# Auditoria RBAC + Isolamento Multi-Tenant — Unitos (read-only)

Data: 2026-08-24. Nenhuma alteração de código, banco ou migration foi feita.

## A. Arquitetura atual de autorização

1. **Autenticação**: Supabase Auth. Server: `requireSupabaseAuth` (`src/integrations/supabase/auth-middleware.ts`) injeta `supabase` (RLS como usuário), `userId`, `claims`. Bearer anexado por `functionMiddleware` em `src/start.ts`. Cliente: `getCachedUser()` (`src/lib/auth-cache.ts`, TTL 60s) usado pelo gate `src/routes/_authenticated/route.tsx`.
2. **Não existe entidade "workspace" separada.** `brands` = workspace; `clients` = contas/clientes do workspace. Não há tabela `workspaces`, nem `is_workspace_admin`, nem `is_member_of`, nem `has_role` (o `has_role` genérico da doc não existe neste projeto; o equivalente é `has_brand_role`).
3. **Camadas de decisão**:
   - Banco (verdade real): RLS + funções SECURITY DEFINER (`app_access_role`, `can_access_client(_row)`, `is_brand_member`, `is_brand_admin_level`, `has_brand_role`, `is_super_admin`, `is_global_admin`, `is_portal_client_of`, `my_access`).
   - Server functions: quase sempre apenas repassam `brandId`/`clientId` para queries com o client autenticado (RLS decide). Só 6 módulos chamam guards explícitos (`access-guard.ts`).
   - Frontend: `useActiveContext` (localStorage) + `useAccessRole` (espelho de `my_access`) — apenas cosmético.
4. **Contexto ativo (frontend)**: `src/hooks/use-active-context.tsx` guarda `nx.brand` e `nx.client` em `localStorage` (valida só formato UUID). Todo componente/servidor recebe esses IDs como parâmetro.

## B. Fonte real de verdade por permissão

| Decisão | Fonte real |
|---|---|
| Papel canônico | `public.app_access_role(user, brand)` → super_admin / admin / manager / user / client |
| Super admin | `user_profiles.is_super_admin` ou `user_profiles.role='super_admin'` |
| Admin global (cross-brand) | `user_profiles.role='admin'` → `is_global_admin()` |
| Pertencer ao workspace | `brand_members(brand_id,user_id,is_active)` via `is_brand_member` |
| Autoridade admin no workspace | `is_brand_admin_level` (admin, manager, super_admin) |
| Acesso a um cliente | `can_access_client_row(client, brand, owner_user_id, user)` |
| Atribuição usuário→cliente | `clients.owner_user_id` **ou** `client_members(role<>'portal_client')` |
| Cliente do Portal | `client_members.role='portal_client'` via `is_portal_client_of` |
| Escopo exposto à UI | `public.my_access(brand)` → `role`, `brand_role`, `client_ids`, `brand_ids` |
| Convites/grants | `can_invite_brand_role` |
| Features/módulos | `brand_features` + `feature_catalog` (leitura: qualquer membro; escrita: super admin) |

## C. Tabelas envolvidas
`brands`, `brand_members`, `clients`, `client_members`, `user_profiles`, `brand_invites`, `brand_features`, `feature_catalog`, `portal_tokens`, `client_briefing_tokens`, `monthly_plan_tokens`, `card_approval_tokens` + ~54 tabelas de dados com `client_id`.

## D. Funções SQL envolvidas
`app_access_role`, `can_access_client`, `can_access_client_row`, `can_access_task`, `can_invite_brand_role`, `can_create_brand`, `has_brand_role`, `is_brand_member`, `is_brand_admin_level`, `is_super_admin(_user_id)/()`, `is_global_admin`, `is_portal_client_of`, `my_access`, `normalize_app_role`, `normalize_client_member_role`, `guard_super_admin_flag`, `accept_brand_invite`, `_portal_session*`, `portal_resolve`.

## E. Policies RLS (resumo por padrão de escopo)

- **Escopo por cliente (correto)**: `posts` (4), `monthly_plans` (4), `tasks` (2), `projects` (2), `brand_briefing_requests` (3), `brand_briefing_versions/reviews`, `brand_ai_versions`, `brand_briefings`, `brand_pautas`, `brand_personas`, `brand_swot`, `brand_voice_cards`, `brand_competitors`, `brand_ai_content`, `media_plans`, `post_placements`, `activity_events`, `client_briefings`, `client_briefing_tokens`, `portal_tokens`, `brand_briefing_proposals`.
- **Escopo só por marca (`is_brand_member`) apesar de possuir `client_id`** — 31 tabelas: `ai_jobs`, `ai_usage_limits`, `brand_ai_usage`, `brand_cohorts`, `brand_media_assets`, `calendar_events`, `chat_conversations`, `client_documents`, `client_journey_events`, `client_members`, `client_social_accounts`, `content_pipelines`, `monthly_plan_tokens`, `plan_overage_requests`, `social_connections`, `social_posts`, `brain_events*` (todas as partições), `brain_events_archive`, `brain_insights`, `brain_memory`, `brain_recommendations`, `brain_relationships`, `brain_reasoning_logs`.
- `clients`: SELECT = `can_access_client_row(...) OR is_portal_client_of(...)` (correto); UPDATE permite também papel `user` no escopo; INSERT/DELETE = admin/manager/super_admin.
- `brand_members`: leitura por qualquer membro da marca; escrita por owner, ou manager/admin para linhas não-owner.
- `notifications`: leitura/escrita só do próprio `user_id` (correto).

## F. Onde o isolamento está correto

1. Isolamento **entre marcas**: toda policy exige `is_brand_member` (ou equivalente); nenhuma tabela de dados é legível sem vínculo na marca (exceto super/global admin).
2. Isolamento do **Portal**: `can_access_client_row` exclui explicitamente `portal_client`; Portal usa `is_portal_client_of` e `portal_resolve` (RPC) com `clientId` obrigatório e verificação de match (`portal-scope.server.ts`).
3. **Núcleo operacional client-scoped**: `posts`, `tasks`, `projects`, `monthly_plans`, briefings e pauta já filtram por `can_access_client`.
4. Frontend limpa `clientId` fora de escopo (`brand-client-switcher.tsx:143`) e não pré-seleciona cliente ao logar — ADMIN cai no dashboard gerencial (regra atendida).
5. Papéis legados: enum `app_role` ainda tem `editor`/`designer`, mas triggers `normalize_app_role`/`normalize_client_member_role` convertem para `user`; **não há default `role ?? "editor"` no código**.
6. Escalonamento de privilégio bloqueado: `guard_super_admin_flag` impede autoconceder `is_super_admin`/`role`; `can_invite_brand_role` impede conceder acima do próprio nível.

## G. Onde está incorreto (divergências da regra definitiva)

**G1 — MANAGER tem escopo total da marca (CRÍTICO).**
`can_access_client_row` retorna `true` para `v_role IN ('admin','manager')`; `my_access` inclui todos os clientes quando `role IN ('admin','manager')`; `is_brand_admin_level` inclui manager. Logo MANAGER vê/edita **todos** os clientes do workspace, contrariando "só clientes atribuídos".

**G2 — 31 tabelas com `client_id` protegidas apenas por marca (CRÍTICO).**
Um USER atribuído ao cliente A lê dados do cliente B na mesma marca: documentos (`client_documents`), calendário (`calendar_events`), publicações (`social_posts`), conexões e vínculos (`social_connections`, `client_social_accounts`), pipelines (`content_pipelines`), excedentes (`plan_overage_requests`), jornada (`client_journey_events`), conversas (`chat_conversations`), jobs de IA (`ai_jobs`), consumo/limites de IA, mídia (`brand_media_assets`), e **todo o Brain** (`brain_events*`, `brain_memory`, `brain_insights`, `brain_recommendations`, `brain_relationships`, `brain_reasoning_logs`) — que contém contexto estratégico por cliente. Também `monthly_plan_tokens` (token de aprovação pública de outro cliente).

**G3 — Dashboards não respeitam client assignment.**
`getDashboardStats`/`getAgencyDashboardFn`/`getDashboardInsights` (`src/lib/dashboard.functions.ts`) filtram por `brandId` e, opcionalmente, pelo `clientId` enviado. Sem `clientId`, agregam tudo o que a RLS permitir — o que para G2 significa dados de clientes não atribuídos. Regra exige dashboard de MANAGER/USER calculado **exclusivamente** sobre os clientes atribuídos.

**G4 — `clientId` do frontend não é validado no servidor.**
Apenas 6 de ~58 módulos `*.functions.ts` chamam `assertClientScope`/`assertBrandAdmin` (`workspace`, `team`, `team-admin`, `logs`, `client-journey`, `portal-accounts`). Nos demais a única barreira é a RLS — o que é suficiente nas tabelas client-scoped, e insuficiente nas 31 de G2. Não há erro 403 explícito: o usuário recebe silenciosamente dados/vazio.

**G5 — `app_access_role(user, NULL)` escala papel entre marcas.**
Com `_brand_id NULL` a função escolhe o **melhor** papel do usuário em qualquer marca. `assertAdminAuthority(..., null)` (ex.: `logs.functions.ts`) e `useAccessRole` quando `brandId` ainda não hidratou tratam o usuário como admin/manager sem escopo. `my_access` tem o mesmo comportamento, e `brand_role` usa `LIMIT 1` **sem `ORDER BY`** (resultado não determinístico com múltiplas marcas).

**G6 — ADMIN global cross-workspace.**
`is_global_admin` (`user_profiles.role='admin'`) concede acesso a **todas** as marcas e clientes sem membership (`is_brand_member`, `can_access_client_row`, `my_access.brand_ids`). Isso contraria "ADMIN pertence a um workspace" (hoje só SUPER ADMIN deveria ser cross-workspace). É um comportamento intencional herdado (registrado em memória do projeto) e precisa de decisão explícita antes de mudar.

**G7 — Autorização de edição só no frontend.**
`canEditBasicInfo(role) = role === 'admin'` (`src/lib/permissions.ts`) restringe edição de dados básicos do cliente na UI, mas a policy `clients update staff in scope` autoriza também `user`. RLS mais permissiva que a regra de negócio.

**G8 — Efeito colateral de contexto por URL.**
`customers.$customerId.tsx:97` e `customers.$customerId.media-plan.tsx:140` fazem `setClientId(customerId)` a partir do parâmetro de rota, gravando em `localStorage`. Não é falha de autorização (RLS de `clients` barra fora de escopo), mas contamina o contexto global a partir da URL.

**G9 — `supabaseAdmin` (bypass total de RLS) em 35 arquivos.**
Verificados como seguros: `channels-center` (apenas log), `agents.functions` (leitura de prompt por id), `portal-scope`. **Não auditados linha a linha** e portanto risco em aberto: `monthly-plan-public.functions.ts`, `briefing-tokens.functions.ts`, `portal-accounts.functions.ts`, `portal-media.server.ts`, `brain/*.server.ts`, `post-agents.server.ts`, `ai-usage.server.ts`, `routes/api/jobs/*`, `routes/api/public/*`. Qualquer um que aceite `clientId`/`brandId` do chamador sem validar escopo é vazamento direto.

**G10 — Enum `app_role` ainda expõe `editor`/`designer`** (`types.ts`), e `permissions.ts` mantém `resolveAccessRole` que colapsa manager em `admin` — duas matrizes de papel coexistindo (`AccessRole` legado vs `AuthorityRole` canônico).

## H. Riscos de segurança (severidade)

| # | Risco | Sev. |
|---|---|---|
| R1 | USER/MANAGER lê dados de clientes não atribuídos (G2) — inclui Brain, documentos e publicações | Crítico |
| R2 | MANAGER com poder de ADMIN no workspace (G1) | Alto |
| R3 | Token público de aprovação de outro cliente legível (`monthly_plan_tokens`, G2) | Alto |
| R4 | `supabaseAdmin` sem pré-validação de escopo (G9) | Alto (a confirmar) |
| R5 | Elevação de papel com `brandId` nulo (G5) | Médio |
| R6 | ADMIN global cross-workspace (G6) | Médio (decisão de produto) |
| R7 | `user` editando dados básicos do cliente (G7) | Médio |
| R8 | Dashboards agregando fora do escopo atribuído (G3) | Médio |

Não encontrados: fallback que auto-seleciona o primeiro cliente; `role ?? "editor"`; autorização baseada em query string sem RLS por trás; vazamento cross-brand.

## I. Arquivos que precisam ser alterados

Banco (via migrations, ver J). Código:

1. `src/lib/access-guard.ts` — `assertBrandAdmin` deixar de tratar manager como escopo total; exigir `brandId` (proibir `null`); adicionar `assertClientScope` obrigatório e `resolveAllowedClientIds`.
2. `src/lib/access.functions.ts` + `src/hooks/use-access-role.tsx` — separar MANAGER de ADMIN no escopo (`allowedClientIds` deixa de ser `null` para manager).
3. `src/lib/permissions.ts` — aposentar `AccessRole`/`resolveAccessRole`; matriz única por `AuthorityRole`.
4. `src/lib/dashboard.functions.ts` e `src/lib/client-dashboard.*`, `src/lib/customer-dashboard.functions.ts`, `src/lib/analytics.functions.ts` — filtrar por lista de clientes autorizados quando o papel não é admin/super.
5. Server functions que recebem `clientId` sem validar (varredura dos ~52 módulos `src/lib/*.functions.ts`), prioridade: `content.functions.ts`, `calendar.functions.ts`, `calendar-board.functions.ts`, `calendar-events.functions.ts`, `client-channels.functions.ts`, `channels-center.functions.ts`, `connections.functions.ts`, `documents-ai.functions.ts`, `chat.functions.ts`, `ai-jobs.functions.ts`, `ai-limits.functions.ts`, `brand-media.functions.ts`, `media-plans*.functions.ts`, `agency-content.functions.ts`, `client-journey.functions.ts`, `brand-hub.functions.ts`, `brain/*`.
6. Todos os arquivos com `supabaseAdmin` (35) — inserir validação de escopo antes do bypass.
7. `src/components/brand-client-switcher.tsx`, `src/components/command-menu.tsx`, `src/routes/_authenticated/customers.$customerId*.tsx` — contexto como "pedido", nunca autoridade.
8. `tests/rbac.integration.test.ts`, `tests/global-admin.integration.test.ts`, novos testes de vazamento por cliente.

## J. Migrations necessárias (ordem lógica)

1. **M1 — Papel canônico determinístico**: `app_access_role` com `_brand_id` obrigatório (ou retorno `NULL` quando nulo); `my_access.brand_role` com `ORDER BY` determinístico.
2. **M2 — MANAGER escopado**: `can_access_client_row` — manter escopo total apenas para `admin`/`super_admin` (+ `global admin`, se mantido); manager passa a depender de `owner_user_id`/`client_members`. Novo helper `is_brand_manager_level` para permissões administrativas que continuam válidas (convites, criação de cliente) sem conceder leitura de todos os clientes.
3. **M3 — Função de escopo por linha**: `can_access_client_nullable(client_id, brand_id)` (aceita `client_id IS NULL` = recurso da marca) para reuso nas policies.
4. **M4 — Reescrita das policies das 31 tabelas de G2** (`ai_jobs`, `calendar_events`, `client_documents`, `social_posts`, `social_connections`, `client_social_accounts`, `content_pipelines`, `chat_conversations`, `plan_overage_requests`, `client_journey_events`, `brand_media_assets`, `brand_cohorts`, `monthly_plan_tokens`, `ai_usage_limits`, `brand_ai_usage`, `client_members`) — em lotes por domínio.
5. **M5 — Brain**: policies de `brain_events*` (todas as partições + default + archive), `brain_memory`, `brain_insights`, `brain_recommendations`, `brain_relationships`, `brain_reasoning_logs` com escopo por cliente quando `client_id` não é nulo.
6. **M6 — `clients` UPDATE** restrito a `admin`/`manager` (dados básicos), mantendo `user` apenas nos campos operacionais (ou trigger de coluna).
7. **M7 — Decisão sobre ADMIN global** (G6): se confirmado que ADMIN é por workspace, remover `is_global_admin` de `is_brand_member`/`can_access_client_row`/`my_access` e migrar quem hoje é `user_profiles.role='admin'` para membership `owner` nas marcas devidas.
8. **M8 — Limpeza de papéis legados**: remover `editor`/`designer` do enum `app_role` (após confirmar zero linhas) e dos tipos gerados.
9. **M9 — Views/RPCs de dashboard escopadas** (opcional): `my_client_ids(brand)` como fonte única para agregações.

## K. Ordem recomendada de implementação

1. **Fase 0 — Decisões**: confirmar (a) ADMIN global permanece?; (b) MANAGER perde escopo total (impacto operacional); (c) o que MANAGER continua administrando (equipe, convites, criação de clientes).
2. **Fase 1 — Rede de testes**: testes de integração que provem o vazamento atual (USER do cliente A lendo cliente B em cada uma das 31 tabelas) — falham antes, passam depois.
3. **Fase 2 — Fundações SQL**: M1, M3 (+ helper de manager de M2 sem mudar comportamento ainda).
4. **Fase 3 — Fechar vazamento de dados**: M4 e M5 em lotes (operacional → Brain), rodando os testes da Fase 1 a cada lote.
5. **Fase 4 — Escopo do MANAGER**: M2 + `access.functions`/`use-access-role`/`permissions.ts` no mesmo passo (banco e UI juntos, para não divergir).
6. **Fase 5 — Servidor deixa de confiar no cliente**: `assertClientScope` obrigatório em toda server function com `clientId`; auditoria dos 35 arquivos com `supabaseAdmin`; erro 403 explícito.
7. **Fase 6 — Dashboards escopados**: M9 + `dashboard.functions.ts` e derivados (ADMIN sem cliente pré-selecionado; MANAGER/USER agregando só clientes atribuídos).
8. **Fase 7 — Higiene**: M6, M7 (se aprovado), M8, remoção da matriz legada `AccessRole`, revalidação com o linter do Supabase e o scanner de segurança.
