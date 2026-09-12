import { describe, expect, it } from "vitest";
import {
  mediaPlanBudgetSummary,
  mediaPlanDraftToPayload,
} from "@/components/media-plans/media-plan-editor";
import type { MediaPlanItem } from "@/lib/media-plans.functions";

function item(patch: Partial<MediaPlanItem>): MediaPlanItem {
  return {
    id: crypto.randomUUID(), plan_id: crypto.randomUUID(), position: 0,
    product_service: null, campaign_type: null, funnel_stage: null,
    objective: null, main_kpi: null, channel: null, audience: null,
    budget_pct: 0, budget_amount: 0, keywords: [], benchmark: null,
    other_refs: null, platform: null, campaign_subtype: null,
    optimization_goal: null, conversion_event: null, daily_budget: 0,
    targeting: {}, placements: [], creative_brief: {}, estimates: {},
    prerequisites: [], rationale: null, ...patch,
  };
}

describe("apresentação do plano de mídia", () => {
  it("calcula totais, saldo e subtotais por etapa", () => {
    const summary = mediaPlanBudgetSummary([
      item({ funnel_stage: "topo", budget_pct: 30, budget_amount: 3000 }),
      item({ funnel_stage: "topo", budget_pct: 10, budget_amount: 1000 }),
      item({ funnel_stage: "fundo", budget_pct: 20, budget_amount: 2000 }),
    ], 10000);
    expect(summary.allocatedPct).toBe(60);
    expect(summary.allocatedAmount).toBe(6000);
    expect(summary.availablePct).toBe(40);
    expect(summary.availableAmount).toBe(4000);
    expect(summary.byStage.topo).toEqual({ pct: 40, amount: 4000 });
    expect(summary.byStage.meio).toEqual({ pct: 0, amount: 0 });
  });

  it("preserva os 12 campos e separa palavras-chave ao salvar", () => {
    const payload = mediaPlanDraftToPayload({
      id: "8347ea9c-dbbb-4aa0-b3cf-ccef3b1fbe22",
      product_service: " Consultoria ", campaign_type: "Leads", funnel_stage: "meio",
      objective: "Conversão", main_kpi: "CPL R$ 8", channel: "Meta Ads",
      audience: "Visitantes", budget_pct: 25,
      keywords: "consultoria, gestão, consultoria", benchmark: "CTR 1,4%",
      other_refs: "Campanha anterior",
    });
    expect(payload).toMatchObject({
      product_service: "Consultoria", campaign_type: "Leads", funnel_stage: "meio",
      objective: "Conversão", main_kpi: "CPL R$ 8", channel: "Meta Ads",
      audience: "Visitantes", budget_pct: 25, benchmark: "CTR 1,4%",
      other_refs: "Campanha anterior",
    });
    expect(payload.keywords).toEqual(["consultoria", "gestão", "consultoria"]);
    expect(Object.keys(payload)).toHaveLength(12);
  });
});
