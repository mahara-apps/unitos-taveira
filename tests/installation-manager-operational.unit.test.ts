import { describe, expect, it } from "vitest";

import {
  MASTER_RELEASE_VERSION,
  PROVISION_STEPS,
  VALIDATE_STEPS,
  applyStepReport,
  assertOperationTarget,
  buildRunCommand,
  healthFromChecks,
  initialSteps,
  normalizeHealthChecks,
  operationStatusFromSteps,
  stepsProgress,
  updateSummary,
} from "@/lib/installation/manager-contract";

describe("etapas do provisionamento", () => {
  it("declara as etapas operacionais na ordem do bootstrap: código antes do banco", () => {
    expect(PROVISION_STEPS.map((s) => s.id)).toEqual([
      "supabase",
      "code",
      "deploy_link",
      "secrets",
      "deploy",
      "database",
      "storage",
      "seeds",
      "brain",
      "cron",
      "validation",
    ]);
    expect(VALIDATE_STEPS).toHaveLength(5);
  });

  it("começa tudo pendente e sem progresso", () => {
    const steps = initialSteps("provision");
    expect(steps.every((s) => s.state === "pending")).toBe(true);
    expect(stepsProgress(steps).percent).toBe(0);
    expect(operationStatusFromSteps(steps)).toBe("pending");
  });

  it("aplica report real de etapa e ignora etapa desconhecida", () => {
    let steps = initialSteps("provision");
    steps = applyStepReport(steps, { step: "database", state: "running" });
    expect(operationStatusFromSteps(steps)).toBe("running");
    steps = applyStepReport(steps, { step: "inexistente", state: "done" });
    expect(steps).toHaveLength(PROVISION_STEPS.length);
  });

  it("preserva progresso parcial quando uma etapa falha", () => {
    let steps = initialSteps("provision");
    steps = applyStepReport(steps, { step: "supabase", state: "done" });
    steps = applyStepReport(steps, { step: "database", state: "error", detail: "baseline incompleto" });
    const progress = stepsProgress(steps);
    expect(progress.done).toBe(1);
    expect(progress.failed).toBe(1);
    expect(operationStatusFromSteps(steps)).toBe("failed");
  });

  it("sucesso somente com todas as etapas concluídas", () => {
    let steps = initialSteps("validate");
    for (const s of VALIDATE_STEPS) steps = applyStepReport(steps, { step: s.id, state: "done" });
    expect(operationStatusFromSteps(steps)).toBe("success");
    expect(stepsProgress(steps).percent).toBe(100);
  });
});

describe("saúde da instalação", () => {
  it("normaliza checks desconhecidos como pendentes", () => {
    const checks = normalizeHealthChecks({ database: { state: "ok" }, lixo: { state: "x" } });
    expect(checks.database.state).toBe("ok");
    expect(checks.cron.state).toBe("pending");
  });

  it("agrega erro > atenção > pendente > ok", () => {
    expect(healthFromChecks({ database: { state: "error" } })).toBe("failing");
    expect(healthFromChecks({ database: { state: "attention" } })).toBe("degraded");
    expect(healthFromChecks({})).toBe("unknown");
    const all = Object.fromEntries(
      ["connectivity", "supabase", "database", "storage", "cron", "frontend", "secrets", "configuration"].map(
        (id) => [id, { state: "ok" }],
      ),
    );
    expect(healthFromChecks(all)).toBe("healthy");
  });
});

describe("alvo da operação", () => {
  it("exige identidade própria completa", () => {
    expect(assertOperationTarget({ domain: "", supabaseUrl: "https://x.supabase.co" }).ok).toBe(false);
    expect(assertOperationTarget({ domain: "app.cliente.com", supabaseUrl: "" }).ok).toBe(false);
    expect(
      assertOperationTarget({ domain: "app.cliente.com", supabaseUrl: "https://ref.supabase.co" }).ok,
    ).toBe(true);
  });

  it("bloqueia qualquer operação apontando para o MASTER", () => {
    expect(
      assertOperationTarget({
        domain: "unitos-master.lovable.app",
        supabaseUrl: "https://ref.supabase.co",
      }).ok,
    ).toBe(false);
    expect(
      assertOperationTarget({
        domain: "app.cliente.com",
        supabaseUrl: "https://tkjbhttylouamqxnbfgv.supabase.co",
      }).ok,
    ).toBe(false);
  });
});

describe("comando de execução e atualização", () => {
  it("reutiliza os scripts existentes e nunca embute credenciais do destino", () => {
    const cmd = buildRunCommand({
      kind: "provision",
      masterUrl: "https://unitos-master.lovable.app/",
      operationId: "op-1",
      runToken: "tok-1",
      appUrl: "app.cliente.com",
    });
    expect(cmd).toContain("supabase/install/bootstrap.sh");
    expect(cmd).toContain("UNITOS_RUN_TOKEN=\"tok-1\"");
    expect(cmd).toContain("<SENHA>");
  });

  it("validação usa o wrapper read-only", () => {
    const cmd = buildRunCommand({
      kind: "validate",
      masterUrl: "https://unitos-master.lovable.app",
      operationId: "op-2",
      runToken: "tok-2",
    });
    expect(cmd).toContain("supabase/install/validate.sh");
  });

  it("resumo de atualização compara versões", () => {
    expect(updateSummary("2026.08.0", MASTER_RELEASE_VERSION)).toContain(MASTER_RELEASE_VERSION);
  });
});
