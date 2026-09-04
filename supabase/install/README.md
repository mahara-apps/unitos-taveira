# Padrão único de instalação do Unitos

Bootstrap idempotente de uma instalação **nova e independente do MASTER**:
Supabase próprio, Storage próprio, secrets próprios, cron apontando somente
para a própria URL, domínio próprio, deploy e repositório próprios.

Não há replay das migrations históricas — o estado inicial vem do baseline
snapshot em `supabase/baseline-snapshot/`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `bootstrap.sh` | orquestrador idempotente, 9 etapas, relatório PASS/FAIL |
| `validate-env.ts` | etapa 0 opcional: valida env sem tocar banco (`bun supabase/install/validate-env.ts`) |
| `010_installation_identity.sql` | grava `installation.app_url` da própria instalação (guard anti-MASTER) |
| `011_brain_stats_init.sql` | primeiro refresh de `brain_stats_mv` |
| `020_cron.sql` | agenda os 14 crons e recusa qualquer URL fora da própria origem |
| `verify-installation.sql` | validação **READ-ONLY** completa (pode rodar em produção) |
| `src/lib/installation/bootstrap-contract.ts` | regras puras do contrato (testadas em `tests/installation-bootstrap.unit.test.ts`) |

## Execução

```bash
export SUPABASE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
export PUBLIC_APP_URL="https://minha-instalacao.com"
# opcionais — gerados automaticamente se ausentes:
# CRON_SECRET BRAND_CREDENTIALS_SECRET META_STATE_SECRET META_WEBHOOK_VERIFY_TOKEN

bash supabase/install/bootstrap.sh
```

Ordem aplicada: `000 → 001 → 005 → 003 → 006 → 004`, depois
`set_cron_secret` → `installation.app_url` → `brain_stats_mv` → probe HTTP da
própria URL → `020_cron.sql` → `verify-installation.sql`.

`SKIP_URL_PROBE=1` roda tudo menos o cron (útil antes do frontend estar
publicado); rode o script novamente depois do deploy para agendar os jobs.

## Garantias

- **Idempotente**: `001` é pulado quando o schema já existe; buckets, seeds e
  crons usam `ON CONFLICT` / `unschedule` condicional.
- **Não destrutivo**: nenhum `DROP`, `TRUNCATE` ou `DELETE`.
- **Sem herança do MASTER**: ref `tkjbhttylouamqxnbfgv` e domínio
  `unitos-master.lovable.app` são recusados em env, DB URL, `installation` e cron.
- **Sem dado de negócio**: seeds apenas de `agent_prompts`, `feature_catalog`,
  `brain_retention_config` e do singleton `installation`.
- **Segredos por instalação**: gerados localmente com `/dev/urandom`, nunca importados.
- **Cron só depois da URL validada**: o probe HTTP precisa responder 401/403/200.
- **Origem única**: `020_cron.sql` compara a URL recebida com `installation.app_url`
  e aborta em divergência; ao final rejeita qualquer job com URL externa.

## Verificação isolada

```bash
psql "$SUPABASE_DB_URL" -f supabase/install/verify-installation.sql
```

Cobre isolamento, buckets/policies, RLS, funções/triggers, extensões, seeds,
Vault, URLs de cron, `installation.app_url`, `brain_stats_mv`, ausência de
referências ao MASTER e as contagens esperadas do baseline.

## Ordem no provisionamento automático (MASTER)

O bootstrap por script acima cuida do banco. Quando o provisionamento é
disparado pelo MASTER (*Administração → Instalações*), a ordem é:

```text
Supabase destino → código no GitHub da instalação (do template do MASTER)
→ projeto de deploy ligado a esse repositório (auto-deploy Git desligado)
→ secrets próprios → variáveis + primeira publicação + URL operacional
→ banco/RLS/funções → storage → seeds → Brain stats → cron → validação
```

Requer no MASTER, além dos tokens de Supabase e deploy, o
`UNITOS_GITHUB_TOKEN` e o repositório do MASTER marcado como **template**.

## Continua manual

Publicar os secrets no deploy, DNS/TLS, App Meta (`unitos` ou `client`) com
redirect URI e webhook, Resend, Evolution, signup do primeiro Super Admin,
primeiro workspace, branding institucional e chaves BYOK de IA.

## Preflight e política de secrets (fechamento técnico)

* `bash supabase/install/preflight.sh` — READ-ONLY. Valida domínio, Supabase
  destino, banco, credencial de gestão, extensões, endpoint publicado, secrets
  próprios e isolamento do MASTER. Resultado: `PASS`, `BLOCKED` (falta
  ambiente/credencial, exit 2) ou `FAIL` (pré-condição inválida, exit 1).
  Ausência de pré-condição nunca é PASS.
* Secrets (`CRON_SECRET`, `BRAND_CREDENTIALS_SECRET`, `META_STATE_SECRET`,
  `META_WEBHOOK_VERIFY_TOKEN`) nunca são herdados do ambiente em silêncio. Se a
  variável já existir no shell, a instalação destino precisa declará-la em
  `UNITOS_INSTALL_SECRETS` (`all` ou lista de nomes); sem declaração o bootstrap
  falha. Ausentes, são gerados no próprio destino.
* `bootstrap.sh` nunca imprime `RESULTADO: PASS` após abortar: abort de
  pré-condição gera `BLOCKED` (exit 2) e falha de etapa gera `FAIL` (exit 1).
