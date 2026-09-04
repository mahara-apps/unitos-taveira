import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBrandAiModel } from "@/lib/ai-provider.server";
import { briefingToPromptText, loadCanonicalBriefing } from "@/lib/briefing-source.server";

const InputSchema = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  monthlyBudget: z.number().nonnegative(),
  objective: z.string().max(2000).optional().nullable(),
  funnelSplit: z.object({ topo: z.number(), meio: z.number(), fundo: z.number() }).optional(),
});

export type AiMediaPlanItem = {
  product_service: string;
  campaign_type: string;
  funnel_stage: "topo" | "meio" | "fundo";
  channel: string;
  main_kpi: string;
  audience: string;
  budget_pct: number;
  keywords: string[];
};

const ItemsSchema = z.object({
  items: z.array(
    z.object({
      product_service: z.string(),
      campaign_type: z.string(),
      funnel_stage: z.enum(["topo", "meio", "fundo"]),
      channel: z.string(),
      main_kpi: z.string(),
      audience: z.string(),
      budget_pct: z.number(),
      keywords: z.array(z.string()),
    }),
  ),
});

function clampItems(items: AiMediaPlanItem[]): AiMediaPlanItem[] {
  const clean = items.slice(0, 12).map((i) => ({
    product_service: String(i.product_service ?? "").slice(0, 280),
    campaign_type: String(i.campaign_type ?? "").slice(0, 120),
    funnel_stage: (["topo", "meio", "fundo"].includes(i.funnel_stage)
      ? i.funnel_stage
      : "meio") as AiMediaPlanItem["funnel_stage"],
    channel: String(i.channel ?? "").slice(0, 120),
    main_kpi: String(i.main_kpi ?? "").slice(0, 160),
    audience: String(i.audience ?? "").slice(0, 400),
    budget_pct: Math.max(0, Math.min(100, Number(i.budget_pct) || 0)),
    keywords: (Array.isArray(i.keywords) ? i.keywords : [])
      .slice(0, 10)
      .map((k) => String(k).slice(0, 60)),
  }));
  // Normalize percentages to sum ~100
  const sum = clean.reduce((s, i) => s + i.budget_pct, 0);
  if (sum > 0 && Math.abs(sum - 100) > 0.5) {
    const k = 100 / sum;
    clean.forEach((i) => (i.budget_pct = Math.round(i.budget_pct * k * 10) / 10));
  }
  return clean;
}

function tryParseFallback(text: string | undefined): AiMediaPlanItem[] {
  if (!text) return [];
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const raw = match ? match[0] : text;
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed?.items) ? parsed.items : [];
    return arr as AiMediaPlanItem[];
  } catch {
    return [];
  }
}

export const generateMediaPlanWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ items: AiMediaPlanItem[] }> => {
    // Load brand + briefing canônico (clients.brand_hub) — best-effort
    const [{ data: brand }, canonical] = await Promise.all([
      context.supabase.from("brands").select("name").eq("id", data.brandId).maybeSingle(),
      loadCanonicalBriefing(context.supabase, {
        clientId: data.clientId,
        brandId: data.brandId,
      }),
    ]);
    const client = {
      name: canonical.clientName,
      niche: canonical.niche,
      tone_of_voice: canonical.hub.tone_text ?? canonical.toneOfVoice,
    };

    const split = data.funnelSplit ?? { topo: 30, meio: 40, fundo: 30 };
    const brief = briefingToPromptText(canonical);

    const budgetBRL = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(data.monthlyBudget);

    const prompt = [
      `Você é um estrategista sênior de mídia paga.`,
      `Monte um plano de mídia mensal para o cliente abaixo em português (Brasil).`,
      ``,
      `Marca: ${brand?.name ?? "—"}`,
      `Cliente: ${client?.name ?? "—"}${client?.niche ? ` (${client.niche})` : ""}`,
      client?.tone_of_voice ? `Tom de voz: ${client.tone_of_voice}` : "",
      brief ? `Briefing/contexto:\n${brief.slice(0, 4000)}` : "",
      data.objective ? `Objetivos declarados: ${data.objective}` : "",
      ``,
      `Orçamento mensal total: ${budgetBRL}`,
      `Distribuição alvo por etapa do funil (aproximada, em %): topo=${split.topo}, meio=${split.meio}, fundo=${split.fundo}.`,
      ``,
      `Regras estritas:`,
      `- Gere entre 6 e 10 iniciativas.`,
      `- Cada iniciativa deve conter: product_service, campaign_type, funnel_stage (topo|meio|fundo), channel (ex: Meta Ads, Google Search, YouTube, TikTok Ads, LinkedIn Ads, Programmatic), main_kpi (ex: CPL, CTR, ROAS, CPV, CPA), audience (público-alvo objetivo), budget_pct (número, 0 a 100), keywords (array com até 6 termos).`,
      `- A soma de budget_pct deve ser exatamente 100.`,
      `- Balanceie os canais evitando concentração excessiva em um único canal.`,
      `- Escreva textos objetivos, sem markdown, sem prefixos como "1." ou "-".`,
      `- Retorne EXATAMENTE um objeto JSON { "items": [...] } que respeite o schema.`,
    ]
      .filter(Boolean)
      .join("\n");

    const { model } = await getBrandAiModel(context.supabase, data.brandId, "text", "strategic", {
      agent: "media-plan.generate",
      clientId: data.clientId ?? null,
      userId: context.userId,
    });

    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: ItemsSchema }),
        prompt,
      });
      return { items: clampItems((output as { items: AiMediaPlanItem[] }).items ?? []) };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        const items = tryParseFallback((error as { text?: string }).text);
        if (items.length > 0) return { items: clampItems(items) };
      }
      const msg = error instanceof Error ? error.message : "ai_generation_failed";
      throw new Error(msg);
    }
  });
