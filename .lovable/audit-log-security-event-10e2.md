# FASE 10E.2 — Hardening mínimo de `brain_events` (actor_id / created_at / payload)

Escopo estrito: P2 comprovados em 10E.1. Nenhuma nova infraestrutura de auditoria,
nenhum novo mecanismo de RBAC, nenhum dado histórico alterado.
Data: 2026-08-25.

---

## 1. Produtores encontrados

| Caminho | Cliente Supabase | Ator antes | Observação |
| --- | --- | --- | --- |
| `src/lib/brain/event-bus/index.ts` → `publish()` | do contexto (usuário ou admin) | `event.actor_id ?? ctx.userId` | **único INSERT direto** em `brain_events` da plataforma |
| `src/lib/brain/services.ts` → `registerEvent()`/`learn()` | via `publish` | `event.actor_id ?? ctx.userId` | repassava ator do chamador |
| `src/lib/brain/context-engine/provenance.ts` (`context.used`) | via `publish` | `ctx.userId` | já correto |
| `src/lib/chat.functions.ts` (`chat.turn`) e `src/routes/api/chat.stream.ts` (2x) | via `publish` | `context.userId` / `userId` | já correto, mas passava ator explícito |
| `src/routes/api/public/meta/webhook.ts` | `supabaseAdmin` (sistema) | `null` | evento de sistema legítimo |
| `src/lib/brain/ingest-quiet.server.ts` (`brain.ingestQuiet`) | cliente autenticado do caller | não enviava ator | payload cru do chamador |
| Triggers `brain_trg_*` → `emit_brain_event` | `SECURITY DEFINER` / service_role | derivado da linha | inalterado |

Nenhum produtor real precisava enviar ator diferente da própria sessão: os únicos eventos
com ator ≠ sessão são de sistema (webhook/worker via `service_role`, sem `auth.uid()`).

## 2. Alterações efetivamente feitas

Código:
- `src/lib/brain/core/types.ts` — campo `actor_id` **removido** de `BrainEventInput` (não é mais aceitável de chamador).
- `src/lib/brain/event-bus/index.ts` — `actor_id` sempre `ctx.userId || null`; novo `sanitizeEventPayload()` remove chaves de identidade/autoridade do payload.
- `src/lib/brain/ingest-quiet.server.ts` — payload sanitizado no mesmo padrão.
- `src/lib/brain/services.ts`, `src/lib/brain/context-engine/provenance.ts`, `src/lib/chat.functions.ts`, `src/routes/api/chat.stream.ts`, `src/routes/api/public/meta/webhook.ts` — deixam de repassar `actor_id`.

Banco (2 migrations):
- `public.brain_events_guard_identity()` — trigger `BEFORE INSERT` em `public.brain_events`
  (`SECURITY DEFINER`, `search_path = public`, `EXECUTE` revogado de `PUBLIC/anon/authenticated`):
  1. valida estruturalmente o par `brand_id`/`client_id` contra `public.clients` (para qualquer caller);
  2. se `auth.uid()` existe → força `actor_id := auth.uid()` e remove chaves sensíveis do `payload`;
  3. se `auth.uid()` é NULL (service_role/worker) → mantém evento de sistema intacto.
- Policy `brain_events_part_insert` (authenticated) reforçada:
  `client_in_scope(client_id, brand_id) AND (actor_id IS NULL OR actor_id = auth.uid())
   AND created_at BETWEEN now() - 2min AND now() + 2min`.

Nenhuma função canônica de RBAC nova: reutilizados `auth.uid()`, `client_in_scope`,
`can_access_client`, `is_brand_member`, `is_super_admin`.

## 3. Enforcement de `actor_id`

- Aplicação: impossível enviar ator (tipo removido); `publish` deriva da identidade autenticada.
- Banco: trigger sobrescreve para `auth.uid()` + policy rejeita ator divergente (defesa em profundidade,
  cobre também INSERT direto via PostgREST).
- Sistema: apenas contextos **sem sessão** (`service_role`/worker) registram ator nulo/próprio.
- Histórico: nenhuma linha existente foi tocada.

## 4. Enforcement de timestamp

`created_at` é coluna de particionamento — um trigger `BEFORE ROW` não pode reescrevê-la
("moving row to another partition during a BEFORE FOR EACH ROW trigger is not supported").
Portanto o enforcement é feito na policy de INSERT: usuário autenticado só grava com
`created_at` dentro de ±2 min de `now()` (o caminho normal omite a coluna e recebe `DEFAULT now()`).
`service_role`/workers preservam liberdade operacional (backfill/ingest histórico).
Timestamps históricos não foram reescritos.

## 5. Tratamento do payload

Payload legítimo continua livre (não há schema novo). Removidas **apenas** chaves que poderiam
ser reinterpretadas como identidade/autorização, na aplicação e no banco:
`role, roles, app_role, app_roles, access_role, is_super_admin, super_admin, is_admin, actor_id,
actor, auth, auth_uid, uid, claims, jwt, token, tokens, access_token, refresh_token, id_token,
api_key, apikey, authorization, bearer, password, secret, service_role, permissions, scopes,
scope_override, impersonate`.
Eventos de sistema (`service_role`) não sofrem stripping — nenhum consumidor trata payload como
fonte de autoridade, e o stripping evita que isso se torne possível por acidente.

## 6. Matriz por papel (INSERT em `brain_events`)

| Papel | Escopo permitido | Pode definir ator | Ator gravado | Pode falsificar `created_at` |
| --- | --- | --- | --- | --- |
| SUPER ADMIN | global (leitura); escrita conforme membership | não | `auth.uid()` | não |
| ADMIN | workspace selecionado | não | `auth.uid()` | não |
| MANAGER | somente clientes atribuídos | não | `auth.uid()` | não |
| USER | somente clientes atribuídos | não | `auth.uid()` | não |
| PORTAL | nenhum (sem membership de brand) | n/a | n/a | n/a |
| ANON | nenhum (sem grant) | n/a | n/a | n/a |
| service_role / worker | sistema | sim (evento de sistema) | informado/nulo | sim (uso operacional) |

Par `brand_id`/`client_id` inconsistente falha para **todos** os papéis, inclusive service_role.

## 7. Testes

`tests/brain-events-identity-10e2.integration.test.ts` — 14 casos, banco real, sem bypass:
USER/MANAGER/ADMIN não forjam ator (substituído pela identidade real); ator nulo também é
substituído; cliente não atribuído bloqueado (USER e MANAGER); cross-workspace bloqueado;
par brand/client inconsistente bloqueado; portal bloqueado; `created_at` passado e futuro
rejeitados; evento sem `created_at` recebe `now()`; payload de autoridade removido com dados
legítimos preservados; evento de sistema via `service_role` continua funcionando.

Validação: `tsgo -b --noEmit` → 0 erros. Regressão completa `vitest run` → **380/380 passando**
(22 arquivos), sem falhas pré-existentes.

## 8. Riscos residuais

- Escritas `service_role` (workers, cron, `supabaseAdmin`) permanecem não auditadas por natureza
  e mantêm liberdade de ator/timestamp/payload — decisão consciente para não criar nova
  infraestrutura de auditoria nesta fase.
- Continua não existindo trilha de eventos de segurança (`security_events` não foi criada, conforme restrição).
- P3 de 10E.1 em aberto por decisão de escopo: grants mortos `INSERT/UPDATE/DELETE` de
  `authenticated` em `activity_events`.
- Janela de ±2 min em `created_at` permite desvio máximo de 2 minutos em evento de usuário
  (irrelevante para reconstituição de ordem).
- `brain_events_archive` e partições legadas não foram alteradas (histórico intacto).
