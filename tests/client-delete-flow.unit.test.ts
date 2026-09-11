import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("exclusão completa de clientes", () => {
  it("a proteção do pipeline distingue exclusão isolada da cascata do cliente", () => {
    const migration = read(
      "supabase/migrations/20260911193252_ddd0c9a3-b89f-4294-972d-ff60f7d32dcb.sql",
    );
    expect(migration).toContain("IF NOT EXISTS");
    expect(migration).toContain("FROM public.clients");
    expect(migration).toContain("cannot_delete_last_pipeline");
  });

  it("exige nome escrito e um último aviso antes de executar", () => {
    const page = read("src/routes/_authenticated/customers.index.tsx");
    expect(page).toContain("deleteConfirmName.trim() === toDelete.name.trim()");
    expect(page).toContain("setDeleteFinalWarningOpen(true)");
    expect(page).toContain("Esta é a terceira e última confirmação");
    expect(page).toContain("Sim, excluir permanentemente");
  });

  it("a instalação verifica a correção e as permissões da função", () => {
    const verify = read("supabase/install/verify-installation.sql");
    expect(verify).toContain("clientes: cascata pode remover o último pipeline");
    expect(verify).toContain("NOT has_function_privilege('authenticated'");
  });
});