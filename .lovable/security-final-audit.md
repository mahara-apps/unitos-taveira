# AUDITORIA FINAL DE SEGURANÇA — UNITOS

Read-only. Nenhum arquivo de código, migration, RLS, policy, grant, trigger, função, UI, teste ou dado foi alterado nesta etapa.
Data: 2026-08-25 · Projeto Supabase: `tkjbhttylouamqxnbfgv`

---

## 1. Resumo executivo

Pergunta única: **depois de todas as correções, existe bypass real de segurança, isolamento ou privilege escalation no Unitos?**

Resposta: **não existe bypass estrutural no código nem na RLS.** Todas as travas auditadas (RBAC, cross-workspace, cross-client, Storage, Portal, Brain, superfícies públicas, tokens, service_role) resolvem escopo no servidor/banco e nunca aceitam o ID enviado pelo frontend como autoridade.

Porém existe **um P1 de natureza operacional/dados, não de arquitetura**: o projeto Supabase de produção acumula **contas de QA com `is_super_admin = true`, e-mail confirmado, senha ativa e senha derivável do próprio e-mail**. É privilege escalation real por credencial, não por falha de policy.

| Severidade | Qtd |
| --- | --- |
| P0 | 0 |
| P1 | 1 |
| P2 | 4 |
| P3 | 5 |

- Bypass cross-workspace: **não encontrado.**
- Bypass cross-client: **não encontrado** no servidor/banco (há 1 P2 de cache local no browser).
- Privilege escalation por papel/policy: **não encontrado.**
- Privilege escalation por credencial residual de QA: **sim (P1)**.

---

## 2. Modelo final de autorização (verificado)

Fonte canônica única no banco:

- `is_super_admin(uid)` → `user_profiles.is_super_admin OR role = 'super_admin'` (autoridade global).
- `app_access_role(uid, brand_id)` → `super_admin` | `admin` (`brand_members.role = 'owner'`) | `manager` | `user` | `client`. Sem `brand_id` **não** resolve papel interno: devolve só `super_admin` ou `client` (Portal). Não existe ADMIN global por papel.
- `can_access_client_row(client, brand, owner, uid)` → super admin: tudo; exige `brand_members` ativo; `admin`: todo o workspace; `manager`/`user`: **somente** `owner_user_id = uid` ou `is_client_assigned` (`client_members`). Portal **não entra por aqui** (usa `is_portal_client_of`).
- `can_access_client(client, uid)` → cliente inexistente retorna `false` **inclusive para super admin**: ID forjado falha igual a ID fora de escopo.
- `client_in_scope(client, brand)` → exige `is_brand_member(brand)` **e** `can_access_client(client)`; par `brand A + client B` é impossível.
- `is_agency_operator` = papéis internos (usado só em escrita, sempre combinado com escopo de cliente).
- `is_portal_client_of(client, uid)` → `client_members.role = 'portal_client'`.

Não existem `editor`/`designer`: `select count(*) from brand_members where role in ('editor','designer')` = **0**.

Hierarquia confirmada: SUPER ADMIN → ADMIN (workspace) → MANAGER (clientes atribuídos) → USER (clientes atribuídos) → PORTAL (próprio cliente) → ANON (só superfícies públicas).

---

## 3. Workspace isolation (cross-workspace)

- Toda policy de dado operacional passa por `client_in_scope(client_id, brand_id)` ou `can_access_client(client_id, …)`, que exigem membership **ativo** naquele `brand_id`. Papel ADMIN em A não concede nada em B.
- Combinações forjadas testadas conceitualmente e cobertas por suíte: `brand A + client B` (falha em `client_in_scope`), `brand A + project B` / `brand A + task B` (`can_access_project`/`can_access_task` releem a entidade e derivam brand/client dela), `brand A + token B` (tokens carregam o próprio `client_id`/`brand_id`; nada vem do request).
- Server functions privilegiadas recebem `brandId` do frontend, mas passam por `assertBrandMember`/`assertBrandAdmin`/`assertCanGrantBrandRole` (`src/lib/access-guard.ts`) **antes** de qualquer uso de `supabaseAdmin`.
- Rotas HTTP de job autenticam por bearer JWT, montam client do próprio usuário (RLS) e aplicam `guardClientScope` (`src/lib/http-scope.server.ts`) via `can_access_client`.
- Cron/webhooks: gate por `CRON_SECRET` com comparação em tempo constante (`src/lib/cron-auth.server.ts`); webhooks Meta por HMAC `META_APP_SECRET`; OAuth callback por state assinado (CSRF + brand/user).

**Nenhum caminho A→B encontrado** por brandId, clientId, IDs forjados, tokens, query/URL params, localStorage, cookies, cache, RPC, server functions, supabaseAdmin, service_role, webhooks, jobs ou workers.

---

## 4. Client isolation (cross-client)

MANAGER/USER atribuídos ao Cliente A **não** alcançam o Cliente B em nenhuma das superfícies auditadas, porque todas derivam do mesmo predicado:

| Domínio | Trava |
| --- | --- |
| clients, client_members, client_social_accounts | `can_access_client*` |
| projects, tasks | `can_access_client` + `client_id IS NULL` restrito a admin/super admin |
| activity_events | idem |
| client_documents, calendar_events, content_pipelines, monthly_plans, posts, social_posts, plan_overage_requests, notifications | `can_access_client` / `client_in_scope` |
| chat_conversations, ai_jobs | `client_in_scope` + `user_id = auth.uid()` |
| brain_memory / insights / recommendations / relationships / events | `client_in_scope` ou super admin |
| brain_metrics_snapshots | só `admin`/`super_admin` do brand |
| message_logs | `client_in_scope`, ou `client_id IS NULL` só para `admin`/super admin |
| media_plans / media_plan_items | `can_access_client` (items via join no plano) |
| portal_tokens | `can_access_client_row` do cliente do token |
| Storage | `storage_scope_allows` |

ADMIN cobre todos os clientes do workspace selecionado. SUPER ADMIN opera globalmente. Confirmado que **nenhuma** policy usa `is_brand_member` isolado como autorização de dado de cliente.

---

## 5. `client_id IS NULL` (escopo workspace)

Ramos `client_id IS NULL` existem em `projects`, `tasks`, `activity_events`, `message_logs` — e em todos eles o ramo exige `app_access_role IN ('super_admin','admin')`. **Nenhum ramo NULL devolve acesso a MANAGER/USER.**

---

## 6. RLS — verificação por tabela

- Roles das policies: `{authenticated}` em praticamente tudo. Duas policies (`media_plans`, `media_plan_items`) estão declaradas para role `public`, mas o predicado é `can_access_client(..., auth.uid())`, que é `false` para `anon` — **sem efeito prático**, apenas ruído (P3).
- **`anon` não possui nenhum GRANT de tabela no schema `public`** (`role_table_grants` para `anon` = vazio). O acesso público existe exclusivamente através de RPCs `SECURITY DEFINER` nominalmente liberadas.
- `super_admin_full_access` aparece só onde faz sentido (`ai_jobs`, `chat_conversations`, …) e sempre por `is_super_admin(auth.uid())`.

---

## 7. service_role / supabaseAdmin / SECURITY DEFINER

37 módulos referenciam `supabaseAdmin`. Classificação:

1. **Guardados por papel/escopo antes do bypass** — `team.functions.ts`, `team-admin.functions.ts`, `agents.functions.ts`, `content.functions.ts`, `channels-center.functions.ts`, `portal-accounts.functions.ts`, `brain-consolidate.functions.ts`, `ai-model-health.server.ts`: usam `assertBrandMember`/`assertBrandAdmin`/`assertAdminAuthority`/`assertCanGrantBrandRole`.
2. **Guardados por segredo de servidor** — `api/public/cron/*`, `api/public/hooks/*`, `meta/publish-scheduled`, `media/prune`: `assertCronRequest` (`CRON_SECRET`, comparação constante).
3. **Guardados por assinatura do provedor** — `meta/webhook`, `meta/data-deletion`, `meta/deauthorize` (HMAC `META_APP_SECRET`), `meta/callback` (state assinado).
4. **Guardados por token de credencial** — `briefing-tokens.functions.ts`, `monthly-plan-public.functions.ts`, `api/public/approval.$token.ts`: o token é a única entrada; `planId`/`clientId`/`brandId` são **derivados da linha do token**, nunca do request. Itens por tópico são validados contra o plano do token (`invalid_topic`).
5. **Guardados por bearer + escopo** — `api/jobs/customer-pipeline.ts`: valida JWT, monta client do usuário e chama `guardClientScope`.
6. **Server-only sem entrada de usuário** (workers/infra) — `brain/*.server.ts`, `ai-*.server.ts`, `post-agents.server.ts`, `login-branding.functions.ts` (marca resolvida por env/instalação única), `portal-scope.server.ts`, `portal-media.server.ts`.

`SECURITY DEFINER` executável por `anon`: apenas `media_plan_public_resolve`, `media_plan_public_items`, `portal_*` e `storage_scope_allows`. Todas resolvem escopo por token ou por `auth.uid()`:

- `_portal_session_user` / `portal_resolve` / `portal_my_clients` / `portal_decide`: `_client_id` recebido é **validado** contra `client_members(role='portal_client', user_id=auth.uid())` → `client_not_allowed`. Sem sessão e sem token: `invalid_token`.
- `card_approval_public_decide` e `public_surface_rate_hit` (10F.2): `REVOKE` de `anon`/`authenticated`, só `service_role`.

**Critério atendido: service_role + validação correta.** Nenhum ponto usa ID do frontend como autoridade.

---

## 8. Storage

`storage_scope_allows(bucket, name, write)` é a autorização única dos buckets `brand-assets`/`brand-documents`/`brand-media`, com 4 policies (`select/insert/update/delete`) para `authenticated`:

- path **não** é autoridade: `brand_id` e `client_id` extraídos do path são validados por `EXISTS (clients c WHERE c.id = _client AND c.brand_id = _brand)` — trocar segmentos manualmente falha;
- Portal: somente leitura do próprio cliente, e em `brand-documents` só documentos com `visible_to_client = true`;
- interno: `client_in_scope` (ADMIN workspace / MANAGER-USER atribuídos);
- sem cliente no path (branding de workspace): exige `is_brand_admin_level` — **não existe fallback "brand member pode"**;
- `anon` não aparece em nenhuma policy de storage.

Observação P3: `avatars_auth_read` permite qualquer autenticado ler qualquer avatar do bucket `avatars` — bucket de foto de perfil, sem dado operacional.

---

## 9. Portal

- Autenticação: sessão Supabase (`portal_client` em `client_members`) ou token (`portal_tokens`, com revogação/expiração validadas na RPC).
- `clientId` vindo de URL/estado é sempre revalidado por `_portal_session_any`/`_portal_session_user`; troca de cliente só entre os vínculos do próprio usuário (`portal_my_clients`).
- Portal não alcança tabelas administrativas: `can_access_client_row` exclui explicitamente `portal_client`, e o Portal lê apenas via RPCs `portal_*` com payload restrito.
- Storage do Portal: leitura, próprio cliente, documentos marcados como visíveis.
- Branding: `portal_theme`/`logo_url` do próprio cliente.

`Portal Client A ≠ Client B` e `Portal ≠ Admin` confirmados.

---

## 10. Superfícies públicas (revalidação pós-10F.2)

**`/api/public/approval/$token`** — single-use via `card_approval_public_decide` (grava evento, aplica estado e revoga o token na mesma transação, com `FOR UPDATE`); estado terminal → `409`; peça excluída → `410`; par brand/post inconsistente → `403`; replay → `410`; rate limit 60/5min (GET) e 10/5min (POST); CORS wildcard removido, origem externa → `403`, `cache-control: no-store`; payload mínimo sem `client_id`, `script`, `references`, IDs internos. Cross-client/cross-workspace impossíveis (escopo derivado do token).

**`media_plans.share_token`** — `media_plan_public_resolve` valida existência e expiração; `client_id`/`brand_id` vêm da própria linha; recurso inexistente → `invalid_token`. 2 planos compartilhados, ambos **sem** `share_expires_at`, e planos arquivados continuam legíveis pelo link → P3 (hardening consciente, não vulnerabilidade).

**`getLoginLogoFn`** — marca resolvida por `LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG` ou instalação de marca única; ambiguidade devolve `null` (branding neutro), sem seleção arbitrária; path validado estruturalmente contra a marca resolvida; URL assinada com TTL de 10 min; rate limit aplicado. Sem cross-workspace.

**Gap P2:** `resolveMonthlyPlanPublic` / `decideMonthlyPlanPublic` (pauta pública por token) **não** receberam rate limit nem single-use na 10F.2 — o escopo daquela fase era o token de aprovação de peça. Não é bypass (token de alta entropia, escopo derivado do token), mas é a assimetria de hardening mais relevante que resta.

---

## 11. Cache / contexto

- `resetIdentityState` (logout e `SIGNED_IN`/`SIGNED_OUT`/`USER_UPDATED` no `__root`): cancela queries, `queryClient.clear()`, limpa `auth-cache`, `access-cache`, `nx.brand`, `nx.client` e o snapshot persistido.
- `resetScopeCache` na troca de workspace/cliente (`brand-client-switcher`) remove queries dependentes de escopo.
- Persistência em `localStorage` limitada a `social-analytics*` (nada de auth/token), `maxAge` 24 h.
- **P2 (cache local):** a chave persistida `unitos:social-analytics-cache:v1` é global ao browser, não por usuário. Num navegador compartilhado, após reload com outra sessão, o snapshot do usuário anterior é reidratado antes de qualquer evento de auth (`INITIAL_SESSION` não é tratado). Exposição limitada a métricas sociais já renderizadas, exige mesmo dispositivo e a mesma `queryKey` (mesmo cliente) ser montada; nenhuma leitura nova é autorizada pelo servidor.

---

## 12. Brain (enforcement 10E.2)

- `brain_events_part_insert`: `client_in_scope(client_id, brand_id)` **e** `actor_id IS NULL OR actor_id = auth.uid()` **e** `created_at` na janela de ±2 min.
- Trigger `brain_events_guard_identity()` força `actor_id := auth.uid()` para usuários e sanitiza payload de chaves sensíveis.
- Select: `is_super_admin OR client_in_scope`.
- `brain_memory`/`insights`/`recommendations`/`relationships`: leitura por `client_in_scope`; escrita apenas por `service_role`/`SECURITY DEFINER` (`brain_memory_evolve`, workers).
- `brain_metrics_snapshots`: só nível admin da marca.
- `emit_brain_event` restrito a `service_role`.
- Embeddings/jobs/workers rodam com `service_role` sem entrada direta de usuário.

Arquitetura não reaberta; enforcement confirmado presente.

---

## 13. Tokens e links públicos

| Token | Classificação | Nota |
| --- | --- | --- |
| `card_approval_tokens` (3 ativos) | Segurança OK | alta entropia, single-use, expiração, rate limit |
| `monthly_plan_tokens` | Hardening | valida revogação/expiração; sem single-use e sem rate limit (P2) |
| `media_plans.share_token` (2) | Hardening/dívida | seguro; sem expiração nem rotação (P3) |
| `portal_tokens` (5 ativos) | Segurança OK | revogação + expiração + rate limit do portal |
| URLs assinadas de Storage | Segurança OK | TTL 10 min, path validado |
| Tokens/usuários de QA | **Risco real (P1)** | ver §14 |

Ausência de expiração **não** foi classificada como vulnerabilidade.

---

## 14. P1 — contas de QA com super admin residuais em produção (dados/ambiente)

Fato observado (somente leitura):

- `user_profiles` com `is_super_admin = true`: **13** — 1 legítima (`n3@unitos.com`) e **12 contas `QA S5`** criadas por execuções de teste (`qa+<tag>-s5super@unitos-tests.dev`), a mais recente às 03:03 desta auditoria (o contador cresce a cada suíte).
- Em `auth.users` essas contas estão **com e-mail confirmado, senha ativa e sem ban**.
- `tests/helpers/fixtures.ts` deriva a senha de forma determinística a partir do mesmo `TAG` que aparece **no e-mail** (`Qa!<TAG><label>Aa1`). Quem conhece o padrão e o e-mail conhece a senha.
- Nenhuma delas tem `brand_members`, mas `is_super_admin` concede autoridade global por si só — logar com uma delas equivale a acesso total à instalação.

Classificação: **P1 — privilege escalation real por credencial residual**, não por falha de RLS/código. Não é cross-workspace por policy; é uma identidade global viva que não deveria existir.

Correção mínima recomendada (**não executada, conforme a regra desta etapa**):
1. remover as 12 contas `QA S5` de `auth.users`/`user_profiles` (as legítimas ficam);
2. garantir que o `cleanup()` das fixtures rode sempre (inclusive em falha) e que a senha não derive de dado presente no e-mail;
3. idealmente, executar a suíte de integração contra um projeto Supabase separado do de produção.

---

## 15. Dados históricos / legados (nada modificado)

| Registro | Qtd | Classificação |
| --- | --- | --- |
| `activity_events.client_id IS NULL` | 94 | legado sem risco — ramo NULL só admin/super admin |
| `brain_events.client_id IS NULL` | 77 | legado sem risco — mesma trava |
| `message_logs.client_id IS NULL` | 20 | legado sem risco (seed) |
| `projects` / `tasks` NULL | 0 | — |
| clientes órfãos de brand | 0 | — |
| papéis legados (`editor`/`designer`) | 0 | — |
| contas/tokens de QA em produção | 12 supers + fixtures | **risco atual (P1)** |

Nenhuma limpeza automática sugerida além do P1.

---

## 16. Matriz por papel (resultado esperado × verificado)

| Recurso | SUPER ADMIN | ADMIN | MANAGER | USER | PORTAL | ANON |
| --- | --- | --- | --- | --- | --- | --- |
| Múltiplos workspaces | sim | não | não | não | não | não |
| Todos clientes do workspace | sim | sim | não | não | não | não |
| Cliente atribuído | sim | sim | sim | sim | próprio | não |
| Cliente não atribuído | sim | sim | **não** | **não** | **não** | não |
| Registros workspace (`client_id NULL`) | sim | sim | **não** | **não** | não | não |
| Gestão de equipe/atribuições | sim | sim | limitada (`can_invite_brand_role`) | não | não | não |
| Storage do cliente | sim | workspace | atribuídos | atribuídos | leitura própria/visível | não |
| Brain | global | workspace | atribuídos | atribuídos | não | não |
| Métricas do Brain | sim | sim | não | não | não | não |
| Superfícies públicas | — | — | — | — | — | só por token válido |

Cobertura de testes existentes para essa matriz: `privilege-escalation`, `v1-role-escalation`, `rbac`, `rbac-scope`, `scope-closure`, `scope-null-10d2`, `e2e-authorization`, `global-admin`, `workspace-context`, `portal-hardening`, `storage-scope`, `message-logs-scope`, `brain-events-identity-10e2`, `public-surfaces-10f2`, `settings-hardening`, `phase8-hardening`, `task-hierarchy`.

---

## 17. Achados

**P0 — 0.**

**P1 — 1**
1. Contas de QA com `is_super_admin` ativas no projeto de produção, com senha derivável do e-mail (§14).

**P2 — 4**
1. Pauta pública (`resolveMonthlyPlanPublic` / `decideMonthlyPlanPublic`) sem rate limit e sem single-use, diferente do padrão adotado na 10F.2 para aprovação de peça.
2. Snapshot `unitos:social-analytics-cache:v1` não é segregado por usuário; reidrata antes de eventos de auth em navegador compartilhado (§11).
3. `guardClientScope` retorna liberado quando `clientId` é nulo: rotas de job com trabalho workspace-level dependem de guard adicional explícito no handler (hoje presente, mas sem trava central).
4. Sal do hash de IP do rate limit público cai em constante fixa quando `CRON_SECRET` não está definido — degrada a proteção de deduplicação de IP em instalações sem o segredo.

**P3 — 5**
1. `media_plans.share_token` sem expiração/rotação; planos arquivados legíveis pelo link (2 planos hoje).
2. Policies de `media_plans`/`media_plan_items` declaradas para role `public` em vez de `authenticated` (sem efeito prático — `anon` não tem GRANT).
3. `avatars_auth_read`: qualquer autenticado lê qualquer avatar.
4. 191 registros legados com `client_id NULL` (activity_events, brain_events, message_logs) mantidos por rastreabilidade.
5. Tokens de compartilhamento armazenados em texto puro no banco.

---

## 18. Riscos residuais e itens deliberadamente não corrigidos

- Rate limit público é por IP: atacante distribuído contorna o contador; a barreira real continua sendo a entropia dos tokens.
- Checagem de origem depende do header `Origin`: clientes não-browser com token legítimo seguem funcionando (comportamento desejado).
- Instalações multi-marca sem `LOGIN_BRAND_ID`/`LOGIN_BRAND_SLUG` exibem branding neutro (decisão da 10F.2).
- Não existe trilha dedicada de eventos de segurança (`log_security_event` não existe) — apontado na 10E.1 como P2 e mantido fora de escopo.
- Todos os P2/P3 acima ficam **deliberadamente sem correção** nesta etapa.

---

## 19. Validação executada

- Suíte completa: **398 testes / 23 arquivos — 398 passando.** Nenhuma falha pré-existente.
- Typecheck (`tsgo --noEmit`): limpo.
- Build (`/tmp/observability/build-errors.log`): `build OK`.
- Nada foi alterado para fazer teste passar. Efeito colateral registrado: cada execução da suíte cria uma nova conta `QA S5` super admin (base do P1).

---

## 20. Decisão final

**CENÁRIO B — CORREÇÃO NECESSÁRIA** (por P1 de dados/ambiente, não estrutural).

- Segurança **estrutural** (RBAC, RLS, isolamento multi-tenant, Storage, Portal, Brain, service_role, superfícies públicas, tokens): **encerrada** — P0 = 0 e nenhum bypass cross-workspace, cross-client ou privilege escalation por papel/policy.
- Bloqueia o encerramento formal apenas o P1 do §14: remoção das contas de QA super admin do projeto de produção e correção do vazamento das fixtures. É higiene de ambiente, sem mudança de arquitetura.
- Os P2/P3 restantes são hardening e dívida técnica e não bloqueiam a evolução do produto. Nenhuma nova fase foi iniciada.
