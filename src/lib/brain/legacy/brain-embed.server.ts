// ⚠️ Brain API boundary — este arquivo faz parte da plataforma Brain.
// Consumidores externos NÃO devem importar deste módulo diretamente:
// use o namespace `brain` exportado em `src/lib/brain/api.ts`.
/**
 * Server-only worker helpers for the Brain memory layer.
 * NEVER import from route/component/*.functions.ts module scope.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Cria embedding com a chave de API da própria marca. Null em falha. */
export async function embedText(
  supabase: SupabaseClient,
  brandId: string,
  text: string,
): Promise<number[] | null> {
  const { embedTextWithBrandKey } = await import("@/lib/ai-provider.server");
  return embedTextWithBrandKey(supabase, brandId, text);
}

/** Resumo curto legível para busca semântica. */
export function summarizeEvent(input: {
  event_type: string;
  source_module: string;
  payload: unknown;
}): string {
  const p = (input.payload ?? {}) as Record<string, unknown>;
  const bits: string[] = [`[${input.source_module}/${input.event_type}]`];
  const push = (k: string) => {
    const v = p[k];
    if (typeof v === "string" && v.trim()) bits.push(`${k}: ${v.trim().slice(0, 300)}`);
    else if (typeof v === "number") bits.push(`${k}: ${v}`);
  };
  [
    "title",
    "channel",
    "channels",
    "format",
    "stage",
    "decision",
    "note",
    "objective",
    "kpi",
    "budget",
  ].forEach(push);
  if (bits.length === 1) bits.push(JSON.stringify(p).slice(0, 400));
  return bits.join(" · ");
}

/**
 * Persiste o embedding de um evento (idempotente).
 *
 * Regras:
 * - se já existe embedding para o evento, não gera outro (evita custo e
 *   duplicidade em reprocessamento/retry do worker);
 * - o vetor é validado antes de gravar — falha de provider não deixa linha
 *   pela metade (a coluna é NOT NULL no banco);
 * - o vínculo de escopo (`brand_id`/`client_id`) vem do próprio evento.
 */
export async function embedEventNow(
  supabaseAdmin: SupabaseClient,
  eventId: string,
  brandId: string,
  summary: string,
) {
  const { isValidEmbedding } = await import("@/lib/embeddings");

  // Idempotência: um embedding por evento.
  const { data: existing } = await supabaseAdmin
    .from("brain_embeddings")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (existing) return;

  // Escopo canônico: o evento é a fonte da verdade de brand/cliente.
  const { data: event } = await supabaseAdmin
    .from("brain_events")
    .select("brand_id, client_id")
    .eq("id", eventId)
    .maybeSingle();
  const scopedBrandId = (event?.brand_id as string | null) ?? brandId;
  if (!scopedBrandId) return;

  const vec = await embedText(supabaseAdmin, scopedBrandId, summary);
  if (!isValidEmbedding(vec)) return;

  const { error } = await supabaseAdmin.from("brain_embeddings").upsert(
    {
      brand_id: scopedBrandId,
      client_id: (event?.client_id as string | null) ?? null,
      event_id: eventId,
      content_summary: summary,
      // pgvector accepts an array through supabase-js
      embedding: vec as unknown as string,
    },
    { onConflict: "event_id", ignoreDuplicates: true },
  );
  if (error) console.error("[brain.embed] persist failed", error.message);
}
