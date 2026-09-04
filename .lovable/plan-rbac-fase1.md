# Fase 1 — Plano de execução (RBAC + escopo de dados)

Base: `.lovable/audit-rbac-multitenant.md`.

## Camada canônica (banco)

- `is_client_assigned(user, client)` — owner_user_id OU `client_members` (não portal).
- `can_access_client_row(client, brand, owner, user)` — super_admin → true; sem membership ativa → false; `admin` → true; `manager`/`user` → `is_client_assigned`; resto → false.
- `can_access_client(client, user)` — inalterado na assinatura, delega ao acima.
- `client_in_scope(client_id, brand_id)` — helper único das policies: membro da marca E (`client_id IS NULL` OU `can_access_client`).
- `app_access_role(user, brand)` — sem `is_global_admin`; `brand NULL` não escala papel (retorna NULL, exceto super admin/portal).
- `is_brand_member` — sem `is_global_admin`.
- `my_access(brand)` — `brand_role` determinístico (ORDER BY), `client_ids` sem atalho de manager, `brand_ids` só das memberships.
- `is_global_admin` — depreciada (retorna false); ADMIN passa a ser sempre por workspace.

## RLS

Reescrever com `client_in_scope` as policies das tabelas client-scoped protegidas só por `is_brand_member`:
`client_documents`, `calendar_events`, `social_posts`, `social_connections`, `client_social_accounts`,
`content_pipelines`, `plan_overage_requests`, `chat_conversations`, `ai_jobs`, `monthly_plan_tokens`,
`client_journey_events`, `brand_media_assets`, `brand_cohorts`, `brand_ai_usage`, `ai_usage_limits`,
`client_members`, `brain_events` (+partições e archive), `brain_memory`, `brain_insights`,
`brain_recommendations`, `brain_relationships`.

## Aplicação (server)

- `access-guard.ts`: `assertClientScope` obrigatório, `resolveAllowedClientIds`, `assertAdminAuthority` exige brand.
- `access.functions.ts`: novo `getMyContextFn` (workspaceId, role, allowedClientIds, clientId sempre null).
- Dashboards (`dashboard.functions.ts` e derivados): agregação restrita a `allowedClientIds` no backend.
- `supabaseAdmin`: validar escopo antes do bypass nos módulos client-scoped.

## Frontend

- `useAccessRole`: manager deixa de ter `allowedClientIds = null`.
- Nenhum cliente pré-selecionado (mantido) — apenas workspace.

## Testes

`tests/rbac-scope.integration.test.ts`: matriz ADMIN/MANAGER/USER × clientes atribuídos/não atribuídos/outro workspace, por tabela crítica, e negativos de `clientId` forjado.
