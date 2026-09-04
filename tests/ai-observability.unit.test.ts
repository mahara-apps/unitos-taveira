import { describe, expect, it } from "vitest";
import {
  formatAiLog,
  isRecoverableFailure,
  isTerminalFailure,
  redactAiDetail,
} from "@/lib/ai-observability";
import { classifyAiError, userFacingAiError } from "@/lib/ai-failures.server";
import { buildAiUsageRow } from "@/lib/ai-usage.server";

const scope = { brandId: "b".repeat(36), clientId: "c".repeat(36), userId: "u".repeat(36) };

describe("P1.4 — classificação preservada por cenário", () => {
  const cases: Array<[string, unknown, string, boolean]> = [
    ["429 rate limit", { statusCode: 429, message: "rate limit" }, "provider_rate_limit", true],
    ["503 indisponível", { statusCode: 503, message: "service unavailable" }, "provider_unavailable", true],
    ["timeout", new Error("The operation timed out (ETIMEDOUT)"), "provider_unavailable", true],
    ["resposta inválida", new Error("ai_invalid_output: JSON vazio"), "invalid_output", false],
    [
      "falha após geração parcial",
      new Error("failed_generation: max completion tokens reached"),
      "output_truncated",
      false,
    ],
  ];

  for (const [name, err, kind, retryable] of cases) {
    it(`${name} → ${kind}`, () => {
      expect(classifyAiError(err)).toEqual({ kind, retryable });
      expect(isRecoverableFailure(kind)).toBe(retryable);
      expect(isTerminalFailure(kind)).toBe(!retryable);
    });
  }
});

describe("P1.4 — mensagem para a UI não expõe erro técnico", () => {
  it("traduz 429 sem status, provider ou corpo do modelo", () => {
    const out = userFacingAiError({
      statusCode: 429,
      message: "openai rate limit exceeded for sk-proj-ABCDEFGH12345678, request id req_123",
    });
    expect(out.kind).toBe("provider_rate_limit");
    expect(out.retryable).toBe(true);
    expect(out.body).toMatch(/aguarde/i);
    expect(`${out.title} ${out.body}`).not.toMatch(/429|openai|sk-proj|req_123/i);
  });

  it("erro desconhecido ainda produz mensagem útil", () => {
    const out = userFacingAiError(new Error("boom"));
    expect(out.kind).toBe("unknown");
    expect(out.body.length).toBeGreaterThan(10);
    expect(out.body).not.toContain("boom");
  });
});

describe("P1.4 — consumo registrado mesmo em falha", () => {
  it("sucesso não grava classificação de erro", () => {
    const row = buildAiUsageRow({
      brandId: scope.brandId,
      model: "gemini-2.5-flash",
      provider: "gemini",
      inputTokens: 100,
      outputTokens: 50,
      success: true,
      step: "pauta.suggest",
      attempt: 1,
    });
    expect(row.success).toBe(true);
    expect(row.error_kind).toBeNull();
    expect(row.cost_usd).toBeGreaterThan(0);
  });

  it("falha grava provider, etapa, tentativa e error_kind", () => {
    const row = buildAiUsageRow({
      brandId: scope.brandId,
      clientId: scope.clientId,
      userId: scope.userId,
      model: "gpt-5-mini",
      provider: "openai",
      inputTokens: 0,
      outputTokens: 0,
      success: false,
      errorKind: "provider_rate_limit",
      errorMessage: "429 rate limit for key sk-proj-ABCDEFGH12345678",
      step: "briefing.import",
      attempt: 2,
    });
    expect(row.error_kind).toBe("provider_rate_limit");
    expect(row.provider).toBe("openai");
    expect(row.step).toBe("briefing.import");
    expect(row.attempt).toBe(2);
    expect(row.actor_kind).toBe("user");
    expect(row.error_message).not.toContain("sk-proj-ABCDEFGH12345678");
  });

  it("falha sem classificação explícita nunca fica sem error_kind", () => {
    const row = buildAiUsageRow({
      brandId: scope.brandId,
      model: "m",
      inputTokens: 0,
      outputTokens: 0,
      success: false,
    });
    expect(row.error_kind).toBe("unknown");
    expect(row.actor_kind).toBe("system");
  });

  it("falha após geração parcial preserva os tokens já consumidos", () => {
    const row = buildAiUsageRow({
      brandId: scope.brandId,
      model: "gemini-2.5-flash",
      inputTokens: 900,
      outputTokens: 300,
      success: false,
      errorKind: "output_truncated",
    });
    expect(row.input_tokens).toBe(900);
    expect(row.output_tokens).toBe(300);
    expect(row.cost_usd).toBeGreaterThan(0);
    expect(row.error_kind).toBe("output_truncated");
  });
});

describe("P1.4 — logs permitem reconstruir a execução", () => {
  it("envelope traz op, etapa, provider, modelo, tentativa e classificação", () => {
    const parsed = JSON.parse(
      formatAiLog("ai.failure", {
        op: "briefing.import",
        step: "interpret",
        provider: "gemini",
        model: "gemini-2.5-flash",
        attempt: 3,
        kind: "provider_unavailable",
        retryable: true,
        durationMs: 1234,
        detail: "503 overloaded",
        ...scope,
      }),
    );
    expect(parsed).toMatchObject({
      at: "ai.failure",
      op: "briefing.import",
      step: "interpret",
      provider: "gemini",
      model: "gemini-2.5-flash",
      attempt: 3,
      kind: "provider_unavailable",
      retryable: true,
      ms: 1234,
    });
    expect(parsed.brand).toHaveLength(8);
    expect(parsed.detail).toBe("503 overloaded");
  });

  it("redige chaves de API do detalhe técnico", () => {
    const text = redactAiDetail(
      'Authorization: Bearer sk-ant-ABCDEFGH12345678 {"api_key":"AIzaABCDEFGH12345678"}',
    );
    expect(text).not.toMatch(/ABCDEFGH12345678/);
    expect(text).toMatch(/redacted/);
  });
});
