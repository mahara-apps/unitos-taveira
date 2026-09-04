# FASE 10E.1 — Auditoria read-only de `public.log_security_event` e `logs.functions.ts`

Somente leitura. Nenhuma alteração de código, banco, RLS, grants ou UI.
Data: 2026-08-25.

---

## 0. Conclusão principal (antecipada)

**`public.log_security_event` NÃO EXISTE** — nem no banco conectado (`tkjbhttylouamqxnbfgv`), nem no repositório.

Evidências:

- `pg_proc` + `pg_namespace`: `proname LIKE '%log_security_event%'` → 0 linhas.
- Busca por funções/tabelas/views com nome contendo `security|audit`: apenas
  `pg_catalog.row_security_active` e `auth.audit_log_entries` (tabela interna do Supabase Auth).
- `rg "log_security_event"` em todo o repositório (incluindo `supabase/`, `src/`, `docs/`, `.lovable/`) → 0 ocorrências.
- `rg "security_event|log_security"` em `supabase/`, `src/`, `docs/`, `.lovable/` → 0 ocorrências.

Portanto o risco levantado ("função sensível preservada, executável por authenticated,
aceitando `actor_id`/`brand_id`/`client_id` do chamador") **não se materializa**: não há
superfície de execução, não há grants, não há consumidores, não há tabela de destino própria.
O item deve ser tratado como **referência obsoleta na auditoria anterior** (P3 documental).

Para fechar o diagnóstico com utilidade, esta auditoria estendeu o escopo *em leitura* às
superfícies de auditoria que efetivamente existem hoje: `logs.functions.ts` (leitura),
`activity_events`, `notifications`, `ai_jobs`, `brain_events` e `emit_brain_event` (escrita).

---

## 1. Definição da função

Não aplicável — a função não existe. Não há argumentos, `RETURNS`, `SECURITY DEFINER/INVOKER`,
`search_path`, owner, dependências ou triggers a inspecionar.

## 2. Grants e superfície de execução

Nenhum grant `EXECUTE` existe para `anon`, `authenticated` ou `service_role` (objeto ausente).

Funções canônicas realmente expostas (para referência da próxima etapa):

| Função | EXECUTE |
| --- | --- |
| `app_access_role(uuid,uuid)` | postgres, authenticated, service_role |
| `is_super_admin()` / `is_super_admin(uuid)` | postgres, authenticated, service_role |
| `can_access_client(uuid,uuid)` | postgres, authenticated, service_role |
| `client_in_scope(uuid,uuid)` | postgres, authenticated, service_role |
| `emit_brain_event(12 args, incl. `p_actor_id`)` | **postgres, service_role apenas** (sem `authenticated`) |

`emit_brain_event` é o único ponto que se aproxima do risco descrito (aceita `p_actor_id`,
`p_brand_id`, `p_client_id` do chamador), mas **não é executável por `authenticated`/`anon`** —
só por service_role/servidor. Correto.

## 3. Tabela(s) de destino e RLS

Não há tabela de destino de `log_security_event`. Estado das tabelas de auditoria existentes:

| Tabela | RLS | Grants `anon` | Grants `authenticated` | Policies |
| --- | --- | --- | --- | --- |
| `activity_events` | ON | nenhum | SELECT/INSERT/UPDATE/DELETE (grant), mas **só existe policy de SELECT** → escrita bloqueada por RLS | SELECT: `client_id IS NULL` → `app_access_role ∈ (super_admin, admin)`; senão `can_access_client(client_id, auth.uid())` |
| `notifications` | ON | nenhum | SELECT/INSERT/UPDATE | SELECT/UPDATE: `user_id = auth.uid()`; INSERT: `user_id = auth.uid() AND is_brand_member(brand_id, auth.uid())`; super admin ALL |
| `ai_jobs` | ON | nenhum | CRUD | leitura/escrita presas a `client_in_scope(client_id, brand_id)` + `user_id = auth.uid()`; super admin ALL |
| `brain_events` (particionada) | ON | nenhum | CRUD | INSERT: `client_in_scope(client_id, brand_id)`; SELECT: super admin OU `client_in_scope` |
| `message_logs` | ON | nenhum | conforme 10B/10C | insert exige `client_in_scope`, ou NULL + `app_access_role = admin` |
| `brain_worker_runs` | ON | nenhum | — | SELECT só super admin |

`activity_events.created_at` tem `DEFAULT now()` e `NOT NULL`, porém a coluna é aceita em
`INSERT` — relevante apenas para o caminho service_role (ver §8, P2).

## 4. Consumidores

### 4.1 De `log_security_event`
**Nenhum.** Zero ocorrências em server functions, rotas API (`src/routes/api/**`), loaders/actions,
workers, webhooks, cron (`src/routes/api/public/cron/*`, `hooks/*`), triggers/RPCs no banco
(nenhuma função referencia o nome) e nenhuma chamada SQL direta.

### 4.2 De `src/lib/logs.functions.ts`
Único export: `listSystemLogs` (**apenas leitura**, `createServerFn({ method: "POST" })`).

| Aspecto | Estado |
| --- | --- |
| Consumidor | `src/components/system-logs/log-viewer.tsx` (via `useServerFn`), usado por `/settings/logs` e pelo Centro de IA |
| Autenticação | `.middleware([requireSupabaseAuth])` — client Supabase do usuário, RLS ativa |
| Autoridade | `if (!data.brandId) return []` + `assertAdminAuthority(supabase, userId, brandId)` |
| `brandId` do frontend | não confiável por si — revalidado contra `brand_members` (`memberBrandIds.includes(brandId)`) antes de qualquer consulta |
| Cliente | `clientId` opcional apenas como filtro adicional; isolamento real vem da RLS |
| Escrita | **nenhuma** — a função não insere nada em lugar algum |
| service_role | não usado |
| MANAGER/USER | bloqueados por `assertAdminAuthority` |

Não há, em `logs.functions.ts`, qualquer produtor de auditoria — logo nenhum vetor de forjamento
por esse arquivo.

### 4.3 Produtores de auditoria existentes (contexto)
- `src/lib/content.functions.ts` (`media_generated`): escreve `activity_events` via `supabaseAdmin`,
  com `brand_id`/`client_id` **derivados do post já lido sob RLS** e `actor_id = context.userId`. Seguro.
- Triggers `brain_trg_*` (SECURITY DEFINER) → `emit_brain_event`: escopo derivado da linha
  modificada, não do payload do chamador. Seguro.
- `src/lib/messaging-log.server.ts` (10C.2): escopo explícito + `assertBrandMember`/`assertClientInBrand`.

## 5. Fluxo dos IDs e contexto

Sem `log_security_event`, não existe caminho em que `actor_id`, `brand_id`, `client_id`, ação,
entidade, timestamp, IP ou user-agent sejam aceitos crus de um chamador `authenticated`.
Os produtores atuais derivam o escopo de uma entidade previamente validada (post, task, project,
row do trigger) ou exigem declaração explícita já validada no servidor.

## 6. Matriz de capacidade (escrita de auditoria)

| Papel | `log_security_event` | `emit_brain_event` | INSERT `activity_events` | INSERT `brain_events` | Leitura `listSystemLogs` |
| --- | --- | --- | --- | --- | --- |
| SUPER ADMIN | n/a | não (só service_role) | não (sem policy) | sim, dentro de escopo | sim |
| ADMIN | n/a | não | não | sim, no escopo do workspace | sim (workspace selecionado) |
| MANAGER | n/a | não | não | só clientes atribuídos | **não** |
| USER | n/a | não | não | só clientes atribuídos | **não** |
| PORTAL | n/a | não | não | não (sem membership) | não |
| ANON | n/a | não | não (sem grant) | não (sem grant) | não (middleware 401) |
| service_role (servidor) | n/a | sim | sim | sim | — |

## 7. Cenários de escalada analisados

Nenhuma mutação foi executada. Análise estática + inspeção de policies/grants.

| # | Cenário | Resultado | Execução |
| --- | --- | --- | --- |
| A | USER forja `actor_id` de outro usuário | **Não aplicável** — função ausente; `activity_events` sem policy de INSERT | não executado |
| B | USER forja `brand_id` de outro workspace | Não aplicável; nas superfícies reais, `client_in_scope`/`is_brand_member` barram | não executado |
| C | USER usa `client_id` não atribuído | Não aplicável; `client_in_scope` barra em `brain_events`/`ai_jobs`/`message_logs` | não executado |
| D | MANAGER registra para cliente não atribuído | Idem C — MANAGER não tem escopo ampliado (10D) | não executado |
| E | Mistura brand A + client B | `client_in_scope(client_id, brand_id)` valida o par; `message_logs` tem trigger de guarda | não executado |
| F | Evento client-scoped sem `client_id` | Em `activity_events`, NULL só é **legível** por admin/super admin (10D.2); escrita só via servidor com ID derivado | não executado |
| G | ADMIN registra evento no workspace | Possível apenas via produtores servidor-side; leitura garantida | não executado |
| H | SUPER ADMIN capacidade global | Preservada por `is_super_admin` nas policies e via service_role | não executado |
| I | Portal/anon escreve auditoria | Sem grants para `anon`; portal opera por RPCs de token dedicadas | não executado |

## 8. Riscos classificados

**P0 — nenhum.**

**P1 — nenhum.** Não há função de auditoria executável por `authenticated` que aceite
identificadores do chamador. `emit_brain_event` (o único candidato) não tem `EXECUTE` para
`authenticated`/`anon`.

**P2 — integridade/observabilidade**
1. **Não existe trilha de eventos de segurança.** Não há registro de login/logout, falha de
   autorização, uso de bypass de feature flag, escrita com service_role ou ação de SUPER ADMIN
   em workspace alheio. A auditoria hoje é funcional (`activity_events`, `ai_jobs`,
   `notifications`), não de segurança. A referência a `log_security_event` em auditorias
   anteriores criava a falsa impressão de que essa trilha existia.
2. **`brain_events` aceita `actor_id` arbitrário no INSERT direto por `authenticated`** — a policy
   valida escopo (`client_in_scope`) mas não `actor_id = auth.uid()`. Impacto restrito ao próprio
   escopo do usuário (não é cross-tenant), mas permite atribuir um evento a outro membro do
   mesmo cliente.
3. **`created_at` e `payload` são livres nos INSERTs permitidos** (`brain_events`, `ai_jobs`,
   `notifications`): timestamp e conteúdo podem ser manipulados pelo chamador dentro do escopo,
   sem restrição de tamanho ou de campos sensíveis. Nenhuma proteção anti-replay/dedupe além do
   `dedupe_key` de `notifications`.

**P3 — melhorias menores**
4. `activity_events` mantém grants `INSERT/UPDATE/DELETE` para `authenticated` sem policies
   correspondentes — inofensivo hoje (RLS nega), mas é privilégio morto e frágil a uma policy
   futura permissiva.
5. Documentação: remover `log_security_event` das listas de "dependências sensíveis preservadas"
   nos relatórios anteriores, para não perpetuar um risco inexistente.

## 9. Correção mínima recomendada para 10E.2 (não implementada)

1. **Fechar o item formalmente**: registrar que `log_security_event` não existe; ajustar as
   auditorias que a citam.
2. **Se — e somente se — houver decisão de criar a trilha de segurança**, o desenho mínimo:
   - tabela `public.security_events` (append-only), sem grants para `anon`, sem `UPDATE`/`DELETE`
     para `authenticated`, `created_at DEFAULT now()` **não aceito do chamador**;
   - escrita exclusivamente por servidor (`supabaseAdmin`) ou por função
     `SECURITY DEFINER` com `search_path = public` que **ignore qualquer `actor_id` recebido** e
     use `auth.uid()`, validando o par workspace→cliente com `client_in_scope`/`can_access_client`
     e a autoridade com `app_access_role`/`is_super_admin`;
   - leitura via policy: `client_id IS NULL` → `app_access_role ∈ (super_admin, admin)`;
     caso contrário `can_access_client` (mesmo padrão consolidado em 10D.2);
   - se exposta a `authenticated`, `EXECUTE` restrito e sem parâmetro de ator/timestamp.
3. **P2.2**: acrescentar `actor_id = auth.uid()` (ou `actor_id IS NULL`) ao `WITH CHECK` de
   `brain_events_part_insert`.
4. **P3.4**: revogar `INSERT/UPDATE/DELETE` de `authenticated` em `activity_events`.

Nenhuma nova função canônica de RBAC deve ser criada: reutilizar `auth.uid()`,
`app_access_role`, `is_super_admin`, `can_access_client`, `client_in_scope`,
`assertBrandMember`, `assertClientInBrand`.

## 10. Riscos residuais

- Ausência de trilha de segurança permanece: incidentes de acesso indevido não são reconstituíveis
  por dados da aplicação (apenas `auth.audit_log_entries` do Supabase, retenção limitada).
- Escritas via `service_role` (workers, cron, `supabaseAdmin`) não são auditadas por natureza —
  a correção depende de instrumentação explícita, não de RLS.
- `brain_events` permite atribuição de ator dentro do mesmo escopo até que P2.2 seja aplicado.
- Os 91 registros legados de `activity_events` com `client_id NULL` (10D.1) permanecem intactos e
  visíveis apenas a ADMIN/SUPER ADMIN.
