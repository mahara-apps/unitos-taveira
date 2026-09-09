import { CREATIVE_LIMITS, type GeneratedCampaign, type GeneratedPlan } from "./plan-schema";

const clampText = (s: unknown, max: number) =>
  String(s ?? "")
    .trim()
    .slice(0, max);

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Distribuição do funil normalizada para somar exatamente 100. */
export function normalizeFunnelSplit(split: { topo: number; meio: number; fundo: number }) {
  const raw = {
    topo: Math.max(0, Number(split?.topo) || 0),
    meio: Math.max(0, Number(split?.meio) || 0),
    fundo: Math.max(0, Number(split?.fundo) || 0),
  };
  const sum = raw.topo + raw.meio + raw.fundo;
  if (sum <= 0) return { topo: 30, meio: 40, fundo: 30 };
  const k = 100 / sum;
  const topo = round1(raw.topo * k);
  const meio = round1(raw.meio * k);
  return { topo, meio, fundo: round1(100 - topo - meio) };
}

function normalizeCampaign(c: GeneratedCampaign): GeneratedCampaign {
  const limits = CREATIVE_LIMITS[c.platform] ?? CREATIVE_LIMITS.meta;
  return {
    ...c,
    name: clampText(c.name, 120),
    campaign_type: clampText(c.campaign_type, 120),
    campaign_subtype: clampText(c.campaign_subtype, 120),
    objective: clampText(c.objective, 400),
    optimization_goal: clampText(c.optimization_goal, 160),
    conversion_event: clampText(c.conversion_event, 160),
    audience: clampText(c.audience, 600),
    targeting_notes: clampText(c.targeting_notes, 900),
    placements: (c.placements ?? []).slice(0, 12).map((p) => clampText(p, 80)),
    budget_pct: Math.max(0, Math.min(100, Number(c.budget_pct) || 0)),
    main_kpi: clampText(c.main_kpi, 120),
    keywords: (c.keywords ?? []).slice(0, 20).map((k) => clampText(k, 80)),
    negative_keywords: (c.negative_keywords ?? []).slice(0, 20).map((k) => clampText(k, 80)),
    estimates: {
      cpa_range: clampText(c.estimates?.cpa_range, 120),
      volume_range: clampText(c.estimates?.volume_range, 120),
      notes: clampText(c.estimates?.notes, 400),
    },
    prerequisites: (c.prerequisites ?? []).slice(0, 10).map((p) => clampText(p, 200)),
    rationale: clampText(c.rationale, 900),
    creative: {
      angles: (c.creative?.angles ?? []).slice(0, 6).map((a) => clampText(a, 200)),
      headlines: (c.creative?.headlines ?? [])
        .slice(0, 15)
        .map((h) => clampText(h, limits.headline)),
      descriptions: (c.creative?.descriptions ?? [])
        .slice(0, 6)
        .map((d) => clampText(d, limits.description)),
      cta: clampText(c.creative?.cta, 40),
      visual_ideas: (c.creative?.visual_ideas ?? []).slice(0, 6).map((v) => clampText(v, 240)),
    },
  };
}

/**
 * Pós-processamento determinístico do plano gerado: limites de texto reais,
 * verba somando 100% e no máximo 8 campanhas (verba pulverizada não sai da
 * fase de aprendizado).
 */
export function normalizeGeneratedPlan(plan: GeneratedPlan): GeneratedPlan {
  const campaigns = (plan.campaigns ?? []).slice(0, 8).map(normalizeCampaign);
  const sum = campaigns.reduce((s, c) => s + c.budget_pct, 0);
  if (campaigns.length > 0) {
    if (sum <= 0) {
      const even = round1(100 / campaigns.length);
      campaigns.forEach((c, i) => {
        c.budget_pct =
          i === campaigns.length - 1 ? round1(100 - even * (campaigns.length - 1)) : even;
      });
    } else if (Math.abs(sum - 100) > 0.1) {
      const k = 100 / sum;
      campaigns.forEach((c) => (c.budget_pct = round1(c.budget_pct * k)));
      const drift = round1(100 - campaigns.reduce((s, c) => s + c.budget_pct, 0));
      const last = campaigns[campaigns.length - 1]!;
      last.budget_pct = round1(last.budget_pct + drift);
    }
  }
  return {
    summary: clampText(plan.summary, 1600),
    platform_split_rationale: clampText(plan.platform_split_rationale, 900),
    funnel_split: normalizeFunnelSplit(plan.funnel_split ?? { topo: 0, meio: 0, fundo: 0 }),
    funnel_rationale: clampText(plan.funnel_rationale, 900),
    warnings: (plan.warnings ?? []).slice(0, 10).map((w) => clampText(w, 240)),
    campaigns,
  };
}

/** Quantas campanhas cabem numa verba mensal sem pulverizar (R$/dia por campanha). */
export function maxCampaignsForBudget(monthlyBudget: number): number {
  const daily = monthlyBudget / 30;
  if (daily < 30) return 1;
  if (daily < 70) return 2;
  if (daily < 150) return 3;
  if (daily < 400) return 5;
  return 8;
}
