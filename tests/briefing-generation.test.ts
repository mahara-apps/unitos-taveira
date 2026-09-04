import { describe, expect, it } from "vitest";
import { BriefingAnalysisSchema, normalizeBriefingAnalysis } from "@/lib/briefing-analysis-schema";
import { briefingProviderOptions } from "@/lib/briefing-generation.server";

describe("geração provider-aware de briefing", () => {
  it("nunca envia reasoningEffort none ao GPT-OSS da Groq", () => {
    expect(briefingProviderOptions("groq")).toEqual({
      groq: {
        reasoningEffort: "low",
        structuredOutputs: true,
        strictJsonSchema: true,
      },
    });
    expect(JSON.stringify(briefingProviderOptions("groq"))).not.toContain('"none"');
    expect(briefingProviderOptions("gemini")).toEqual({});
  });

  it("mantém o schema wire sem limites frágeis e aplica limites depois", () => {
    const long = "x".repeat(900);
    expect(BriefingAnalysisSchema.shape.briefing.safeParse({
      description: long,
      mission: null,
      positioning: null,
      values: null,
      audience: null,
      pain_points: null,
      demographics: null,
      offer: null,
      differentials: null,
      objections: null,
      journey: null,
      desires: null,
      tone_text: null,
      hashtags: [],
      goals: null,
    }).success).toBe(true);

    const normalized = normalizeBriefingAnalysis({
      executive_summary: long,
      material_type: "texto",
      briefing: { description: long },
    });
    expect(normalized?.executive_summary).toHaveLength(400);
    expect(normalized?.briefing.description).toHaveLength(700);
  });
});