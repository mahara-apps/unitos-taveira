#!/usr/bin/env bash
# =============================================================================
# validate.sh — validação READ-ONLY de uma instalação, com report ao MASTER.
#
# NÃO substitui nem duplica nada: apenas executa o
# supabase/install/verify-installation.sql existente e traduz o resultado em
# etapas para o módulo MASTER de Instalações (quando configurado).
#
# Uso:
#   export SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
#   # opcional (acompanhamento no MASTER):
#   export UNITOS_MASTER_URL="https://unitos-master.lovable.app"
#   export UNITOS_RUN_TOKEN="<token emitido pelo MASTER>"
#   bash supabase/install/validate.sh
# =============================================================================

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/report.sh"

RELEASE_VERSION="2026.09.0"

[ -n "${SUPABASE_DB_URL:-}" ] || { echo "SUPABASE_DB_URL ausente"; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "psql não encontrado"; exit 1; }

STEPS=(isolation database rls storage cron)
for s in "${STEPS[@]}"; do report_step "$s" running; done

OUT="$(psql "$SUPABASE_DB_URL" -f "$HERE/verify-installation.sql" 2>&1)"
RC=$?
printf '%s\n' "$OUT"

PASSED="$(printf '%s' "$OUT" | grep -c 'PASS' || true)"
FAILED="$(printf '%s' "$OUT" | grep -c 'FAIL' || true)"

if [ "$RC" -ne 0 ]; then
  for s in "${STEPS[@]}"; do report_step "$s" error "verify-installation.sql não executou"; done
  report_done false "" "Validação não executou (verifique SUPABASE_DB_URL)." false '{}'
  exit 1
fi

state=done
warnings=false
if [ "${FAILED:-0}" -gt 0 ]; then state=error; fi

for s in "${STEPS[@]}"; do report_step "$s" "$state" "$PASSED PASS / $FAILED FAIL"; done

CHECKS='{"database":"ok","storage":"ok","cron":"ok","secrets":"ok"}'
if [ "${FAILED:-0}" -gt 0 ]; then
  CHECKS='{"database":"error","storage":"attention","cron":"attention","secrets":"attention"}'
  report_done false "$RELEASE_VERSION" "Validação: $PASSED aprovados, $FAILED falhos." false "$CHECKS"
  exit 1
fi

report_done true "$RELEASE_VERSION" "Validação: $PASSED aprovados, 0 falhos." "$warnings" "$CHECKS"
exit 0
