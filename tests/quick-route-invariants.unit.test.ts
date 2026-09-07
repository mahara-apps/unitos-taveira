/**
 * Rota rápida (pauta expressa / peça expressa): trava as regras que não podem
 * ser burladas pelo atalho — política de aprovação do cliente, limite de
 * produção contratado, projeto obrigatório e ausência de legenda genérica.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const plans = readFileSync("src/lib/monthly-plans.functions.ts", "utf8");
const quick = readFileSync("src/lib/quick-content.functions.ts", "utf8");
const submit = readFileSync("src/lib/monthly-plan-submit.server.ts", "utf8");

describe("pauta expressa", () => {
  it("usa a mesma geração com trava de concorrência", () => {
    const fn = plans.slice(plans.indexOf("export const quickPlanFn"));
    expect(fn).toContain("acquirePlanGenerationLock");
    expect(fn).toContain("runPlanGeneration");
    expect(fn).toContain("releasePlanGenerationLock");
  });

  it("delega a decisão de aprovação ao ponto único da regra", () => {
    const fn = plans.slice(plans.indexOf("export const quickPlanFn"));
    expect(fn).toContain("monthly-plan-submit.server");
    expect(fn).toContain("submitPlanForApproval");
  });

  it("vincula projeto antes de encaminhar", () => {
    const fn = plans.slice(plans.indexOf("export const quickPlanFn"));
    expect(fn.indexOf("linkPlanToProject")).toBeGreaterThan(-1);
    expect(fn.indexOf("linkPlanToProject")).toBeLessThan(fn.indexOf("submitPlanForApproval"));
  });
});

describe("ponto único de encaminhamento", () => {
  it("consulta a política do cliente e exige projeto", () => {
    expect(submit).toContain("requiresClientApproval");
    expect(submit).toContain("project_required");
  });

  it("só materializa quando o cliente não aprova pauta", () => {
    const waived = submit.indexOf("if (!needsClient)");
    const materialize = submit.indexOf("materializePlanToKanban");
    expect(waived).toBeGreaterThan(-1);
    expect(materialize).toBeGreaterThan(waived);
  });
});

describe("peça expressa", () => {
  it("aplica o limite de produção contratado", () => {
    expect(quick).toContain("checkManualScope");
    expect(quick).toContain("scope_limit_reached");
  });

  it("exige projeto do próprio cliente", () => {
    expect(quick).toContain("Projeto não pertence a este cliente.");
  });

  it("usa os agentes de conteúdo e nunca escreve legenda genérica", () => {
    expect(quick).toContain("generatePostContent");
    expect(quick).not.toMatch(/copy:\s*["'`]/);
  });

  it("nasce em estágio não terminal, sem agendamento", () => {
    expect(quick).toContain("!s.is_terminal");
    expect(quick).not.toContain("scheduled_at");
  });
});
