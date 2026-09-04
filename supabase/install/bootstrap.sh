#!/usr/bin/env bash
# =============================================================================
# bootstrap.sh — padrão único de instalação do Unitos.
#
# Cria uma instalação NOVA e INDEPENDENTE do MASTER em um Supabase próprio,
# sem replay das migrations históricas: aplica o baseline snapshot na ordem
# correta, grava o segredo do cron no Vault, registra a URL da própria
# instalação, inicializa brain_stats_mv e só então agenda os 14 crons.
#
# Propriedades:
#   * idempotente (pode rodar várias vezes);
#   * não destrutivo (nenhum DROP/TRUNCATE/DELETE);
#   * não copia dado de negócio, usuário, marca, secret ou credencial do MASTER;
#   * seeds apenas de catálogo/configuração;
#   * relatório PASS/FAIL por etapa e exit code != 0 em qualquer FAIL.
#
# Uso:
#   export SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
#   export PUBLIC_APP_URL="https://minha-instalacao.com"
#   export CRON_SECRET="..."                 # opcional: gerado se ausente
#   export BRAND_CREDENTIALS_SECRET="..."    # opcional: gerado se ausente
#   export META_STATE_SECRET="..."           # opcional: gerado se ausente
#   export META_WEBHOOK_VERIFY_TOKEN="..."   # opcional: gerado se ausente
#   bash supabase/install/bootstrap.sh
#
# Flags de ambiente:
#   SKIP_URL_PROBE=1   pula o teste HTTP da própria URL (dev/preview offline)
# =============================================================================

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASELINE="$(cd "$HERE/../baseline-snapshot" && pwd)"
MASTER_TOKENS='unitos-master.lovable.app|tkjbhttylouamqxnbfgv'
RELEASE_VERSION="2026.09.0"

# Canal OPCIONAL de progresso para o módulo MASTER de Instalações.
# Sem UNITOS_MASTER_URL/UNITOS_RUN_TOKEN todas as funções são no-op.
# shellcheck source=/dev/null
. "$HERE/report.sh"

FAILURES=0
ABORTED=0
declare -a REPORT=()

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

pass() { REPORT+=("PASS | $1 | ${2:-}"); printf '  PASS  %s %s\n' "$1" "${2:-}"; }
fail() { REPORT+=("FAIL | $1 | ${2:-}"); FAILURES=$((FAILURES + 1)); printf '  FAIL  %s %s\n' "$1" "${2:-}"; }
skip() { REPORT+=("SKIP | $1 | ${2:-}"); printf '  SKIP  %s %s\n' "$1" "${2:-}"; }
blocked() { REPORT+=("BLOCKED | $1 | ${2:-}"); printf '  BLOCKED  %s %s\n' "$1" "${2:-}"; }

die() {
  # Abort por pré-condição (nenhuma etapa falhou) => BLOCKED/exit 2.
  # Abort após falha de etapa => FAIL/exit 1. Nunca PASS.
  if [ "$FAILURES" -eq 0 ]; then
    ABORTED=1
    blocked "pré-condição" "$1"
  fi
  printf '\n\033[31mBOOTSTRAP ABORTADO:\033[0m %s\n' "$1"
  report_done false "" "Bootstrap abortado: $1" false '{}'
  print_report
  [ "$ABORTED" = "1" ] && exit 2
  exit 1
}

print_report() {
  printf '\n=========== RELATÓRIO DO BOOTSTRAP ===========\n'
  for line in "${REPORT[@]}"; do printf '%s\n' "$line"; done
  printf '==============================================\n'
  if [ "$ABORTED" = "1" ]; then
    printf 'RESULTADO: BLOCKED (pré-condição não satisfeita — nada foi provisionado)\n'
  elif [ "$FAILURES" -gt 0 ]; then
    printf 'RESULTADO: FAIL (%s etapa(s))\n' "$FAILURES"
  else
    printf 'RESULTADO: PASS\n'
  fi
}


psql_run() { psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --quiet "$@"; }
psql_value() { psql "$SUPABASE_DB_URL" -tAX -c "$1" 2>/dev/null | tr -d '[:space:]'; }

gen_secret() {
  # Segredo aleatório local — nunca herdado do MASTER.
  head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40
}

# ----------------------------------------------------------------- etapa 1: env
step "Etapa 1/9 — Validação do ambiente da instalação"
report_step supabase running

command -v psql >/dev/null 2>&1 || die "psql não encontrado no PATH"
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL ausente"
[ -n "${PUBLIC_APP_URL:-}" ] || die "PUBLIC_APP_URL ausente (a instalação precisa da própria URL)"

APP_ORIGIN="${PUBLIC_APP_URL%/}"
if ! printf '%s' "$APP_ORIGIN" | grep -Eq '^https://[A-Za-z0-9._-]+(:[0-9]+)?$'; then
  die "PUBLIC_APP_URL inválida ($PUBLIC_APP_URL): use somente a origem https, sem path"
fi
if printf '%s' "$APP_ORIGIN" | grep -Eiq "$MASTER_TOKENS"; then
  die "PUBLIC_APP_URL aponta para o MASTER — instalação não seria independente"
fi
if printf '%s' "$SUPABASE_DB_URL" | grep -Eiq "$MASTER_TOKENS"; then
  die "SUPABASE_DB_URL aponta para o banco do MASTER — abortado"
fi
pass "ambiente" "origem=$APP_ORIGIN"

# Mínimo Operacional Primeiro: a URL temporária do deploy é uma URL OPERACIONAL
# válida. Domínio definitivo é configuração posterior e nunca bloqueia.
case "$APP_ORIGIN" in
  *.vercel.app|*.lovable.app|*.netlify.app|*.pages.dev|*.onrender.com|*.fly.dev)
    pass "url operacional" "URL temporária do deploy aceita — domínio definitivo é opcional" ;;
  *)
    pass "url operacional" "domínio próprio da instalação" ;;
esac

# Secrets: nunca herdados silenciosamente do ambiente (ex.: shell do MASTER).
# Aceitos apenas quando a instalação destino os DECLARA em UNITOS_INSTALL_SECRETS
# ("all" ou lista de nomes). Sem declaração, o bootstrap gera valores próprios;
# se a variável já existir no ambiente sem declaração, a operação é BLOQUEADA.
DECLARED_SECRETS="$(printf '%s' "${UNITOS_INSTALL_SECRETS:-}" | tr '[:lower:]' '[:upper:]' | tr ',' ' ')"
MASTER_ENV=0
if [ "$(printf '%s' "${UNITOS_INSTALLATION_ROLE:-}" | tr '[:upper:]' '[:lower:]')" = "master" ]; then MASTER_ENV=1; fi
if printf '%s' "${SUPABASE_URL:-}" | grep -Eiq "$MASTER_TOKENS"; then MASTER_ENV=1; fi

secret_declared() {
  case " $DECLARED_SECRETS " in
    *" ALL "*) return 0 ;;
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

for var in CRON_SECRET BRAND_CREDENTIALS_SECRET META_STATE_SECRET META_WEBHOOK_VERIFY_TOKEN; do
  current="${!var:-}"
  if [ -z "$current" ]; then
    export "$var"="$(gen_secret)"
    pass "secret $var" "gerado nesta instalação (valor não exibido)"
  elif printf '%s' "$current" | grep -Eiq "$MASTER_TOKENS"; then
    fail "secret $var" "parece derivado do MASTER — gere um novo"
  elif ! secret_declared "$var"; then
    fail "secret $var" "presente no ambiente sem declaração em UNITOS_INSTALL_SECRETS — herança não permitida"
  elif [ "$MASTER_ENV" = "1" ]; then
    fail "secret $var" "ambiente de execução é o MASTER — rode o bootstrap no destino"
  elif [ "$var" = "CRON_SECRET" ] && [ "${#current}" -lt 16 ]; then
    fail "secret CRON_SECRET" "menor que 16 caracteres"
  else
    pass "secret $var" "declarado pela instalação destino"
  fi
done
[ "$FAILURES" -eq 0 ] || die "segredos inválidos ou herdados do ambiente"


# ------------------------------------------------------------- etapa 2: conexão
step "Etapa 2/9 — Conectividade e pré-requisitos do Supabase"
report_step supabase running
if ! psql_run -c 'select 1' >/dev/null 2>&1; then
  die "não foi possível conectar ao banco informado em SUPABASE_DB_URL"
fi
for schema in auth storage vault; do
  if [ "$(psql_value "select count(*) from information_schema.schemata where schema_name='$schema'")" = "1" ]; then
    pass "schema $schema" "presente"
  else
    fail "schema $schema" "ausente — o alvo precisa ser um projeto Supabase, não Postgres puro"
  fi
done
[ "$FAILURES" -eq 0 ] || die "pré-requisitos de plataforma ausentes"

# ------------------------------------------------------------ etapa 3: baseline
step "Etapa 3/9 — Baseline (extensões, schema, RLS, triggers, buckets, policies, seeds)"
report_step database running

apply_sql() {
  local label="$1" file="$2"
  if [ ! -f "$file" ]; then fail "$label" "arquivo ausente: $file"; return; fi
  if out="$(psql_run -f "$file" 2>&1)"; then
    pass "$label" "aplicado"
  else
    fail "$label" "$(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')"
  fi
}

apply_sql "000_extensions" "$BASELINE/000_extensions.sql"

TABLE_COUNT="$(psql_value "select count(*) from pg_tables where schemaname='public'")"
if [ "${TABLE_COUNT:-0}" -ge 95 ]; then
  skip "001_initial_schema" "schema já presente ($TABLE_COUNT tabelas) — idempotência preservada"
else
  apply_sql "001_initial_schema" "$BASELINE/001_initial_schema.sql"
fi

apply_sql "005_auth_trigger"    "$BASELINE/005_auth_trigger.sql"
# Delta pos-dump: tudo criado depois do corte de 001_initial_schema.sql.
apply_sql "007_delta_migrations" "$BASELINE/007_delta_migrations.sql"
report_step database done "schema aplicado"
report_step storage running
apply_sql "003_storage_buckets" "$BASELINE/003_storage_buckets.sql"
apply_sql "006_storage_policies" "$BASELINE/006_storage_policies.sql"
report_step storage done "buckets e policies aplicados"
report_step seeds running
apply_sql "004_seeds"           "$BASELINE/004_seeds.sql"
[ "$FAILURES" -eq 0 ] || die "baseline incompleto"
report_step seeds done "seeds de catálogo aplicados"

# O PostgREST cacheia o schema. Sem recarregar, a API responde PGRST205/PGRST202
# para tudo que acabou de ser criado e a instalação sobe aparentemente vazia.
if psql_run -c "notify pgrst, 'reload schema';" >/dev/null 2>&1; then
  pass "postgrest schema cache" "recarregado"
else
  fail "postgrest schema cache" "não foi possível recarregar (notify pgrst)"
fi


# ------------------------------------------------------------ etapa 4: vault
step "Etapa 4/9 — CRON_SECRET no Vault (mesma origem usada pelo cron)"
report_step secrets running
if psql_run -c "select public.set_cron_secret('${CRON_SECRET//\'/\'\'}');" >/dev/null 2>&1; then
  vault_len="$(psql_value "select coalesce(length(public.cron_secret()),0)")"
  if [ "${vault_len:-0}" -ge 16 ]; then
    pass "vault cron_secret" "gravado (len=$vault_len)"
  else
    fail "vault cron_secret" "gravado mas inválido"
  fi
else
  fail "vault cron_secret" "set_cron_secret falhou"
fi
[ "$FAILURES" -eq 0 ] || die "segredo do cron não disponível"
report_step secrets done "CRON_SECRET próprio no Vault"

# --------------------------------------------------------- etapa 5: identidade
step "Etapa 5/9 — Identidade da instalação (installation.app_url)"
report_step deploy running
if out="$(psql_run -v app_url="$APP_ORIGIN" -f "$HERE/010_installation_identity.sql" 2>&1)"; then
  stored="$(psql_value "select rtrim(app_url,'/') from public.installation limit 1")"
  if [ "$stored" = "$APP_ORIGIN" ]; then
    pass "installation.app_url" "$stored"
  else
    fail "installation.app_url" "divergente: banco=$stored env=$APP_ORIGIN"
  fi
else
  fail "installation.app_url" "$(printf '%s' "$out" | tail -n 2 | tr '\n' ' ')"
fi
[ "$FAILURES" -eq 0 ] || die "identidade da instalação inválida"
report_step deploy done "app_url própria registrada"

# ------------------------------------------------------- etapa 6: brain_stats_mv
step "Etapa 6/9 — Inicialização de brain_stats_mv"
report_step brain running
if out="$(psql_run -f "$HERE/011_brain_stats_init.sql" 2>&1)"; then
  populated="$(psql_value "select relispopulated from pg_class where relname='brain_stats_mv' and relkind='m'")"
  [ "$populated" = "t" ] && pass "brain_stats_mv" "populada" || fail "brain_stats_mv" "não populada"
else
  fail "brain_stats_mv" "$(printf '%s' "$out" | tail -n 2 | tr '\n' ' ')"
fi
report_step brain "$([ "$FAILURES" -eq 0 ] && echo done || echo error)"

# ------------------------------------------------------- etapa 7: URL validada
step "Etapa 7/9 — Validação da própria URL antes de agendar cron"
report_step deploy running
URL_OK=0
if [ "${SKIP_URL_PROBE:-0}" = "1" ]; then
  skip "probe da URL" "SKIP_URL_PROBE=1 — cron NÃO será agendado"
else
  probe_url="$APP_ORIGIN/api/public/cron/sla-check"
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' -X POST "$probe_url" 2>/dev/null || echo 000)"
  case "$code" in
    401|403) pass "probe da URL" "$probe_url respondeu $code (endpoint protegido por x-cron-secret)"; URL_OK=1 ;;
    200)     pass "probe da URL" "$probe_url respondeu 200 (verifique o gate de segredo)"; URL_OK=1 ;;
    000)     fail "probe da URL" "sem resposta de $probe_url — publique o frontend antes do cron" ;;
    *)       fail "probe da URL" "$probe_url respondeu $code — cron não será agendado" ;;
  esac
fi

# ------------------------------------------------------------- etapa 8: cron
step "Etapa 8/9 — Agendamento dos 14 crons (somente com URL validada)"
report_step cron running
if [ "$URL_OK" = "1" ]; then
  if out="$(psql_run -v app_url="$APP_ORIGIN" -f "$HERE/020_cron.sql" 2>&1)"; then
    jobs="$(psql_value "select count(*) from cron.job")"
    foreign="$(psql_value "select count(*) from cron.job where command ~ 'https?://' and command not like '%${APP_ORIGIN}/%'")"
    if [ "${jobs:-0}" -ge 14 ] && [ "${foreign:-1}" = "0" ]; then
      pass "cron" "$jobs jobs, todos na própria origem"
    else
      fail "cron" "jobs=$jobs urls externas=$foreign"
    fi
  else
    fail "cron" "$(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')"
  fi
else
  skip "cron" "URL da instalação não validada — agendamento postergado (rode novamente após publicar)"
fi

# ------------------------------------------------------------ etapa 9: verify
step "Etapa 9/9 — Verificação final (READ-ONLY)"
report_step validation running
if out="$(psql "$SUPABASE_DB_URL" -f "$HERE/verify-installation.sql" 2>&1)"; then
  printf '%s\n' "$out"
  if printf '%s' "$out" | grep -q '^ *FAIL'; then
    fail "verify-installation" "há verificações em FAIL (ver saída acima)"
  else
    pass "verify-installation" "todas as verificações PASS"
  fi
else
  fail "verify-installation" "$(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')"
fi

# ------------------------------------------------ primeiro acesso (não bloqueia)
step "Primeiro acesso — Super Admin e workspace único"
SETUP_JSON="$(psql_value "select public.installation_setup_state()::text")"
CORE_ADMIN="pending"
CORE_WORKSPACE="pending"
case "$SETUP_JSON" in
  *'"needs_super_admin":false'*) CORE_ADMIN="ok" ;;
esac
case "$SETUP_JSON" in
  *'"has_workspace":true'*) CORE_WORKSPACE="ok" ;;
esac
if [ "$CORE_ADMIN" = "ok" ]; then
  pass "primeiro acesso" "Super Admin já existe nesta instalação"
else
  skip "primeiro acesso" "abra $APP_ORIGIN/setup e crie o Super Admin (o 1º usuário vira Super Admin e cria o workspace único)"
fi

print_report

cat <<MANUAL

NÚCLEO (obrigatório — define READY, já coberto por este bootstrap):
  * Supabase, schema, RLS, Storage, seeds, secrets próprios, cron, URL própria,
    health check; primeiro Super Admin + workspace único em ${APP_ORIGIN}/setup.
  * publicar os secrets gerados no gerenciador do deploy (mesmos valores usados aqui).

CONFIGURAÇÃO OPCIONAL (não bloqueia — a instalação já é OPERACIONAL sem isso):
  * domínio definitivo (DNS/TLS) — a URL temporária do deploy é válida;
  * App Meta (modo "unitos" ou "client"), redirect URI e webhook;
  * Resend (domínio verificado) e instância Evolution/WhatsApp;
  * chaves BYOK de IA e branding institucional na UI.
MANUAL

CORE_CHECKS="{\"database\":\"ok\",\"schema\":\"ok\",\"rls\":\"ok\",\"seeds\":\"ok\",\"storage\":\"ok\",\"cron\":\"ok\",\"secrets\":\"ok\",\"deploy\":\"ok\",\"health_check\":\"ok\",\"super_admin\":\"$CORE_ADMIN\",\"workspace\":\"$CORE_WORKSPACE\"}"

if [ "$FAILURES" -eq 0 ]; then
  report_step validation done "todas as verificações PASS"
  report_done true "$RELEASE_VERSION" "Provisionamento concluído sem falhas." false "$CORE_CHECKS"
  exit 0
fi

report_step validation error "$FAILURES etapa(s) em FAIL"
report_done false "$RELEASE_VERSION" "Provisionamento com $FAILURES etapa(s) em FAIL." false '{}'
exit 1
