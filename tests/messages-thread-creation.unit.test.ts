import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Contrato da criação de conversas (Mensagens).
 *
 * O insert direto em `message_threads` com `.select()` falhava com
 * "new row violates row-level security policy": a policy de leitura é avaliada
 * no RETURNING e `team_dm` tinha impasse de primeiro participante.
 * A criação passou a ser atômica via RPC `create_message_thread`.
 */
const root = join(import.meta.dirname, "..");
const messaging = readFileSync(join(root, "src/lib/messaging.functions.ts"), "utf8");

function deltaSql() {
  const dir = join(root, "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

describe("criação de conversas", () => {
  it("createThread usa a RPC atômica e não insere direto na tabela", () => {
    expect(messaging).toContain('"create_message_thread"');
    const createThread = messaging.slice(
      messaging.indexOf("export const createThread"),
      messaging.indexOf("export const createThread") + 3000,
    );
    expect(createThread).not.toContain('.from("message_threads")');
  });

  it("a RPC existe no pacote MASTER, é SECURITY DEFINER e valida escopo", () => {
    const sql = deltaSql();
    const fn = sql.slice(sql.indexOf("FUNCTION public.create_message_thread"));
    expect(fn).toContain("SECURITY DEFINER");
    expect(fn).toContain("is_brand_member");
    expect(fn).toContain("can_access_client");
    expect(fn).toContain("can_access_project");
    expect(fn).toContain("has_module_access");
    expect(fn).toContain("GRANT EXECUTE ON FUNCTION public.create_message_thread");
  });

  it("a verificação de instalação cobre a nova função", () => {
    const verify = readFileSync(join(root, "supabase/install/verify-installation.sql"), "utf8");
    expect(verify).toContain("create_message_thread");
  });
});
