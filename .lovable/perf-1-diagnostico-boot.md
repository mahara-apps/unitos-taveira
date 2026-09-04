# PERFORMANCE 1 — Diagnóstico do boot e dashboard inicial (READ-ONLY)

Nenhuma alteração de código, banco ou UI foi feita nesta etapa.

## Sequência real do boot (pós-login)

1. `__root.tsx` monta e registra `supabase.auth.onAuthStateChange`. Em `SIGNED_IN`
   chama `resetIdentityState(queryClient)` → `queryClient.clear()` +
   `router.invalidate()` + remove `nx.brand` / `nx.client` do localStorage.
2. Gate `_authenticated` (`ssr: false`) bloqueia 100% do render até
   `Promise.all([getCachedUser(), getCachedPortalAccess()])` (paralelos entre si,
   timeouts de 6s cada, TTL 60s / 5min).
3. `ActiveContextProvider` hidrata `brandId`/`clientId` só em `useEffect` →
   o primeiro render sempre acontece com contexto `null`.
4. `ContextSwitcher` busca `["brands"]`; só depois o `useEffect` de validação
   confirma/ajusta o `brandId` e publica em `active-workspace`.
5. `clients`, `brand-features` e `dashboard-agency` têm `enabled: !!brandId` →
   ficam esperando o passo 4.
6. `getAgencyDashboardFn`: 1 request HTTP, mas ~15 selects em `Promise.all`
   + 3 awaits seriais (`resolveScopedClientIds`, `pipelines`, `pipelineStages`).

Medição no preview (navegação cliente→dashboard, ambiente dev):
`listClients` 1.17s, `listProjectsFn` 1.15s, `listTasksFn` 1.89s,
`getAgencyDashboardFn` 1.11s. Boot completo (navigation timing): ~4.8s.
Requests do browser no boot: ~9.

## Causas identificadas

**A (P1) — `SIGNED_IN` tratado como troca de identidade.**
`__root.tsx` não compara `user.id`: qualquer `SIGNED_IN` (inclusive restauração
de sessão / sync entre abas) apaga o cache inteiro, invalida o router e apaga
`nx.brand` / `nx.client`. É a explicação direta de "tela em skeleton no boot" e
de perder a seleção de cliente.

**B (P1) — `setBrandId` sempre zera `clientId`.**
`use-active-context.tsx` acopla `setClientId(null)` a todo `setBrandId`, e o
`useEffect` do switcher chama `setBrandId` no boot mesmo quando o brand já é o
correto. Evidência ao vivo: `localStorage.nx.brand` presente e
`localStorage.nx.client` ausente com sessão contínua → o seletor volta para
"Todos os clientes".

**C (P2) — `WorkspaceQueryReset` usa `removeQueries()` sem predicate.**
Qualquer transição de `brandId` (inclusive `localStorage otimista → validado`)
apaga TODAS as queries, forçando refetch de `brands`, `my-access`, greeting etc.

**D (P2) — Dashboard não distingue "resolvendo" de "sem workspace".**
Com `brandId === null` mostra o placeholder textual, provocando o "piscar"
placeholder → conteúdo. Deveria usar `resolved` de `active-workspace`.

**E (P2) — `ensureFeatureEnabled` é serial:** `waitForActiveWorkspace` (3s)
+ `getCachedFeatureAccess` (6s) por rota com feature flag.

**F (P3) — `getAgencyDashboardFn`** tem 3 roundtrips seriais fora do
`Promise.all`, e o dashboard inicia em `AgencyMode` enquanto `clientId` hidrata,
gerando fetch descartado.

## Correções mínimas propostas (para a próxima etapa)

1. Guardar o `user.id` anterior e só chamar `resetIdentityState` quando mudar.
2. No switcher, chamar `setBrandId` apenas quando o valor realmente muda.
3. Aplicar em `WorkspaceQueryReset` o mesmo predicate de `resetScopeCache`.
4. Skeleton enquanto `!resolved`; placeholder só quando `resolved && !brandId`.
5. Reduzir timeouts do feature gate e/ou consultar em paralelo.
6. Colapsar os awaits seriais de `getAgencyDashboardFn` no `Promise.all`.
