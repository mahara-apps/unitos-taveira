import { describe, expect, it } from "vitest";

import {
  STALE_OPERATION_MS,
  canStartOperation,
  isOperationStale,
  lastSignalAt,
  operationStatusFromSteps,
  initialSteps,
  stepsProgress,
} from "@/lib/installation/manager-contract";

const NOW = Date.parse("2026-01-10T12:00:00.000Z");

function op(overrides: Partial<{ status: "pending" | "running" | "success" | "failed"; startedAt: string; lastReportAt: string | null }>) {
  return {
    status: "running" as const,
    startedAt: new Date(NOW - 60_000).toISOString(),
    lastReportAt: null,
    ...overrides,
  };
}

describe("operação travada", () => {
  it("operação viva reportando há pouco NÃO é travada", () => {
    expect(
      isOperationStale(op({ lastReportAt: new Date(NOW - 10_000).toISOString() }), NOW),
    ).toBe(false);
  });

  it("operação viva sem report além do limite é travada", () => {
    expect(
      isOperationStale(
        op({
          startedAt: new Date(NOW - STALE_OPERATION_MS - 60_000).toISOString(),
          lastReportAt: new Date(NOW - STALE_OPERATION_MS - 30_000).toISOString(),
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("operação encerrada nunca é travada", () => {
    expect(
      isOperationStale(
        op({ status: "failed", startedAt: new Date(NOW - 10 * STALE_OPERATION_MS).toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });

  it("último sinal considera o report mais recente", () => {
    const started = new Date(NOW - 300_000).toISOString();
    const report = new Date(NOW - 5_000).toISOString();
    expect(lastSignalAt(op({ startedAt: started, lastReportAt: report }))).toBe(Date.parse(report));
  });
});

describe("reinício e nova tentativa", () => {
  it("instalação com erro aceita novo provisionamento", () => {
    expect(canStartOperation("provision", "error")).toBe(true);
  });

  it("instalação em atenção (após cancelamento) aceita novo provisionamento", () => {
    expect(canStartOperation("provision", "attention")).toBe(true);
  });

  it("instalação provisionando NÃO aceita novo disparo", () => {
    expect(canStartOperation("provision", "provisioning")).toBe(false);
  });
});

describe("progresso por etapa", () => {
  it("provisionamento começa com 11 etapas pendentes", () => {
    const steps = initialSteps("provision");
    expect(steps).toHaveLength(11);
    expect(stepsProgress(steps).percent).toBe(0);
    expect(operationStatusFromSteps(steps)).toBe("pending");
  });

  it("etapa com erro marca a operação como falha", () => {
    const steps = initialSteps("provision").map((step, index) =>
      index === 0 ? { ...step, state: "error" as const } : step,
    );
    expect(operationStatusFromSteps(steps)).toBe("failed");
    expect(stepsProgress(steps).failed).toBe(1);
  });
});
