// ⚠️ Brain Learning Engine — fila de aprendizado.
//
// A fila é alimentada pelo TRIGGER `enqueue_brain_event_for_learning` em
// brain_events: todo evento registrado já entra na fila com `event_id`. Esta
// camada NÃO duplica esse enfileiramento — só observa a fila e permite
// re-enfileirar um evento específico (reprocessamento).
//
// Status canônicos (alinhados ao worker SQL): queued → done | failed | skipped.
import type { BrainContext } from "../core";
import { brainFail } from "../observability";
import { waitUntil } from "@/lib/wait-until.server";

export const QUEUE_STATUS = {
  queued: "queued",
  done: "done",
  failed: "failed",
  skipped: "skipped",
} as const;

/** Re-enfileira um evento já registrado para reprocessamento pelo worker. */
export async function requeueEvent(ctx: BrainContext, eventId: string): Promise<void> {
  waitUntil(
    (async () => {
      const { error } = await ctx.supabase.from("brain_learning_queue").insert({
        brand_id: ctx.brandId ?? null,
        event_id: eventId,
        status: QUEUE_STATUS.queued,
        attempts: 0,
      });
      if (error) console.error("[brain.learning.requeue]", error.message);
    })(),
  );
}

/** Itens aguardando processamento pelo worker. */
export async function pending(ctx: BrainContext): Promise<number> {
  const q = ctx.supabase
    .from("brain_learning_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", QUEUE_STATUS.queued);
  const { count, error } = ctx.brandId ? await q.eq("brand_id", ctx.brandId) : await q;
  if (error) brainFail("learning.pending", error, ctx);
  return count ?? 0;
}

/** Itens que o worker não conseguiu processar (visível no diagnóstico). */
export async function failed(ctx: BrainContext): Promise<number> {
  const q = ctx.supabase
    .from("brain_learning_queue")
    .select("*", { count: "exact", head: true })
    .eq("status", QUEUE_STATUS.failed);
  const { count, error } = ctx.brandId ? await q.eq("brand_id", ctx.brandId) : await q;
  if (error) brainFail("learning.failed", error, ctx);
  return count ?? 0;
}
