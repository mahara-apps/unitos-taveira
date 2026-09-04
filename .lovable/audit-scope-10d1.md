# FASE 10D.1 — Auditoria de escopo: `projects`, `tasks`, `activity_events`

Somente leitura. Nenhum código, dado, policy, migration ou UI alterado.

## 1. Resumo executivo

- **`projects`: 93 registros, 0 com `client_id` NULL.**
- **`tasks`: 278 registros, 0 com `client_id` NULL.**
- **`activity_events`: 911 registros, 91 com `client_id` NULL (10%).**
- Todos os 91 NULL são `entity_type = 'task'`, `verb = 'created'`, `brand_id` preenchido (90 workspaces distintos, todos existentes), `actor_id` NULL, criados entre 2026-08-18 e 2026-08-24.
- **Nenhum dos 91 tem tarefa correspondente** (`entity_id` órfão: 0 de 91 resolvem em `tasks`). Payload com títulos do tipo `"Tarefa fora rbacmsynok46"`, `"Portal rbacmsynok46"`, em brands chamadas `RBAC rbacmsyn…` → artefatos das suítes de integração RBAC (tarefas workspace-level criadas e depois removidas com o fixture).
- **Classificação dominante: D — LEGADO/artefato de teste** (não determinável nem corrigível; a tarefa de origem não existe mais). Não devem receber `client_id`.
- O risco estrutural real **não está nos dados atuais**, e sim no **padrão de policy** `CASE WHEN client_id IS NULL THEN is_brand_member(brand_id) ELSE can_access_client(client_id) END`, presente em `projects`, `tasks` e `activity_events`: qualquer registro futuro workspace-level fica visível a **todo** membro da brand, incluindo MANAGER/USER sem cliente atribuído. Hoje não há vazamento client-level porque não existem linhas NULL em `projects`/`tasks` e os 91 eventos NULL são órfãos de teste.
- Um bug de produtor foi encontrado (P2, não segurança): `src/lib/content.functions.ts:1603` insere `activity_events` sem `brand_id` (NOT NULL) e sem `client_id`; o erro não é verificado → o evento `post/media_generated` é silenciosamente perdido.

## 2. Inventário das tabelas

| | `projects` | `tasks` | `activity_events` |
|---|---|---|---|
| `brand_id` | sim, NOT NULL | sim, NOT NULL | sim, NOT NULL |
| `client_id` | sim, **nullable** | sim, **nullable** | sim, **nullable** |
| `project_id` | — | sim, nullable | não (só `entity_id` genérico) |
| `task_id` | — | — | não (`entity_id`, sem FK) |
| FK → clients | sim | sim | sim |
| FK → projects | — | sim | **não** |
| FK → tasks | — | — | **não** (`entity_id` livre, sem integridade referencial) |
| RLS | habilitada | habilitada | habilitada |
| Triggers | `brain_projects_evt`, `trg_projects_updated`, `trg_projects_updated_at` | `brain_tasks_evt`, `tasks_notify_assigned`, `trg_enforce_task_project_client`, `trg_tasks_activity`, `trg_tasks_updated` | nenhum |

Tabelas que herdam escopo dessas entidades (sem `client_id` próprio, autorização via cadeia):

| Tabela | Chave de escopo | Policy |
|---|---|---|
| `project_jobs` | `project_id` | `can_access_project(project_id, auth.uid())` (ALL) |
| `task_subtasks` | `task_id` | `can_access_task(task_id, auth.uid())` (SELECT/INSERT/UPDATE/DELETE) |
| `task_comments` | `task_id` | `can_access_task(task_id, auth.uid())` (ALL) |
| `task_time_entries` | `task_id` + `user_id` | `can_access_task(...)`; escrita restrita a `user_id = auth.uid()` |
| `project_templates` | `brand_id` / `is_system` | `is_system OR is_brand_member(brand_id)` — templates de sistema legíveis por qualquer autenticado (por design) |

## 3. Policies (texto real)

`projects`, `tasks`, `activity_events` compartilham o mesmo predicado de leitura:

```sql
CASE WHEN client_id IS NULL
     THEN is_brand_member(brand_id, auth.uid())
     ELSE can_access_client(client_id, auth.uid())
END
```

- `projects` / `tasks` — escrita: `is_agency_operator(auth.uid(), brand_id) AND <mesmo CASE>` (ALL).
- `activity_events` — **apenas SELECT** para `authenticated` (`brand members read activity`). Não há policy de INSERT/UPDATE/DELETE → escrita direta pelo usuário é bloqueada; os inserts existem via trigger SECURITY DEFINER, `supabaseAdmin`, ou (nos casos com `context.supabase`) falham por ausência de policy.

Funções canônicas envolvidas:

- `is_brand_member(brand, user)` = super admin **ou** `brand_members` ativo.
- `can_access_client(client, user)` → `can_access_client_row(...)`; cliente inexistente ⇒ `false` (IDs forjados falham como fora de escopo).
- `is_agency_operator(user, brand)` = `app_access_role ∈ (super_admin, admin, manager, user)` — **não** restringe por cliente por si só.
- `can_access_project(p, u)` = `is_brand_member(p.brand_id)` **AND** (`p.client_id IS NULL` **OR** `can_access_client(p.client_id)`).
- `can_access_task(t, u)` = `is_brand_member(t.brand_id)` **AND** (`t.client_id IS NULL` OR `can_access_client`) **AND** (`t.project_id IS NULL` OR `can_access_project`).

### Matriz de visibilidade (análise, sem alterações)

Cenário: USER/MANAGER atribuído apenas ao cliente A, mesma brand.

| Papel | project cliente B | task cliente B | activity_event cliente B | registro NULL (workspace) |
|---|---|---|---|---|
| SUPER ADMIN | vê | vê | vê | vê |
| ADMIN (workspace) | vê | vê | vê | vê |
| MANAGER (só A) | **não** | **não** | **não** | **VÊ** ⚠️ |
| USER (só A) | **não** | **não** | **não** | **VÊ** ⚠️ |
| PORTAL (cliente A) | não (sem policy anon/portal nessas tabelas) | não | não | não |
| ANON | não | não | não | não |

Conclusão: isolamento client-level está correto; o furo é exclusivamente o ramo `client_id IS NULL`, que colapsa em "todo membro da brand". `can_access_task`/`can_access_project` herdam o mesmo furo, propagando-o para `task_subtasks`, `task_comments`, `task_time_entries` e `project_jobs`.

## 4. Registros NULL — classificação

| Padrão | Volume | Classe | Justificativa | Ação |
|---|---|---|---|---|
| `activity_events` `task/created`, `entity_id` órfão, `actor_id` NULL, brands `RBAC rbacmsy…`, payload `"Tarefa fora …"` / `"Portal …"` | 91 | **D — LEGADO** | tarefa de origem inexistente; nenhuma relação determinística com cliente; nome/texto/actor não são evidência aceitável | manter NULL |
| `projects` com `client_id` NULL | 0 | — | inexistente hoje | — |
| `tasks` com `client_id` NULL | 0 | — | inexistente hoje | — |

Nenhum registro classificado como B (client level corrigível) e nenhum como C/E hoje. A classe **C — HERDADO** é, ainda assim, o modelo correto de autorização futuro para `activity_events`, pois a tabela não tem FK para a entidade de origem:

```
activity_event.entity_type='task'  → tasks.client_id      → clients.brand_id
activity_event.entity_type='post'  → posts.client_id      → clients.brand_id
activity_event.entity_type in ('brand_feature','brand_identity','social_connection') → workspace (A)
```

Ou seja: `activity_events` é **heterogênea** — parte A (workspace), parte C (herdada). Não deve simplesmente "receber client_id" retroativamente.

## 5. Produtores

### `activity_events`
| Origem | Tipo | `client_id` |
|---|---|---|
| `log_task_activity()` (trigger em `tasks`, INSERT/UPDATE de status) | trigger SECURITY DEFINER | copia `NEW.client_id` → herda corretamente (NULL só quando a tarefa é NULL) |
| `src/lib/ai-agents.functions.ts:288` | server fn | `client_id` preenchido |
| `src/lib/publish-retry.functions.ts:343` | server fn | preenchido |
| `src/lib/post-agents.server.ts:219,701` | `supabaseAdmin` | `post.client_id` |
| `src/routes/api/jobs/customer-pipeline.ts:720` | rota HTTP | `state.clientId` |
| `src/lib/channels-center.functions.ts:153` | `supabaseAdmin` | `clientId` opcional, validado por `assertClientScope` antes do bypass — **SAFE** |
| `src/lib/feature-flags.functions.ts:126`, `src/lib/admin-environment.functions.ts:91` | server fn | workspace-level intencional (classe A) — porém usam `context.supabase` sem policy de INSERT ⇒ escrita provavelmente rejeitada silenciosamente |
| `src/lib/content.functions.ts:1603` | server fn | **sem `brand_id` (NOT NULL) e sem `client_id`; erro não verificado** ⇒ evento perdido |
| `brain_trg_*` | triggers | escrevem em `brain_events`, não em `activity_events` |

Não há produtor que grave `activity_events` com `client_id` NULL de forma intencional client-level.

### `projects`
`src/lib/projects.functions.ts:322` (`client_id: v.client_id ?? null` — permite workspace-level), `src/lib/monthly-plan-project.server.ts` / `monthly-plans.functions.ts` (materialização de pauta, sempre com cliente), `src/lib/workspace.functions.ts` (seed demo, com cliente). Nenhum clone/import/webhook/cron cria projeto.

### `tasks`
`src/lib/tasks.functions.ts:282` (`client_id: data.client_id ?? null` — permite workspace-level), `src/lib/project-jobs.functions.ts:170` (herda `client_id` do projeto), `src/lib/monthly-plan-kanban.server.ts:295` (materialização, `client_id` explícito), `src/lib/workspace.functions.ts:450` (seed, com cliente). Trigger `trg_enforce_task_project_client` garante coerência brand/cliente do projeto — mas **não exige** `client_id` quando o projeto é workspace-level.

## 6. Server functions — classificação

| Função / arquivo | Classe | Nota |
|---|---|---|
| `listProjectsFn` / `createProjectFn` (`projects.functions.ts`) | **PARTIAL** | filtra por `brand_id`; escopo por cliente depende só da RLS, e `client_id` nulo é aceito sem exigir papel admin |
| `tasks.functions.ts` (list/create/update/comments/subtasks) | **PARTIAL** | idem; `client_id ?? null` cria linhas workspace-level visíveis a toda a brand |
| `project-jobs.functions.ts` | SAFE | herda `client_id` do projeto; policies via `can_access_project`/`can_access_task` |
| `dashboard.functions.ts` (`computeStats`) | **PARTIAL** | `assertClientInBrand` quando há `clientId`; sem `clientId` agrega **tudo da brand** contando apenas com RLS — e as linhas NULL entram para MANAGER/USER |
| `customer-dashboard.functions.ts` | SAFE | sempre `brand_id + client_id` |
| `client-dashboard.server.ts`, `analytics.functions.ts`, `agency-ops.functions.ts` | **PARTIAL** | agregam por `brand_id`, dependem de RLS |
| `brain/reasoning/tools.server.ts`, `brain/chat-gateway/tools.server.ts` | **PARTIAL** | `scope()` aplica `client_id` quando informado; sem cliente, agrega brand |
| `messaging-kpis.functions.ts` | SAFE | único módulo que usa `assertBrandMember` + `resolveScopedClientIds` |
| `channels-center.functions.ts` | SAFE | valida escopo antes do `supabaseAdmin` |
| `content.functions.ts:1603` | **UNSAFE (integridade, não vazamento)** | insert sem `brand_id`, erro ignorado |

Nenhuma função UNSAFE quanto a vazamento cross-client foi encontrada: a RLS bloqueia leitura client-level indevida. O gap é a **agregação sem `resolveScopedClientIds`** somada ao ramo NULL.

## 7. Dashboards e agregações afetados

- `/dashboard` (`dashboard.functions.ts` → `computeStats`, `getBriefStatsFn`): KPIs de projetos, tarefas e feed de `activity_events` por `brand_id`. MANAGER/USER veem contagens de qualquer registro NULL da brand.
- `analytics.tsx` / `agency-ops`: tarefas por brand.
- Painel do Brain (`brain/reasoning/tools.server.ts`): contagens de tasks/projects por brand quando nenhum cliente está selecionado.
- **Não afetados**: painel do cliente (`customer-dashboard.functions.ts`) e Portal, que sempre fixam `client_id`.

## 8. `supabaseAdmin` / `service_role` / SECURITY DEFINER ligados a essas entidades

| Local | Operação | recebe `clientId` | valida cliente | valida workspace | risco |
|---|---|---|---|---|---|
| `post-agents.server.ts:219,701` | insert `activity_events` | do post | sim (deriva do post) | sim | baixo |
| `channels-center.functions.ts:153` | insert `activity_events` | sim | sim (`assertClientScope`) | sim (`brands` via RLS) | baixo |
| `monthly-plan-kanban.server.ts:271-302` | select/insert/update `tasks` | sim | derivado da pauta | sim | baixo |
| `routes/api/jobs/*` (`customer-pipeline`, `copilot`, `analyze-document`) | insert `activity_events`, leitura de contexto | sim | `guardClientScope` (`http-scope.server.ts`) antes do bypass | sim | baixo |
| `log_task_activity()` (DEFINER) | insert `activity_events` | herda da task | herda | herda | baixo |
| `enforce_task_project_client()` (DEFINER) | validação | — | compara projeto×task | sim | protege |
| `can_access_task/project/client`, `is_brand_member`, `is_agency_operator` (DEFINER, STABLE, `search_path=public`) | autorização | — | — | — | corretas; herdam o furo do ramo NULL |

Nenhum uso de `service_role` grava `projects`/`tasks`/`activity_events` sem derivar o cliente de uma entidade já validada.

## 9. Riscos de segurança

1. **P1 — ramo `client_id IS NULL` em `projects`/`tasks`/`activity_events`**: registro workspace-level é visível/editável por qualquer membro da brand, inclusive MANAGER/USER sem clientes atribuídos. Propaga-se por `can_access_project`/`can_access_task` para subtarefas, comentários, apontamentos de tempo e jobs.
2. **P1 (latente) — criação de linhas NULL pela UI**: `createTaskFn`/`createProjectFn` aceitam `client_id` ausente sem exigir papel ADMIN, permitindo que um USER crie conteúdo visível a toda a brand.
3. **P2 — `activity_events` sem FK para `entity_id`**: eventos ficam órfãos (91 hoje) e não podem ser reclassificados; qualquer correção retroativa por herança é impossível para eles.
4. **P2 — `content.functions.ts:1603`**: evento de auditoria perdido silenciosamente (insert inválido, erro ignorado); ausência de policy de INSERT em `activity_events` também derruba `feature-flags`/`admin-environment` silenciosamente.
5. **P2 — agregações por `brand_id`** sem `resolveScopedClientIds`: dependem 100% de RLS; qualquer regressão de policy vira vazamento numérico imediato.

## 10. Registros que precisam de correção vs. permanecer NULL

- **Corrigir dados: nenhum.** Não existe registro classe B.
- **Permanecer NULL:** os 91 `activity_events` órfãos (classe D).
- O trabalho da 10D.2 é de **enforcement**, não de backfill.

## 11. Proposta objetiva para a Fase 10D.2

1. **Redefinir o ramo NULL** nas policies de `projects`, `tasks` e `activity_events`: trocar `is_brand_member(brand_id)` por um predicado de autoridade de workspace (`app_access_role ∈ (super_admin, admin)`), mantendo `can_access_client` para o ramo client-level. Sem criar novas funções de autorização.
2. **Alinhar a cadeia herdada**: revisar `can_access_project`/`can_access_task` para que `client_id IS NULL` também exija autoridade de workspace, fechando `task_subtasks`, `task_comments`, `task_time_entries`, `project_jobs`.
3. **Enforcement de produtor**: em `createProjectFn`/`createTaskFn`, exigir `clientId` para MANAGER/USER (workspace-level só para ADMIN/SUPER ADMIN), com validação server-side via `assertBrandMember` + `assertClientInBrand`.
4. **Agregações**: aplicar `resolveScopedClientIds` em `dashboard.functions.ts`, `analytics.functions.ts`, `agency-ops.functions.ts` e nas tools do Brain, como defesa em profundidade.
5. **Corrigir o produtor quebrado** `content.functions.ts:1603` (incluir `brand_id`/`client_id` do post e verificar erro) e decidir se `activity_events` recebe policy de INSERT escopada ou se todos os produtores passam por um único helper server-side.
6. **Suíte** `tests/scope-null-10d2.integration.test.ts`: MANAGER/USER não veem projeto/task/evento workspace-level; ADMIN vê; PORTAL/ANON nada; USER não consegue criar linha sem `client_id`.
7. Os 91 eventos legados permanecem NULL e passam a ser invisíveis para MANAGER/USER pelo item 1 — sem migração de dados.

**Auditoria 10D.1 concluída — nenhuma alteração realizada.**
