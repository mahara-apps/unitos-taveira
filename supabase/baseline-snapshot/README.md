# Baseline do Unitos — instalação nova (staging, nada aplicado)

Conjunto autocontido para levantar uma instalação nova do Unitos em um Supabase
**vazio**, gerado a partir do **estado real** do banco atual (`tkjbhttylouamqxnbfgv`),
sem replay das 250 migrations históricas — que continuam preservadas em
`supabase/migrations/` e no Git.

Nada nesta pasta é aplicado automaticamente. Produção não foi alterada: só
`pg_dump --schema-only` e `SELECT` em catálogos.

## Ordem definitiva de execução

```
000_extensions.sql        -- extensões (inclui vault, pgvector, pg_net, pg_cron)
001_initial_schema.sql    -- schema public completo (estrutura, RLS, funções)
005_auth_trigger.sql      -- trigger on_auth_user_created em auth.users
003_storage_buckets.sql    -- os 5 buckets privados
006_storage_policies.sql   -- as 12 policies de storage.objects
004_seeds.sql             -- seeds de catálogo (9 agentes, 14 features, 7 TTLs, installation)
002_bootstrap_cron.sql    -- os 14 cron jobs (por último: dependem de tudo acima)
```

`006` é obrigatório: `001` foi dumpado com `--schema=public` e por isso **não
contém nada do schema `storage`** — sem ele a instalação fica sem acesso a
arquivos (ou sem isolamento por workspace/cliente).

## Conteúdo por arquivo

| Arquivo | Conteúdo | Origem |
|---|---|---|
| `000_extensions.sql` | `pgcrypto`, `uuid-ossp`, `pg_stat_statements` (schema `extensions`), `supabase_vault`, `vector` e `pg_net` (schema `public`), `pg_cron` | `pg_extension` |
| `001_initial_schema.sql` | **reordenado por dependencia** (`tools/reorder_schema.py`), sem diretivas `\restrict`/`\unrestrict`: 89 tabelas, 10 enums, 133 funções/RPCs, 200 policies, 96 triggers, 203 índices + 114 constraints, 1 matview, GRANTs | `pg_dump --schema-only --schema=public` |
| `005_auth_trigger.sql` | `on_auth_user_created` → `public.handle_new_user()` | `pg_get_triggerdef` |
| `003_storage_buckets.sql` | `brand-assets`, `brand-documents`, `brand-media`, `avatars`, `chat-attachments` (privados) | `storage.buckets` |
| `006_storage_policies.sql` | 12 policies de `storage.objects` + RLS | `pg_policies` |
| `004_seeds.sql` | 9 `agent_prompts` + 14 `feature_catalog` + 7 `brain_retention_config` + singleton vazio de `installation`; zero dados de negócio/cliente/credencial | catálogos do Master (somente leitura) |
| `002_bootstrap_cron.sql` | 14 jobs (7 via `net.http_post`, 7 SQL diretos) | `cron.job` |
| `tools/dump_schema.sh` | regenera o `001` | — |

## Dependências externas obrigatórias (fornecidas pelo Supabase)

O conjunto **não** cria — e depende de — objetos gerenciados pela plataforma:

- schema `auth` com `auth.users` (FKs e `auth.uid()` / `auth.jwt()`);
- schema `storage` com `storage.objects`, `storage.buckets`, `storage.foldername()`
  e os triggers nativos (`protect_delete`, `update_objects_updated_at`, etc.);
- roles `anon`, `authenticated`, `service_role`, `postgres` (alvos de GRANT);
- schema `vault` (a extensão é criada em `000`);
- Realtime não é usado pelo baseline (nenhuma tabela publicada).

Ou seja: **projeto Supabase novo, não Postgres puro.**

## Variáveis / segredos necessários na instalação nova

No banco:

```sql
SELECT public.set_cron_secret('<CRON_SECRET>');            -- >= 16 chars, Vault
INSERT INTO public.installation (id) VALUES (true)          -- singleton, se ausente
  ON CONFLICT DO NOTHING;
```

Em `002_bootstrap_cron.sql`: substituir `APP_URL_AQUI` pela URL **da própria**
instalação.

Na aplicação (env):

```
VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PROJECT_ID
SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY / SUPABASE_SERVICE_ROLE_KEY
CRON_SECRET                (idêntico ao gravado no Vault)
BRAND_CREDENTIALS_SECRET
PUBLIC_APP_URL
META_APP_ID / META_APP_SECRET / META_REDIRECT_URI /
META_WEBHOOK_VERIFY_TOKEN / META_STATE_SECRET     (opcionais: Meta)
```

Nenhum valor de domínio, ID, usuário ou marca desta instalação está no SQL
(verificado: zero URLs, zero `INSERT`/`COPY`).

## Correções já aplicadas nesta etapa

1. `CREATE SCHEMA public;` → `CREATE SCHEMA IF NOT EXISTS public;` (o `public`
   sempre existe em projeto Supabase novo; o comando original abortaria o `001`).
2. `supabase_vault` passou a ser criado explicitamente em `000` — `001` define
   `public.cron_secret()` / `set_cron_secret()` sobre `vault.*`.
3. `pg_net`: documentado que as funções ficam em `net.*` (como `002` chama),
   apesar de `extnamespace = public`.
4. `006_storage_policies.sql` criado (lacuna real: `storage` fora do dump).
5. `002` passou a exigir explicitamente `set_cron_secret` antes dos jobs HTTP.

## Ordem interna do `001_initial_schema.sql`

`pg_dump` emite as funções antes das tabelas que elas referenciam, o que torna o
dump cru inexecutável em banco vazio (`supabase db query --linked` falhava em
`public.brain_retention_config`, `portal_tokens`, `clients`, etc.). O arquivo é
agora reordenado por `tools/reorder_schema.py` para:

```
schema → enums/types → tabelas → funções → matview → defaults →
constraints (PK/UNIQUE/CHECK) → FKs → índices → triggers → RLS →
policies → comments → grants
```

Nenhuma DDL é alterada, removida ou adicionada — só a ordem. `\restrict` e
`\unrestrict` (meta-comandos do psql) foram removidos; um único
`SET check_function_bodies = false;` no topo cobre funções que chamam outras
funções (ordem topológica não garantida pelo dump). Objetos que exigem validação
real — defaults, CHECK, índices e policies — são criados depois das funções e
continuam sendo verificados pelo Postgres.

### Validação por execução real (banco vazio)

Executado em cluster PostgreSQL descartável com stubs de `auth`/`storage`/`vault`
e roles `anon`/`authenticated`/`service_role`. Resultado idêntico ao Master:

| Objeto | Master | Reconstruído |
|---|---|---|
| tabelas | 89 | 89 |
| funções próprias | 133 | 133 |
| triggers | 96 | 96 |
| policies | 200 | 200 |
| enums | 10 | 10 |
| FKs | 194 | 194 |
| índices | 317 | 317 |
| materialized view | 1 | 1 |
| tabelas com RLS | 89 | 89 |

Zero erros de dependência; as 133 funções SQL foram revalidadas com
`check_function_bodies = true` sem nenhuma falha, e `004_seeds.sql` e
`006_storage_policies.sql` aplicaram em seguida sem erro. Observação: o cluster
de teste era PG16 e recusou o privilégio `MAINTAIN` (PG17+) em 89 GRANTs; em
projeto Supabase novo (PG17.6, igual ao Master) isso não ocorre.

## Pendências antes do primeiro teste real

1. ~~Execução real ainda não feita.~~ **RESOLVIDO:** `000`+`001`+`004`+`006`
   foram aplicados em cluster PostgreSQL vazio e as contagens conferem com o
   Master (ver tabela acima). Falta apenas o teste em projeto Supabase real
   descartável para cobrir `003` (buckets) e `002` (cron).
2. ~~Catálogos de `004` não promovidos.~~ **RESOLVIDO:** `004_seeds.sql` agora
   contém os seeds reais e idempotentes — 9 `agent_prompts`, 14 `feature_catalog`,
   7 `brain_retention_config` e o singleton vazio de `installation`.
   Validado por execução real dentro de transação com `ROLLBACK` (zero erros).
3. **`brain_stats_mv`** nasce vazia; o job `refresh-brain-stats-mv` a popula.
4. Divergências de contagem esperadas (não são erro): 96 triggers no `001`
   (os 103 do banco incluem `auth`/`cron`/`realtime`/`storage`) e 203
   `CREATE INDEX` (os 317 do catálogo incluem índices de constraints).

O baseline **não** está aprovado como final: está autocontido e sem dependência
oculta das 250 migrations, mas falta a reconstrução real (item 1) e a decisão de
seeds (item 2).

## 007_delta_migrations.sql (delta pos-dump)

O dump `001_initial_schema.sql` congela o schema na migration `20260829120135`.
Todas as migrations posteriores sao concatenadas em `007_delta_migrations.sql`
(gerado por `tools/build_delta.py`, manifesto em `tools/delta_manifest.txt`) e
aplicadas **depois** de `005_auth_trigger.sql`. Sem esse arquivo, uma instalacao
nova nasce sem briefing import por IA, workspace singleton, `/setup`,
`installation_meta_app`, leases de `ai_jobs` e autoridade de integracao.

Ao criar novas migrations, a sequencia obrigatoria e:

1. `python3 supabase/baseline-snapshot/tools/build_delta.py` (regenera o delta e
   o manifesto);
2. conferir/ajustar os limites de contagem e as checagens especificas em
   `supabase/install/verify-installation.sql`;
3. elevar `MASTER_RELEASE_VERSION` em `src/lib/installation/manager-contract.ts`
   (as instalacoes so mostram "atualizacao disponivel" quando a versao sobe);
4. rodar **Atualizar** em cada instalacao (a etapa de banco aplica o delta novo,
   controlada pelo ledger `public._unitos_applied_deltas`).

Statements `ALTER TYPE ... ADD VALUE` sao executados isolados pela automacao
(`applyStatementByStatement`), porque o Postgres recusa esse comando dentro de
bloco `DO`. Mantenha o `IF NOT EXISTS` nesses comandos.
