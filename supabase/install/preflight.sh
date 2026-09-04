#!/usr/bin/env bash
# =============================================================================
# preflight.sh — validação determinística das PRÉ-CONDIÇÕES de provisionamento.
#
# READ-ONLY: não cria, não altera e não provisiona nada. Serve para responder,
# antes de qualquer execução, se o provisionamento real é possível.
#
# Resultado:
#   PASS    todas as pré-condições satisfeitas
#   BLOCKED falta ambiente/credencial (NUNCA tratar como PASS)
#   FAIL    pré-condição inválida (ex.: aponta para o MASTER)
#
# Pré-condições avaliadas:
#   domínio próprio, projeto Supabase destino, banco destino, credencial de
#   gestão, extensões obrigatórias, endpoint publicado, secrets próprios e
#   isolamento em relação ao MASTER.
#
# Uso:
#   export PUBLIC_APP_URL="https://minha-instalacao.com"
#   export SUPABASE_URL="https://<ref>.supabase.co"
#   export SUPABASE_DB_URL="postgresql://..."            # opcional
#   export SUPABASE_ACCESS_TOKEN="..."                    # credencial de gestão
#   bash supabase/install/preflight.sh
# =============================================================================

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MASTER_TOKENS='unitos-master.lovable.app|tkjbhttylouamqxnbfgv'
REQUIRED_EXT='vector pg_net pg_cron supabase_vault pgcrypto'

PASS_N=0
FAIL_N=0
BLOCK_N=0

emit() { printf '%-12s | %-8s | %s\n' "$1" "$2" "${3:-}"; }
ok()      { PASS_N=$((PASS_N + 1));  emit "$1" PASS "${2:-}"; }
bad()     { FAIL_N=$((FAIL_N + 1));  emit "$1" FAIL "${2:-}"; }
blocked() { BLOCK_N=$((BLOCK_N + 1)); emit "$1" BLOCKED "${2:-}"; }

printf 'check        | estado   | evidência\n'
printf '%s\n' '-------------+----------+----------------------------------------------'

# --- domínio ---------------------------------------------------------------
APP="${PUBLIC_APP_URL:-}"
APP="${APP%/}"
if [ -z "$APP" ]; then
  blocked domain "PUBLIC_APP_URL ausente"
elif printf '%s' "$APP" | grep -Eiq "$MASTER_TOKENS"; then
  bad domain "PUBLIC_APP_URL aponta para o MASTER"
elif printf '%s' "$APP" | grep -Eq '^https://[A-Za-z0-9._-]+(:[0-9]+)?$'; then
  ok domain "$APP"
else
  bad domain "PUBLIC_APP_URL inválida (use apenas a origem https)"
fi

# --- projeto supabase destino ----------------------------------------------
if [ -z "${SUPABASE_URL:-}" ]; then
  blocked supabase "SUPABASE_URL do destino ausente"
elif printf '%s' "${SUPABASE_URL}" | grep -Eiq "$MASTER_TOKENS"; then
  bad supabase "SUPABASE_URL aponta para o MASTER"
else
  ok supabase "${SUPABASE_URL}"
fi

# --- banco destino ---------------------------------------------------------
DB_OK=0
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  blocked database "SUPABASE_DB_URL ausente"
elif printf '%s' "${SUPABASE_DB_URL}" | grep -Eiq "$MASTER_TOKENS"; then
  bad database "SUPABASE_DB_URL aponta para o banco do MASTER"
elif ! command -v psql >/dev/null 2>&1; then
  blocked database "psql não encontrado no PATH"
elif psql "${SUPABASE_DB_URL}" -tAX -c 'select 1' >/dev/null 2>&1; then
  DB_OK=1
  ok database "conexão estabelecida (credencial não exibida)"
else
  blocked database "banco destino inacessível"
fi

# --- credencial de gestão --------------------------------------------------
if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  ok management "credencial presente (valor não exibido)"
else
  blocked management "credencial de gestão do Supabase destino ausente"
fi

# --- extensões -------------------------------------------------------------
if [ "$DB_OK" != "1" ]; then
  blocked extensions "sem banco acessível para inspecionar extensões"
else
  missing=""
  for ext in $REQUIRED_EXT; do
    found="$(psql "${SUPABASE_DB_URL}" -tAX -c "select count(*) from pg_available_extensions where name='$ext'" 2>/dev/null | tr -d '[:space:]')"
    [ "${found:-0}" = "0" ] && missing="$missing $ext"
  done
  if [ -n "$missing" ]; then bad extensions "ausentes:$missing"; else ok extensions "$REQUIRED_EXT"; fi
fi

# --- endpoint publicado ----------------------------------------------------
if [ -z "$APP" ]; then
  blocked endpoint "sem domínio para testar"
elif ! command -v curl >/dev/null 2>&1; then
  blocked endpoint "curl não encontrado no PATH"
else
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST "$APP/api/public/cron/sla-check" 2>/dev/null || echo 000)"
  case "$code" in
    200|401|403) ok endpoint "HTTP $code" ;;
    000) blocked endpoint "sem resposta do endpoint publicado" ;;
    *) bad endpoint "HTTP $code inesperado" ;;
  esac
fi

# --- secrets próprios ------------------------------------------------------
DECLARED="$(printf '%s' "${UNITOS_INSTALL_SECRETS:-}" | tr '[:lower:]' '[:upper:]' | tr ',' ' ')"
secret_problem=""
for var in CRON_SECRET BRAND_CREDENTIALS_SECRET META_STATE_SECRET META_WEBHOOK_VERIFY_TOKEN; do
  value="${!var:-}"
  [ -z "$value" ] && continue
  if printf '%s' "$value" | grep -Eiq "$MASTER_TOKENS"; then
    secret_problem="$secret_problem $var(master)"
    continue
  fi
  case " $DECLARED " in
    *" ALL "*|*" $var "*) : ;;
    *) secret_problem="$secret_problem $var(herdado)" ;;
  esac
done
if [ -n "$secret_problem" ]; then
  bad secrets "problemas:$secret_problem"
else
  ok secrets "próprios do destino (ausentes serão gerados no bootstrap)"
fi

# --- isolamento ------------------------------------------------------------
if [ "$(printf '%s' "${UNITOS_INSTALLATION_ROLE:-}" | tr '[:upper:]' '[:lower:]')" = "master" ]; then
  bad isolation "preflight rodando no ambiente MASTER"
else
  ok isolation "nenhum identificador do MASTER no ambiente"
fi

printf '\n'
if [ "$FAIL_N" -gt 0 ]; then
  printf 'RESULTADO: FAIL (%s falha(s), %s bloqueio(s))\n' "$FAIL_N" "$BLOCK_N"
  exit 1
fi
if [ "$BLOCK_N" -gt 0 ]; then
  printf 'RESULTADO: BLOCKED (%s pré-condição(ões) indisponível(is) neste ambiente)\n' "$BLOCK_N"
  exit 2
fi
printf 'RESULTADO: PASS (%s checks) — script em %s\n' "$PASS_N" "$HERE"
exit 0
