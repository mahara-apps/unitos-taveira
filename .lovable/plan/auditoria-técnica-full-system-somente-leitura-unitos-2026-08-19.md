# Auditoria Técnica Full-System (somente leitura) — Unitos

Baseline validado neste turno: typecheck `tsgo` **exit 0**; testes **147/147 passando** (9 arquivos); `bun run lint` **falha** (10.533 problemas). Banco: RLS habilitada em todas as tabelas de `public`, nenhuma função SECURITY DEFINER sem `search_path`, nenhuma policy concedida a `anon`. RBAC no banco já está no formato Super Admin / Admin (owner) / Manager / User — nenhum resquício de `editor`/`designer` em dados.

Saúde geral: **7,0 / 10** (fundação de segurança boa; problemas concentrados em endpoints públicos de cron, um bug de hooks e higiene de código/lint).

---

## 1. Achados por severidade

### CRÍTICO

**C1 — Rota de seed de super admins ainda publicada**
`src/routes/api/public/seed-superadmins.ts`. Endpoint público que cria/reseta usuários com `supabaseAdmin.auth.admin.createUser` e marca super admin, protegido apenas por `x-seed-token` = `SUPERADMIN_APITADA_PASSWORD`. O próprio comentário diz "rota descartável — removida logo após o seed", mas ela permanece no bundle do servidor. Impacto: superfície de escalada de privilégio global e de reset de senha do super admin. Recomendação: remover o arquivo e o secret associado; se necessário, refazer o seed por migration/console.

**C2 — Endpoints privilegiados de cron autenticados pela chave publicável**
`src/routes/api/public/cron/sla-check.ts`, `hooks/ai-models-health.ts`, `hooks/brain-consolidate.ts`, `hooks/brain-synthesis.ts`, `hooks/resume-post-content.ts`, `hooks/social-metrics-sync.ts`, `media/prune.ts`, `meta/publish-scheduled.ts`. Todos comparam o header `apikey` com `SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_ANON_KEY`. Essa chave é pública (vai no bundle do browser), portanto o gate é equivalente a "sem autenticação". Impacto: qualquer terceiro pode disparar publicação de posts agendados, consumo de IA (custo), sincronização de métricas, poda de mídia e criação em massa de notificações. Recomendação: gate por secret dedicado (ex.: `CRON_SECRET`) com comparação de tempo constante, e atualizar as chamadas do `pg_cron`. Correção única, compartilhada por todos os endpoints.

### ALTO

**A1 — Violação de ordem de hooks em `/connections` (14 erros de lint, bug real)**
`src/routes/_authenticated/connections.tsx:233-238`: `if (isReady && role !== "admin") return <Navigate .../>` aparece **antes** de `useState`/`useEffect`/`useQuery`/`useMutation`. Como `isReady` começa `false` e depois vira `true`, o React renderiza a primeira passagem com todos os hooks e a segunda com nenhum → "Rendered fewer hooks than expected", tela branca para usuários não-admin. Recomendação: mover o gate para `beforeLoad` da rota ou renderizar o `Navigate` no fim do componente, depois de todos os hooks.

**A2 — Portal client herda leitura de `clients` no contexto interno**
`public.can_access_client_row` retorna `true` para qualquer `client_members.role = 'portal_client'` **antes** de exigir vínculo em `brand_members`. As policies internas de `clients`, `posts`, `tasks` etc. usam essa função, então um usuário do Portal com token de sessão válido pode ler linhas internas (incluindo colunas comerciais de `clients`) via API direta, mesmo sendo redirecionado na UI. Recomendação: separar a decisão de escopo do Portal (`_portal_session_user`) da decisão interna, ou restringir o ramo `portal_client` às policies/colunas do Portal.

**A3 — 36 de 40 clientes sem `owner_user_id`, com apenas 14 vínculos `client_members.role='user'`**
Depois da remoção correta do fallback "cliente sem responsável", o papel USER só alcança clientes próprios ou vinculados. Na base atual a maioria dos clientes não tem responsável nem vínculo → USERs veem listas vazias e vão reportar isso como bug de carregamento. Não é falha de segurança: é lacuna de dados/operação. Recomendação: exigir responsável no wizard de cliente, backfill de `owner_user_id` e um estado vazio explicativo ("nenhum cliente atribuído a você").

**A4 — Lint quebrado impede uso como rede de proteção**
10.413 erros, sendo 10.323 de `prettier/prettier`. Os erros reais (14 rules-of-hooks, 68 `no-explicit-any`, 40 `exhaustive-deps`) ficam soterrados. Recomendação: rodar `prettier --write` em uma passada mecânica isolada, corrigir os erros reais e só então tratar lint como gate.

### MÉDIO

**M1 — Dead code confirmado (~2.5k linhas sem nenhum importador)**
`components/connections/connected-channels-section.tsx` (518), `components/connections/meta-integration-card.tsx` (343), `components/calendar/pending-schedule-panel.tsx` (327), `components/brain/neural-network-canvas.tsx` (314), `lib/social-connections.functions.ts` (189), `lib/social-core/api.functions.ts` (189), `lib/channels-kpis.functions.ts` (157), `lib/copilot-inline.functions.ts` (99), `lib/publications.functions.ts` (85), `lib/meta/publish-readiness.server.ts` (73), `components/brand-hub/brand-hub.tsx` (70), `lib/ai-gateway.server.ts` (62), `components/dashboard/client-health-panel.tsx` (60), `components/ai-jobs/ai-jobs-dock.tsx` (57), `hooks/use-realtime-invalidate.tsx` (28). Risco maior: `*.functions.ts` órfãos continuam expondo endpoints RPC de servidor mesmo sem UI.

**M2 — Duplicidade nos módulos de canais/publicação**
Coexistem `social-connections.functions.ts` (órfão), `connections.functions.ts`, `client-channels.functions.ts`, `channels-center.functions.ts`, `channels-kpis.functions.ts` (órfão) e `publications.functions.ts` (órfão) + `placements.functions.ts`. Duas leituras de "canais do cliente" com regras de exclusividade divergentes é fonte histórica dos bugs de vínculo Meta. Recomendação: consolidar em `channels-center` + `client-channels` e apagar o resto.

**M3 — `my_access` avalia `can_access_client` por linha de `clients`**
`public.my_access` roda a função plpgsql SECURITY DEFINER para cada cliente da marca, e `useAccessRole` a chama a cada troca de marca. Custo cresce linearmente com a carteira. Recomendação: reescrever em SQL puro com um único `EXISTS` sobre `brand_members`/`client_members`.

**M4 — FKs sem índice (dezenas)**
Ex.: `activity_events.client_id`, `ai_jobs.client_id`, `brain_memory.client_id`, `calendar_events.client_id`, `brand_ai_content.brand_id`, `client_social_accounts.brand_id`. Impacto: varreduras sequenciais nas telas filtradas por cliente e cascatas de delete lentas. Recomendação: criar índices para as FKs efetivamente filtradas na UI (client_id/brand_id primeiro), não todas de uma vez.

**M5 — Waterfall e consulta redundante na aprovação pública**
`src/routes/api/public/approval.$token.ts`: `token → posts → (subconsulta extra em posts só para client_id) → clients`, com o `client_id` sendo buscado numa segunda query aninhada dentro do `.eq()`. Recomendação: um único select com `client_id` embutido e join do cliente.

**M6 — `*.functions.ts` com helpers em escopo de módulo**
`social-analytics/brand-dashboard.functions.ts` (8), `team.functions.ts`, `team-admin.functions.ts`, `logs.functions.ts`, `dashboard.functions.ts`, `analytics.functions.ts`, `agency-content.functions.ts`. O split de server functions pode remover os irmãos em runtime → `ReferenceError` que o typecheck não pega. Recomendação: mover helpers para `*.server.ts` importados.

**M7 — Arquivos grandes demais para manutenção segura**
`content/task-dialog.tsx` (2.021), `calendar/schedule-wizard/index.tsx` (1.884), `brand-hub/briefing-workspace.tsx` (1.734), `connections/channels-center.tsx` (1.731), `lib/content.functions.ts` (1.569), `api/jobs/customer-pipeline.ts` (1.203).

### BAIXO

- **B1** — Mensagem de erro de `client.server.ts` cita `SB_SERVICE_ROLE_KEY` mas o ambiente atual provê `SUPABASE_SERVICE_ROLE_KEY`; o fallback funciona, o log engana o diagnóstico.
- **B2** — `src/lib/permissions.ts` mantém `PermissionId`/`ALL_PERMISSION_IDS` inertes (sem enforcement) e `resolveAccessRole` paralelo a `app_access_role`; risco de alguém voltar a tratá-los como fonte de verdade.
- **B3** — `console.log/debug` residuais (9 ocorrências) em caminhos de servidor.
- **B4** — Tabelas com RLS e zero policies (`meta_compliance_events`, `portal_rate_limit`, partições `brain_events_*`): comportamento correto (deny-all + service role), mas merece comentário/documentação para não ser "corrigido" por engano.
- **B5** — `src/integrations/supabase/types.ts` ainda declara `editor`/`designer` no enum `app_role` (valores existem no banco, apenas sem uso). Aceitável; só não devem reaparecer na UI.

---

## 2. Top 10 prioridades

1. Remover `api/public/seed-superadmins.ts` (C1).
2. Trocar o gate `apikey` dos 8 endpoints de cron/hooks por secret dedicado (C2).
3. Corrigir a ordem de hooks em `/connections` (A1).
4. Fechar o vazamento de leitura interna para `portal_client` em `can_access_client_row` (A2).
5. Backfill/obrigatoriedade de responsável em clientes + estado vazio para USER (A3).
6. Passada de formatação + zerar `rules-of-hooks` e reduzir `any` (A4).
7. Apagar os 15 arquivos órfãos, priorizando os `*.functions.ts` (M1).
8. Consolidar os módulos duplicados de canais/publicações (M2).
9. Índices nas FKs `client_id`/`brand_id` mais usadas (M4).
10. Reescrever `my_access` sem chamada por linha (M3).

---

## 3. Mapa de dead code / duplicidades

- **Órfãos (remover):** lista completa em M1.
- **Duplicidade canais/publicação:** M2.
- **Duplicidade de resolução de papel:** `lib/permissions.ts:resolveAccessRole` (string local) vs `lib/access-guard.ts` + `app_access_role` (fonte real). Manter apenas o segundo; o primeiro só como rótulo de UI.
- **Duplicidade de acesso admin:** `is_brand_admin_level`, `has_brand_role`, `assertBrandAdmin`, `assertAdminAuthority` — coerentes hoje (todas derivam de `app_access_role`), mas quatro portas de entrada para a mesma regra.

## 4. Riscos de segurança / multi-tenant / RBAC

- Escalada de privilégio via seed público (C1) e execução não autenticada de jobs privilegiados (C2) são os únicos riscos com caminho de exploração direto.
- Multi-tenant no banco está sólido: RLS em todas as tabelas, zero policy para `anon`, todas as SECURITY DEFINER com `search_path` fixo, `can_access_client_row` sem o antigo fallback de cliente órfão.
- Única brecha de isolamento encontrada: papel de Portal atravessando policies internas (A2).
- Service role: 33 arquivos referenciam `client.server`, sempre por `await import(...)` dentro de handler — nenhum import em escopo de módulo de rota ou `*.functions.ts`. Correto.

## 5. Comparação com o estado recentemente validado (Portal / RBAC / login)

- **RBAC — convergente.** `app_access_role` mapeia owner→admin, manager→manager, resto→user; `client_members.role='portal_client'` é o único caminho de cliente. Dados legados zerados: 0 `editor`/`designer` em `brand_members`, `brand_invites` e `user_profiles`. `brand_members.is_active` é respeitado em `app_access_role`, `can_access_client_row` e `my_access`. Nenhuma referência a Editor/Designer no código de UI (só o enum gerado e uma string de prompt de IA).
- **Portal — convergente com uma divergência.** `portal-scope.server.ts` continua exigindo `clientId` explícito e `hasServiceKey()` degrada sem quebrar. A divergência é A2: a validação anterior cobriu o Portal por rota/token, não o acesso do usuário-portal às policies internas.
- **Login — convergente.** Sem fluxo de criação de conta; `start.ts` mantém refresh proativo do bearer e limpeza de sessão inválida.
- **Regressão de dados, não de código:** a remoção do fallback de cliente órfão (correta) ficou sem o backfill de `owner_user_id` (A3).

## 6. O que está correto e não deve ser mexido

- Postura de RLS/SECURITY DEFINER do banco e as funções canônicas `app_access_role` / `can_access_client` / `is_brand_admin_level`.
- Padrão de acesso ao service role via `await import` dentro do handler + proxy lazy em `client.server.ts`.
- Middleware `attachSupabaseAuth` em `src/start.ts` (refresh proativo + limpeza de sessão) e o gate `_authenticated/route.tsx` com `ssr: false`.
- Reserva concorrente de publicação (`claim_scheduled_social_posts` + `FOR UPDATE SKIP LOCKED`) e o trigger `sync_post_publication_state`.
- Verificação de assinatura HMAC nos webhooks Meta (`meta/webhook.ts`, `data-deletion.ts`) — este é o padrão que os endpoints de cron deveriam seguir.
- Suíte de 147 testes (RBAC, portal-hardening, task-hierarchy, settings-hardening) e o padrão `PageKpi`/`PageKpiGrid`.

## 7. Plano de correção por fases (para aprovação futura)

- **Fase 1 — Segurança de endpoints (sem risco de UI):** C1, C2.
- **Fase 2 — Bugs visíveis:** A1, A3 (backfill + estado vazio), M5.
- **Fase 3 — Isolamento:** A2, com teste de regressão em `portal-hardening`.
- **Fase 4 — Higiene:** A4 (formatação + hooks + `any`), M1, M2, B1–B3.
- **Fase 5 — Performance:** M3, M4.
- **Fase 6 — Estrutura:** M6, M7 (quebra dos arquivos grandes, sem mudança de comportamento).

Nenhuma mudança de infraestrutura e nenhum Control Plane foi considerado. Este documento é somente leitura: nada foi alterado no projeto.
