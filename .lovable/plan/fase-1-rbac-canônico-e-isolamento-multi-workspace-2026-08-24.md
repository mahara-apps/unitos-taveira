# Fase 1 — RBAC canônico e isolamento multi-workspace

## Diagnóstico da estrutura atual (auditoria read-only)

**Workspace = `brands`** (confirmado): `brand_members(brand_id, user_id, role, is_active)` é o vínculo de workspace; `clients.brand_id` liga cliente ao workspace; `client_members(client_id, brand_id, user_id, role)` é o vínculo por cliente, com `role='portal_client'` reservado ao Portal. Hoje: 207 workspaces, 107 clientes, 315 memberships ativas, 1 super admin.

### O que já está correto (não mexer)

- `is_super_admin(user_id)` → só `user_profiles.is_super_admin` ou `role='super_admin'`. **ADMIN não vira super admin** (o antigo "admin global" já foi removido do banco: `app_access_role` não consulta mais `user_profiles.role`).
- `is_global_admin()` já está depreciada (retorna `false`).
- `app_access_role(user, brand)`: `owner→admin`, `manager→manager`, resto→`user`; sem workspace não escala papel.
- `can_access_client_row` / `can_access_client`: super admin → tudo; sem membership ativa no workspace → nada; `admin` → todos os clientes do workspace; `manager`/`user` → só `is_client_assigned` (owner_user_id ou `client_members` não-portal).
- `is_portal_client_of` isola o Portal; `client_in_scope` é o helper das policies.
- Nenhuma tabela **com coluna `client_id`** ficou protegida apenas por `is_brand_member` (verificado por query).
- **Clientes órfãos: 0** — nenhum cliente sem owner e sem membership; o estado não gera acesso implícito hoje.

### Lacunas reais encontradas

1. **Herança quebrada em tabelas descendentes sem `client_id`** — hoje qualquer membro do workspace lê/escreve:
   - `task_comments` (ALL), `task_time_entries` (SELECT e escritas) → deveriam herdar de `can_access_task`;
   - `monthly_plan_topics` (SELECT) → deveria herdar do plano (`can_access_client`);
   - `project_jobs` (ALL) → deveria herdar do projeto;
   - `card_approval_events`, `card_approval_tokens` → deveriam herdar do post/cliente;
   - `brain_embeddings`, `brain_memory_versions`, `brain_learning_queue` → deveriam herdar da memória/evento do cliente.
2. **Falta função canônica de projeto**: existe `can_access_task`, não existe `can_access_project`; a herança de projeto está duplicada inline nas policies de `projects`/`tasks`.
3. **`is_agency_operator` inclui `user`** — é só "operador interno vs portal", nome enganoso; manter comportamento, documentar.
4. **Resíduos de "admin global" na aplicação**: comentários e ramos em `team.functions.ts` (`listProvisionableBrands`), `workspace.functions.ts`, `analytics.functions.ts` ainda descrevem/tratam `user_profiles.role='admin'` como autoridade de agência, divergindo do banco. 13 perfis têm `role='admin'` — os dados ficam, o significado deixa de conceder acesso.
5. **Teste `tests/global-admin.integration.test.ts` afirma a regra antiga** (admin global acessa marca sem membership) — precisa ser invertido para teste de não-escalada.
6. **`supabaseAdmin` em 35 arquivos** — sem inventário/classificação.

## Plano de migração

### 1. Banco — funções canônicas (consolidar, não duplicar)

- Criar `can_access_project(_project_id, _user_id)`: membro do workspace do projeto **e** (`client_id IS NULL` → membro; senão `can_access_client`).
- Reescrever `can_access_task` sobre `can_access_project` quando a task tem projeto (mantendo o caminho por `client_id`).
- Manter nomes existentes (`is_brand_member`, `is_brand_admin_level`, `has_brand_role`, `can_access_client`, `client_in_scope`, `is_portal_client_of`, `is_agency_operator`) — nenhuma função nova redundante.
- Documentar `is_agency_operator` como "operador interno do workspace".

### 2. Banco — RLS de herança (mesma migração)

Reescrever as policies das tabelas descendentes listadas na lacuna 1 para usarem `can_access_task` / `can_access_project` / `can_access_client` via `EXISTS` no pai, preservando os predicados de papel já existentes (ex.: `is_agency_operator`, `user_id = auth.uid()` em time entries) e as leituras do Portal já vigentes. Nenhum `DROP TABLE`, nenhuma coluna removida, nenhum dado apagado.

### 3. Aplicação (server) — sem mudança de UI

- Remover os ramos/comentários de "admin global" em `team.functions.ts`, `workspace.functions.ts`, `analytics.functions.ts`: workspaces visíveis = super admin (todos) ou memberships do usuário.
- `access-guard.ts`: adicionar `assertProjectScope` e `assertTaskScope` (usando as RPCs canônicas) para as server functions que hoje confiam em `projectId`/`taskId` recebidos do frontend.
- Aplicar `assertClientScope`/`assertProjectScope`/`assertTaskScope` nas server functions protegidas que recebem esses IDs e escrevem via `supabaseAdmin`.

### 4. Inventário de `supabaseAdmin` (classificar, não remover)

Documentar em `.lovable/audit-supabase-admin.md` os 35 arquivos em três categorias: **bypass técnico legítimo** (webhooks Meta, cron com `CRON_SECRET`, tokens públicos de portal/aprovação, catálogo de modelos/health), **precisa autorização antes do bypass** (team/portal-accounts/briefing-tokens/channels-center/brain), **potencialmente inseguro** (uso em caminho autenticado onde a RLS bastaria). Correções ficam para a fase seguinte, exceto onde o guard de escopo do item 3 já é trivial.

### 5. Testes — matriz completa

Novo `tests/rbac-scope.integration.test.ts` cobrindo os 20 casos pedidos (super admin em A e B; admin de A em todos os clientes de A e bloqueado em B; admin em A+B alternando; manager/user atribuídos vs não atribuídos; portal restrito ao próprio cliente; cross-workspace; herança project→task→subtask; `clientId` forjado; manager/user sem acesso global por membership; admin ≠ super admin).
Reescrever `tests/global-admin.integration.test.ts` como teste de **não-escalada** de `user_profiles.role='admin'`.

### 6. Memória do projeto

Atualizar a regra Core que hoje diz que `user_profiles.role='admin'` concede autoridade em todas as marcas — passa a valer: ADMIN = autoridade apenas nos workspaces em que é membro.

## Riscos e mitigação

- Endurecer RLS pode esconder registros de manager/user que hoje veem tudo do workspace: por isso os clientes órfãos foram auditados (zero) e os testes rodam antes/depois.
- Nada é destrutivo: apenas `CREATE OR REPLACE FUNCTION` e `DROP POLICY`/`CREATE POLICY`.
