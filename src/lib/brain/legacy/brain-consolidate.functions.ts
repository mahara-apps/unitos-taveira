// ⚠️ Brain API boundary — este arquivo faz parte da plataforma Brain.
// Consumidores externos NÃO devem importar deste módulo diretamente:
// use o namespace `brain` exportado em `src/lib/brain/api.ts`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandAdmin } from "../../access-guard";
import { assertSuperAdmin } from "../../super-admin";
import { generateText } from "ai";
import { getBrandAiModel } from "../../ai-provider.server";

const Input = z.object({ brandId: z.string().uuid().nullable().optional() });

/**
 * Brain — periodic consolidation.
 * Reads recent events per brand and asks the LLM to condense recurring
 * patterns into 3-6 insights. Writes with the admin client (bypasses RLS).
 */
export const brainConsolidateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    // Fase 3: a consolidação escreve com service role (bypassa RLS), então a
    // autorização precisa acontecer ANTES. Um `brandId` do frontend nunca
    // autoriza: exige nível administrativo naquele workspace. A varredura
    // global (sem brandId) é operação de plataforma → só SUPER ADMIN.
    if (data.brandId) {
      await assertBrandAdmin(context.supabase as never, context.userId, data.brandId);
    } else {
      await assertSuperAdmin(context.supabase as never, context.userId);
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const targetBrands: string[] = [];
    if (data.brandId) {
      targetBrands.push(data.brandId);
    } else {
      const { data: rows } = await supabaseAdmin
        .from("brain_events")
        .select("brand_id")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .not("brand_id", "is", null);
      const set = new Set<string>();
      for (const r of rows ?? []) if (r.brand_id) set.add(r.brand_id as string);
      set.forEach((id) => targetBrands.push(id));
    }

    let produced = 0;

    for (const brandId of targetBrands) {
      const { data: events } = await supabaseAdmin
        .from("brain_events")
        .select("event_type, source_module, payload, outcome_score, created_at")
        .eq("brand_id", brandId)
        .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(200);
      if (!events || events.length < 5) continue;

      const digest = events
        .map(
          (e) => `- ${e.source_module}/${e.event_type}: ${JSON.stringify(e.payload).slice(0, 200)}`,
        )
        .join("\n")
        .slice(0, 12000);

      let model;
      try {
        ({ model } = await getBrandAiModel(supabaseAdmin, brandId, "text", "operational", {
          agent: "brain.consolidate",
        }));
      } catch {
        continue; // marca sem chave de IA configurada
      }

      try {
        const { text } = await generateText({
          model,
          system:
            "Você é analista de dados de agência de marketing. Analise eventos recentes de uma marca e devolva insights curtos e acionáveis em JSON. Nunca invente dados fora do que foi fornecido.",
          prompt:
            `Eventos recentes:\n${digest}\n\n` +
            `Devolva um array JSON com 3 a 6 itens no formato:\n` +
            `[{"insight_type":"padrao_conteudo|benchmark_canal|preferencia_cliente","description":"...","confidence":0.0-1.0}]\n` +
            `Só o JSON, sem texto ao redor.`,
        });

        const cleaned = text
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        const parsed = JSON.parse(cleaned) as Array<{
          insight_type: string;
          description: string;
          confidence?: number;
        }>;
        if (!Array.isArray(parsed)) continue;

        // Substitui insights ativos daquela marca (mantém histórico via created_at).
        await supabaseAdmin
          .from("brain_insights")
          .delete()
          .eq("brand_id", brandId)
          .lt("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

        const rows = parsed
          .filter((i) => i.description && i.insight_type)
          .map((i) => ({
            brand_id: brandId,
            insight_type: i.insight_type.slice(0, 64),
            description: i.description.slice(0, 1000),
            confidence:
              typeof i.confidence === "number" ? Math.max(0, Math.min(1, i.confidence)) : null,
            based_on_events: events.length,
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          }));
        if (rows.length) {
          await supabaseAdmin.from("brain_insights").insert(rows);
          produced += rows.length;
        }
      } catch (err) {
        console.error("[brain-consolidate] brand failed", brandId, err);
      }
    }

    return { ok: true as const, brands: targetBrands.length, insights: produced };
  });
