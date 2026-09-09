import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("prazo da tarefa criada no job", () => {
  const fn = readFileSync("src/lib/project-jobs.functions.ts", "utf8");
  const create = fn.slice(fn.indexOf("createJobTaskFn"), fn.indexOf("updateJobTaskFn"));

  it("aceita due_at no validador da criação", () => {
    expect(create).toContain("due_at: z.string().min(1).nullable().optional()");
  });

  it("grava due_at no insert", () => {
    expect(create).toContain("due_at: data.due_at ?? null");
  });

  it("a linha da tarefa mostra o prazo e o responsável compacto", () => {
    const row = readFileSync("src/components/projects/jobs-panel.tsx", "utf8");
    expect(row).toContain("<DueDateChip");
    expect(row).toMatch(/<AssigneePicker\s+compact/);
  });
});
