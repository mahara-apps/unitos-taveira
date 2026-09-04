# Auditoria READ-ONLY — Módulo de Instalação (MASTER)

Data: 2026-09-03. Nenhum arquivo de código, banco ou configuração foi alterado.

Veredito global: **FAIL — o módulo NÃO está pronto para replicar instalações completas.**
Há 3 bugs P0 que fazem o provisionamento automático falhar (ou reportar falso FAIL)
em qualquer execução real, além de drift do baseline em relação ao banco atual.

## P0 — quebram o provisionamento real

1. **Comandos psql enviados à Management API**
   `automation.server.ts` envia `010_installation_identity.sql`, `011_brain_stats_init.sql`,
   `020_cron.sql` e `verify-installation.sql` como SQL puro, mas os arquivos contêm
   meta-comandos de psql (`\set ON_ERROR_STOP on`, `\pset pager off`, `\timing off`).
   A Management API rejeita com erro de sintaxe em `\`.
   Efeito: etapas Deploy/URL, Brain stats, Cron e Validação final falham sempre.

2. **Detecção de FAIL na validação lê a linha errada**
   `verify-installation.sql` termina com um segundo statement ("RESUMO … qualquer FAIL
   bloqueia a liberação"). A Management API devolve só o resultado do último statement,
   cujo texto contém a palavra `FAIL`. O runner conta ocorrências de `FAIL` no JSON →
   sempre acusa 1 verificação em FAIL, mesmo com a instalação saudável.

3. **Baseline desatualizado (drift real de schema)**
   `supabase/baseline-snapshot/001_initial_schema.sql` foi dumpado antes das últimas
   migrations. Comparação com o banco atual:
   - tabelas ausentes (6): `briefing_import_runs`, `briefing_import_steps`,
     `briefing_import_changes`, `installations`, `installation_operations`,
     `installation_meta_app`
   - funções ausentes: `briefing_import_claim_lease`, `briefing_import_heartbeat`,
     `briefing_import_reap`, `installation_setup_state`, `enforce_single_brand`,
     `is_brand_integration_authority`
   - policies: 200 no baseline vs 217 no banco; triggers: 96 vs 103
   Efeito numa instalação nova: importação de briefing com IA morre (worker/reaper de cron
   apontam para tabelas inexistentes), `/setup` (primeiro Super Admin) quebra por falta de
   `installation_setup_state`, o guard de workspace único (`enforce_single_brand`) não existe,
   e a configuração Meta por instalação (`installation_meta_app`) não existe — sendo que o
   próprio `verify-installation.sql` consulta essa tabela e falharia com "relation does not exist".

## P1 — provisionamento incompleto

4. **Nenhum deploy é disparado após gravar as variáveis**
   `createDeployClient` só faz `GET /v9/projects` e `POST /v10/projects/:p/env`. Na Vercel,
   variáveis novas só valem em um novo deployment. A instalação é marcada OPERACIONAL sem que
   a aplicação tenha subido com as variáveis.

5. **Sem verificação de conectividade HTTP real da URL operacional**
   `checks.frontend = "ok"` é definido depois de gravar env, sem nenhum GET na URL. O cron é
   agendado para uma origem que pode nem responder.

6. **Testes cobrem apenas mocks**
   `tests/installation-automation.unit.test.ts` injeta `fetchImpl` que sempre responde ok, e nunca
   valida o texto SQL enviado. É por isso que os itens 1–3 passaram despercebidos.

## P2 — inconsistências menores

7. `verify-installation.sql` fixa "esperado 89 tabelas / 200 policies / 96 triggers" — números do
   dump antigo; após corrigir o baseline os limites ficam defasados.
8. Duplicidade de cron: `baseline-snapshot/002_bootstrap_cron.sql` (com `APP_URL_AQUI`) e
   `install/020_cron.sql`. A automação usa só o `020`; o `002` continua no README como etapa final,
   risco de alguém aplicar o arquivo com placeholder.
9. `installations` / `installation_operations` são MASTER-only por design, mas hoje estão no mesmo
   banco/baseline conceitual — não há marcação explícita de "não replicar", enquanto
   `installation_meta_app` (que DEVE ser replicada) está no mesmo balaio ausente.

## O que está correto

- Guards anti-MASTER (URL, cron, secrets herdados) em `bootstrap-contract.ts`, `010`, `020`.
- Geração de secrets exclusivos por instalação + `set_cron_secret` no Vault do destino.
- Isolamento de credenciais de gestão (`UNITOS_SUPABASE_MANAGEMENT_TOKEN`, `UNITOS_VERCEL_TOKEN`)
  lidas via `runtime-env.server.ts`, nunca expostas na UI.
- Saneamento de comandos de superusuário do dump (`baseline-sql.ts`).
- Ciclo de vida da operação: persistência, polling, retry, cancelar, reiniciar, acúmulo de progresso.
- Redaction/sanitize de detalhes persistidos e histórico sem dados sensíveis.

## Correção mínima para chegar a 100%

1. Strip de meta-comandos psql (`^\\\\...`) antes de enviar qualquer script à Management API.
2. Fazer o `verify` retornar um único resultado estruturado (ou parsear só as linhas de check),
   eliminando o falso FAIL.
3. Regerar o baseline (`tools/dump_schema.sh`) e atualizar os limites do verify; decidir
   explicitamente o que é MASTER-only.
4. Disparar deployment na Vercel após gravar env e checar HTTP 200 da URL antes de agendar cron.
5. Teste que valide o SQL enviado (sem `\`, sem placeholder, ordem dos arquivos) e um teste do
   parser de verify com linhas PASS/FAIL reais.

---

## Fechamento (correcoes aplicadas)

- **P0 meta-comandos psql:** `stripPsqlMetaCommands` aplicado a `010`, `011`, `020` e ao verify antes da Management API.
- **P0 parser do verify:** `prepareVerificationSql` remove o statement de RESUMO e `summarizeVerificationRows` decide apenas pela coluna `status`; zero linhas = inconclusivo (nunca PASS).
- **P0 baseline defasado:** criado `supabase/baseline-snapshot/007_delta_migrations.sql` (29 migrations pos-dump) + gerador `tools/build_delta.py`, aplicado no bootstrap e na automacao.
- **P1 deploy:** `deploy.redeploy()` dispara novo deployment de producao apos gravar as variaveis; `probeOperationalUrl` faz GET real e `checks.frontend` so vira `ok` com resposta HTTP 2xx/3xx.
- **P2 limites do verify:** atualizados para 95 tabelas / >=250 funcoes / >=215 policies / >=100 triggers.
- **Testes:** `tests/installation-baseline-completeness.unit.test.ts` (delta, meta-comandos, parser) e novos casos de redeploy/probe em `tests/installation-automation.unit.test.ts`.
