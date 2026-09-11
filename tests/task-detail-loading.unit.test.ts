import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const shared = fs.readFileSync(path.resolve("src/components/tasks/shared.tsx"), "utf8");
const functions = fs.readFileSync(path.resolve("src/lib/tasks.functions.ts"), "utf8");

describe("detalhe de tarefa fora da lista filtrada", () => {
  it("busca a tarefa individualmente quando ela não está na lista atual", () => {
    expect(shared).toContain('queryKey: ["task-detail", brandId, taskId]');
    expect(shared).toContain("enabled: !listedTask");
    expect(shared).toContain("const task = listedTask ?? taskQ.data ?? null");
  });

  it("não mantém carregamento infinito quando a tarefa é inacessível", () => {
    expect(shared).toContain("!task && taskQ.isError");
    expect(shared).toContain("Não foi possível abrir esta tarefa");
  });

  it("protege a leitura individual por autenticação, escopo e workspace", () => {
    const detailFunction = functions.slice(
      functions.indexOf("export const getTaskFn"),
      functions.indexOf("export type TaskProjectOption"),
    );
    expect(detailFunction).toContain("requireSupabaseAuth");
    expect(detailFunction).toContain("assertTaskScope");
    expect(detailFunction).toContain("scope.brand_id !== data.brandId");
  });
});