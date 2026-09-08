import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const functions = readFileSync("src/lib/content.functions.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260908183506_bb896577-81d3-4d45-b00b-958db59f4482.sql",
  "utf8",
);
const verify = readFileSync("supabase/install/verify-installation.sql", "utf8");

describe("Lixeira de Conteúdo", () => {
  it("restringe exclusão e restauração a Owner, Admin ou Super Admin", () => {
    expect(functions).toContain('brandRole !== "owner"');
    expect(functions).toContain('brandRole !== "admin"');
    expect(functions).toContain('role !== "super_admin"');
    expect(migration).toContain("guard_content_trash_changes");
  });

  it("mantém histórico por 30 dias e agenda limpeza diária", () => {
    expect(functions).toContain("30 * 86_400_000");
    expect(migration).toContain("interval '30 days'");
    expect(verify).toContain("purge-deleted-content-30d");
  });

  it("cancela agendamentos antes da exclusão", () => {
    expect(functions).toContain('.update({ status: "cancelled" } as never)');
    expect(functions).toContain('.eq("status", "scheduled")');
  });

  it("protege pipeline padrão e último pipeline", () => {
    expect(functions).toContain("O pipeline padrão não pode ser excluído");
    expect(functions).toContain("O último pipeline não pode ser excluído");
  });
});
