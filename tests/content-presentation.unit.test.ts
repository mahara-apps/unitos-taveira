import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("apresentação da tela de Conteúdo", () => {
  it("preserva os controles da tela e o banner de legendas", () => {
    const route = read("src/routes/_authenticated/content.tsx");
    const toolbar = read("src/components/content/content-toolbar.tsx");
    const queue = read("src/components/content/copy-queue-bar.tsx");
    for (const label of ["Novo conteúdo", "Novo pipeline", "Renomear pipeline", "Colunas", "Lixeira"]) {
      expect(route).toContain(label);
    }
    for (const label of ["Filtros", "Selecionar", "Visão Kanban", "Visão em lista"]) {
      expect(toolbar).toContain(label);
    }
    expect(queue).toContain("Gerar legendas pendentes");
  });

  it("mantém Kanban, ações de coluna e hierarquia completa dos cards", () => {
    const board = read("src/components/content/content-board.tsx");
    for (const label of ["Adicionar coluna", "Nova peça", "Renomear", "Excluir coluna", "Subir arte ou gerar com IA", "Definir "]) {
      expect(board).toContain(label);
    }
    expect(board).toContain("useDraggable");
    expect(board).toContain("useDroppable");
    expect(board).toContain("line-clamp-2");
  });

  it("preserva todos os campos e ações do editor lateral", () => {
    const editor = read("src/components/content/task-dialog.tsx");
    for (const label of [
      "Legenda gerada pelos agentes",
      "Vai publicar? Selecione a conta de destino",
      "Formato",
      "Arraste e solte aqui",
      "Briefing interno",
      "Briefing cliente",
      "Roteiro",
      "Agenda da pauta",
      "Salvar agenda",
      "Data de publicação",
      "Lembrete",
      "Criado em",
      "Excluir",
      "Refazer",
      "Salvar",
      "Prioridade",
      "Tags",
      "Visível no portal",
      "Aprovação externa",
      "Histórico",
    ]) {
      expect(editor).toContain(label);
    }
  });
});