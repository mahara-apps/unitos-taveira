import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("apresentação das pautas", () => {
  it("mantém todas as ações principais na lista e no detalhe", () => {
    const view = read("src/components/monthly-plan/monthly-plan-view.tsx");
    for (const label of [
      "Peça expressa",
      "Pauta expressa",
      "Gerar pauta com IA",
      "Ver projeto",
      "Ideias de posts",
      "Descartar pauta",
      "Excluir definitivamente",
      "Enviar ao cliente para aprovação",
    ]) {
      expect(view).toContain(label);
    }
  });

  it("usa os KPIs canônicos e preserva filtros e ações da listagem", () => {
    const board = read("src/components/monthly-plan/pauta-board.tsx");
    expect(board).toContain("PageKpiGrid");
    expect(board).not.toContain("function SummaryCell");
    for (const label of ["Ativas", "Em produção", "No cliente", "Arquivadas", "Nova pauta"]) {
      expect(board).toContain(label);
    }
  });

  it("abre a geração em painel lateral e transporta o modelo escolhido", () => {
    const wizard = read("src/components/monthly-plan/generate-plan-wizard.tsx");
    const functions = read("src/lib/monthly-plans.functions.ts");
    const agent = read("src/lib/monthly-plan-agent.server.ts");
    expect(wizard).toContain("<Sheet");
    expect(wizard).toContain("selectedModel");
    expect(functions).toContain("listPlanAiModelsFn");
    expect(agent).toContain("opts.selectedModel");
  });
});