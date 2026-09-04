import { describe, expect, it } from "vitest";
import { APICallError } from "ai";
import { z } from "zod";
import { salvageStructuredOutput } from "@/lib/ai-output-salvage";
import {
  BriefingAnalysisSchema,
  normalizeBriefingAnalysis,
} from "@/lib/briefing-analysis-schema";

// Espelha a tolerância do schema de análise: campos de metadados opcionais.
const Schema = z.object({
  executive_summary: z.string().nullable(),
  briefing: z.object({ description: z.string().nullable() }),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(z.object({ field: z.string() })).optional(),
});

const GENERATION = JSON.stringify({
  executive_summary: "Reunião de briefing da marca X.",
  briefing: { description: "Marca de moda feminina." },
});

function apiErrorWithFailedGeneration(): APICallError {
  return new APICallError({
    message:
      "Generated JSON does not match the expected schema. Error: jsonschema: '' does not validate with /required: missing properties: 'evidence', 'speakers', 'confidence'",
    url: "https://openrouter.ai/api/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 400,
    responseBody: JSON.stringify({
      error: {
        message: "Generated JSON does not match the expected schema.",
        type: "invalid_request_error",
        code: "json_validate_failed",
        failed_generation: GENERATION,
      },
    }),
    isRetryable: false,
  });
}

describe("salvageStructuredOutput", () => {
  it("recupera geração descartada por json_validate_failed do provider", () => {
    const err = apiErrorWithFailedGeneration();
    const salvaged = salvageStructuredOutput(err, Schema);
    expect(salvaged).not.toBeNull();
    expect(salvaged?.executive_summary).toContain("Reunião de briefing");
    expect(salvaged?.briefing.description).toContain("moda feminina");
    expect(salvaged?.confidence).toBeUndefined();
  });

  it("retorna null quando não há geração recuperável", () => {
    const err = new APICallError({
      message: "rate limited",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 429,
      isRetryable: true,
    });
    expect(salvageStructuredOutput(err, Schema)).toBeNull();
  });

  it("retorna null quando a geração não valida no schema", () => {
    const err = new APICallError({
      message: "schema",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({
        error: { failed_generation: JSON.stringify({ outra_coisa: true }) },
      }),
      isRetryable: false,
    });
    expect(salvageStructuredOutput(err, Schema)).toBeNull();
  });

  it("ignora erros que não são de IA", () => {
    expect(salvageStructuredOutput(new Error("boom"), Schema)).toBeNull();
  });

  it("normaliza metadados omitidos sem inventar conteúdo", () => {
    const generation = JSON.stringify({
      executive_summary: "Resumo",
      material_type: "Transcrição",
      briefing: {
        description: "Marca de moda",
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
        hashtags: null,
        goals: null,
      },
    });
    const err = new APICallError({
      message: "json_validate_failed",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({ error: { data: { failed_generation: generation } } }),
      isRetryable: false,
    });
    const salvaged = salvageStructuredOutput(
      err,
      BriefingAnalysisSchema,
      normalizeBriefingAnalysis,
    );
    expect(salvaged).toMatchObject({ evidence: [], speakers: [], confidence: null });
  });

  it("não aceita JSON truncado", () => {
    const err = new APICallError({
      message: "json_validate_failed",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({ error: { failed_generation: '{"briefing": {' } }),
      isRetryable: false,
    });
    expect(
      salvageStructuredOutput(err, BriefingAnalysisSchema, normalizeBriefingAnalysis),
    ).toBeNull();
  });
});
