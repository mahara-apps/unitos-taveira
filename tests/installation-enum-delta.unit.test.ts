import { describe, expect, it } from "vitest";

import { applyStatementByStatement } from "@/lib/installation/automation.server";

/**
 * `ALTER TYPE ... ADD VALUE` não pode rodar dentro de bloco DO/função: o
 * Postgres recusa. O delta das Mensagens traz esse comando, então a automação
 * precisa enviá-lo isolado — caso contrário a etapa de banco falha na primeira
 * instalação atualizada.
 */
describe("delta com novo valor de enum", () => {
  function makeManagement() {
    const queries: string[] = [];
    return {
      queries,
      query: async (sql: string) => {
        queries.push(sql);
        return { ok: true, rows: [] as unknown[] };
      },
    };
  }

  const sql = [
    "create table public.t1 (id int);",
    "ALTER TYPE public.notification_kind ADD VALUE IF NOT EXISTS 'message';",
    "create table public.t2 (id int);",
  ].join("\n");

  it("envia o ALTER TYPE fora do bloco protegido", async () => {
    const management = makeManagement();
    const result = await applyStatementByStatement(management, sql, { maxStatements: 50 });
    expect(result.ok).toBe(true);

    const enumCalls = management.queries.filter((q) => /alter\s+type/i.test(q));
    expect(enumCalls).toHaveLength(1);
    expect(enumCalls[0]).not.toMatch(/unitos_guard/);
    expect(enumCalls[0]!.trim()).toMatch(/^ALTER TYPE/);
  });

  it("tolera enum já existente sem abortar a aplicação", async () => {
    const queries: string[] = [];
    const management = {
      query: async (statement: string) => {
        queries.push(statement);
        if (/alter\s+type/i.test(statement)) {
          return { ok: false, rows: [] as unknown[], error: 'enum label "message" already exists' };
        }
        return { ok: true, rows: [] as unknown[] };
      },
    };
    const result = await applyStatementByStatement(management, sql, { maxStatements: 50 });
    expect(result.ok).toBe(true);
  });

  it("aborta em erro real do ALTER TYPE", async () => {
    const management = {
      query: async (statement: string) =>
        /alter\s+type/i.test(statement)
          ? { ok: false, rows: [] as unknown[], error: "permission denied" }
          : { ok: true, rows: [] as unknown[] },
    };
    const result = await applyStatementByStatement(management, sql, { maxStatements: 50 });
    expect(result.ok).toBe(false);
  });
});
