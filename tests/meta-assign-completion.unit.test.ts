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

describe("resumo por canal e destino", () => {
  it("descreve o destino quando o cliente está escolhido", () => {
    const s = assignFinishState({
      activated: ["Página A", "@perfil"],
      target: "c1",
      clientName: "Taveira",
      channels: { facebook: 1, instagram: 1 },
    });
    expect(s.breakdown).toBe("1 Página · 1 conta do Instagram");
    expect(s.destination).toContain("Taveira");
    expect(s.canLink).toBe(true);
  });

  it("explica o que acontece ao concluir sem cliente", () => {
    const s = assignFinishState({ activated: ["Página A"], channels: { facebook: 1 } });
    expect(s.destination).toContain("workspace");
    expect(s.canLink).toBe(false);
    expect(s.canFinishWithoutClient).toBe(true);
  });

  it("sem contas ativadas, nada é conectado", () => {
    const s = assignFinishState({ activated: [] });
    expect(s.destination).toContain("Nada será conectado");
    expect(s.breakdown).toBe("");
  });
});
