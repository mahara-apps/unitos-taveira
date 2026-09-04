import { describe, expect, it } from "vitest";

import { applyStatementByStatement } from "@/lib/installation/automation.server";
import {
  isDuplicateObjectError,
  prepareVerificationSql,
  splitSqlStatements,
  stripPsqlMetaCommands,
  summarizeVerificationRows,
} from "@/lib/installation/baseline-sql";
import delta from "../supabase/baseline-snapshot/007_delta_migrations.sql?raw";
import manifestRaw from "../supabase/baseline-snapshot/tools/delta_manifest.txt?raw";

// Todas as migrations do repositório, para garantir que o delta não fique defasado.
const migrationFiles = import.meta.glob("../supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

import install010 from "../supabase/install/010_installation_identity.sql?raw";
import install011 from "../supabase/install/011_brain_stats_init.sql?raw";
import install020 from "../supabase/install/020_cron.sql?raw";
import verifySql from "../supabase/install/verify-installation.sql?raw";

describe("delta do baseline", () => {
  const objetos = [
    "briefing_import_runs",
    "briefing_import_steps",
    "briefing_import_changes",
    "installation_meta_app",
    "installation_operations",
    "briefing_import_claim_lease",
    "briefing_import_heartbeat",
    "briefing_import_reap",
    "installation_setup_state",
    "enforce_single_brand",
    "is_brand_integration_authority",
  ] as const;

  for (const nome of objetos) {
    it(`contém ${nome}`, () => {
      expect(delta.toLowerCase()).toContain(nome.toLowerCase());
    });
  }

  it("não contém meta-comandos psql", () => {
    expect(delta).not.toMatch(/^\\[a-z]/im);
  });

  /**
   * Regressão real: o delta ficou parado em 2026-09-03 enquanto o código já
   * usava `work_statuses`, `work_links`, `projects.status_id` e
   * `tasks.start_date`. A instalação nascia com schema antigo e as telas de
   * Projetos/Tarefas falhavam ao ler colunas inexistentes.
   */
  it("cobre TODAS as migrations posteriores ao corte do dump", () => {
    const manifest = new Set(
      manifestRaw
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const all = Object.keys(migrationFiles)
      .map((p) => p.split("/").pop()!)
      .sort();
    const start = "20260829121019_8a4f7bd3-bff7-464d-997c-d72f8676ebec.sql";
    const posteriores = all.filter((n) => n >= start);
    // Migrations exclusivas do MASTER (cron apontando para a URL do MASTER)
    // ficam de fora de propósito: a instalação recebe cron próprio em 020_cron.
    const masterOnly = posteriores.filter((n) =>
      (migrationFiles[
        Object.keys(migrationFiles).find((p) => p.endsWith(n))!
      ] as string).includes("project--3f33732a-cb8b-43ae-84fb-01d9e367fb0c"),
    );
    const faltando = posteriores.filter((n) => !manifest.has(n) && !masterOnly.includes(n));
    expect(faltando).toEqual([]);
  });

  for (const objeto of [
    "work_statuses",
    "work_links",
    "work_comments",
    "project_participants",
  ] as const) {
    it(`delta cria ${objeto}`, () => {
      expect(delta).toContain(`public.${objeto}`);
    });
  }

  for (const coluna of ["projects.status_id", "tasks.start_date"] as const) {
    it(`delta adiciona ${coluna}`, () => {
      const [tabela, campo] = coluna.split(".");
      const bloco = delta.slice(delta.indexOf(`ALTER TABLE public.${tabela}\n`));
      expect(bloco).toContain(campo!);
    });
  }
});


describe("stripPsqlMetaCommands", () => {
  it("remove \\set, \\pset e \\timing mantendo o SQL", () => {
    const { sql, removed } = stripPsqlMetaCommands(
      ["\\pset pager off", "\\timing off", "SELECT 1;"].join("\n"),
    );
    expect(sql.trim()).toBe("SELECT 1;");
    expect(removed).toHaveLength(2);
  });

  for (const [nome, script] of [
    ["010_installation_identity", install010],
    ["011_brain_stats_init", install011],
    ["020_cron", install020],
  ] as const) {
    it(`${nome} fica sem meta-comando após saneamento`, () => {
      expect(stripPsqlMetaCommands(script).sql).not.toMatch(/^\\[a-z]/im);
    });
  }
});

describe("prepareVerificationSql", () => {
  it("remove o statement de RESUMO que contém a palavra FAIL", () => {
    const { sql } = prepareVerificationSql(verifySql);
    expect(sql).not.toMatch(/SELECT\s+'RESUMO'/i);
    expect(sql).not.toMatch(/^\\[a-z]/im);
    expect(sql.trimEnd().endsWith("ORDER BY ord;")).toBe(true);
  });
});

describe("summarizeVerificationRows", () => {
  it("PASS quando nenhuma linha tem status FAIL", () => {
    const s = summarizeVerificationRows([
      { status: "PASS", check_name: "extensões", observed: "6" },
      { status: "INFO", check_name: "sem dados de negócio (FAIL no texto)", observed: "0" },
    ]);
    expect(s.ok).toBe(true);
    expect(s.failed).toBe(0);
    expect(s.total).toBe(2);
  });

  it("FAIL somente pela coluna status", () => {
    const s = summarizeVerificationRows([
      { status: "PASS", check_name: "a", observed: "1" },
      { status: "FAIL", check_name: "cron: total de jobs", observed: "0" },
    ]);
    expect(s.ok).toBe(false);
    expect(s.failedChecks).toEqual(["cron: total de jobs"]);
  });

  it("resultado sem linhas é inconclusivo, nunca PASS", () => {
    const s = summarizeVerificationRows([]);
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/nenhuma verificação/);
  });
});

describe("reexecução idempotente do baseline", () => {
  it("divide statements preservando corpos dollar-quoted", () => {
    const stmts = splitSqlStatements(
      [
        "CREATE TYPE public.alert_severity AS ENUM ('low','high');",
        "CREATE FUNCTION f() RETURNS void AS $$ BEGIN PERFORM 1; END; $$ LANGUAGE plpgsql;",
        "SELECT 'a;b';",
      ].join("\n"),
    );
    expect(stmts).toHaveLength(3);
    expect(stmts[1]).toContain("PERFORM 1;");
    expect(stmts[2]).toBe("SELECT 'a;b';");
  });

  it("reconhece erros da classe 'já existe'", () => {
    expect(isDuplicateObjectError('ERROR: 42710: type "alert_severity" already exists')).toBe(true);
    expect(isDuplicateObjectError("ERROR: 42P07: relation \"brands\" already exists")).toBe(true);
    expect(isDuplicateObjectError('ERROR: 42P16: multiple primary keys for table "activity_events" are not allowed')).toBe(true);
    expect(isDuplicateObjectError("ERROR: 42P16: cannot change name of input parameter")).toBe(false);
    expect(isDuplicateObjectError("ERROR: 42501: permission denied")).toBe(false);
    expect(isDuplicateObjectError(null)).toBe(false);
  });

  it("reaplica ignorando duplicados e aborta em erro real", async () => {
    const ok = await applyStatementByStatement(
      {
        query: async () => ({ ok: true, rows: [] }),
      },
      "CREATE TYPE t AS ENUM ('a');\nCREATE TABLE x (id int);",
    );
    expect(ok).toMatchObject({ ok: true, skipped: 0, complete: true });

    const bad = await applyStatementByStatement(
      { query: async () => ({ ok: false, rows: [], error: "42501: permission denied" }) },
      "CREATE TABLE x (id int);",
    );
    expect(bad.ok).toBe(false);
  });

  it("divide adaptativamente o lote em vez de enviar milhares de statements um a um", async () => {
    let calls = 0;
    const progress: number[] = [];
    const sql = Array.from({ length: 256 }, (_, index) => `SELECT ${index};`).join("\n");
    const result = await applyStatementByStatement(
      {
        query: async (batch) => {
          if (!batch.includes("DO $unitos_guard$")) {
            // chamadas auxiliares: preparação da tabela de adiados e drenagem final
            return { ok: true, rows: [] };
          }
          calls += 1;
          expect(batch).toContain("WHEN SQLSTATE '42710'");
          expect(batch).toContain("WHEN SQLSTATE '42P16'");
          expect(batch).toContain("multiple primary key");
          return { ok: true, rows: [] };
        },

      },
      sql,
      { onProgress: (processed) => void progress.push(processed), maxStatements: 256 },
    );
    expect(result).toEqual({
      ok: true,
      skipped: 0,
      processed: 256,
      total: 256,
      complete: true,
    });
    expect(calls).toBe(11);
    expect(progress.at(-1)).toBe(256);

  });

  it("interrompe a retomada quando a operação foi cancelada", async () => {
    const result = await applyStatementByStatement(
      { query: async () => ({ ok: true, rows: [] }) },
      "SELECT 1; SELECT 2;",
      { isCancelled: async () => true },
    );
    expect(result).toMatchObject({ ok: false, error: "Operação cancelada pelo Super Admin." });
  });

  it("reinicia com segurança quando o checkpoint antigo não tem a fila de dependências", async () => {
    const batches: string[] = [];
    const result = await applyStatementByStatement(
      {
        query: async (batch) => {
          batches.push(batch);
          return {
            ok: true,
            rows: batch.includes(" as initialized") ? [{ initialized: false }] : [],
          };
        },
      },
      "SELECT 1; SELECT 2; SELECT 3;",
      { startIndex: 3 },
    );

    expect(result).toMatchObject({ ok: true, processed: 3, total: 3, complete: true });
    expect(batches.some((batch) => batch.includes("truncate table public._unitos_deferred_sql"))).toBe(true);
    expect(batches.some((batch) => batch.includes("DO $unitos_guard$"))).toBe(true);
  });
});
