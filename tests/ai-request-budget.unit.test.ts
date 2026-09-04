import { describe, expect, it, vi } from "vitest";
import {
  AiRequestBudgetExceededError,
  createAiRequestBudget,
  isAiRequestBudgetError,
  MAX_AI_REQUESTS_PER_OPERATION,
  takeAiRequest,
} from "@/lib/ai/request-budget";

describe("budget de requests dos provedores BYOK", () => {
  it("permite operação dentro do budget", () => {
    const budget = createAiRequestBudget(3);
    for (let i = 0; i < 3; i++) {
      expect(() => takeAiRequest(budget, { op: "pauta.suggest" })).not.toThrow();
    }
    expect(budget.used()).toBe(3);
    expect(budget.remaining()).toBe(0);
  });

  it("interrompe a operação fora do budget", () => {
    const budget = createAiRequestBudget(2);
    takeAiRequest(budget, { op: "x" });
    takeAiRequest(budget, { op: "x" });
    expect(() => takeAiRequest(budget, { op: "x" })).toThrow(AiRequestBudgetExceededError);
    // Não consome além do teto.
    expect(budget.used()).toBe(2);
  });

  it("emite telemetria somente quando o budget estoura", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const budget = createAiRequestBudget(1);
    takeAiRequest(budget, { op: "content.generate", provider: "gemini", model: "m" });
    expect(spy).not.toHaveBeenCalled();
    expect(() =>
      takeAiRequest(budget, { op: "content.generate", provider: "gemini", model: "m" }),
    ).toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("[ai-budget]");
    expect(line).toContain("outcome=request_budget_exceeded");
    expect(line).toContain("limit=1");
    spy.mockRestore();
  });

  it("teto padrão é positivo e o erro é reconhecível", () => {
    expect(MAX_AI_REQUESTS_PER_OPERATION).toBeGreaterThan(0);
    const budget = createAiRequestBudget(1);
    takeAiRequest(budget, {});
    try {
      takeAiRequest(budget, {});
      throw new Error("deveria ter lançado");
    } catch (err) {
      expect(isAiRequestBudgetError(err)).toBe(true);
    }
  });
});
