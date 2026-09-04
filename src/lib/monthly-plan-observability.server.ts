import type { SupabaseClient } from "@supabase/supabase-js";
import type { FailureKind } from "@/lib/ai-failures.server";

/**
 * Observabilidade do pipeline canônico de Pauta.
 *
 * Mesmo contrato dos pipelines de Estratégia IA e Copy:
 *   - progresso e etapa atual em `ai_jobs` (a própria trava de geração);
 *   - tentativas, classificação de falha e resultado em `activity_events`.
 *
 * Nenhuma alteração de schema: usa as tabelas já existentes.
 */

export type PlanStep =
  | "contexto"
  | "volumetria"
  | "estrategia"
  | "prompt"
  | "ia"
  | "normalizacao"
  | "persistencia";

/** Rótulos e progresso por etapa — exibidos no dock de gerações. */
const STEP_META: Record<PlanStep, { label: string; progress: number }> = {
  contexto: { label: "Lendo briefing e contexto da marca", progress: 10 },
  volumetria: { label: "Calculando volumetria por canal e formato", progress: 20 },
  estrategia: { label: "Cruzando estratégia e desempenho real", progress: 35 },
  prompt: { label: "Montando o prompt da pauta", progress: 45 },
  ia: { label: "Gerando ideias com a IA", progress: 60 },
  normalizacao: { label: "Distribuindo ideias nas vagas contratadas", progress: 85 },
  persistencia: { label: "Salvando a pauta", progress: 95 },
};

export async function setPlanJobStep(
  supabase: SupabaseClient,
  jobId: string | null | undefined,
  step: PlanStep,
  extra?: string,
): Promise<void> {
  if (!jobId) return;
  const meta = STEP_META[step];
  try {
    await supabase
      .from("ai_jobs")
      .update({
        status: "running",
        progress: meta.progress,
        step_label: extra ? `${meta.label} — ${extra}` : meta.label,
      })
      .eq("id", jobId);
  } catch (err) {
    console.warn("[monthly-plan] step update failed", err);
  }
}

/** Guarda o checkpoint de retomada (plano criado + tópicos já salvos). */
export async function setPlanJobCheckpoint(
  supabase: SupabaseClient,
  jobId: string | null | undefined,
  checkpoint: { monthly_plan_id: string; topics_saved: number; period: string },
): Promise<void> {
  if (!jobId) return;
  try {
    await supabase.from("ai_jobs").update({ result: checkpoint }).eq("id", jobId);
  } catch (err) {
    console.warn("[monthly-plan] checkpoint failed", err);
  }
}

export async function logPlanEvent(
  supabase: SupabaseClient,
  scope: { brandId: string; clientId: string; userId: string; planId?: string | null },
  payload: {
    step: PlanStep | "retomada" | "conclusao";
    ok: boolean;
    attempt?: number;
    kind?: FailureKind;
    retryable?: boolean;
    message?: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // Telemetria é infraestrutura: `activity_events` não tem policy de INSERT
    // para `authenticated`, então o registro usa o client admin (mesmo padrão
    // dos pipelines de Estratégia IA e Copy). Sem isso as tentativas da Pauta
    // ficavam invisíveis.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const writer = (supabaseAdmin ?? supabase) as SupabaseClient;
    const { error } = await writer.from("activity_events").insert({
      brand_id: scope.brandId,
      client_id: scope.clientId,
      actor_id: scope.userId,
      entity_type: "monthly_plan",
      entity_id: scope.planId ?? null,
      verb: payload.ok ? "plan_step_ok" : "plan_step_failed",
      payload: {
        pipeline: "pauta.suggest",
        ...payload,
        at: new Date().toISOString(),
      },
    } as never);
    if (error) console.warn("[monthly-plan] log falhou", error.message);
    if (!payload.ok) {
      console.warn(
        `[monthly-plan] etapa ${payload.step} falhou (${payload.kind ?? "?"}): ${payload.message ?? ""}`,
      );
    }
  } catch {
    // auditoria não crítica
  }
}
