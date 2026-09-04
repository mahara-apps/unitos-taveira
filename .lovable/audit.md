# NexusFlow — Auditoria Sênior (2026-07-15 · rev 2)

> Atualizado após correções desta rodada. Sinais: linter, security scan,
> `pg_stat_statements`, Worker logs.

## ✅ Corrigido nesta rodada

- Índices compostos criados em `activity_events (brand_id, created_at DESC)` e `(brand_id, client_id, created_at DESC)`.
- Índice em `ai_jobs (user_id, created_at DESC)` e `brand_members (user_id)`.
- REVOKE EXECUTE em funções administrativas (`has_brand_role`, `is_brand_member`, `is_super_admin`, `accept_brand_invite`, `reap_stuck_ai_jobs`) para `anon`.
- REVOKE EXECUTE em **todas as funções de trigger** (`handle_new_user`, `add_brand_owner`, `log_*`, `notify_*`, `protect_pipeline_delete`, `recalc_*`, `update_updated_at_column`) para `PUBLIC/anon/authenticated`.
- Confirmado: `MandatoryPasswordReset` já usa `staleTime: Infinity`; `useAccessRole` já usa 60s.

## Pendências

- **P0 `SUPABASE_SERVICE_ROLE_KEY`**: prefixo é reservado; deve ser injetado via integração Supabase gerenciada (Lovable Cloud → Project Settings) — não é criável via `add_secret`.
- **P1 `agent_prompts` escopo por brand** — decisão pendente.
- **P1 Leaked Password Protection** — ativar no painel Supabase Auth.
- **P2 Extensões em `public`** (vector/pg_trgm) — mover para schema `extensions`.

---

## Snapshot anterior

---

## Sumário executivo

| Severidade | Aberto | Observações |
| --- | --- | --- |
| P0 | **1** | `SUPABASE_SERVICE_ROLE_KEY` ausente em produção → aprovação pública quebrada |
| P1 | 4 | SECURITY DEFINER expostos, `agent_prompts` multi-tenant, caches faltando, senha vazada |
| P2 | 5 | Extensões em `public`, empty states, PT-BR remanescente, dark badges, mobile |

---

## 🔴 P0 — `SUPABASE_SERVICE_ROLE_KEY` não configurada em produção

- **Evidência (monitoramento, últimas 24h):**
  - 81× `Error: supabaseKey is required.` em `src/routes/api/public/approval.$token.ts`
  - 11× `[Supabase] Missing Supabase environment variable(s): SUPABASE_SERVICE_ROLE_KEY` em `src/integrations/supabase/client.server.ts`
- **Impacto:** endpoint público de aprovação (`/api/public/approval/:token`) — enviado ao cliente por e-mail — está retornando 500 para usuários reais. Qualquer outra rota que use `supabaseAdmin` sofre o mesmo.
- **Ação:** configurar `SUPABASE_SERVICE_ROLE_KEY` como secret do projeto (Lovable Cloud → Secrets). Após redeploy, validar `/api/public/approval/<token>` com um token válido. Também remover o `!` non-null em `createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)` e falhar cedo com mensagem legível.

---

## 🟠 P1 — Segurança

### 1. 27 funções `SECURITY DEFINER` executáveis por `anon`/`authenticated`
- Scanner reporta o mesmo alerta em massa (9× anon, 18× authenticated). A maioria em `anon` é intencional (`portal_*`, `p_briefing_*`, `card_approval_*`), mas funções administrativas (`has_role`, `is_super_admin`, `is_brand_member`, `has_brand_role`, `accept_brand_invite`, `handle_new_user`, `add_brand_owner`, `reap_stuck_ai_jobs`, triggers `log_*`, `notify_task_*`, `protect_pipeline_delete`, `update_updated_at_column`) **não** deveriam ser executáveis por `PUBLIC/anon/authenticated`.
- **Ação:** migração `REVOKE EXECUTE ON FUNCTION public.<fn>(...) FROM PUBLIC, anon` para funções não-portal; para triggers, `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.

### 2. `agent_prompts` legível por qualquer usuário autenticado
- Finding `PUBLIC_USER_DATA` — política `USING (true)` em uma tabela com prompts proprietários.
- **Ação (recomendada):** escopar por `brand_id` (adicionar coluna + política `is_brand_member(auth.uid(), brand_id)`) OU, se prompts forem realmente globais, restringir escrita a super-admin e documentar em `security-memory`.

### 3. Leaked Password Protection desativado
- `SUPA_auth_leaked_password_protection`. Ativar em **Supabase → Authentication → Password Protection**. Não requer código.

### 4. Extensões em `public` (2×)
- Warns `0014_extension_in_public`. Mover `vector` / `pg_trgm` (ou o que estiver ali) para schema dedicado (`extensions`). Baixo impacto, alto ruído no scanner.

---

## ⚡ P1 — Performance (top pg_stat_statements)

| Total ms | Calls | Query |
| --- | --- | --- |
| 2358 | 555 | `activity_events` por `brand_id + client_id` |
| 2194 | 563 | `activity_events` por `brand_id + created_at >= ?` |
| 1976 | **1192** | `brand_members` por `user_id` |
| 1592 | 498 | `posts` por `brand_id + client_id` |
| 1534 | **663** | `user_profiles.requires_password_change` por `id` |

- `brand_members` (1192 chamadas): switcher/permissões executando por render. **Cache global**: `useQuery(['brand-memberships', userId], staleTime: 5min)`.
- `requires_password_change` (663 chamadas): o gate `MandatoryPasswordReset` refaz a query em cada mount de rota. Usar `staleTime: Infinity`, invalidar apenas em `SIGNED_IN`.
- `activity_events`: falta índice composto — `CREATE INDEX ON activity_events (brand_id, created_at DESC)` e `(brand_id, client_id, created_at DESC)`.
- `posts` slim: dashboard traz apenas `id` mas ainda paga 3ms/query — considerar RPC `count_posts_by_client` cacheado por 60s.

> Runtime: última hora de Worker logs sem `error/warn` — infra saudável. Único ruído recente é o P0 acima em janela de 24h.

---

## 🎨 P2 — UX / consistência

- **Empty states** com CTA + ilustração nas listas `customers`, `projects`, `tasks`, `media-plans`.
- **PT-BR remanescente**: `agent-drawer`, `column-config-dialog`, `strategy-editors` ainda têm strings em EN.
- **Dark mode**: badges de estágio agora vindos do DB (cores livres) — validar contraste no dark; fallback para tokens semânticos quando `luminance < X`.
- **Mobile**: sidebar/header ainda não auditados (breakpoint < 768px).
- **Acessibilidade**: rechecar `DialogTitle` visualmente oculto em `command.tsx` (já corrigido) e replicar em modais menores.

---

## Plano de ação sugerido

1. **P0 hoje:** configurar `SUPABASE_SERVICE_ROLE_KEY` no ambiente publicado + validar fluxo de aprovação por token.
2. **P1 esta semana:**
   - migração revogando `EXECUTE` de funções não-portal / de trigger;
   - decisão de escopo em `agent_prompts` (global vs por marca);
   - habilitar leaked-password protection;
   - índices em `activity_events` + caches `brand_members` / `requires_password_change`.
3. **P2 depois:** mover extensões, polir empty states, i18n final, mobile pass.

---

## Histórico (auditoria anterior)


Escopo priorizado pelo usuário: **Runtime & erros · Performance · UX / consistência · Segurança**. Formato: relatório primeiro, correção depois. Cada item traz **severidade**, **evidência** e **ação recomendada**.

Legenda: `P0` bloqueia usuário · `P1` degrada experiência/segurança · `P2` polimento.

---

## 1. Runtime & erros

### P0 — Realtime: `postgres_changes` registrado depois de `subscribe()`
- **Evidência (console):** `cannot add "postgres_changes" callbacks for realtime:notif:<uid> after "subscribe()".` disparado em `src/components/notifications/notifications-drawer.tsx:112`.
- **Causa:** o `.on(...)` é encadeado dentro de `supabase.auth.getUser().then(...)` — a Promise resolve **após** o React commit; o efeito também pode remontar (StrictMode / re-render) e reatar um listener num canal já assinado.
- **Impacto:** notificações em tempo real param de chegar após o primeiro erro; ruído no rastreio de erros do usuário.
- **Ação:** obter `userId` de forma síncrona (usar sessão já carregada / hook `useAuth`), criar canal e `.on(...).subscribe()` numa única transação, e garantir cleanup com `supabase.removeChannel(channel)`.

### P1 — TanStack Router: `Cannot read properties of undefined (reading '_nonReactive')`
- **Evidência:** `RouterCore.preloadRoute` em `@tanstack_router-core.js`. Dispara em navegação hover (`defaultPreload: "intent"`).
- **Causa provável:** rota com `loader` que retorna `undefined` / objeto sem shape esperado, ou `queryClient` context não injetado no preload path (loader chamando `context.queryClient.ensureQueryData` numa rota que não recebe context).
- **Ação:** auditar rotas com prefetch on-intent; garantir todo loader `return`-ar objeto serializável ou `null`, nunca `undefined`.

### P1 — Acessibilidade: `DialogContent` sem `DialogTitle` / `Description`
- **Evidência:** dois erros Radix repetidos após abrir menus/command palette.
- **Local:** `CommandDialog` em `src/components/ui/command.tsx` não injeta `DialogTitle`/`Description` invisíveis; o único consumidor (`src/components/command-menu.tsx`) também não define.
- **Ação:** dentro do `CommandDialog`, adicionar `VisuallyHidden` com `<DialogTitle>Comandos</DialogTitle>` e `<DialogDescription>` — resolve todos os call sites de uma vez.

### P2 — Ruído no console
- `Unknown message type: RESET_BLANK_CHECK` — origem `cdn.gpteng.co/lovable.js` (harness). Ignorar.

---

## 2. Segurança

Scan Supabase: **29 findings** (1 ERROR, 28 warn).

### P0 — Storage policy quebrada em `brand-assets` / `brand-documents`
- **Finding:** `STORAGE_POLICY_LOGIC_BROKEN` — `portal_anon_read_brand_assets` **não correlaciona** `storage.objects.name` ao caminho do cliente. Qualquer token de portal válido concede leitura anônima a **qualquer arquivo** dos buckets.
- **Ação (migração):** reescrever a policy comparando `storage.foldername(name)[1]` (ou padrão `client_id/...`) ao `client_id` resolvido via `portal_tokens`. Reduzir para SELECT-only e escopar por caminho.

### P1 — `agent_prompts` legível por qualquer usuário autenticado
- **Finding:** `PUBLIC_USER_DATA` — policy `agent_prompts_authenticated_read USING (true)`.
- **Decisão pendente:** prompts globais compartilhados **ou** por brand?
  - Se globais: aceitar risco e documentar em `mem://` / security-memory.
  - Se sensíveis: escopar por `brand_id` (add coluna + policy `is_brand_member`).

### P1 — 27 funções `SECURITY DEFINER` executáveis por `anon`/`authenticated`
- 9 públicas (`anon`): a maioria são as `portal_*` — **precisam** ficar acessíveis a `anon` porque o portal white-label não tem sessão. Ação: revogar apenas as **não-portal** de `anon` (ex.: `has_role`, `has_brand_role`, `is_brand_member`, `is_super_admin`, `reap_stuck_ai_jobs`, `accept_brand_invite`, `handle_new_user`, `notify_task_*`, `log_*_activity`, triggers).
- 18 `authenticated`: revisar caso a caso. Triggers (`log_*`, `notify_*`, `add_brand_owner`, `handle_new_user`, `protect_pipeline_delete`, `update_updated_at_column`) **não** precisam de EXECUTE por role — só o dono. Revogar EXECUTE de `PUBLIC`, `anon`, `authenticated` para funções de trigger.

### P2 — Proteção contra senhas vazadas desativada
- `SUPA_auth_leaked_password_protection`. Ativar em Supabase Auth → Password Protection.

---

## 3. Performance

### Top queries (pg_stat_statements — últimas 24h)
| Total ms | Calls | Query |
|---|---|---|
| 1438 | 430 | `activity_events` por `brand_id` + `created_at >= ?` |
| 1293 | 874 | `brand_members` por `user_id` |
| 1038 | 400 | `activity_events` por `brand_id + client_id` |
| 1003 | 411 | `user_profiles.requires_password_change` |
| 990 | 365 | `posts.id` por `brand_id + client_id` |
| 935 | 660 | listagem `clients` por `brand_id` |
| 797 | 387 | `posts` por `brand_id + client_id` (dashboard) |
| 781 | 874 | `brand_briefings` por brand + client IN (...) |
| 604 | 533 | `ai_jobs` por `user_id` ORDER BY created_at |

### Observações & ações
- **P1 — `user_profiles.requires_password_change` 411 chamadas:** o gate `MandatoryPasswordReset` refaz a query a cada mount/rota. Cachear via `useQuery` com `staleTime: Infinity` (invalidar só ao trocar de sessão).
- **P1 — `brand_members` 874 chamadas:** switcher/permissions lê a cada render. Consolidar num `useQuery` global (`['brand-memberships']`, `staleTime: 5min`).
- **P1 — `activity_events` acumula 3s+:** falta índice composto `(brand_id, created_at DESC)` e `(brand_id, client_id, created_at DESC)`. Ação: `CREATE INDEX` via migração.
- **P1 — `ai_jobs` por user 600ms:** índice `(user_id, created_at DESC)`.
- **P2 — payloads inflados:** `clients` list traz 15 colunas (inclusive `palette`, `socials`, `tone_of_voice`) só pro switcher. Criar view/`select` slim para sidebar.
- **P2 — `brand_briefings` só pra saber "tem briefing?"** — 874 chamadas. Cachear ou materializar `has_briefing boolean` em `clients`.

### Front-end
- `defaultPreload: "intent"` ativo — bom, mas o TypeError acima está gerando preloads perdidos. Corrigir loaders (item runtime).
- Realtime: 3 arquivos usam `supabase.channel`. Todos devem ter `removeChannel` no cleanup (verificar `use-realtime-invalidate.tsx` e `ai-jobs-provider.tsx`).

---

## 4. UX / consistência

### P1
- **Acessibilidade global de diálogos:** consequência do item runtime — telas com command palette e alguns modais quebram leitor de tela.
- **PT-BR incompleto:** o audit anterior localizou o dashboard, mas ainda há strings inglesas em modais menos usados (verificar `agent-drawer`, `column-config-dialog`, `strategy-editors`).
- **Header dinâmico:** confirmar que todas as rotas registram título/subtítulo via `PageHeaderProvider`; rotas de settings ainda usam heading local em alguns lugares.

### P2
- **Estados vazios:** listas (`customers`, `projects`, `tasks`) precisam de empty-state com CTA + ilustração leve, não apenas "nenhum item".
- **Skeletons:** rotas de detalhe do cliente já usam Suspense — validar que analytics e connections também têm fallback.
- **Dark mode:** revisar contraste dos badges de estágio dinâmicos (agora vindos do DB — cores livres podem ficar ilegíveis no dark).
- **Mobile:** sidebar/header não foi auditado; solicitação futura.

---

## Plano de correção sugerido (ordem)

1. **P0 realtime notifications** — 10 min, arquivo único.
2. **P0 storage policy portal** — migração + teste anon.
3. **P1 CommandDialog a11y** — patch em `ui/command.tsx`.
4. **P1 TanStack preload TypeError** — reproduzir e corrigir loader ofensor.
5. **P1 Índices Postgres** (`activity_events`, `ai_jobs`) + `staleTime` no `requires_password_change` e `brand_members`.
6. **P1 SECURITY DEFINER hardening** (revogar EXECUTE de funções de trigger e non-portal).
7. **P1 `agent_prompts` decisão de escopo** (perguntar antes).
8. **P2 senha vazada, empty states, PT-BR remanescente, dark-mode badges.**

Quer que eu comece pelos P0/P1 nessa ordem, ou reordenar?