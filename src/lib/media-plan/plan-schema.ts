import { z } from "zod";

/**
 * Contrato de saída do agente de mídia paga.
 *
 * Schema deliberadamente sem limites (`.min`/`.max`/`length`): provedores
 * rejeitam schemas muito restritos e, quando aceitam, a validação pós-geração
 * quebra a chamada inteira. Os limites reais (caracteres de título/descrição,
 * soma de verba) são aplicados em `normalizeGeneratedPlan`.
 */

export const PLATFORMS = ["meta", "google"] as const;
export const FUNNEL_STAGES = ["topo", "meio", "fundo"] as const;

export const CreativeBriefSchema = z.object({
  angles: z.array(z.string()),
  headlines: z.array(z.string()),
  descriptions: z.array(z.string()),
  cta: z.string(),
  visual_ideas: z.array(z.string()),
});

export const CampaignSchema = z.object({
  name: z.string(),
  platform: z.enum(PLATFORMS),
  /** Tipo oficial da plataforma. Ex.: "Vendas (catálogo)", "Performance Max". */
  campaign_type: z.string(),
  campaign_subtype: z.string(),
  funnel_stage: z.enum(FUNNEL_STAGES),
  objective: z.string(),
  optimization_goal: z.string(),
  conversion_event: z.string(),
  audience: z.string(),
  targeting_notes: z.string(),
  placements: z.array(z.string()),
  budget_pct: z.number(),
  main_kpi: z.string(),
  keywords: z.array(z.string()),
  negative_keywords: z.array(z.string()),
  estimates: z.object({
    cpa_range: z.string(),
    volume_range: z.string(),
    notes: z.string(),
  }),
  prerequisites: z.array(z.string()),
  rationale: z.string(),
  creative: CreativeBriefSchema,
});

export const GeneratedPlanSchema = z.object({
  summary: z.string(),
  platform_split_rationale: z.string(),
  funnel_split: z.object({
    topo: z.number(),
    meio: z.number(),
    fundo: z.number(),
  }),
  funnel_rationale: z.string(),
  warnings: z.array(z.string()),
  campaigns: z.array(CampaignSchema),
});

export type GeneratedCampaign = z.infer<typeof CampaignSchema>;
export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>;

/** Limites reais de texto por plataforma (aplicados no pós-processamento). */
export const CREATIVE_LIMITS = {
  meta: { headline: 40, description: 30, body: 125 },
  google: { headline: 30, description: 90, body: 90 },
} as const;
