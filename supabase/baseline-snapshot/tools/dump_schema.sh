#!/usr/bin/env bash
# =============================================================================
# Gera supabase/baseline-snapshot/001_initial_schema.sql a partir do ESTADO REAL
# do banco, por dump estrutural (NUNCA por replay das 250 migrations).
#
# Uso:
#   bash supabase/baseline-snapshot/tools/dump_schema.sh "<POSTGRES_URL>"
#
# <POSTGRES_URL>: connection string do banco de ORIGEM (producao), somente
# leitura por natureza — pg_dump nao escreve nada. Nenhum dado e exportado:
# --schema-only garante snapshot estrutural puro.
#
# Requer pg_dump >= 15 (mesma major do servidor Supabase).
# =============================================================================
set -euo pipefail

DB_URL="${1:?informe a connection string do banco de origem}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$OUT_DIR/001_initial_schema.sql"

pg_dump "$DB_URL" \
  --schema-only \
  --no-owner \
  --schema=public \
  --exclude-table='public.brain_events_archive*' \
  --file="$OUT.raw"

# Reordenacao por dependencia (obrigatoria): pg_dump emite funcoes ANTES das
# tabelas que elas referenciam, o que quebra a execucao em banco vazio via
# `supabase db query --linked`. O script abaixo apenas reordena statements e
# remove meta-comandos do psql (\restrict/\unrestrict) — nenhuma DDL muda.
python3 "$(dirname "$0")/reorder_schema.py" "$OUT.raw" "$OUT"

rm -f "$OUT.raw"
echo "gerado: $OUT ($(wc -l < "$OUT") linhas)"


cat <<'NEXT'

Proximo passo (NAO aplicar em producao):
  1. criar projeto Supabase descartavel
  2. psql "<URL_DESCARTAVEL>" -f 001_initial_schema.sql
  3. psql "<URL_DESCARTAVEL>" -f 003_storage_buckets.sql
  4. ajustar APP_URL e aplicar 002_bootstrap_cron.sql (ou manter jobs inativos)
  5. comparar contagens com a tabela do README.md e relatar divergencias
NEXT
