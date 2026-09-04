#!/usr/bin/env python3
"""
Reordena um dump pg_dump --schema-only para ordem de dependencia executavel
em um banco vazio (supabase db query --linked / psql), sem alterar nenhuma DDL.

Ordem de saida:
  schema -> types/enums -> tabelas -> funcoes -> matviews/views ->
  constraints (PK/UNIQUE/CHECK) -> FKs -> indices -> triggers ->
  RLS -> policies -> comments -> grants/revokes

Uso: python3 tools/reorder_schema.py <in.sql> <out.sql>
Nao remove nem adiciona objetos: apenas reordena statements e descarta
meta-comandos do psql (\\restrict / \\unrestrict) e comandos SET de sessao.
"""
import re
import sys


def split_statements(sql: str):
    """Divide em statements de topo, respeitando dollar-quoting e strings."""
    stmts, buf, i, n = [], [], 0, len(sql)
    dollar_tag = None
    while i < n:
        ch = sql[i]
        if dollar_tag:
            if sql.startswith(dollar_tag, i):
                buf.append(dollar_tag)
                i += len(dollar_tag)
                dollar_tag = None
                continue
            buf.append(ch)
            i += 1
            continue
        if ch == "$":
            m = re.match(r"\$[A-Za-z_0-9]*\$", sql[i:])
            if m:
                dollar_tag = m.group(0)
                buf.append(dollar_tag)
                i += len(dollar_tag)
                continue
        if ch == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'":
                    if j + 1 < n and sql[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            buf.append(sql[i:j + 1])
            i = j + 1
            continue
        if ch == '"':
            j = sql.index('"', i + 1)
            buf.append(sql[i:j + 1])
            i = j + 1
            continue
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j == -1 else j
            buf.append(sql[i:j])
            i = j
            continue
        if ch == ";":
            buf.append(";")
            stmts.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        stmts.append(tail)
    return stmts


def code_of(stmt: str) -> str:
    """Statement sem comentarios de linha, normalizado para classificacao."""
    lines = [ln for ln in stmt.split("\n") if not ln.lstrip().startswith("--")]
    return " ".join(" ".join(lines).split())


def bucket(stmt: str) -> int:
    c = code_of(stmt)
    u = c.upper()
    if not c:
        return -1
    if u.startswith(("SET ", "SELECT PG_CATALOG.SET_CONFIG")):
        return -1
    if u.startswith("CREATE SCHEMA") or u.startswith("COMMENT ON SCHEMA"):
        return 0
    if u.startswith("CREATE EXTENSION"):
        return 0
    if u.startswith(("CREATE TYPE", "CREATE DOMAIN")):
        return 1
    if u.startswith(("CREATE TABLE", "CREATE UNLOGGED TABLE", "CREATE SEQUENCE")):
        return 2
    if u.startswith("ALTER SEQUENCE") or u.startswith("ALTER TABLE") and " OWNED BY " in u:
        return 3
    if u.startswith(("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION",
                     "CREATE PROCEDURE", "CREATE AGGREGATE", "CREATE OPERATOR",
                     "CREATE CAST")):
        return 4
    if u.startswith(("CREATE MATERIALIZED VIEW", "CREATE VIEW", "CREATE OR REPLACE VIEW")):
        return 5
    if u.startswith("ALTER TABLE") and "ALTER COLUMN" in u and "SET DEFAULT" in u:
        return 6
    if u.startswith("ALTER TABLE") and "ADD CONSTRAINT" in u:
        return 8 if "FOREIGN KEY" in u else 7
    if u.startswith(("CREATE INDEX", "CREATE UNIQUE INDEX")):
        return 9
    if u.startswith(("CREATE TRIGGER", "CREATE CONSTRAINT TRIGGER")):
        return 10
    if u.startswith("ALTER TABLE") and "ROW LEVEL SECURITY" in u:
        return 11
    if u.startswith("CREATE POLICY"):
        return 12
    if u.startswith("COMMENT ON"):
        return 13
    if u.startswith(("GRANT ", "REVOKE ", "ALTER DEFAULT PRIVILEGES")):
        return 14
    return 6  # outros ALTERs de tabela (defaults, identity, replica identity)


HEADER = """\
-- =============================================================================
-- 001_initial_schema.sql — SNAPSHOT ESTRUTURAL DO ESTADO ATUAL APROVADO
--
-- Gerado por pg_dump --schema-only (estado real do banco) e REORDENADO por
-- tools/reorder_schema.py para ordem de dependencia executavel em um projeto
-- Supabase NOVO e vazio, via psql OU `supabase db query --linked`.
--
-- Ordem interna: schema -> enums/types -> tabelas -> funcoes -> matviews ->
-- defaults -> constraints (PK/UNIQUE/CHECK) -> FKs -> indices -> triggers ->
-- RLS -> policies -> comments -> grants.
--
-- Nenhuma DDL foi alterada, removida ou adicionada: apenas a ordem dos
-- statements. Meta-comandos do psql (\\restrict/\\unrestrict) e SETs de sessao
-- foram removidos por incompatibilidade com `supabase db query`.
--
-- NAO contem: DML de seed/backfill, dados de producao, cron jobs, buckets e
-- policies de Storage, trigger em auth.users. Ver 000/002/003/004/005/006.
-- =============================================================================

"""

LABELS = {
    0: "SCHEMA / EXTENSIONS", 1: "TYPES / ENUMS", 2: "TABLES / SEQUENCES",
    3: "SEQUENCE OWNERSHIP", 4: "FUNCTIONS", 5: "VIEWS / MATERIALIZED VIEWS",
    6: "COLUMN DEFAULTS / OTHER ALTERS", 7: "CONSTRAINTS (PK / UNIQUE / CHECK)",
    8: "FOREIGN KEYS", 9: "INDEXES", 10: "TRIGGERS", 11: "ROW LEVEL SECURITY",
    12: "POLICIES", 13: "COMMENTS", 14: "GRANTS / REVOKES",
}


def main():
    src, dst = sys.argv[1], sys.argv[2]
    raw = open(src, encoding="utf-8").read()
    raw = "\n".join(
        ln for ln in raw.split("\n") if not ln.lstrip().startswith("\\")
    )
    # remove o cabecalho original do arquivo de entrada (comentarios antes do
    # primeiro statement) para nao duplicar com o HEADER desta ferramenta.
    lines = raw.split("\n")
    k = 0
    while k < len(lines) and (not lines[k].strip() or lines[k].lstrip().startswith("--")):
        k += 1
    raw = "\n".join(lines[k:])
    stmts = split_statements(raw)
    groups = {k: [] for k in LABELS}
    dropped = 0
    for s in stmts:
        b = bucket(s)
        if b < 0:
            dropped += 1
            continue
        groups[b].append(s.strip())
    out = [HEADER,
           "-- Bodies de funcoes nao sao validados: o dump nao garante ordem\n"
           "-- topologica entre funcoes que chamam outras funcoes. Objetos que\n"
           "-- exigem validacao real (defaults, CHECK, indices, policies) sao\n"
           "-- criados DEPOIS das funcoes, portanto continuam sendo verificados.\n"
           "SET check_function_bodies = false;\n"]
    for k in sorted(LABELS):
        if not groups[k]:
            continue
        out.append(f"\n-- ============================ {LABELS[k]} "
                   f"({len(groups[k])}) ============================\n")
        out.extend(s + "\n" for s in groups[k])
    open(dst, "w", encoding="utf-8").write("\n".join(out) + "\n")
    total = sum(len(v) for v in groups.values())
    print(f"statements: {len(stmts)} lidos, {total} emitidos, {dropped} descartados (SET/psql)")
    for k in sorted(LABELS):
        print(f"  {LABELS[k]}: {len(groups[k])}")


if __name__ == "__main__":
    main()
