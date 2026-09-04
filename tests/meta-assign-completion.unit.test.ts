import { describe, expect, it } from "vitest";
import { assignFinishState } from "../src/lib/meta/assign-completion";

describe("conclusão da etapa de ativos da Meta", () => {
  it("sem contas ativadas nada pode ser concluído", () => {
    const s = assignFinishState({ activated: [] });
    expect(s.canLink).toBe(false);
    expect(s.canFinishWithoutClient).toBe(false);
    expect(s.needsCloseConfirm).toBe(false);
    expect(s.message).toMatch(/Ative acima/);
  });

  it("com contas e cliente escolhido permite vincular", () => {
    const s = assignFinishState({ activated: ["Página A", "Página B"], target: "c1" });
    expect(s.count).toBe(2);
    expect(s.canLink).toBe(true);
    expect(s.needsCloseConfirm).toBe(false);
    expect(s.message).toContain("2 contas ativadas");
  });

  it("com contas e sem cliente só conclui sem cliente e pede confirmação ao fechar", () => {
    const s = assignFinishState({ activated: ["Página A"] });
    expect(s.canLink).toBe(false);
    expect(s.canFinishWithoutClient).toBe(true);
    expect(s.needsCloseConfirm).toBe(true);
    expect(s.message).toContain("1 conta ativada");
  });

  it("cliente do contexto dispensa o seletor", () => {
    const s = assignFinishState({ activated: ["Página A"], clientId: "cli" });
    expect(s.canLink).toBe(true);
    expect(s.needsCloseConfirm).toBe(false);
  });
});
