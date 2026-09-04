import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isLeaseValid,
  jobTtlMs,
  leaseExpiryIso,
  newLeaseOwner,
  type LeaseJob,
} from "@/lib/ai-job-lease";

/**
 * Trava server-side contra geração duplicada de pauta.
 *
 * Usa `ai_jobs` (kind = "monthly_plan") como registro de execução com LEASE:
 *   1. insere a própria trava já com `lease_owner` + `lease_expires_at`;
 *   2. relê as travas do mesmo brand + client + período e ignora as que já
 *      perderam a lease (worker morto);
 *   3. se a trava válida mais antiga não é a minha, libera a minha e devolve
 *      conflito — nenhum processamento duplicado é iniciado;
 *   4. enquanto gera, renova a lease (`ai_job_heartbeat`), então o reaper
 *      (`reap_stuck_ai_jobs`) nunca encerra uma geração ainda válida.
 */

const LOCK_KIND = "monthly_plan";
/** Duração de cada lease; renovada por heartbeat enquanto a geração roda. */
const LEASE_SECONDS = 120;
const HEARTBEAT_MS = 45_000;

export type PlanLock = { jobId: string; owner: string } | { conflict: true };

type LockRow = LeaseJob & { id: string; created_at: string };

export async function acquirePlanGenerationLock(
  supabase: SupabaseClient,
  args: { brandId: string; clientId: string; userId: string; period: string },
): Promise<PlanLock> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const owner = newLeaseOwner("monthly-plan");
  const { data: mine, error } = await supabase
    .from("ai_jobs")
    .insert({
      brand_id: args.brandId,
      client_id: args.clientId,
      user_id: args.userId,
      kind: LOCK_KIND,
      title: "Gerando pauta mensal",
      status: "running",
      started_at: nowIso,
      step_label: "Gerando pauta",
      input: { period: args.period, lock: true },
      lease_owner: owner,
      lease_expires_at: leaseExpiryIso(LEASE_SECONDS, nowMs),
      heartbeat_at: nowIso,
    })
    .select("id, created_at")
    .single();
  if (error) throw error;
  const lockId = (mine as { id: string }).id;

  // Janela ampla o suficiente para o TTL do tipo; a validade real é decidida
  // pela lease (isLeaseValid), não pela idade do registro.
  const since = new Date(nowMs - jobTtlMs(LOCK_KIND) * 2).toISOString();
  const { data: active, error: readErr } = await supabase
    .from("ai_jobs")
    .select("id, kind, status, created_at, updated_at, heartbeat_at, lease_owner, lease_expires_at")
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .eq("kind", LOCK_KIND)
    .eq("status", "running")
    .gte("created_at", since)
    .filter("input->>period", "eq", args.period)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (readErr) {
    await releasePlanGenerationLock(supabase, lockId, { ok: false, error: readErr.message });
    throw readErr;
  }

  const holder = pickLockHolder((active ?? []) as unknown as LockRow[], Date.now());
  if (holder && holder.id !== lockId) {
    await releasePlanGenerationLock(supabase, lockId, {
      ok: false,
      error: "generation_in_progress",
    });
    return { conflict: true };
  }
  return { jobId: lockId, owner };
}

/**
 * Dono legítimo da trava: a mais antiga entre as que AINDA têm lease válida.
 * Travas órfãs (lease expirada) não bloqueiam uma nova execução.
 */
export function pickLockHolder(rows: LockRow[], now: number = Date.now()): LockRow | undefined {
  return rows
    .filter((r) => isLeaseValid(r, now))
    .sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
}

/** Renova a lease. `false` => perdemos a trava (não somos mais o dono). */
export async function heartbeatPlanGenerationLock(
  supabase: SupabaseClient,
  jobId: string,
  owner: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("ai_job_heartbeat", {
    _job_id: jobId,
    _owner: owner,
    _lease_seconds: LEASE_SECONDS,
  });
  if (error) return false;
  return data === true;
}

/**
 * Mantém a lease viva durante a geração. Devolve um `stop()` idempotente.
 */
export function startPlanLockHeartbeat(
  supabase: SupabaseClient,
  lock: { jobId: string; owner: string },
): () => void {
  const timer = setInterval(() => {
    void heartbeatPlanGenerationLock(supabase, lock.jobId, lock.owner).catch(() => undefined);
  }, HEARTBEAT_MS);
  return () => clearInterval(timer);
}

export async function releasePlanGenerationLock(
  supabase: SupabaseClient,
  jobId: string,
  outcome: { ok: boolean; error?: string; planId?: string },
): Promise<void> {
  try {
    await supabase
      .from("ai_jobs")
      .update({
        status: outcome.ok ? "succeeded" : "failed",
        progress: outcome.ok ? 100 : 0,
        finished_at: new Date().toISOString(),
        error: outcome.error ? outcome.error.slice(0, 2000) : null,
        // Libera a lease: o job terminou e não deve mais ser considerado ativo.
        lease_owner: null,
        lease_expires_at: null,
        ...(outcome.planId ? { result: { monthly_plan_id: outcome.planId } } : {}),
      })
      .eq("id", jobId);
  } catch (err) {
    console.warn("[monthly-plan] release lock failed", err);
  }
}
