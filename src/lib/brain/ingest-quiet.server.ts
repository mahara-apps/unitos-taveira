// ⚠️ Brain API boundary — fire-and-forget ingest usado por módulos externos
// que precisam registrar eventos em background (ex.: content pipeline).
// Este é o ÚNICO caminho autorizado a inserir em `brain_events` a partir
// de callers que já detêm um SupabaseClient autenticado.
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitUntil } from "../wait-until.server";
import { sanitizeEventPayload } from "./event-bus";

export function ingestBrainQuiet(
  supabase: SupabaseClient,
  brandId: string,
  eventType: string,
  sourceModule: string,
  payload: Record<string, unknown>,
) {
  waitUntil(
    (async () => {
      try {
        const { data: row } = await supabase
          .from("brain_events")
          .insert({
            brand_id: brandId,
            event_type: eventType,
            source_module: sourceModule,
            payload: sanitizeEventPayload(payload) as never,
          })
          .select("id")
          .single();
        if (!row) return;
        const [{ supabaseAdmin }, embed] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("./legacy/brain-embed.server"),
        ]);
        const summary = embed.summarizeEvent({
          event_type: eventType,
          source_module: sourceModule,
          payload,
        });
        await embed.embedEventNow(supabaseAdmin, row.id as string, brandId, summary);
      } catch (err) {
        console.error("[brain.ingestQuiet] failed", err);
      }
    })(),
  );
}
