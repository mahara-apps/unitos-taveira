/**
 * Histórico auditável de AÇÕES CRÍTICAS.
 *
 * Gravado SEMPRE no servidor, dentro da própria ação e depois da checagem de
 * permissão — nunca pela tela, para não haver como burlar. Sem PII sensível no
 * payload: apenas o resumo do impacto.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { CRITICAL_ACTIONS, type CriticalActionKey } from "@/lib/critical-actions";

export type CriticalAuditInput = {
  action: CriticalActionKey;
  actorId: string;
  targetId?: string | null;
  targetLabel?: string | null;
  brandId?: string | null;
  /** Resumo do impacto — campos alterados, contagens, versões. Sem dados sensíveis. */
  impact?: Record<string, unknown>;
  result?: "success" | "error";
  errorMessage?: string | null;
};

/**
 * Nunca lança: falha de auditoria não deve derrubar a ação já autorizada, mas
 * fica visível no log do servidor.
 */
export async function logCriticalAction(
  supabase: SupabaseClient,
  input: CriticalAuditInput,
): Promise<void> {
  try {
    const def = CRITICAL_ACTIONS[input.action];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const client = supabaseAdmin ?? supabase;
    const { error } = await client.from("critical_action_events").insert({
      actor_id: input.actorId,
      action_key: input.action,
      target_type: def?.targetType ?? "unknown",
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      brand_id: input.brandId ?? null,
      impact: { summary: def?.impact ?? null, ...(input.impact ?? {}) },
      result: input.result ?? "success",
      error_message: input.errorMessage ?? null,
    } as never);
    if (error) console.error("[critical-audit] insert failed", error.message);
  } catch (e) {
    console.error("[critical-audit] unexpected failure", e instanceof Error ? e.message : e);
  }
}

/** Envolve uma ação crítica: registra sucesso e erro com o mesmo contexto. */
export async function withCriticalAudit<T>(
  supabase: SupabaseClient,
  input: CriticalAuditInput,
  run: () => Promise<T>,
): Promise<T> {
  try {
    const out = await run();
    await logCriticalAction(supabase, { ...input, result: "success" });
    return out;
  } catch (e) {
    await logCriticalAction(supabase, {
      ...input,
      result: "error",
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}
