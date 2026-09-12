import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const hook = fs.readFileSync(path.resolve("src/hooks/use-module-permissions.ts"), "utf8");
const migrationName = fs
  .readdirSync(path.resolve("supabase/migrations"))
  .find((name) => name.startsWith("20260912153717_"));
const migration = migrationName
  ? fs.readFileSync(path.resolve("supabase/migrations", migrationName), "utf8")
  : "";

describe("carregamento resiliente das permissões de módulo", () => {
  it("não depende do intermediário de server functions para montar a navegação", () => {
    expect(hook).toContain('callRpc(supabase, "effective_module_permissions"');
    expect(hook).not.toContain("useServerFn");
    expect(hook).not.toContain("myModulePermissions");
  });

  it("encerra o carregamento com permissões vazias após falha transitória", () => {
    expect(hook).toContain("isReady: !q.isLoading");
    expect(hook).toContain("retry: 1");
  });

  it("impede que o navegador consulte permissões de outra identidade", () => {
    expect(migration).toContain("auth.uid() IS DISTINCT FROM _user_id");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("TO authenticated, service_role");
  });
});