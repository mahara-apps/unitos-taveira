import { describe, expect, it } from "vitest";
import { isMetaRateLimit, nextRateLimitRetryAt, rateLimitMessage } from "@/lib/meta/rate-limit";

describe("classificação de limite temporário da Meta", () => {
  it("reconhece o erro real do Instagram (code 4)", () => {
    expect(
      isMetaRateLimit({ graph: { code: 4 }, message: "Application request limit reached" }),
    ).toBe(true);
  });

  it("reconhece por mensagem quando não há código", () => {
    expect(isMetaRateLimit({ message: "Please retry your request later" })).toBe(true);
  });

  it("não confunde erro de conteúdo/autorização com limite", () => {
    expect(isMetaRateLimit({ graph: { code: 190 }, message: "Invalid OAuth access token" })).toBe(
      false,
    );
    expect(isMetaRateLimit(new Error("Mídia inválida para Reels"))).toBe(false);
  });

  it("aplica espera progressiva e nunca regride", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    const a = nextRateLimitRetryAt(0, now).getTime();
    const b = nextRateLimitRetryAt(1, now).getTime();
    const c = nextRateLimitRetryAt(4, now).getTime();
    expect(a).toBeGreaterThan(now.getTime());
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    // Índice acima da tabela não quebra.
    expect(nextRateLimitRetryAt(99, now).getTime()).toBeGreaterThan(c);
  });

  it("mensagem em pt-BR informa o horário da próxima tentativa", () => {
    const msg = rateLimitMessage(new Date("2026-01-01T15:30:00Z"));
    expect(msg).toContain("Limite temporário da Meta");
    expect(msg).toMatch(/\d{2}:\d{2}/);
  });
});
