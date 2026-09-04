import { describe, expect, it } from "vitest";
import { classifyAiError } from "@/lib/ai-failures.server";

describe("classificação de falhas da IA", () => {
  it("não repete nem troca provider para schema/request inválido", () => {
    expect(
      classifyAiError({
        statusCode: 400,
        message:
          "invalid JSON schema for response_format: required must include every key in properties",
      }),
    ).toEqual({ kind: "invalid_request", retryable: false });
  });

  it("mantém fallback elegível somente para indisponibilidade transitória", () => {
    expect(classifyAiError({ statusCode: 503, message: "provider unavailable" })).toEqual({
      kind: "provider_unavailable",
      retryable: true,
    });
    expect(classifyAiError({ statusCode: 429, message: "rate limit" })).toEqual({
      kind: "provider_rate_limit",
      retryable: true,
    });
  });

  it("classifica limite de saída como terminal e não como indisponibilidade", () => {
    expect(
      classifyAiError({
        statusCode: 400,
        message: "failed_generation: max completion tokens reached before generating a valid document",
      }),
    ).toEqual({ kind: "output_truncated", retryable: false });
  });

  it("não troca provider quando a saída gerada é inválida", () => {
    expect(classifyAiError(new Error("ai_invalid_output: empty JSON"))).toEqual({
      kind: "invalid_output",
      retryable: false,
    });
  });
});