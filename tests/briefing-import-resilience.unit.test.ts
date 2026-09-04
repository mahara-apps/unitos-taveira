import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_STATUSES,
  RETRYABLE_RUN_STATUSES,
  canTransition,
  classifyRunFailure,
} from "@/lib/briefing-import.server";
import { canRetryRun, shouldPollRun, uiStepFromRun, RUN_STATUS_LABELS } from "@/lib/briefing-import-ui";

describe("máquina de estados resiliente da importação", () => {
  it("permite reaper devolver run travada para a fila ou expirar", () => {
    expect(canTransition("running", "queued")).toBe(true);
    expect(canTransition("running", "expired")).toBe(true);
    expect(canTransition("expired", "queued")).toBe(true);
  });

  it("mantém estados terminais definitivos fechados", () => {
    expect(canTransition("applied", "queued")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
  });

  it("libera o bloqueio de execução ativa nos estados recuperáveis", () => {
    for (const status of RETRYABLE_RUN_STATUSES) {
      expect(ACTIVE_RUN_STATUSES).not.toContain(status);
      expect(canRetryRun(status)).toBe(true);
      expect(shouldPollRun(status)).toBe(false);
      expect(uiStepFromRun(status)).toBe("failed");
      expect(RUN_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("classifica bloqueio de provedor como pausa (não repete a chamada)", () => {
    expect(classifyRunFailure(new Error("ai_provider_not_configured")).status).toBe("paused");
    expect(classifyRunFailure(new Error("HTTP 402 insufficient credit")).status).toBe("paused");
  });

  it("classifica material inservível como needs_input", () => {
    expect(classifyRunFailure(new Error("document_not_found")).status).toBe("needs_input");
    expect(classifyRunFailure(new Error("empty_input_text")).status).toBe("needs_input");
  });

  it("classifica falha genérica como retentável", () => {
    expect(classifyRunFailure(new Error("ai_invalid_output")).status).toBe("failed");
    expect(classifyRunFailure(new Error("503 model overloaded")).status).toBe("failed");
  });
});
