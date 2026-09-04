/**
 * Saneamento do baseline para execução via Supabase Management API.
 *
 * A Management API executa SQL como o papel `postgres`, que NÃO é superusuário
 * no Supabase. Alguns comandos que o `pg_dump` emite pertencem exclusivamente
 * a `supabase_admin`/superusuário e falham com:
 *
 *   ERROR: 42501: permission denied to change default privileges
 *   ERROR: 42501: must be owner of schema public
 *
 * Esses comandos são irrelevantes para a instalação: o baseline concede
 * privilégios explicitamente (GRANT por tabela/função) e todo projeto Supabase
 * novo já nasce com as ACLs default corretas. Portanto eles são REMOVIDOS aqui,
 * nunca "ignorados silenciosamente no meio do script" — a remoção é explícita,
 * auditável e testada.
 *
 * Nada além destes padrões é alterado: schema, RLS, policies, funções,
 * triggers, GRANTs e seeds seguem literais.
 */

/** Padrões de comandos que apenas superusuário pode executar. */
const SUPERUSER_ONLY_PATTERNS: readonly RegExp[] = [
  /^ALTER\s+DEFAULT\s+PRIVILEGES\b/i,
  /^COMMENT\s+ON\s+SCHEMA\s+public\b/i,
  /^ALTER\s+SCHEMA\s+public\s+OWNER\s+TO\b/i,
  // storage.objects pertence a supabase_storage_admin: `must be owner of table
  // objects`. RLS ja vem habilitado nesta tabela em qualquer projeto novo.
  /^ALTER\s+TABLE\s+(?:ONLY\s+)?storage\.\w+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i,
  /^ALTER\s+TABLE\s+(?:ONLY\s+)?storage\.\w+\s+OWNER\s+TO\b/i,
];

export type SanitizedBaseline = {
  /** SQL pronto para a Management API. */
  sql: string;
  /** Comandos removidos (primeira linha, truncada) — para telemetria. */
  removed: string[];
};

function isSuperuserOnly(statement: string): boolean {
  const head = statement.replace(/^\s*(--[^\n]*\n|\s)+/g, "").trim();
  return SUPERUSER_ONLY_PATTERNS.some((re) => re.test(head));
}

/**
 * Remove os comandos exclusivos de superusuário de um arquivo do baseline.
 * Implementação conservadora: só remove statements de UMA linha que casam com
 * os padrões acima (é exatamente a forma emitida pelo pg_dump).
 */
export function sanitizeBaselineSqlForManagementApi(sql: string): SanitizedBaseline {
  const removed: string[] = [];
  const out: string[] = [];

  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.endsWith(";") && isSuperuserOnly(trimmed)) {
      removed.push(trimmed.slice(0, 120));
      continue;
    }
    if (isPsqlMetaCommand(trimmed)) {
      removed.push(trimmed.slice(0, 120));
      continue;
    }
    out.push(line);
  }

  return { sql: out.join("\n"), removed };
}

/**
 * Meta-comandos do cliente `psql` (`\set`, `\pset`, `\timing`, `\echo`, ...).
 * Eles NAO sao SQL: enviados a Management API causam erro de sintaxe. Os
 * scripts de `supabase/install/` sao escritos para psql, entao precisam ser
 * saneados antes de rodar pela API.
 */
function isPsqlMetaCommand(line: string): boolean {
  return /^\\[a-z]/i.test(line);
}

/** Remove meta-comandos psql mantendo todo o restante literal. */
export function stripPsqlMetaCommands(sql: string): SanitizedBaseline {
  const removed: string[] = [];
  const out: string[] = [];
  for (const line of sql.split("\n")) {
    if (isPsqlMetaCommand(line.trim())) {
      removed.push(line.trim().slice(0, 120));
      continue;
    }
    out.push(line);
  }
  return { sql: out.join("\n"), removed };
}

/**
 * Prepara `verify-installation.sql` para a Management API.
 *
 * A API retorna SOMENTE as linhas do ULTIMO statement. O script termina com um
 * SELECT de resumo cujo texto contem a palavra "FAIL", o que produzia um FAIL
 * falso e escondia o resultado real. Aqui o statement de resumo é removido,
 * deixando a consulta de checks como ultimo statement.
 */
export function prepareVerificationSql(sql: string): SanitizedBaseline {
  const stripped = stripPsqlMetaCommands(sql);
  const removed = [...stripped.removed];
  const summary = /(--[^\n]*\n)*\s*SELECT\s+'RESUMO'[\s\S]*?;\s*$/i;
  const match = summary.exec(stripped.sql);
  if (match) removed.push("SELECT 'RESUMO' ... (statement de resumo)");
  return { sql: stripped.sql.replace(summary, "").trimEnd(), removed };
}

export type VerificationSummary = {
  total: number;
  failed: number;
  failedChecks: string[];
  ok: boolean;
  reason: string | null;
};

/**
 * Interpreta as linhas do verify: só a coluna `status` decide PASS/FAIL.
 * Nunca busca a palavra "FAIL" no JSON inteiro da linha (o texto do check
 * também contém "FAIL"). Zero linhas => resultado inconclusivo => não-ok.
 */
export function summarizeVerificationRows(rows: readonly unknown[]): VerificationSummary {
  const parsed = rows.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  if (parsed.length === 0) {
    return {
      total: 0,
      failed: 0,
      failedChecks: [],
      ok: false,
      reason: "verify-installation não retornou nenhuma verificação",
    };
  }
  const failedChecks = parsed
    .filter((row) => String(row["status"] ?? "").trim().toUpperCase() === "FAIL")
    .map((row) => String(row["check_name"] ?? "verificação sem nome"));

  return {
    total: parsed.length,
    failed: failedChecks.length,
    failedChecks,
    ok: failedChecks.length === 0,
    reason:
      failedChecks.length === 0
        ? null
        : `${failedChecks.length} verificação(ões) em FAIL: ${failedChecks.slice(0, 5).join("; ")}`,
  };
}


/* ------------------------------------------------------------------ *
 * Reexecução idempotente do baseline
 *
 * A Management API aborta o arquivo inteiro no primeiro erro. Se uma
 * tentativa anterior aplicou parte do schema, o retry morre em
 * "42710: type ... already exists". Aqui o SQL é dividido em statements
 * (respeitando dollar-quoting de funções) para que a reexecução possa
 * ignorar SOMENTE erros da classe "já existe".
 * ------------------------------------------------------------------ */

/** Códigos de erro Postgres que significam "objeto já existe". */
const DUPLICATE_SQLSTATES = [
  "42710", // duplicate_object (type, trigger, policy, role...)
  "42P07", // duplicate_table (table, index, view, sequence)
  "42P06", // duplicate_schema
  "42701", // duplicate_column
  "42723", // duplicate_function
  "23505", // unique_violation (seed já inserido)
] as const;

/** True quando o erro é apenas "objeto já existe" (retry idempotente). */
export function isDuplicateObjectError(message: string | null | undefined): boolean {
  if (!message) return false;
  return DUPLICATE_SQLSTATES.some((code) => message.includes(code))
    || (/42P16/i.test(message) && /multiple primary keys?/i.test(message))
    || /already exists/i.test(message);
}

/**
 * Divide SQL em statements no `;` de nível superior, preservando strings,
 * identificadores citados, comentários e corpos dollar-quoted ($$ / $tag$).
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  let quote: "'" | '"' | null = null;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const ch = sql.charAt(i);
    const rest = sql.slice(i);

    if (dollarTag) {
      buf += ch;
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag.slice(1);
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i += 1;
      continue;
    }

    if (quote) {
      buf += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          buf += quote;
          i += 2;
          continue;
        }
        quote = null;
      }
      i += 1;
      continue;
    }

    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end + 1;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    const dollar = /^\$[A-Za-z_0-9]*\$/.exec(rest);
    if (dollar) {
      dollarTag = dollar[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      i += 1;
      continue;
    }

    if (ch === ";") {
      const statement = `${buf};`.trim();
      if (statement.replace(/;$/, "").trim()) out.push(statement);
      buf = "";
      i += 1;
      continue;
    }

    buf += ch;
    i += 1;
  }

  const tail = buf.trim();
  if (tail) out.push(tail.endsWith(";") ? tail : `${tail};`);
  return out;
}
