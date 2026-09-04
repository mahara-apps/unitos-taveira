import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_CHANNELS, type PlanChannel } from "@/lib/monthly-plan-fields";
import { currentMonthStartISO } from "@/lib/timezone";

/**
 * Primeiro dia do mês corrente no fuso oficial de Brasília (YYYY-MM-DD).
 * Em UTC, a virada de mês acontecia 3h antes do horário de Brasília.
 */
export function currentPeriodMonth(now: Date = new Date()): string {
  return currentMonthStartISO(now);
}

export type OverageMap = Record<PlanChannel, number>;

function emptyMap(): OverageMap {
  return PLAN_CHANNELS.reduce<OverageMap>((acc, c) => {
    acc[c] = 0;
    return acc;
  }, {} as OverageMap);
}

/** Excedentes já autorizados no mês corrente, por canal. */
export async function loadApprovedOverage(
  supabase: SupabaseClient,
  args: { brandId?: string; clientId: string; periodMonth?: string },
): Promise<OverageMap> {
  const map = emptyMap();
  let q = supabase
    .from("plan_overage_requests" as never)
    .select("channel, overage, status")
    .eq("client_id", args.clientId)
    .eq("period_month", args.periodMonth ?? currentPeriodMonth())
    .eq("status", "approved");
  if (args.brandId) q = q.eq("brand_id", args.brandId);
  const { data } = await q;
  for (const r of (data ?? []) as Array<{ channel: string; overage: number }>) {
    const c = (r.channel ?? "").toLowerCase() as PlanChannel;
    if (c in map) map[c] = (map[c] ?? 0) + (Number(r.overage) || 0);
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Política de volumetria (bloquear × avisar) e bypass hierárquico    */
/* ------------------------------------------------------------------ */

/** `block` = excedente exige liberação. `warn` = volumetria livre (só aviso). */
export type OveragePolicy = "block" | "warn";

const isPolicy = (v: unknown): v is OveragePolicy => v === "block" || v === "warn";

/**
 * Política efetiva: override do cliente vence; sem override usa o padrão do
 * workspace; sem nada, `block` (comportamento histórico).
 */
export async function resolveOveragePolicy(
  supabase: SupabaseClient,
  args: { brandId: string; clientId?: string | null },
): Promise<OveragePolicy> {
  const [brandRes, clientRes] = await Promise.all([
    supabase
      .from("brands" as never)
      .select("overage_policy")
      .eq("id", args.brandId)
      .maybeSingle(),
    args.clientId
      ? supabase
          .from("clients" as never)
          .select("overage_policy")
          .eq("id", args.clientId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const clientPolicy = (clientRes.data as { overage_policy?: unknown } | null)?.overage_policy;
  if (isPolicy(clientPolicy)) return clientPolicy;
  const brandPolicy = (brandRes.data as { overage_policy?: unknown } | null)?.overage_policy;
  return isPolicy(brandPolicy) ? brandPolicy : "block";
}

/**
 * Papéis com autoridade para gerar acima da volumetria sem pedir liberação:
 * Super Admin, Owner e Admin (o banco mapeia owner→admin em `app_access_role`).
 * Manager e User continuam solicitando.
 */
export async function canBypassOverage(
  supabase: SupabaseClient,
  userId: string,
  brandId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("app_access_role" as never, {
    _user_id: userId,
    _brand_id: brandId,
  } as never);
  if (error) return false;
  return data === "super_admin" || data === "admin";
}

export type OverageItem = {
  channel: PlanChannel;
  quota: number;
  requested: number;
  overage: number;
};

/** Motivo do registro automático do excedente (auditoria). */
export type AutoOverageReason = "role_bypass" | "policy_warn";

/**
 * Registra o excedente já autorizado (sem passar por aprovação), preservando
 * o histórico em Produção. Best-effort: falha aqui não invalida a geração.
 */
export async function autoAuthorizeOverage(
  supabase: SupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    userId: string;
    items: OverageItem[];
    reason: AutoOverageReason;
    periodMonth?: string;
  },
): Promise<number> {
  if (!args.items.length) return 0;
  const now = new Date().toISOString();
  const rows = args.items.map((it) => ({
    brand_id: args.brandId,
    client_id: args.clientId,
    channel: it.channel,
    period_month: args.periodMonth ?? currentPeriodMonth(),
    quota: it.quota,
    requested: it.requested,
    overage: it.overage,
    justification:
      args.reason === "role_bypass"
        ? "Liberado automaticamente (autoridade do usuário)"
        : "Volumetria livre configurada (sem bloqueio)",
    status: "approved",
    requested_by: args.userId,
    decided_by: args.userId,
    decided_at: now,
  }));
  const { error } = await supabase.from("plan_overage_requests" as never).insert(rows as never);
  if (error) {
    console.warn("[plan-overage] auto authorize failed", error);
    return 0;
  }
  return rows.length;
}

/**
 * Decide se a geração pode seguir acima da volumetria.
 * Quando pode, registra os excedentes como autorizados.
 */
export async function tryAutoAuthorizeOverage(
  supabase: SupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    userId: string;
    items: OverageItem[];
    periodMonth?: string;
  },
): Promise<{ allowed: boolean; reason?: AutoOverageReason }> {
  if (!args.items.length) return { allowed: true };
  const [bypass, policy] = await Promise.all([
    canBypassOverage(supabase, args.userId, args.brandId),
    resolveOveragePolicy(supabase, { brandId: args.brandId, clientId: args.clientId }),
  ]);
  const reason: AutoOverageReason | null = bypass
    ? "role_bypass"
    : policy === "warn"
      ? "policy_warn"
      : null;
  if (!reason) return { allowed: false };
  await autoAuthorizeOverage(supabase, { ...args, reason });
  return { allowed: true, reason };
}
