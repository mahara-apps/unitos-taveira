import { describe, expect, it } from "vitest";
import {
  interviewBudget,
  interviewToPromptText,
  isInterviewComplete,
  parseMoney,
  visibleQuestions,
} from "@/lib/media-plan/interview-schema";
import {
  maxCampaignsForBudget,
  normalizeFunnelSplit,
  normalizeGeneratedPlan,
} from "@/lib/media-plan/normalize";
import type { GeneratedPlan } from "@/lib/media-plan/plan-schema";

describe("entrevista de mídia paga", () => {
  it("mostra perguntas extras conforme as respostas (fluxo adaptativo)", () => {
    const base = visibleQuestions({});
    const ids = base.map((q) => q.id);
    expect(ids).not.toContain("coverage_detail");
    expect(ids).not.toContain("catalog_size");

    const branched = visibleQuestions({
      coverage: "city",
      business_model: "ecommerce",
      history: "tried_failed",
    }).map((q) => q.id);
    expect(branched).toContain("coverage_detail");
    expect(branched).toContain("catalog_size");
    expect(branched).toContain("history_detail");
  });

  it("não exige resposta em perguntas opcionais", () => {
    const answers: Record<string, string | string[]> = {};
    for (let pass = 0; pass < 5; pass += 1) {
      for (const q of visibleQuestions(answers)) {
        if (q.id === "constraints") continue;
        if (answers[q.id] != null) continue;
        answers[q.id] = q.kind === "multi" ? ["website"] : (q.options?.[0]?.value ?? "resposta");
      }
    }
    expect(isInterviewComplete(answers)).toBe(true);
  });

  it("lê o orçamento em formatos brasileiros", () => {
    expect(parseMoney("R$ 3.000")).toBe(3000);
    expect(parseMoney("2500,50")).toBe(2500.5);
    expect(parseMoney("abc")).toBe(0);
    expect(interviewBudget({ monthly_budget: "1.200" })).toBe(1200);
  });

  it("serializa a entrevista com o rótulo escolhido", () => {
    const text = interviewToPromptText({ business_model: "ecommerce", goal_30d: "leads" });
    expect(text).toContain("Vende produtos pelo site");
    expect(text).toContain("Receber contatos");
  });
});

describe("normalização do plano gerado", () => {
  it("fecha a divisão do funil em 100", () => {
    const s = normalizeFunnelSplit({ topo: 20, meio: 20, fundo: 20 });
    expect(s.topo + s.meio + s.fundo).toBeCloseTo(100, 5);
    expect(normalizeFunnelSplit({ topo: 0, meio: 0, fundo: 0 })).toEqual({
      topo: 30,
      meio: 40,
      fundo: 30,
    });
  });

  it("limita verba a 100% e respeita limites de caracteres por plataforma", () => {
    const plan: GeneratedPlan = {
      summary: "resumo",
      platform_split_rationale: "",
      funnel_split: { topo: 10, meio: 10, fundo: 10 },
      funnel_rationale: "",
      warnings: [],
      campaigns: [
        campaign("meta", 80),
        campaign("google", 80),
      ],
    };
    const out = normalizeGeneratedPlan(plan);
    const sum = out.campaigns.reduce((s, c) => s + c.budget_pct, 0);
    expect(sum).toBeCloseTo(100, 1);
    expect(out.campaigns[0]!.creative.headlines[0]!.length).toBeLessThanOrEqual(40);
    expect(out.campaigns[1]!.creative.headlines[0]!.length).toBeLessThanOrEqual(30);
    expect(out.campaigns[1]!.creative.descriptions[0]!.length).toBeLessThanOrEqual(90);
  });

  it("limita o número de campanhas pela verba para não pulverizar", () => {
    expect(maxCampaignsForBudget(600)).toBe(1);
    expect(maxCampaignsForBudget(3000)).toBe(3);
    expect(maxCampaignsForBudget(30000)).toBe(8);
  });
});

function campaign(platform: "meta" | "google", pct: number) {
  return {
    name: "Campanha",
    platform,
    campaign_type: "Vendas",
    campaign_subtype: "site",
    funnel_stage: "fundo" as const,
    objective: "vender",
    optimization_goal: "conversões",
    conversion_event: "Purchase",
    audience: "público",
    targeting_notes: "notas",
    placements: ["Feed"],
    budget_pct: pct,
    main_kpi: "CPA",
    keywords: [],
    negative_keywords: [],
    estimates: { cpa_range: "a", volume_range: "b", notes: "c" },
    prerequisites: [],
    rationale: "porque",
    creative: {
      angles: ["a"],
      headlines: ["T".repeat(120)],
      descriptions: ["D".repeat(200)],
      cta: "Comprar",
      visual_ideas: ["v"],
    },
  };
}
