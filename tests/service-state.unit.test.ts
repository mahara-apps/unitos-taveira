import { describe, expect, it } from "vitest";

import { resolveServiceGate } from "@/lib/service-state";
import { buildServiceStateSql } from "@/lib/installation/service-state.server";

describe("estado operacional do ambiente", () => {
  it("ambiente normal libera tudo", () => {
    const gate = resolveServiceGate({ state: "active", message: null, until: null });
    expect(gate.blocked).toBe(false);
    expect(gate.writesBlocked).toBe(false);
  });

  it("atualização mantém leitura e bloqueia gravação", () => {
    const gate = resolveServiceGate({ state: "maintenance", message: null, until: null });
    expect(gate.blocked).toBe(false);
    expect(gate.writesBlocked).toBe(true);
    expect(gate.message).toContain("Atualização");
  });

  it("suspensão bloqueia navegação e mostra o motivo informado", () => {
    const gate = resolveServiceGate({
      state: "suspended",
      message: "Pendência de pagamento.",
      until: null,
    });
    expect(gate.blocked).toBe(true);
    expect(gate.message).toBe("Pendência de pagamento.");
  });

  it("estado vencido volta sozinho ao normal (nunca trava para sempre)", () => {
    const gate = resolveServiceGate(
      { state: "maintenance", message: null, until: "2020-01-01T00:00:00.000Z" },
      Date.parse("2024-01-01T00:00:00.000Z"),
    );
    expect(gate.state).toBe("active");
    expect(gate.writesBlocked).toBe(false);
  });

  it("SQL cria as colunas quando faltam e escapa o texto do motivo", () => {
    const sql = buildServiceStateSql({
      state: "suspended",
      message: "cliente d'água",
      untilIso: null,
      actor: "user-1",
    });
    expect(sql).toContain("add column if not exists service_state");
    expect(sql).toContain("'cliente d''água'");
    expect(sql).toContain("service_state = 'suspended'");
  });

  it("ativação só remove manutenção e preserva suspensão administrativa", () => {
    const sql = buildServiceStateSql({
      state: "active",
      message: null,
      untilIso: null,
      actor: null,
      onlyIfMaintenance: true,
    });
    expect(sql).toContain("service_state = 'active'");
    expect(sql).toContain("where service_state = 'maintenance'");
  });
});
