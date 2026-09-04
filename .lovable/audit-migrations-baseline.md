# Auditoria READ-ONLY — 250 migrations × estado real do banco

Data: 2026-08-29 · Escopo: `supabase/migrations/` (250 arquivos) + catálogo do banco de produção (`tkjbhttylouamqxnbfgv`).
**Nenhum DDL/DML foi executado.** Todas as consultas foram `SELECT` em `pg_catalog`/`cron.job`/`supabase_migrations`.

## 1. Quantidade total

| Item | Valor |
|---|---|
| Arquivos em `supabase/migrations/` | **250** |
| Registros em `supabase_migrations.schema_migrations` | **250** (ledger íntegro, zero drift) |
| Arquivos em `supabase/baseline/` (staging, nunca aplicados como arquivo) | 15 |
| Tabelas em `public` hoje | 89 |
| Enums | 10 · Functions 251 (inclui pgvector) · Policies 200 · Triggers 103 · Índices 317 · FKs 194 · Matviews 1 · Views 0 · Cron jobs 14 |

## 2. Distribuição por classificação

| Classificação | Qtd | % |
|---|---|---|
| ATIVA | 177 | 70,8% |
| SUPERADA | 22 | 8,8% |
| PERIGOSA | 16 | 6,4% |
| REDUNDANTE | 13 | 5,2% |
| INDETERMINADA | 12 | 4,8% |
| HISTÓRICA | 10 | 4,0% |

Critério aplicado: uma migration é ATIVA quando contém a **última** definição de pelo menos um objeto que ainda existe (função, policy, trigger, índice, tabela, enum) ou um `ALTER TABLE` estrutural vigente; SUPERADA quando todas as suas definições foram redefinidas depois; HISTÓRICA quando só toca objetos que já não existem ou faz seed/backfill de dados; REDUNDANTE quando só repete `GRANT`/`REVOKE` idempotente; PERIGOSA quando contém `DROP TABLE` de tabela com dados, `DELETE`/`TRUNCATE` ou reorganização física; INDETERMINADA quando o efeito depende de `DO $$` dinâmico/cron e não é dedutível estaticamente.

## 3. Blocos arquiteturais e sua evolução

| Bloco | Criado em | Modificado/removido por | Estado final atual |
|---|---|---|---|
| Núcleo (brands, clients, projects, tasks, posts, post_approvals, notifications, activity_events, portal_tokens, brand_members, client_briefings) | `20260707030537` | dezenas de ALTERs (colunas, enums, RLS) até `20260828121229` | ATIVO; `brands` é o Workspace/Tenant canônico (69 colunas `brand_id` no schema) |
| Brand Hub / IA de marca (brand_ai_*, brand_briefings, personas, swot, pautas, voice cards, cohorts, competitors) | `20260707035947` | briefing v2 (`20260818143357`, `20260818144705`, `20260818151627`) | ATIVO |
| Pipelines de conteúdo | `20260711093326` | SLA (`20260720153439`), `derive_post_stage`, `posts_touch_stage_entered_at` | ATIVO |
| CRM (crm_pipelines, crm_pipeline_stages, crm_deals) | `20260711094913` | **nenhuma migration remove** | **AUSENTE no banco** → divergência (item 4) |
| Brain 1.0 (brain_events particionado + archive + brain_knowledge + matview) | `20260715124415`, `20260717165418`, `20260717195239`, `20260717202312` | `20260717194303` (drop brain_knowledge), `20260819182328`, `20260824114103`, e a simplificação `20260829113852` → `20260829121019` (drop archive) → `20260829122439` (desparticionamento) → `20260829124704` (FKs + policies renomeadas) | ATIVO simplificado: `brain_events` tabela única, sem partições/archive, retenção 90d, FKs cascade para fila e embeddings |
| Brain memória/aprendizado (brain_memory, versions, learning_queue, relationships, recommendations, reasoning_logs, worker_runs) | `20260717165418`–`20260817132752` | mineração `20260817135040`/`20260817141853`, guardas `20260824125902`, `20260825005340`/`20260825005625` | ATIVO |
| Meta/Social | `20260717230138` (meta_connections + meta_oauth_states) | **substituídos** por `20260717231914` (social_connections/social_posts) e `20260720161542` (meta_oauth_sessions) | ATIVO no modelo social_*; tabelas meta antigas removidas por migration |
| Portal do cliente | `20260715020549` (`_portal_session`, RPCs `portal_*`) | `20260813115816` (rate limit), `20260813135601`, `20260818131940` (`_portal_session_any/_user`), hardening `20260821091100` | ATIVO; `portal_feed` foi descontinuada |
| RBAC | `app_access_role` `20260818123429` (6 revisões até `20260828114652`) | `can_access_client*`, `can_access_project/task`, `can_invite_brand_role`, `can_create_brand`, `can_delete_brand` (`20260828121229`), `brand_member_role` | ATIVO: Super Admin → Owner; Owner/Admin → Admin/Manager/User; Manager → User |
| Instalação (singleton) | `20260829130645` | — | ATIVO: `public.installation` (URL, logos, remetente), escrita só Super Admin |
| Features/entitlements | `20260720111732` (feature_catalog, brand_features) | trigger `enable_default_brand_features` | ATIVO |
| WhatsApp/Evolution | `20260826155640`, `20260826162930`, `20260826164502` | — | ATIVO |
| Cron | vários (`20260714211842`, `20260715134357`, `20260717170458`, `20260717195239`, `20260811125449`, `20260817135723`/`20260817141853`, `20260819160947`) | reagendamentos sucessivos | 14 jobs ativos (worker/reaper Brain, retenção, SLA, publicação Meta, prune de mídia, refresh da matview) |

## 4. Divergências migration × banco atual

1. **CRM removido fora do versionamento** — `crm_pipelines`, `crm_pipeline_stages`, `crm_deals` são criadas em `20260711094913` e **nenhuma migration as remove**, mas não existem no banco. Replay integral do histórico recriaria três tabelas mortas.
2. **`user_profiles` sem `CREATE TABLE` em migrations** — objeto pré-versionamento; só existe como staging em `supabase/baseline/20260101000000_baseline_pre_versioning.sql`. É o único objeto do banco não explicado pelo histórico aplicado.
3. **5 buckets de Storage** (`brand-assets`, `brand-documents`, `brand-media`, `avatars`, `chat-attachments`) existem no banco e não são criados por nenhuma migration (API de Storage, não SQL).
4. **Enum `app_role` carrega labels legados** `editor` e `designer`, contrários à matriz canônica atual — labels de enum não podem ser removidos, então o histórico não reflete a regra vigente (normalização é feita em código/`normalize_app_role`).
5. **Objetos criados e depois removidos** (esperado, mas relevante para baseline): `brain_knowledge`, `brain_events_archive`, `brain_events_default`/partições mensais, `brain_events_new` (tabela de transição), `meta_connections`, `meta_oauth_states`, funções `brain_ensure_event_partitions`, `brain_apply_partition_policies`, `brain_archive_and_prune_events`, `portal_feed`.
6. **Churn de policies** — 444 `CREATE POLICY` e 283 `DROP POLICY` no histórico resultam em **200** policies vivas: ~55% do histórico de RLS é sobrescrito.
7. **Funções redefinidas muitas vezes** — 253 `CREATE OR REPLACE FUNCTION` para 136 nomes distintos; ex.: `app_access_role` 6×, `can_access_client_row` 6×, `can_access_client` 5×, `accept_brand_invite` 4×, `can_manage_brand_ai_limits` 4×.

## 5. Objetos órfãos / legados

- `brain_stats_mv` (única matview) + job `refresh-brain-stats-mv` a cada 5 min: criada em `20260717195239`, exposição no API já corrigida; permanece como legado de performance do Brain 1.0.
- Índices duplicados semânticos em `brain_relationships`: `brain_rel_from_idx`/`brain_relationships_from_idx` e `brain_rel_to_idx`/`brain_relationships_to_idx`.
- Duplicidade em `client_members`: `client_members_user_id_idx` e `client_members_user_idx`; em `client_social_accounts`: `idx_client_social_accounts_connection` e `client_social_accounts_connection_idx`.
- Labels de enum sem uso operacional (`app_role.editor`, `app_role.designer`).
- `supabase/baseline/` contém 15 SQLs de correção nunca promovidos como arquivo (parte já aplicada por migrations equivalentes) — fonte de ambiguidade sobre o que é verdade em produção.

## 6. Riscos para criar o `001_initial_schema.sql`

| Risco | Detalhe |
|---|---|
| **Replay recria objetos mortos** | CRM (3 tabelas), `brain_knowledge`, `meta_connections`/`meta_oauth_states`, archive/partições do Brain. |
| **16 migrations destrutivas** | `20260707030537` (drop de posts/post_approvals legados), `20260717194303`, `20260717202312`, `20260717231914`, `20260724141045`, `20260811123127`, `20260813115816`, `20260817120920`, `20260817132752`, `20260820174230`, `20260820180844`, `20260829113852`, `20260829121019`, `20260829122439`, `20260829124704`, `20260715022338`. Nenhuma delas deve entrar num snapshot inicial. |
| **92 migrations com DML** | seeds (`feature_catalog`, `agent_prompts`, pipelines/estágios padrão, templates de mensagem) e backfills (`brand_id`, `stage_entered_at`, `client_id`, roles). Seeds de catálogo **precisam** existir no baseline; backfills **não** (dependem de linhas antigas). |
| **9 migrations com cron** | `cron.schedule` depende de extensão, do segredo `cron_secret` e da URL da instalação; reexecução duplica/rearma jobs. Devem ficar em módulo separado, pós-schema. |
| **Migrations que dependem de dados existentes** | `20260820174230`/`20260820180844` (normalização de papéis), `20260828114652` (Owner×Admin), `20260819182328` (owner default de clients), `20260829124704` (marcação de órfãos antes das FKs), `20260817120920`, `20260824125902`. |
| **Objetos fora do SQL** | buckets de Storage, `installation` (1 linha singleton), segredo de cron, publicação realtime (`brain_events`, `brain_insights`). |
| **Estado sem histórico** | `user_profiles` e `handle_new_user()` só existem no staging; um baseline gerado a partir das migrations, sem eles, produziria instalação quebrada no signup. |
| **pgvector/extensões** | `brain_embeddings` depende de `vector`/`halfvec` e índice HNSW; extensões precisam ser declaradas antes do schema. |

## 7. Recomendação final (sem executar nada)

1. **Não** consolidar por replay do histórico. Gerar o `001_initial_schema.sql` a partir de **dump estrutural do banco atual** (schema-only, sem owners/ACL de sistema), que já reflete todas as 250 migrations e as divergências manuais.
2. Estruturar o baseline em 4 arquivos: `001_extensions.sql`, `002_schema.sql` (tabelas/enums/FKs/índices/triggers), `003_functions_rls.sql`, `004_seeds_catalogo.sql` (apenas `feature_catalog`, `agent_prompts`, templates e pipelines padrão — nada de dados de cliente).
3. Manter cron, buckets e a linha singleton de `installation` **fora** do baseline, em um `005_bootstrap_instalacao.sql` opcional e idempotente.
4. Descartar do baseline (mantendo apenas no Git): as 22 SUPERADAS, 13 REDUNDANTES, 10 HISTÓRICAS e as 16 PERIGOSAS — 61 arquivos que não agregam estado final.
5. Antes do corte, decidir explicitamente: (a) CRM volta ou é oficialmente removido; (b) índices duplicados são consolidados; (c) `user_profiles`/`handle_new_user` entram no baseline; (d) labels legados de `app_role` permanecem por compatibilidade.
6. Validar o baseline em projeto Supabase descartável comparando `pg_catalog` (tabelas, colunas, policies, triggers, índices, FKs) com produção antes de trocar o histórico.

## Anexo — classificação por migration

| Migration | Classificação | fn | tab | pol | trg | idx | DML | DROP TABLE | cron |
|---|---|---|---|---|---|---|---|---|---|
| 20260707030537 | PERIGOSA | 5 | 11 | 16 | 10 | 1 | 1 | ai_agents,campaigns,conversations,leads,post_approvals,posts | 0 |
| 20260707030621 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260707032536 | ATIVA | 1 | 0 | 1 | 1 | 0 | 1 | — | 0 |
| 20260707035947 | ATIVA | 0 | 10 | 11 | 8 | 2 | 0 | — | 0 |
| 20260707041201 | ATIVA | 0 | 0 | 10 | 0 | 9 | 0 | — | 0 |
| 20260709213415 | ATIVA | 0 | 0 | 0 | 1 | 0 | 0 | — | 0 |
| 20260709213530 | SUPERADA | 0 | 0 | 0 | 1 | 0 | 0 | — | 0 |
| 20260709220109 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260709221745 | ATIVA | 1 | 0 | 2 | 1 | 0 | 1 | — | 0 |
| 20260709223126 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260709223331 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260709231228 | ATIVA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260710011410 | ATIVA | 1 | 1 | 2 | 1 | 2 | 1 | — | 0 |
| 20260710013331 | ATIVA | 0 | 0 | 0 | 0 | 2 | 0 | — | 0 |
| 20260710020307 | ATIVA | 0 | 0 | 2 | 0 | 0 | 0 | — | 0 |
| 20260710021453 | ATIVA | 0 | 1 | 3 | 1 | 0 | 0 | — | 0 |
| 20260710172211 | ATIVA | 0 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260711093326 | ATIVA | 2 | 2 | 8 | 3 | 1 | 1 | — | 0 |
| 20260711094913 | ATIVA | 0 | 3 | 3 | 2 | 4 | 0 | — | 0 |
| 20260712202121 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260712203056 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260712203412 | ATIVA | 0 | 1 | 11 | 1 | 1 | 0 | — | 0 |
| 20260712204936 | ATIVA | 0 | 1 | 4 | 1 | 2 | 0 | — | 0 |
| 20260712212349 | ATIVA | 0 | 0 | 4 | 0 | 0 | 0 | — | 0 |
| 20260712220620 | ATIVA | 0 | 1 | 1 | 1 | 2 | 0 | — | 0 |
| 20260713000607 | ATIVA | 0 | 1 | 1 | 1 | 0 | 1 | — | 0 |
| 20260714141755 | ATIVA | 0 | 0 | 0 | 1 | 0 | 1 | — | 0 |
| 20260714143640 | ATIVA | 0 | 0 | 0 | 0 | 2 | 0 | — | 0 |
| 20260714145659 | ATIVA | 0 | 2 | 2 | 0 | 5 | 1 | — | 0 |
| 20260714151939 | ATIVA | 0 | 0 | 0 | 0 | 2 | 0 | — | 0 |
| 20260714154223 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260714181206 | ATIVA | 0 | 0 | 1 | 0 | 0 | 1 | — | 0 |
| 20260714181312 | ATIVA | 0 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260714182309 | HISTORICA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260714204313 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260714205833 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260714211842 | ATIVA | 1 | 0 | 0 | 0 | 0 | 1 | — | 1 |
| 20260714214855 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 1 |
| 20260714221929 | ATIVA | 0 | 1 | 1 | 1 | 3 | 1 | — | 0 |
| 20260714222515 | ATIVA | 2 | 1 | 1 | 3 | 1 | 1 | — | 0 |
| 20260714224034 | ATIVA | 0 | 0 | 0 | 1 | 0 | 0 | — | 0 |
| 20260715005658 | ATIVA | 1 | 0 | 2 | 0 | 1 | 0 | — | 0 |
| 20260715014018 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260715020549 | HISTORICA | 10 | 0 | 1 | 0 | 0 | 1 | — | 0 |
| 20260715021107 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260715021902 | ATIVA | 1 | 0 | 2 | 0 | 0 | 0 | — | 0 |
| 20260715022233 | ATIVA | 0 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260715022338 | PERIGOSA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260715022749 | HISTORICA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260715030950 | ATIVA | 0 | 0 | 1 | 0 | 5 | 0 | — | 0 |
| 20260715031416 | ATIVA | 0 | 0 | 0 | 0 | 1 | 0 | — | 0 |
| 20260715115107 | ATIVA | 0 | 1 | 1 | 1 | 0 | 0 | — | 0 |
| 20260715115951 | ATIVA | 0 | 1 | 2 | 1 | 0 | 0 | — | 0 |
| 20260715121031 | ATIVA | 0 | 1 | 2 | 0 | 3 | 0 | — | 0 |
| 20260715121635 | ATIVA | 4 | 2 | 2 | 4 | 3 | 1 | — | 0 |
| 20260715124415 | ATIVA | 1 | 4 | 5 | 0 | 8 | 0 | — | 0 |
| 20260715131054 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260715134357 | ATIVA | 6 | 0 | 0 | 4 | 0 | 1 | — | 1 |
| 20260715144905 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260715161725 | ATIVA | 0 | 0 | 0 | 0 | 4 | 0 | — | 0 |
| 20260717122244 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260717125330 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260717130211 | ATIVA | 1 | 1 | 22 | 0 | 2 | 0 | — | 0 |
| 20260717133733 | ATIVA | 2 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260717133859 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260717134423 | ATIVA | 0 | 0 | 0 | 0 | 4 | 0 | — | 0 |
| 20260717141154 | ATIVA | 0 | 0 | 4 | 0 | 0 | 0 | — | 0 |
| 20260717142231 | ATIVA | 0 | 0 | 4 | 0 | 0 | 0 | — | 0 |
| 20260717145215 | ATIVA | 1 | 0 | 0 | 1 | 1 | 1 | — | 0 |
| 20260717165418 | ATIVA | 9 | 4 | 4 | 11 | 13 | 1 | — | 0 |
| 20260717165856 | ATIVA | 1 | 0 | 0 | 0 | 7 | 1 | — | 0 |
| 20260717170458 | ATIVA | 3 | 1 | 1 | 2 | 2 | 1 | — | 1 |
| 20260717170844 | ATIVA | 5 | 0 | 0 | 0 | 4 | 1 | — | 0 |
| 20260717172106 | ATIVA | 1 | 2 | 2 | 2 | 2 | 1 | — | 0 |
| 20260717173712 | ATIVA | 0 | 0 | 4 | 0 | 0 | 0 | — | 0 |
| 20260717184021 | ATIVA | 4 | 1 | 1 | 1 | 4 | 1 | — | 0 |
| 20260717193451 | HISTORICA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260717194303 | PERIGOSA | 0 | 0 | 0 | 0 | 0 | 0 | brain_knowledge | 0 |
| 20260717195239 | ATIVA | 1 | 0 | 0 | 0 | 4 | 0 | — | 1 |
| 20260717202312 | PERIGOSA | 5 | 5 | 4 | 1 | 11 | 1 | brain_events_old,public | 0 |
| 20260717202919 | HISTORICA | 1 | 2 | 0 | 0 | 0 | 0 | — | 0 |
| 20260717210450 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260717210800 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260717210922 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260717211331 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260717213136 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260717220024 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260717223106 | ATIVA | 0 | 1 | 1 | 0 | 2 | 0 | — | 0 |
| 20260717230138 | ATIVA | 0 | 2 | 3 | 1 | 1 | 0 | — | 0 |
| 20260717231914 | PERIGOSA | 1 | 2 | 8 | 2 | 5 | 0 | meta_connections,meta_oauth_states | 0 |
| 20260718000635 | ATIVA | 0 | 1 | 5 | 1 | 2 | 0 | — | 0 |
| 20260718002801 | ATIVA | 0 | 0 | 0 | 0 | 2 | 1 | — | 0 |
| 20260720111732 | ATIVA | 0 | 2 | 8 | 1 | 1 | 1 | — | 0 |
| 20260720113435 | ATIVA | 3 | 0 | 0 | 0 | 4 | 1 | — | 0 |
| 20260720115003 | ATIVA | 2 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260720121016 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260720134016 | ATIVA | 1 | 1 | 4 | 1 | 2 | 0 | — | 0 |
| 20260720135447 | ATIVA | 5 | 5 | 13 | 4 | 6 | 1 | — | 0 |
| 20260720140336 | ATIVA | 1 | 1 | 2 | 1 | 1 | 0 | — | 0 |
| 20260720144007 | ATIVA | 4 | 1 | 1 | 1 | 6 | 0 | — | 0 |
| 20260720144133 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260720144845 | ATIVA | 0 | 0 | 4 | 0 | 0 | 1 | — | 0 |
| 20260720153439 | ATIVA | 0 | 1 | 2 | 1 | 2 | 0 | — | 0 |
| 20260720161542 | ATIVA | 0 | 1 | 2 | 0 | 3 | 0 | — | 0 |
| 20260720170319 | ATIVA | 0 | 1 | 0 | 0 | 2 | 0 | — | 0 |
| 20260720170949 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260720193324 | ATIVA | 0 | 1 | 4 | 0 | 2 | 1 | — | 0 |
| 20260720194657 | ATIVA | 0 | 0 | 0 | 0 | 2 | 0 | — | 0 |
| 20260720211101 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260722002552 | SUPERADA | 0 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260722002833 | ATIVA | 0 | 0 | 0 | 0 | 1 | 0 | — | 0 |
| 20260722072435 | ATIVA | 0 | 0 | 0 | 0 | 1 | 0 | — | 0 |
| 20260722072823 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260724132459 | ATIVA | 0 | 2 | 8 | 2 | 4 | 0 | — | 0 |
| 20260724140133 | ATIVA | 0 | 1 | 1 | 0 | 2 | 0 | — | 0 |
| 20260724141045 | PERIGOSA | 0 | 0 | 1 | 0 | 1 | 1 | — | 0 |
| 20260724155522 | ATIVA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260726164551 | ATIVA | 1 | 2 | 4 | 1 | 2 | 0 | — | 0 |
| 20260811123127 | PERIGOSA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260811124812 | ATIVA | 0 | 1 | 1 | 0 | 0 | 0 | — | 0 |
| 20260811125449 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 1 |
| 20260811142815 | ATIVA | 0 | 1 | 1 | 1 | 1 | 0 | — | 0 |
| 20260811150517 | ATIVA | 0 | 0 | 0 | 0 | 1 | 0 | — | 0 |
| 20260811160947 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260812123030 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260812124704 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260812154657 | ATIVA | 0 | 1 | 1 | 1 | 1 | 0 | — | 0 |
| 20260812160143 | SUPERADA | 3 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260812163545 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260812182455 | ATIVA | 3 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260813115210 | ATIVA | 1 | 0 | 1 | 0 | 1 | 0 | — | 0 |
| 20260813115816 | PERIGOSA | 3 | 1 | 0 | 0 | 1 | 1 | — | 0 |
| 20260813121645 | ATIVA | 0 | 0 | 0 | 0 | 1 | 1 | — | 0 |
| 20260813123754 | ATIVA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260813130637 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260813132721 | ATIVA | 3 | 0 | 1 | 0 | 3 | 0 | — | 0 |
| 20260813135601 | SUPERADA | 10 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260813144619 | ATIVA | 0 | 1 | 4 | 1 | 1 | 0 | — | 0 |
| 20260813170930 | ATIVA | 0 | 0 | 0 | 0 | 1 | 0 | — | 0 |
| 20260813175733 | ATIVA | 0 | 0 | 0 | 0 | 2 | 0 | — | 0 |
| 20260813184211 | ATIVA | 2 | 0 | 0 | 1 | 0 | 1 | — | 0 |
| 20260813203733 | ATIVA | 3 | 0 | 5 | 2 | 6 | 1 | — | 0 |
| 20260813203817 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260814132434 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260814141839 | ATIVA | 3 | 0 | 0 | 1 | 2 | 1 | — | 0 |
| 20260814145040 | ATIVA | 0 | 0 | 0 | 0 | 2 | 0 | — | 0 |
| 20260814220332 | ATIVA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817105032 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260817113741 | ATIVA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817120920 | PERIGOSA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817123951 | ATIVA | 0 | 0 | 0 | 0 | 1 | 0 | — | 0 |
| 20260817132752 | PERIGOSA | 5 | 1 | 1 | 2 | 5 | 1 | — | 0 |
| 20260817134058 | ATIVA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817135040 | SUPERADA | 3 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817135507 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817135723 | ATIVA | 1 | 0 | 0 | 1 | 0 | 0 | — | 1 |
| 20260817141853 | ATIVA | 3 | 0 | 0 | 0 | 0 | 1 | — | 1 |
| 20260817144642 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260817144908 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260817151443 | ATIVA | 2 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817152910 | ATIVA | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260817153947 | ATIVA | 0 | 0 | 0 | 0 | 1 | 0 | — | 0 |
| 20260817171521 | ATIVA | 1 | 0 | 0 | 0 | 1 | 1 | — | 0 |
| 20260817175045 | ATIVA | 2 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817175958 | ATIVA | 2 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817180146 | HISTORICA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817180903 | ATIVA | 0 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260817182223 | SUPERADA | 0 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260817183748 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260817195525 | ATIVA | 1 | 0 | 0 | 1 | 1 | 0 | — | 0 |
| 20260817200018 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260817201253 | ATIVA | 1 | 0 | 4 | 0 | 0 | 0 | — | 0 |
| 20260817230708 | HISTORICA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260817231804 | ATIVA | 1 | 0 | 0 | 0 | 2 | 1 | — | 0 |
| 20260818123429 | ATIVA | 4 | 0 | 10 | 0 | 0 | 0 | — | 0 |
| 20260818124503 | ATIVA | 2 | 0 | 2 | 0 | 0 | 0 | — | 0 |
| 20260818124920 | ATIVA | 2 | 0 | 4 | 1 | 0 | 0 | — | 0 |
| 20260818131940 | ATIVA | 12 | 0 | 15 | 0 | 0 | 1 | — | 0 |
| 20260818132414 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260818143357 | ATIVA | 0 | 1 | 2 | 0 | 1 | 1 | — | 0 |
| 20260818144705 | ATIVA | 0 | 2 | 4 | 0 | 3 | 0 | — | 0 |
| 20260818151627 | ATIVA | 0 | 1 | 2 | 0 | 2 | 0 | — | 0 |
| 20260818153629 | ATIVA | 0 | 0 | 7 | 0 | 0 | 0 | — | 0 |
| 20260818154356 | ATIVA | 0 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260818223811 | ATIVA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260818230647 | ATIVA | 1 | 0 | 4 | 0 | 0 | 0 | — | 0 |
| 20260818231112 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260819000229 | ATIVA | 7 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260819131529 | ATIVA | 0 | 0 | 4 | 0 | 0 | 0 | — | 0 |
| 20260819144059 | ATIVA | 6 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260819150510 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260819150650 | ATIVA | 5 | 0 | 0 | 3 | 0 | 1 | — | 0 |
| 20260819160557 | ATIVA | 2 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260819160947 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 1 |
| 20260819162925 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260819163409 | ATIVA | 1 | 0 | 0 | 0 | 7 | 0 | — | 0 |
| 20260819171957 | ATIVA | 1 | 0 | 6 | 0 | 0 | 0 | — | 0 |
| 20260819182328 | ATIVA | 3 | 2 | 2 | 1 | 0 | 1 | — | 0 |
| 20260820134714 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260820174230 | PERIGOSA | 2 | 0 | 0 | 3 | 0 | 1 | — | 0 |
| 20260820180844 | PERIGOSA | 2 | 0 | 5 | 0 | 0 | 1 | — | 0 |
| 20260820192249 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260820201916 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260820204650 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260820210340 | ATIVA | 1 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260820212717 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260820213733 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260821142452 | SUPERADA | 6 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260821143733 | ATIVA | 0 | 0 | 22 | 0 | 0 | 0 | — | 0 |
| 20260821160900 | HISTORICA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260821161020 | ATIVA | 1 | 0 | 0 | 1 | 0 | 1 | — | 0 |
| 20260821161632 | HISTORICA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260821162035 | HISTORICA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260822120557 | ATIVA | 1 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260824105538 | ATIVA | 0 | 0 | 2 | 0 | 0 | 0 | — | 0 |
| 20260824112642 | ATIVA | 8 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260824112904 | ATIVA | 0 | 0 | 40 | 0 | 0 | 0 | — | 0 |
| 20260824114103 | ATIVA | 1 | 0 | 7 | 0 | 0 | 0 | — | 0 |
| 20260824115706 | ATIVA | 2 | 0 | 15 | 0 | 0 | 0 | — | 0 |
| 20260824115806 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260824121709 | ATIVA | 0 | 0 | 5 | 0 | 0 | 0 | — | 0 |
| 20260824123240 | ATIVA | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260824125612 | ATIVA | 4 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260824125902 | ATIVA | 4 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260824215348 | ATIVA | 1 | 0 | 2 | 0 | 0 | 0 | — | 0 |
| 20260824223437 | ATIVA | 2 | 0 | 4 | 0 | 0 | 0 | — | 0 |
| 20260824224108 | ATIVA | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260824225125 | ATIVA | 1 | 0 | 2 | 1 | 2 | 0 | — | 0 |
| 20260824225605 | REDUNDANTE | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260825002841 | ATIVA | 2 | 0 | 5 | 0 | 0 | 0 | — | 0 |
| 20260825005340 | SUPERADA | 1 | 0 | 1 | 1 | 0 | 0 | — | 0 |
| 20260825005625 | ATIVA | 1 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260825024712 | ATIVA | 2 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260826155640 | ATIVA | 0 | 1 | 4 | 1 | 3 | 0 | — | 0 |
| 20260826162930 | ATIVA | 0 | 1 | 1 | 0 | 4 | 0 | — | 0 |
| 20260826164502 | ATIVA | 0 | 1 | 4 | 1 | 4 | 0 | — | 0 |
| 20260827170536 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260828112413 | SUPERADA | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260828114454 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260828114652 | ATIVA | 8 | 0 | 6 | 0 | 0 | 1 | — | 0 |
| 20260828115855 | ATIVA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260828121229 | ATIVA | 1 | 0 | 1 | 0 | 0 | 0 | — | 0 |
| 20260828123251 | ATIVA | 0 | 0 | 0 | 0 | 1 | 0 | — | 0 |
| 20260828124246 | ATIVA | 0 | 0 | 0 | 0 | 2 | 0 | — | 0 |
| 20260829113852 | PERIGOSA | 3 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260829120135 | INDETERMINADA | 0 | 0 | 0 | 0 | 0 | 0 | — | 0 |
| 20260829121019 | PERIGOSA | 1 | 0 | 0 | 0 | 0 | 0 | brain_events_archive,public | 0 |
| 20260829122439 | PERIGOSA | 2 | 1 | 2 | 2 | 3 | 1 | brain_events | 0 |
| 20260829124704 | PERIGOSA | 0 | 0 | 0 | 0 | 0 | 1 | — | 0 |
| 20260829130645 | ATIVA | 0 | 1 | 2 | 1 | 0 | 1 | — | 0 |
