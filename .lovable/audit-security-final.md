# Fase 9 — Auditoria Final de Segurança, Sessão e Superfície Pública

**Modo:** 100% READ-ONLY. Nenhuma migration, policy, rota, componente ou
configuração foi alterada nesta fase.
**Data:** 2026-08-24 · **Projeto Supabase:** `tkjbhttylouamqxnbfgv`

---

## 1. Resumo executivo

O modelo SUPER ADMIN → ADMIN → MANAGER → USER → PORTAL está
**estruturalmente correto** e implementado por funções canônicas únicas
(`app_access_role`, `my_access`, `can_access_client`, `can_access_client_row`,
`client_in_scope`, `can_access_project`, `can_access_task`,
`is_portal_client_of`). As Fases 1–8 fecharam o grosso do RBAC de dados: as
tabelas operacionais relevantes usam escopo por cliente (não apenas
`brand_id`), e mutações fora de escopo falham explicitamente.

Não foi encontrado nenhum P0 (bypass completo de RLS, cross-workspace massivo,
takeover ou vazamento de credenciais). Os achados residuais concentram-se em
três superfícies que ainda raciocinam por **workspace** e não por **cliente**:
Storage, logs/mensageria e registros com `client_id NULL`.

| Prioridade | Quantidade |
| --- | --- |
| P0 | 0 |
| P1 | 3 |
| P2 | 6 |
| P3 | 5 |

---

## 2. Arquitetura de autorização encontrada

```text
LOGIN (Supabase Auth, senha/OAuth)
  → JWT no localStorage (client.ts, passThroughLock)
  → auth-cache.ts (TTL 60s) + access-cache.ts (TTL 5min)
  → gate _authenticated/route.tsx (ssr:false) | _portal/route.tsx
  → contexto: nx.brand / nx.client (localStorage, revalidados no switcher)
  → attachSupabaseAuth (bearer em toda server function)
  → server fn: requireSupabaseAuth → context.supabase (RLS como usuário)
       ├─ guards: access-guard.ts / super-admin.ts / http-scope.server.ts
       └─ eventual supabaseAdmin (service role) APÓS guard
  → RLS: client_in_scope / can_access_client(_row) / is_agency_operator
  → RPC SECURITY DEFINER (search_path fixo em 100% das funções)
  → Storage: policies por PRIMEIRO SEGMENTO DO PATH = brand_id
  → LOGOUT: resetIdentityState() limpa query cache, nx.brand/nx.client e
    o snapshot social persistido
```

Pontos canônicos verificados:

- `app_access_role(user, brand)` **não** deriva papel de campo global; sem
  `brand_id` só devolve `super_admin` ou `client`. `user_profiles.role` não
  concede acesso a workspace. ✅ conforme o modelo oficial.
- `my_access(brand)` devolve `brand_role = NULL` sem workspace ativo e
  `client_ids` já filtrados por `can_access_client_row`. ✅
- `client_in_scope(client, brand)` exige pertencer à marca **e** ter o cliente
  no escopo; `MANAGER`/`USER` recebem apenas clientes atribuídos. ✅

---

## 3. Matriz SUPER ADMIN / ADMIN / MANAGER / USER / PORTAL (comportamento real)

| Ator | Workspace | Clientes | Escrita | Admin do ambiente |
| --- | --- | --- | --- | --- |
| SUPER ADMIN | todos (`is_super_admin`) | todos | sim | sim (`/admin`, `assertSuperAdmin`) |
| ADMIN (owner) | apenas onde tem membership ativa | todos do workspace | sim | não global |
| MANAGER | apenas onde tem membership | somente atribuídos | sim nos atribuídos | parcial (convites não-owner) |
| USER | apenas onde tem membership | somente atribuídos | conforme `is_agency_operator` | não |
| PORTAL CLIENT | nenhum interno | somente o próprio cliente | somente decisões do portal | não |

Divergências observadas em relação à matriz: ver P1-1 (Storage), P1-2
(`message_logs`), P1-3 (registros com `client_id NULL`) e P2-5 (logs para
MANAGER).

---

## 4. Inventário SECURITY DEFINER (public)

Total: **~150 funções** `SECURITY DEFINER` no schema `public`.
**100% possuem `search_path` fixo** (`public`, ou `public, auth` em
`find_user_id_by_email` e `link_existing_user_to_brand`).

### 4.1 Executáveis por `anon` (13) — superfície pública real

| Função | Autenticação | Valida cliente | Classe |
| --- | --- | --- | --- |
| `portal_resolve`, `portal_rate_status`, `portal_rate_register_failure` | token opaco + rate limit (`portal_rate_limit`) | sim (`_portal_session_any`) | P3 (legítimo) |
| `portal_approvals`, `portal_briefings`, `portal_calendar`, `portal_files`, `portal_metrics`, `portal_post`, `portal_my_clients`, `portal_decide` | sessão de portal derivada do token | sim | P3 (legítimo) |
| `media_plan_public_resolve`, `media_plan_public_items` | `share_token` (sem expiração obrigatória, sem revogação, sem rate limit) | escopo implícito no token | **P2** |

### 4.2 Executáveis por `authenticated` (51) — destaques

| Função | Valida `auth.uid()` | Valida workspace | Valida cliente | Classe |
| --- | --- | --- | --- | --- |
| `can_access_client`, `can_access_client_row`, `can_access_project`, `can_access_task` | sim | sim | sim | OK (oráculo de existência → P2-3) |
| `client_in_scope`, `is_client_assigned`, `is_brand_member`, `has_brand_role`, `is_brand_admin_level`, `is_portal_client_of` | sim | sim | sim | OK / oráculo P2-3 |
| `app_access_role`, `my_access`, `is_super_admin` | sim | sim | n/a | OK |
| `accept_brand_invite`, `link_existing_user_to_brand` | sim | sim (`owner/manager` + `can_invite_brand_role`) | n/a | OK (bloqueia auto-promoção) |
| `instantiate_project_template`, `start_timer`, `stop_timer`, `brain_memory_evolve`, `brain_memory_touch` | sim | sim | sim (Fase 5) | OK |
| `get_brain_graph`, `get_brain_neighborhood`, `match_brain_events` | sim | sim | sim (Fase 5) | OK |
| `list_ai_usage_overview`, `check_ai_usage_budget`, `can_manage_brand_ai_limits` | sim | sim | parcial | P3 |
| `reactivate_portal_token`, `portal_client_ids` | sim | sim | sim | OK |
| `list_agent_catalog`, `notification_prefs_allows` | sim | sim | n/a | OK |

Funções de worker/trigger (`brain_*`, `mark_social_post_*`,
`claim_scheduled_social_posts`, `emit_brain_event`, `cron_secret`,
`set_cron_secret`, `find_user_id_by_email`, `enqueue_deadline_notifications`)
**não** são executáveis por `anon` nem `authenticated`. ✅

---

## 5. Inventário de grants

- `anon`: privilégios de tabela **revogados em todas as tabelas de `public`**
  (`20260821091200_revoke_anon_table_privileges.sql`), inclusive default
  privileges e sequences. Mantém apenas `USAGE` no schema + `EXECUTE` nas 13
  RPCs do Portal/Media Plan.
- `authenticated`: grants normais de tabela, com RLS obrigatória.
- `service_role`: acesso pleno (esperado; só usado server-side).
- Nenhuma view materializada exposta na API (corrigido em fases anteriores).
- Linter Supabase: 69 avisos, todos das classes já classificadas aqui
  (13 anon SECURITY DEFINER = Portal legítimo + media plan, 51 authenticated
  SECURITY DEFINER = funções canônicas, 2 "RLS sem policy" = deny-all
  intencional, 2 extensões em `public`, 1 Leaked Password Protection).

---

## 6. Auditoria RLS

Tabelas amostradas (representativas das famílias `brand_id`/`client_id`/
`project_id`/`task_id`):

| Tabela | RLS | SELECT | INSERT | UPDATE | DELETE | Escopo cliente |
| --- | --- | --- | --- | --- | --- | --- |
| `clients` | sim | `can_access_client_row` | admin | admin | admin + escopo | sim |
| `projects` | sim | `can_access_client` (ou `is_brand_member` se `client_id NULL`) | `is_agency_operator` | idem | idem | parcial (P1-3) |
| `tasks` | sim | idem projects | idem | idem | idem | parcial (P1-3) |
| `posts` | sim | `can_access_client` + `is_agency_operator` OU portal | agência | agência | agência | sim |
| `ai_jobs`, `chat_conversations`, `chat_messages`, `brain_reasoning_logs` | sim | `client_in_scope` | idem | dono + escopo | dono + escopo | sim |
| `social_connections`, `social_posts`, `client_social_accounts` | sim | `client_in_scope` | admin | admin | admin | sim |
| `client_documents`, `calendar_events`, `brand_media_assets`, `monthly_plan_tokens`, `brand_briefings` | sim | `client_in_scope` / `can_access_client` | idem | idem | idem | sim |
| `notifications` | sim | próprio usuário | próprio usuário + membro | próprio | próprio | n/a |
| `brand_members`, `brands` | sim | membros | `can_create_brand` | `is_brand_admin_level` | — | n/a |
| `activity_events` | sim | `can_access_client` (ou membro se `client_id NULL`) | — | — | — | parcial (P1-3) |
| `message_logs` | sim | **`is_brand_member` (sem cliente)** | membro | — | — | **não (P1-2)** |
| `meta_compliance_events`, `portal_rate_limit` | sim | sem policy (deny-all; só service role) | — | — | — | n/a (falso positivo) |

Herança verificada: `task → project → client` (`can_access_task`),
`subtask/comment/time entry → task`, `approval → post → client`,
`brain → client`, `document → client`, `calendar → client`,
`social → client`, `AI job → client`. ✅

---

## 7. Auditoria supabaseAdmin (service role)

32 arquivos carregam `@/integrations/supabase/client.server`.

| Grupo | Arquivos | Recebe ID do frontend | Guard | Classe |
| --- | --- | --- | --- | --- |
| Rotas públicas de máquina (Meta callback/webhook/deauthorize/data-deletion, cron SLA, media prune, publish-scheduled, hooks Brain/IA) | 12 | não (ou apenas do provedor assinado) | HMAC Meta / `assertCronRequest` (CRON_SECRET) | OK |
| Sessão por token opaco (`monthly-plan-public`, `portal-scope.server`, `portal-media.server`, `briefing-tokens`, `approval.$token`) | 5 | token, não IDs | escopo derivado do token no servidor | OK (ver P2-2 CORS) |
| Workers/telemetria sem ator humano (`ai-*.server`, `agent-prompts.server`, `brain/*.server`, `monthly-plan-observability`, `post-agents.server`) | 12 | não | n/a | OK |
| Administrativas com ator humano (`team`, `team-admin`, `portal-accounts`, `agents`, `channels-center`, `feature-flags`, `admin-environment`, `brain-consolidate`, `jobs/*`) | 9 | sim | `assertBrandAdmin` / `assertClientInBrand` / `guardClientScope` / `assertSuperAdmin` antes do bypass | OK |
| Pré-login | `login-branding.functions.ts` | não | nenhum (por design) | **P2-1** |

**Resposta à pergunta central:** não foi encontrado caminho em que um usuário
autenticado provoque operação `supabaseAdmin` sobre recurso fora da sua RLS —
exceto a leitura de branding pré-login (P2-1), que não expõe dados de cliente.

---

## 8. Auditoria server functions (`*.functions.ts`)

66 arquivos. Padrão dominante: `requireSupabaseAuth` + `context.supabase`
(RLS aplicada como o próprio usuário) — o que torna `clientId`/`projectId`
forjado inofensivo para leitura/escrita. 17 arquivos adicionam guards
explícitos (obrigatório quando há `supabaseAdmin` ou agregação).

Verificados como corretos: `workspace`, `projects`, `tasks`, `team`,
`team-admin`, `dashboard`, `agents`, `feature-flags`, `portal-accounts`,
`channels-center`, `customer-dashboard`, `client-journey`, `branding`,
`admin-environment`.

Observação (P2-5): `logs.functions.ts` usa `assertAdminAuthority`, que aceita
MANAGER, e depois filtra apenas por `brand_id` — MANAGER enxerga jobs de IA e
eventos de atividade de clientes que não lhe foram atribuídos.

---

## 9. Auditoria API (`/api/**`)

| Endpoint | Público? | AuthN | AuthZ | Risco |
| --- | --- | --- | --- | --- |
| `/api/public/cron/sla-check`, `/hooks/*`, `/media/prune`, `/meta/publish-scheduled` | sim | `x-cron-secret` = `CRON_SECRET` | n/a (máquina) | OK; sem nonce → replay possível mas idempotente (P3) |
| `/api/public/meta/webhook` | sim | HMAC `x-hub-signature-256` | derivado do `external_id` | OK |
| `/api/public/meta/callback` | sim | `state` assinado + verificação | brand do state | OK |
| `/api/public/meta/deauthorize`, `/data-deletion` | sim | `signed_request` HMAC | por `meta_user_id` | OK |
| `/api/public/meta/deletion-status` | sim | código de confirmação | leitura mínima | P3 |
| `/api/public/approval/$token` | sim | token opaco | post do token | **P2-2** (CORS `*`, sem rate limit) |
| `/api/jobs/copilot`, `/analyze-document`, `/customer-pipeline` | não | Bearer | `guardClientScope` | OK |
| `/api/chat.stream` | não | Bearer + `getClaims` | conversa do usuário | OK |
| `/api/social/dashboard/:id`, `/top-posts/:id`, `/posts/:id/analytics` | não | Bearer obrigatório | client Supabase do usuário (RLS `client_in_scope`) | OK |

---

## 10. Auditoria webhooks

- **Meta** (webhook, deauthorize, data-deletion, callback): assinatura HMAC
  verificada antes de qualquer escrita; `service_role` só depois. Sem
  janela de tolerância/timestamp → replay teórico (P3), mas escritas são
  idempotentes por `external_id`/`meta_user_id`.
- **Cron/hooks internos**: gate por `CRON_SECRET` em header, nunca chave anon.
  Não aceitam `brandId`/`clientId` arbitrário exceto
  `hooks/resume-post-content` (aceita, mas já protegido pelo mesmo segredo).
- **WhatsApp/Evolution/pagamentos**: não existem no código atual.

---

## 11. Auditoria Storage

Buckets (todos **privados**): `avatars`, `brand-assets`, `brand-documents`,
`brand-media`, `chat-attachments`.

Todas as policies derivam o escopo do **primeiro segmento do path = `brand_id`**
e validam com `is_brand_member` (ou `has_brand_role` para escrita em
`brand-assets`). **Nenhuma policy valida cliente.**

Ataque conceitual `brand/clients/A/doc.pdf` → `brand/clients/B/doc.pdf`:
bloqueado entre workspaces (path começa por outro `brand_id`), **não bloqueado
dentro do mesmo workspace** para MANAGER/USER sem o cliente atribuído. Ver P1-1.

---

## 12. Auditoria de tokens e links públicos

| Token | Entropia | Expiração | Revogação | Rate limit |
| --- | --- | --- | --- | --- |
| `portal_tokens` | `crypto.getRandomValues` | sim | sim (`reactivate_portal_token`) | sim (`portal_rate_limit`) |
| `card_approval_tokens` | `crypto.getRandomValues` | sim (`expires_at`) | sim (`revoked_at`) | **não** (P2-2) |
| `monthly_plan_tokens` | `crypto.getRandomValues` | sim | sim | não (P3) |
| `client_briefing_tokens` | `crypto.getRandomValues` | sim | sim | não (P3) |
| `media_plans.share_token` | `crypto.getRandomValues` | **opcional** (`share_expires_at` nulável) | **não** | não | → **P2-4** |
| Convites (`brand_invites`) | `crypto.getRandomValues` | sim | sim | n/a |

Todos os tokens são opacos e não enumeráveis por força bruta prática
(≥128 bits). Nenhum token permite atravessar para outro cliente.

---

## 13. Auditoria de autenticação e sessão

- **Leaked Password Protection: DESABILITADO** (linter) — P2-6.
- **MFA:** não configurado — P3.
- Remoção do usuário do workspace (`brand_members.is_active = false`) ou
  perda de atribuição de cliente: **efeito imediato**, porque toda policy
  reavalia `is_brand_member`/`can_access_client` a cada query. O JWT antigo
  continua tecnicamente válido até expirar, mas não devolve dados. ✅
- `is_super_admin` protegido por trigger (`guard_super_admin_flag`), sem
  auto-promoção.
- Logout: `resetIdentityState()` limpa React Query, `nx.brand`, `nx.client` e
  o snapshot social persistido.

---

## 14. Auditoria de cache e contexto

- `auth-cache.ts` (60s) e `access-cache.ts` (5min) são invalidados em toda
  transição de identidade.
- Troca de workspace → `resetScopeCache()` + revalidação dos IDs persistidos
  (Fase 4/7).
- Cache persistido em `localStorage` usa chave **global**
  `unitos:social-analytics-cache:v1`, não segmentada por usuário. Limpo no
  logout; risco residual apenas se o logout não completar (aba fechada,
  crash) em máquina compartilhada — P2-3 baixo/limítrofe, listado como P3-2.

---

## 15. Segredos

- Nenhum `service_role`/`sb_secret`/chave de IA no bundle do cliente.
- `src/integrations/supabase/client.ts` contém **fallback hardcoded da chave
  anon/publicável** desta instância (P3-1: publicável por natureza, mas acopla
  o Master a este projeto e vaza o `project ref`).
- `.env` está ignorado pelo git (`.gitignore:2`).
- `src/lib/meta/error-messages.ts` filtra `SERVICE_ROLE` de mensagens de erro
  antes de exibi-las. ✅

---

## 16. Auditoria de logs

- `logs.functions.ts` retorna `ai_jobs.input/result` — payloads de IA podem
  conter conteúdo de cliente; acessível a MANAGER de todo o workspace (P2-5).
- Endpoints de máquina não logam segredos; erros de Meta são sanitizados.
- `brain_worker_runs` restrito a super admin (Fase anterior). ✅

---

## 17. Matriz de ataques (resultado esperado × real)

| Ator | Operação | Mesmo cliente | Outro cliente | Outro workspace | Real |
| --- | --- | --- | --- | --- | --- |
| SUPER ADMIN | leitura/escrita | ✅ | ✅ | ✅ | conforme |
| ADMIN | leitura/escrita | ✅ | ✅ (dentro do workspace) | ❌ | conforme |
| MANAGER | leitura | ✅ | ❌ | ❌ | **diverge**: Storage, `message_logs`, logs, registros `client_id NULL` |
| MANAGER | escrita | ✅ | ❌ | ❌ | conforme (exceto Storage) |
| USER | leitura | ✅ | ❌ | ❌ | **diverge**: mesmas superfícies |
| USER | escrita | conforme papel | ❌ | ❌ | conforme (exceto Storage) |
| PORTAL | leitura | próprio cliente | ❌ | ❌ | conforme |
| PORTAL | escrita | ações permitidas | ❌ | ❌ | conforme |

---

## 18. Vulnerabilidades

### P0 — nenhuma

### P1

**P1-1 — Storage sem escopo de cliente**
- Onde: `storage.objects` (buckets `brand-documents`, `brand-media`,
  `brand-assets`); todas as policies usam `is_brand_member(split_part(name,'/',1))`.
- Comportamento: qualquer membro do workspace lê/escreve/apaga qualquer
  arquivo do workspace, inclusive de clientes não atribuídos.
- Ator afetado: MANAGER, USER.
- Exploração: trocar `…/clients/<A>/doc.pdf` por `…/clients/<B>/doc.pdf`, ou
  listar o bucket pelo prefixo do `brand_id`.
- Impacto: vazamento de documentos/mídia de clientes fora do escopo,
  contradizendo a RLS de `client_documents`/`brand_media_assets`.
- Recomendação: derivar `client_id` do segundo segmento do path e validar com
  `can_access_client`; restringir DELETE/UPDATE a `is_brand_admin_level`.
- Prioridade: **P1**.

**P1-2 — `message_logs` com escopo apenas de marca**
- Onde: policy `brand members can read message logs`
  (`is_brand_member(brand_id, auth.uid())`).
- Impacto: MANAGER/USER leem histórico de mensagens de clientes não atribuídos.
- Recomendação: trocar por `client_in_scope(client_id, brand_id)`.
- Prioridade: **P1**.

**P1-3 — Registros com `client_id NULL` caem em escopo de marca**
- Onde: `projects`, `tasks`, `activity_events` (ramo
  `WHEN client_id IS NULL THEN is_brand_member(...)`).
- Impacto: projetos/tarefas internos sem cliente ficam visíveis a todo o
  workspace, inclusive USER; pode ser usado para inferir operação de outros
  clientes (títulos, descrições).
- Recomendação: decidir explicitamente a regra (ex.: visível apenas ao criador,
  responsáveis e admin do workspace) e tornar `client_id` obrigatório onde o
  produto exige cliente.
- Prioridade: **P1**.

### P2

- **P2-1 — `getLoginLogoFn` (`login-branding.functions.ts`)**: server function
  pública, com service role, devolve URL assinada (6h) da logo da marca
  atualizada mais recentemente, sem rate limit. Vaza branding entre
  instalações multi-marca e permite inferir atividade recente. Recomendação:
  resolver a marca por host/slug e cachear.
- **P2-2 — `/api/public/approval/$token`**: `access-control-allow-origin: *`
  com service role, sem rate limit e sem `Referrer-Policy`; token viaja na URL.
  Permite replay a partir de qualquer origem se o link vazar. Recomendação:
  restringir CORS, adicionar rate limit e reforçar expiração curta.
- **P2-3 — Oráculo de existência via RPC**: `can_access_client`,
  `client_in_scope`, `is_client_assigned`, `can_access_project`,
  `can_access_task` são chamáveis por `authenticated` e devolvem
  `false`/erro distinto para "não existe" vs. "existe fora do escopo".
  Enumeração de UUID é impraticável, mas há oráculo de confirmação para IDs
  obtidos por outros meios.
- **P2-4 — `media_plans.share_token`**: expiração opcional e sem revogação;
  `media_plan_public_resolve` devolve nome do cliente e da marca a `anon`.
  Recomendação: expiração obrigatória + coluna de revogação.
- **P2-5 — Logs acessíveis a MANAGER em todo o workspace**
  (`logs.functions.ts` usa `assertAdminAuthority`, que aceita manager, e
  filtra só por `brand_id`; `ai_jobs.input/result` podem conter dados de
  cliente). Recomendação: interseção com `resolveScopedClientIds`.
- **P2-6 — Leaked Password Protection desabilitado** no Supabase Auth
  (pendência conhecida desde a Fase 8; exige ação no painel).

### P3

- **P3-1** — Chave anon/publicável hardcoded como fallback em
  `src/integrations/supabase/client.ts` (acopla o Master a esta instância).
- **P3-2** — Cache persistido `unitos:social-analytics-cache:v1` não é chaveado
  por usuário; só é limpo no logout bem-sucedido.
- **P3-3** — Webhooks Meta e endpoints de cron sem verificação de timestamp/
  nonce (replay teórico; escritas idempotentes).
- **P3-4** — Extensões instaladas no schema `public` (linter WARN).
- **P3-5** — MFA não habilitado; sem revogação forçada de sessão ao remover
  usuário (autorização morre imediatamente via RLS, mas o JWT vive até expirar).

---

## 19. Falsos positivos descartados

- `meta_compliance_events` e `portal_rate_limit` com RLS e **zero policies**:
  deny-all intencional; acesso apenas por service role.
- 13 funções `SECURITY DEFINER` executáveis por `anon`: superfície do Portal e
  do Media Plan público, todas com sessão derivada de token no servidor e
  rate limit no caminho do Portal (exceto o já reportado P2-4).
- 51 funções `SECURITY DEFINER` para `authenticated`: são as funções canônicas
  de autorização; expor `EXECUTE` é requisito do modelo (ressalva P2-3).
- `user_profiles.role`: não é usado para conceder acesso a workspace
  (`app_access_role` ignora o campo).

---

## 20. Pontos já corretamente protegidos

- Escopo por cliente em `posts`, `projects`, `tasks`, `ai_jobs`, `chat_*`,
  `brain_*`, `social_*`, `client_documents`, `calendar_events`,
  `monthly_plan_tokens`, `brand_briefings`, `brand_media_assets`.
- `anon` sem privilégios de tabela em todo o schema `public`.
- `search_path` fixo em 100% das funções `SECURITY DEFINER`.
- `supabaseAdmin` sempre precedido de guard quando há ator humano.
- Endpoints internos exigem Bearer; cron exige `CRON_SECRET`; webhooks Meta
  exigem HMAC.
- Contexto/cache limpos em troca de workspace, troca de cliente e logout.
- Portal isolado por `is_portal_client_of` e por sessão de token.

---

## 21. Recomendações e plano sugerido para a Fase 10

1. **P1-1 Storage**: reescrever as policies dos três buckets para validar
   `brand_id` **e** `client_id` no path; padronizar o layout
   `"<brand_id>/clients/<client_id>/..."` e migrar caminhos legados.
2. **P1-2**: `message_logs` → `client_in_scope`.
3. **P1-3**: definir e aplicar a regra para `client_id NULL` em `projects`,
   `tasks` e `activity_events`.
4. **P2-5**: escopar `logs.functions.ts` por `resolveScopedClientIds`.
5. **P2-1 / P2-2 / P2-4**: branding pré-login por host, CORS + rate limit no
   endpoint de aprovação, expiração/revogação obrigatórias no share de mídia.
6. **P2-6**: habilitar Leaked Password Protection (e avaliar MFA).
7. **P3**: remover fallback de chave hardcoded, chavear o cache persistido por
   `user_id`, adicionar tolerância de timestamp nos webhooks.
8. Ampliar a suíte de testes com os cenários de escalada da seção 22.

---

## 22. Testes de escalada que devem existir (não executados nesta fase)

| # | Cenário | Resultado esperado | Coberto hoje |
| --- | --- | --- | --- |
| 1 | USER → `clientId` de outro cliente | negado | sim |
| 2 | MANAGER → cliente não atribuído | negado | sim |
| 3 | MANAGER → workspace diferente | negado | sim |
| 4 | ADMIN → workspace fora do contexto | negado | sim |
| 5 | PORTAL → outro `clientId` | negado | sim |
| 6 | PORTAL → endpoint interno | negado | sim |
| 7 | USER → RPC privilegiada (`brain_*`, `claim_scheduled_social_posts`) | sem EXECUTE | sim |
| 8 | USER → endpoint com service role sem segredo | 401 | sim |
| 9 | Usuário removido → sessão antiga | sem dados | parcial |
| 10 | Troca de workspace → cache anterior | limpo | sim |
| 11 | ID válido + `brandId` forjado | negado | sim |
| 12 | `clientId` válido + `projectId` de outro cliente | negado | sim |
| 13 | `projectId` válido + `taskId` de outro cliente | negado | sim |
| 14 | **Path de Storage de outro cliente (mesmo workspace)** | **deveria negar — hoje permite** | **não** |
| 15 | Token público de outro cliente | negado | sim |
| 16 | **MANAGER lendo `message_logs`/logs de cliente não atribuído** | **deveria negar — hoje permite** | **não** |
