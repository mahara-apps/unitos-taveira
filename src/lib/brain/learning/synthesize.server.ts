// ⚠️ Brain Learning Engine — Nightly Synthesis Worker.
//
// Objetivo: agrupar feedback bruto (ex.: 50 `post.rework` no mês) e destilar
// em UM insight consolidado por marca, salvo em `brain_insights`. Assim, o
// prompt da Pauta Mensal recebe uma diretriz curta (~1 linha) em vez de 50
// textos brutos, economizando tokens e melhorando o foco da IA.
//
// Isolamento: usa `supabaseAdmin` (bypassa RLS) mas SEMPRE escopa por
// brand_id. Nenhum vazamento entre marcas.
//
// Modelo: usa o provider de IA configurado por marca (`getBrandAiModel`).
// Marcas sem credenciais são puladas silenciosamente.

import { generateText } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getBrandAiModel } from "@/lib/ai-provider.server";

const LOOKBACK_DAYS = 30;
const MIN_EVENTS_TO_SYNTHESIZE = 3;
const DEDUPE_WINDOW_DAYS = 3;
const MAX_BRANDS_PER_RUN = 20;
const MAX_EVENTS_PER_BRAND = 30;

type ReworkEvent = {
  id: string;
  brand_id: string;
  created_at: string;
  payload: {
    original_title?: string;
    original_copy?: string;
    user_notes?: string;
  };
};

export type SynthesisReport = {
  brands_scanned: number;
  brands_synthesized: number;
  brands_skipped_no_model: number;
  brands_skipped_dedupe: number;
  errors: number;
};

export async function runBrainSynthesis(): Promise<SynthesisReport> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();

  // 1) Pull recent rework events grouped by brand.
  const { data: rawEvents, error } = await supabaseAdmin
    .from("brain_events")
    .select("id, brand_id, created_at, payload")
    .eq("event_type", "post.rework")
    .gte("created_at", since)
    .not("brand_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;

  const byBrand = new Map<string, ReworkEvent[]>();
  for (const row of (rawEvents ?? []) as unknown as ReworkEvent[]) {
    if (!row.brand_id) continue;
    const arr = byBrand.get(row.brand_id) ?? [];
    if (arr.length < MAX_EVENTS_PER_BRAND) arr.push(row);
    byBrand.set(row.brand_id, arr);
  }

  const report: SynthesisReport = {
    brands_scanned: byBrand.size,
    brands_synthesized: 0,
    brands_skipped_no_model: 0,
    brands_skipped_dedupe: 0,
    errors: 0,
  };

  let processed = 0;
  const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 86400_000).toISOString();

  for (const [brandId, events] of byBrand) {
    if (processed >= MAX_BRANDS_PER_RUN) break;
    if (events.length < MIN_EVENTS_TO_SYNTHESIZE) continue;
    processed += 1;

    try {
      // Skip if we already synthesized recently for this brand.
      const { count } = await supabaseAdmin
        .from("brain_insights")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brandId)
        .eq("insight_type", "learned_preference")
        .gte("created_at", dedupeSince);
      if ((count ?? 0) > 0) {
        report.brands_skipped_dedupe += 1;
        continue;
      }

      let model;
      try {
        ({ model } = await getBrandAiModel(supabaseAdmin, brandId, "text", "operational", {
          agent: "brain.synthesize",
        }));
      } catch {
        report.brands_skipped_no_model += 1;
        continue;
      }

      const bulletList = events
        .map((e, i) => {
          const notes = (e.payload?.user_notes ?? "").toString().trim().slice(0, 400);
          const orig = (e.payload?.original_title ?? "").toString().trim().slice(0, 120);
          return `${i + 1}. ${notes || "(sem notas)"}${orig ? `  [post: "${orig}"]` : ""}`;
        })
        .join("\n");

      const prompt = [
        "Você é o Learning Engine do Brain de uma agência de social media.",
        `Abaixo estão ${events.length} pedidos de ajuste (rework) feitos por um mesmo cliente nas últimas semanas.`,
        "Sintetize um ÚNICO parágrafo curto (máx. 2 frases, ≤ 320 caracteres) que descreva o padrão de preferência editorial recorrente deste cliente — algo que a próxima IA deve seguir para não errar de novo.",
        "Seja direto, imperativo e específico (ex: 'Prefere textos curtos, sem emojis e com CTA no final'). Nada de explicações longas.",
        "",
        "PEDIDOS DE AJUSTE:",
        bulletList,
      ].join("\n");

      const { text } = await generateText({ model, prompt });
      const clean = (text ?? "").trim().slice(0, 320);
      if (!clean) continue;

      await supabaseAdmin.from("brain_insights").insert({
        brand_id: brandId,
        insight_type: "learned_preference",
        description: clean,
        confidence: 0.7,
        based_on_events: events.length,
        expires_at: new Date(Date.now() + 90 * 86400_000).toISOString(),
      });
      report.brands_synthesized += 1;
    } catch (err) {
      report.errors += 1;
      console.error("[brain.synthesize] brand", brandId, err);
    }
  }

  return report;
}
