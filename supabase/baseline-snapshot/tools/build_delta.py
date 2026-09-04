#!/usr/bin/env python3
"""Gera supabase/baseline-snapshot/007_delta_migrations.sql.

O dump 001_initial_schema.sql congela o schema em uma migration especifica
(START_MIGRATION). Toda migration posterior precisa entrar no baseline para que
uma instalacao nova nasca identica ao MASTER — este script concatena essas
migrations na ordem cronologica original.

Uso:
    python3 supabase/baseline-snapshot/tools/build_delta.py
"""

from __future__ import annotations

import glob
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MIGRATIONS = os.path.join(ROOT, "migrations")
OUT = os.path.join(ROOT, "baseline-snapshot", "007_delta_migrations.sql")
MANIFEST = os.path.join(ROOT, "baseline-snapshot", "tools", "delta_manifest.txt")

# Primeira migration APOS o corte do dump 001_initial_schema.sql.
START_MIGRATION = "20260829121019_8a4f7bd3-bff7-464d-997c-d72f8676ebec.sql"

HEAD = """-- =============================================================================
-- 007_delta_migrations.sql — DELTA do baseline.
--
-- O dump `001_initial_schema.sql` foi tirado em 2026-08-29 (migration
-- 20260829120135). Tudo que entrou depois vive aqui, na ordem cronologica
-- original das migrations, para que uma instalacao nova nasca identica ao
-- MASTER (briefing import por IA, workspace singleton, Installation Manager,
-- leases de ai_jobs, autoridade de integracao, /setup, etc).
--
-- Gerado por: supabase/baseline-snapshot/tools/build_delta.py
-- Aplicar DEPOIS de 005_auth_trigger.sql e ANTES de 003_storage_buckets.sql.
-- Nao editar a mao: regenerar quando novas migrations forem criadas.
-- =============================================================================

"""


def main() -> None:
    files = sorted(glob.glob(os.path.join(MIGRATIONS, "*.sql")))
    start = os.path.join(MIGRATIONS, START_MIGRATION)
    selected = files[files.index(start):]

    parts = [HEAD]
    for path in selected:
        name = os.path.basename(path)
        parts.append(
            "\n-- ---------------------------------------------------------------------------\n"
            f"-- {name}\n"
            "-- ---------------------------------------------------------------------------\n"
        )
        with open(path, encoding="utf-8") as fh:
            parts.append(fh.read().rstrip() + "\n")

    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("".join(parts))
    with open(MANIFEST, "w", encoding="utf-8") as fh:
        fh.write("\n".join(os.path.basename(p) for p in selected) + "\n")

    print(f"{len(selected)} migrations -> {OUT}")


if __name__ == "__main__":
    main()
