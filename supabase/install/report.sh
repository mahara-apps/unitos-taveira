#!/usr/bin/env bash
# =============================================================================
# report.sh — canal de progresso opcional para o MASTER.
#
# Fonte única: os scripts de instalação continuam sendo os mesmos. Este arquivo
# só ENVIA o progresso ao módulo MASTER de Instalações quando o operador define:
#
#   UNITOS_MASTER_URL   origem https do MASTER
#   UNITOS_RUN_TOKEN    token de execução de uso único emitido pelo MASTER
#
# Sem essas variáveis todas as funções são no-op — o bootstrap roda offline
# exatamente como antes.
#
# Nada sensível é enviado: apenas id da etapa, estado e um resumo curto.
# =============================================================================

report_enabled() {
  [ -n "${UNITOS_MASTER_URL:-}" ] && [ -n "${UNITOS_RUN_TOKEN:-}" ]
}

_report_post() {
  report_enabled || return 0
  command -v curl >/dev/null 2>&1 || return 0
  curl -s -o /dev/null -m 10 -X POST \
    -H 'content-type: application/json' \
    --data "$1" \
    "${UNITOS_MASTER_URL%/}/api/public/installations/report" >/dev/null 2>&1 || true
}

_json_escape() {
  printf '%s' "${1:-}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r' | cut -c1-500
}

# report_step <step-id> <pending|running|done|error> [detalhe]
report_step() {
  report_enabled || return 0
  _report_post "{\"token\":\"$(_json_escape "$UNITOS_RUN_TOKEN")\",\"step\":\"$(_json_escape "$1")\",\"state\":\"$(_json_escape "$2")\",\"detail\":\"$(_json_escape "${3:-}")\"}"
}

# report_done <true|false> <versao> <resumo> [warnings true|false] [checks-json]
report_done() {
  report_enabled || return 0
  local ok="$1" version="$2" summary="$3" warnings="${4:-false}" checks="${5:-{\}}"
  _report_post "{\"token\":\"$(_json_escape "$UNITOS_RUN_TOKEN")\",\"done\":true,\"ok\":$ok,\"warnings\":$warnings,\"version\":\"$(_json_escape "$version")\",\"summary\":\"$(_json_escape "$summary")\",\"checks\":$checks}"
}
