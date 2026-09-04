import { describe, expect, it } from "vitest";
import {
  ImportStepError,
  classifyRunFailure,
  stepFromError,
  tagImportStep,
} from "@/lib/briefing-import.server";
import { STEP_TIMEOUT_MS } from "@/lib/briefing-import-executor.server";
import { friendlyAnalysisError, canRetryRun, uiStepFromRun } from "@/lib/briefing-import-ui";

describe("timeout por etapa da importação", () => {
  it("define orçamento de 60s para extract e 120s para interpret", () => {
    expect(STEP_TIMEOUT_MS.extract).toBe(60_000);
    expect(STEP_TIMEOUT_MS.interpret).toBe(120_000);
  });

  it("classifica timeout de interpret como falha retentável (não pausa)", () => {
    const err = new ImportStepError(
      "interpret",
      "step_timeout: a etapa interpret excedeu o tempo limite de 120s (timeout)",
    );
    const { status, kind } = classifyRunFailure(err);
    expect(status).toBe("failed");
    expect(kind).toBe("timeout");
    expect(canRetryRun("failed")).toBe(true);
  });

  it("classifica abort do provedor como timeout retentável", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(classifyRunFailure(abort).kind).toBe("timeout");
    expect(classifyRunFailure(new Error("ETIMEDOUT")).status).toBe("failed");
  });
});

describe("etapa real da falha", () => {
  it("recupera a etapa do ImportStepError", () => {
    expect(stepFromError(new ImportStepError("propose", "boom"))).toBe("propose");
  });

  it("recupera a etapa através da cadeia de cause", () => {
    const inner = new ImportStepError("diff", "falha ao montar diff");
    const outer = new Error("wrapper", { cause: inner });
    expect(stepFromError(outer)).toBe("diff");
  });

  it("etiqueta erros de terceiros sem trocar o erro original", () => {
    const raw = new Error("db offline");
    expect(tagImportStep(raw, "ingest")).toBe(raw);
    expect(stepFromError(raw)).toBe("ingest");
  });

  it("não inventa etapa quando o erro não carrega nenhuma", () => {
    expect(stepFromError(new Error("qualquer coisa"))).toBeNull();
    expect(stepFromError(null)).toBeNull();
  });

  it("falha DEPOIS do interpret não marca interpret como falho", () => {
    // Cenário: diff/propose quebram após a IA já ter respondido. A etapa real
    // precisa vir do erro para que o retry reuse o checkpoint de interpret.
    const err = new ImportStepError("propose", "insert failed");
    expect(stepFromError(err)).not.toBe("interpret");
    expect(stepFromError(err)).toBe("propose");
  });
});

describe("causa real preservada para a UI", () => {
  it("run expirada com erro persistido mostra a causa, não 'stalled'", () => {
    const persisted = friendlyAnalysisError(
      new ImportStepError("interpret", "step_timeout: a etapa interpret excedeu 120s (timeout)"),
    );
    expect(persisted).toBeTruthy();
    expect(persisted.toLowerCase()).not.toContain("stalled");
    expect(uiStepFromRun("expired")).toBe("failed");
    expect(canRetryRun("expired")).toBe(true);
  });
});
