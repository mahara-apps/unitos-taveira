# AUDITORIA — FEATURE ENTITLEMENTS / PLAN GATING

Read-only. Nada foi alterado: código, banco, migrations, RLS, policies, grants, triggers, dados, planos, features, memberships, UI.
Data: 2026-08-25 · Projeto Supabase `tkjbhttylouamqxnbfgv`

---

## 1. Resumo executivo

As telas não estão sendo bloqueadas por plano. Estão sendo bloqueadas por **falta de contexto de workspace no `localStorage` no momento do gate**.

Cadeia real do sintoma:

1. O gate de rota (`ensureFeatureEnabled`) descobre o workspace ativo lendo **exclusivamente** `localStorage["nx.brand"]`.
2. Se essa chave estiver ausente, ele chama o servidor com `brandId: null`.
3. O servidor (`requireFeatureAccess`) responde `{ enabled: false, reason: "no_brand" }`.
4. O gate trata qualquer `enabled === false` como "sem direito" e redireciona para `/dashboard?blocked=<key>`.
5. O dashboard converte **qualquer** valor de `?blocked=` na mensagem literal `Módulo "XPTO" não disponível no seu plano`.

Ou seja: **`workspace não selecionado` é apresentado ao usuário como `módulo não contratado`** — exatamente o antipadrão descrito no item 7 do briefing.

Agravante observado ao vivo no navegador do usuário (leitura de estado, sem mutação): a sessão atual **tem workspace selecionado na UI** (switcher mostra "Pitada Digital", o dashboard renderiza dados de agência com `brandId` válido) e **não tem `nx.brand` no `localStorage`**:

```
localStorage: sb-...-auth-token, theme, unitos:social-analytics-cache:v1,
              brain-widget:collapsed:*
(nx.brand ausente · nx.client ausente)
```

Existem, portanto, **duas fontes divergentes do workspace ativo**: o estado React (`ActiveContextProvider`, usado por toda a UI) e o `localStorage` (única fonte do gate). Enquanto estiverem divergentes, **todo módulo não-core é negado** mesmo com o plano/feature habilitado no banco.

Único módulo `is_core` no catálogo é `dashboard`. Isso explica com precisão o relato "praticamente qualquer tela": só o dashboard escapa do gate.

**Conclusão: cenário B — Feature Gating quebrado por contexto de workspace** (com um agravante de cache descrito no §8). Plano, entitlements e feature keys estão corretos.

Severidade: **P0 = 0 · P1 = 2 · P2 = 3 · P3 = 2**.

---

## 2. Fluxo atual (arquitetura real)

Não existe camada de plano/subscription/Stripe. A arquitetura real é catálogo + ativação por marca:

```
usuário autenticado
   ↓
workspace ativo  ──── UI: estado React (ActiveContextProvider)
   │                └ GATE: localStorage["nx.brand"]   ← divergem
   ↓
brands (workspace)
   ↓
brand_features (brand_id, feature_key, enabled)      ← "entitlement"
   ↓ (sem linha)
feature_catalog (key, is_core, default_enabled)      ← catálogo/padrão
   ↓
requireFeatureAccess (server fn)  → { enabled, reason }
   ↓
access-cache (memo 5 min, chave `${brandId ?? "none"}:${featureKey}`)
   ↓
ensureFeatureEnabled (beforeLoad) → redirect /dashboard?blocked=<key>
   ↓
dashboard.tsx → toast 'Módulo "X" não disponível no seu plano'
```

**Não existem** as tabelas `plans`, `subscriptions`, `workspace_subscriptions` nem colunas de plano em `brands`. Não há integração de billing decidindo acesso. "Plano" é apenas o texto da mensagem — o mecanismo real é feature flag por marca.

Decisão final de `allowed/denied`: `src/lib/feature-flags.functions.ts` → `requireFeatureAccess.handler` (linhas ~175-205).

Precedência implementada, na ordem:
1. `is_super_admin(auth.uid())` → `true` (`reason: "super_admin"`);
2. `feature_catalog.is_core` → `true` (`reason: "core"`);
3. `brandId` ausente → **`false`** (`reason: "no_brand"`) ← causa raiz;
4. linha em `brand_features` → usa `enabled`;
5. sem linha → `feature_catalog.default_enabled ?? false`.

---

## 3. Fonte de verdade

| Informação | Onde vive | Autoridade |
| --- | --- | --- |
| Catálogo de módulos | `public.feature_catalog` | única |
| Ativação por workspace | `public.brand_features` | única |
| Módulo obrigatório | `feature_catalog.is_core` | única |
| Padrão sem linha | `feature_catalog.default_enabled` | única |
| Bypass global | `is_super_admin(auth.uid())` | única |
| **Workspace ativo (UI)** | estado React `ActiveContextProvider` | **fonte A** |
| **Workspace ativo (gate)** | `localStorage["nx.brand"]` | **fonte B** |
| Plano / subscription / billing | **não existe** | — |

Duplicidade de verdade existe **apenas** no workspace ativo (A × B). Entitlement em si tem fonte única.

RLS e grants verificados (sem alteração): `feature_catalog` tem SELECT `true` para `authenticated`; `brand_features` SELECT por `is_brand_member OR is_super_admin`; escrita só super admin. Nenhuma leitura do gate é bloqueada por RLS — descartado como causa.

---

## 4. Feature keys (inventário real)

14 keys no catálogo. Todas as keys usadas no código existem no catálogo e vice-versa — **zero órfãs, zero typos, zero duplicidades**.

| Key | is_core | default_enabled | Onde é exigida (beforeLoad) | Sidebar |
| --- | --- | --- | --- | --- |
| dashboard | **true** | true | — (rota livre) | sim |
| analytics | false | true | `/analytics` | sim |
| projects | false | true | `/projects` | sim |
| tasks | false | true | `/tasks` | sim |
| monthly_plan | false | true | `/monthly-plan` | sim |
| blog_post ("Conteúdo") | false | true | `/content` | sim |
| calendar | false | true | `/calendar` | sim |
| agents | false | true | `/agents` | sim |
| brain | false | true | `/brain`, `/brain/diagnostics` | sim |
| chat | false | **false** | `/chat` | sim |
| customers | false | true | `/customers` | sim |
| connections | false | true | `/connections` | sim |
| notifications | false | true | `/notifications` | sim |
| midia_paga | false | **false** | `/media-plans`, `/customers/$id/media-plan` | sim |

Rotas **sem** gate de feature: `/dashboard`, `/settings*`, `/admin/*`, `/team`, `/customers/$customerId` (o detalhe do cliente e suas abas não passam por `ensureFeatureEnabled`; só a lista `/customers` passa).

Divergência de configuração digna de nota (não é a causa do bloqueio geral): a memória do projeto registra "Conteúdo" e "Brain" como **módulos padrão do sistema**, mas no banco `blog_post` e `brain` estão com `is_core = false` (apenas `default_enabled = true`). Hoje só `dashboard` é core. Isso significa que, sob contexto ausente, Conteúdo e Brain caem no bloqueio junto com o resto — quando a regra de produto diz que deveriam ser inbloqueáveis.

---

## 5. "Planos" existentes (inventário real de `brand_features`)

Não há planos. Há ativação por marca. Leitura completa:

- 40 marcas no projeto (a grande maioria é lixo de QA: `QA Brand *`, `Hack rbac*`, `p1`).
- **Toda** marca possui as 14 linhas em `brand_features` (trigger de provisionamento funcionando).
- Marca real em uso — **Pitada Digital** (`60fce5a7-1859-4bbd-a887-9018ed7f17b5`): 12 de 14 habilitadas; desabilitadas apenas `chat = false` e `midia_paga = false`.
- Marcas de QA: 14/14 habilitadas.
- `brand_features` com `enabled IS NULL`: 0. Marcas sem nenhuma linha: 0.

Portanto, para a marca real, **todos os módulos que o usuário relata bloqueados (exceto Chat e Mídia Paga) estão habilitados no banco**. O banco não nega — o contexto nega.

---

## 6. Workspace context (como o workspace chega ao gate)

- `src/hooks/use-active-context.tsx` mantém `brandId` em estado React e espelha em `localStorage["nx.brand"]` (escrita só em `setBrandId`). Na montagem, hidrata do `localStorage`.
- `src/components/brand-client-switcher.tsx` (linha ~142) auto-seleciona a primeira marca quando `brandId` é nulo → grava `nx.brand`.
- `src/lib/feature-flags.gate.ts` **não usa o contexto React**: lê `localStorage` direto (`readActiveBrandId`), porque `beforeLoad` roda fora da árvore de componentes.
- `src/lib/session-reset.ts` → `resetIdentityState()` faz `localStorage.removeItem("nx.brand")` e `removeItem("nx.client")`.
- `src/routes/__root.tsx` (linha ~157) chama `resetIdentityState` em `SIGNED_IN`, `SIGNED_OUT` **e** `USER_UPDATED`.

**Falha estrutural:** `resetIdentityState` apaga o `localStorage`, mas **não reseta o estado do `ActiveContextProvider`** (o provider só lê `localStorage` uma vez, no mount). Em `SIGNED_IN`/`USER_UPDATED` disparados depois da auto-seleção — login normal, restauração de sessão em nova aba, atualização de usuário —, o resultado é:

```
estado React: brandId = <uuid da marca>   → UI inteira funciona
localStorage: nx.brand ausente            → gate recebe null → no_brand → denied
```

Foi exatamente o estado encontrado na sessão do usuário (§1). Não há uso de workspace residual/errado (A consultando B); o problema é **ausência**, não troca.

`beforeLoad` também roda **antes** de qualquer componente montar em deep link/refresh, então a auto-seleção do switcher nunca chega em tempo para o primeiro gate: em hard refresh direto em `/tasks` com `nx.brand` limpo, o bloqueio é determinístico.

---

## 7. Client context (`clientId`)

Verificado: **o gate não exige `clientId`**. `requireFeatureAccess` recebe apenas `brandId` + `featureKey`; nenhuma rota gated exige cliente selecionado. A regra "nenhuma conta auto-selecionada" **não** é causa do problema.

Matriz real de nível (inferida de código e modelo de dados):

| Módulo | Workspace-level | Client-level | Exige clientId |
| --- | --- | --- | --- |
| dashboard | sim | opcional (modo cliente) | não |
| customers (lista) | sim | não | não |
| connections | sim | vínculo por cliente na tela | não |
| notifications | sim | filtra por escopo | não |
| agents | sim | não | não |
| settings / team / admin | sim | não | não |
| analytics | sim (agregado) | sim | não (deriva do contexto) |
| projects / tasks | sim (listas) | sim | não |
| monthly_plan / calendar / content | sim (listas) | sim | não |
| brain | sim | sim | não |
| chat | sim | sim | não |
| midia_paga | via `/media-plans` | via `/customers/$id/media-plan` | só na rota de cliente (param de rota) |

O gate desconhece essa distinção — e, neste desenho, não precisa conhecer, porque só depende de `brandId`.

---

## 8. Cache

- `src/lib/access-cache.ts` memoriza o resultado do gate por 5 min na chave `${brandId ?? "none"}:${featureKey}`.
- Isso significa que **a negação `none:<key>` fica cacheada por até 5 minutos**. Mesmo que o usuário selecione o workspace logo depois, é o teste seguinte que muda de chave — mas qualquer navegação disparada antes disso continua negada, e um novo ciclo sem `nx.brand` reencontra a entrada envenenada. Isso amplifica o sintoma para "todas as telas, o tempo todo".
- `withTimeout(..., fallback true, 6s)` é permissivo e **não** cacheia o fallback (`cache: false`) — timeout não gera bloqueio. Correto.
- `clearAccessCaches()` é chamado em `resetIdentityState` (troca de identidade), mas **não** em `setBrandId`/`resetScopeCache` (troca de workspace). Como a chave inclui `brandId`, não há vazamento cross-workspace de entitlement — apenas persistência da entrada `none:*`.
- `useBrandFeatures` (React Query, `["brand-features", brandId]`, `staleTime` 60s) é só cosmético (sidebar), com `enabled: !!brandId`, e não influencia o bloqueio.
- Nenhum entitlement é persistido em `localStorage`/`sessionStorage`; o snapshot persistido cobre apenas `social-analytics*`.

Não há cenário "workspace sem plano exibindo cache antigo com plano" — o cache é por marca.

---

## 9. Erros: `null → false`, `catch → false` e equivalentes

Achados exatos:

1. **`if (!data.brandId) return { enabled: false, reason: "no_brand" }`** — `feature-flags.functions.ts` (~linha 195). Contexto ausente virando negação de entitlement. **P1, causa raiz.**
2. **`if (!enabled) throw redirect({ to: "/dashboard", search: { blocked: featureKey } })`** — `feature-flags.gate.ts` (~linha 19). O gate colapsa `no_brand`, `denied` e qualquer outro motivo em um único caminho, descartando o `reason` que o servidor já devolve. **P1.**
3. **Mensagem única e enganosa** — `dashboard.tsx` (~linha 125): todo `?blocked=` vira "não disponível no seu plano", inclusive quando a causa é falta de workspace. **P2 (diagnóstico/UX, mascara a causa real).**
4. `.catch(() => true)` em `getCachedFeatureEnabled` — falha de infraestrutura libera a navegação (o servidor continua validando dados por RLS). Não causa bloqueio; é escolha deliberada. **P3 (registrar, não bloquear).**
5. `const enabled = row ? row.enabled : (cat?.default_enabled ?? false)` — se a leitura do catálogo falhar silenciosamente (`cat` nulo), a feature é negada. Hoje não ocorre (RLS permite SELECT), mas é `null → false`. **P2.**

Nenhum `try { } catch { return false }` clássico foi encontrado no caminho de entitlement.

---

## 10. Regressão — origem provável

A combinação que produz o bug foi introduzida por duas frentes distintas que, isoladas, pareciam corretas:

| Fase | Alteração | Efeito no gate |
| --- | --- | --- |
| Performance / cache de acesso | criação de `access-cache.ts` com memo 5 min por `${brandId ?? "none"}` | passou a **persistir** a negação por ausência de contexto |
| Fase 7 — session/cache reset (`session-reset.ts` + hook em `__root`) | `resetIdentityState` removendo `nx.brand`/`nx.client` em `SIGNED_IN`, `SIGNED_OUT` e `USER_UPDATED` | passou a **apagar o contexto do gate** em eventos rotineiros de sessão, sem sincronizar o estado React |

O gatilho decisivo é o `SIGNED_IN`/`USER_UPDATED`: antes dessa limpeza, `nx.brand` sobrevivia ao login e o gate sempre encontrava um workspace. Depois dela, a UI segue com `brandId` em memória e o gate passa a ver `null`.

Nada foi revertido nesta auditoria.

---

## 11. Teste conceitual (sem execução de mutação)

| Papel | Contexto | Resultado atual | Esperado |
| --- | --- | --- | --- |
| SUPER ADMIN | qualquer | **permitido sempre** (bypass explícito, antes de qualquer checagem) | ok (regra real do código) |
| ADMIN | `nx.brand` presente, `clientId` null, módulo workspace-level habilitado | permitido | ok |
| ADMIN | `nx.brand` **ausente** (UI com marca selecionada), qualquer módulo não-core | **negado — "não disponível no seu plano"** | deveria pedir seleção de workspace, não negar plano |
| ADMIN | marca com `chat=false` | negado | ok (entitlement real) |
| MANAGER | `nx.brand` presente + cliente atribuído + módulo habilitado | permitido pelo gate; escopo de cliente decidido depois por RLS/`can_access_client` | ok |
| MANAGER | `nx.brand` presente + cliente **não** atribuído + módulo habilitado | gate permite; dados vazios/negados pela RLS | ok — camadas separadas |
| MANAGER/USER | módulo não habilitado na marca | negado pelo gate | ok |
| USER | `nx.brand` ausente | **negado em tudo (exceto dashboard)** | mesmo defeito do ADMIN |

As três camadas (autorização de papel · entitlement do workspace · escopo do recurso) **estão corretamente separadas**: o gate não consulta papel, e a RLS não consulta feature. Não houve fusão indevida de RBAC com entitlement — o único acoplamento é o bypass de super admin, que é explícito e intencional.

---

## 12. Severidade

**P1 — 2**
1. `requireFeatureAccess` traduz `brandId` ausente em `enabled: false`, e o gate transforma isso em bloqueio de módulo: falha de contexto apresentada como ausência de entitlement, bloqueando a operação inteira.
2. `resetIdentityState` apaga `nx.brand`/`nx.client` em `SIGNED_IN`/`USER_UPDATED` sem resetar o `ActiveContextProvider`, criando divergência permanente entre a fonte da UI e a fonte do gate (estado reproduzido na sessão real do usuário).

**P2 — 3**
1. Mensagem única "não disponível no seu plano" para qualquer motivo de bloqueio (inclusive `no_brand`), mascarando a causa e induzindo diagnóstico errado.
2. Cache de 5 min guarda a negação da chave `none:<feature>`, prolongando o bloqueio após a seleção do workspace.
3. `cat?.default_enabled ?? false`: falha/ausência na leitura do catálogo nega a feature.

**P3 — 2**
1. `blog_post` e `brain` estão `is_core = false` no banco, apesar da regra de produto registrada como "módulo padrão do sistema" — ficam sujeitos ao bloqueio.
2. Nenhuma suíte de testes cobre feature entitlements/gating (`rg feature tests/` = 0 ocorrências); o defeito passou pelas 398 validações sem detecção.

**P0 — 0.** Não há bypass de entitlement: super admin é a única exceção e é explícita; usuários comuns não conseguem habilitar features (escrita só super admin, com RLS).

---

## 13. Causa raiz

```
CAUSA RAIZ
  contexto de workspace ausente no localStorage no momento do gate
↓
arquivo/função
  src/lib/session-reset.ts → resetIdentityState() (remove "nx.brand" em SIGNED_IN/USER_UPDATED,
      acionado por src/routes/__root.tsx, sem resetar ActiveContextProvider)
  src/lib/feature-flags.gate.ts → readActiveBrandId() (lê SOMENTE localStorage)
  src/lib/feature-flags.functions.ts → requireFeatureAccess (brandId ausente ⇒ enabled: false / no_brand)
  src/lib/access-cache.ts → memo 5 min na chave "none:<feature>"
  src/routes/_authenticated/dashboard.tsx → toast 'Módulo "X" não disponível no seu plano'
↓
dado/contexto incorreto
  UI: brandId = 60fce5a7-... (Pitada Digital, 12/14 features habilitadas)
  Gate: brandId = null
↓
por que resulta em "módulo não disponível"
  o gate nega qualquer feature não-core quando não recebe brandId, e o dashboard rotula
  todo bloqueio como restrição de plano; como só "dashboard" é is_core, praticamente
  toda tela cai no redirect
↓
correção recomendada (NÃO aplicada, aguarda aprovação)
  1. distinguir motivos no gate: tratar reason === "no_brand" como "selecione uma workspace"
     (sem toast de plano; idealmente sem redirect punitivo), reservando o bloqueio para reason === "denied";
  2. manter uma única fonte do workspace ativo: se resetIdentityState limpar nx.brand,
     precisa também resetar o ActiveContextProvider (ou não limpar em SIGNED_IN/USER_UPDATED,
     limpando apenas em troca real de identidade);
  3. não cachear resultados com brandId nulo (cache: false para no_brand);
  4. revisar is_core de blog_post e brain conforme a regra de produto já registrada;
  5. adicionar testes de entitlement cobrindo: sem workspace, workspace com feature off,
     workspace com feature on, super admin e feature core.
```

---

## 14. Conclusão obrigatória

**Cenário B — Feature Gating quebrado por contexto de workspace.**

Não é plano (não existe camada de plano/subscription), não é feature key (inventário íntegro), não é RLS/grant (leitura permitida), não é entitlement de banco (12/14 habilitadas na marca real). O cache agrava, mas não origina.

---

## 15. Validação executada

- Suíte existente: **398/398 passando** (23 arquivos) — nenhum teste cobre entitlements.
- Typecheck (`tsgo --noEmit`): limpo.
- Build (`/tmp/observability/build-errors.log`, 2026-08-25T03:11:09Z): `build OK`.
- Inspeção de estado do navegador do usuário: somente leitura (chaves de `localStorage`, texto renderizado). Nenhuma mutação, clique ou navegação.
- Nada foi alterado para fazer teste passar.

---

## CORREÇÃO APLICADA — Feature Gate / Workspace Context (25/08/2026)

### Causa raiz
`feature-flags.gate.ts` lia o workspace ativo apenas de `localStorage["nx.brand"]`.
O `resetIdentityState` (SIGNED_IN / USER_UPDATED / logout) removia essa chave sem
sincronizar o `ActiveContextProvider`, gerando `brandId = null` no gate enquanto a
UI operava com workspace selecionado. `requireFeatureAccess` devolvia
`no_brand`, o gate redirecionava para `/dashboard?blocked=...` e o dashboard
rotulava qualquer bloqueio como "não disponível no seu plano". O cache de 5 min
guardava a chave `none:<feature>`, perpetuando o falso bloqueio.

### Arquivos alterados
- `src/lib/active-workspace.ts` (novo) — registro canônico não-React do workspace
  ativo (`brandId` + `resolved`), com `subscribe` e `waitForActiveWorkspace`.
- `src/hooks/use-active-context.tsx` — o provider publica no registro canônico
  (hidratação e `setBrandId`) e reconstrói o contexto no evento `nx:identity-reset`.
- `src/lib/feature-flags.gate.ts` — aguarda o contexto, lê o registro canônico e
  classifica o motivo do bloqueio.
- `src/lib/access-cache.ts` — `getCachedFeatureAccess` devolve `{enabled, reason}`;
  nunca cacheia negativo sem workspace nem erro; limpa o cache a cada mudança de
  workspace (`subscribeActiveWorkspace`).
- `src/lib/session-reset.ts` — mantém o reset e marca o workspace como indefinido
  + dispara `nx:identity-reset`.
- `src/components/brand-client-switcher.tsx` — sinaliza contexto resolvido quando
  o usuário não possui nenhum workspace.
- `src/routes/_authenticated/dashboard.tsx` — classifica `reason`:
  `no_workspace` (informativo), `entitlement_error` (erro) e `feature_disabled`
  (plano). `?reason=` incluído em `validateSearch`.
- `tests/feature-gate-context.unit.test.ts` (novo) — Testes 1 a 9 + erro de consulta.

### ActiveContextProvider ↔ Feature Gate
Sequência: contexto canônico → workspace ativo → feature gate.
`localStorage` permanece só como preferência auxiliar; nunca é autoridade.

### no_workspace / cache negativo / login / troca / logout
- `brandId` nulo → `reason = no_workspace` (sem cache, sem mensagem de plano).
- Contexto indefinido → o gate aguarda (até 3s) a resolução, e só então decide.
- Login/logout/troca de identidade → reset de cache + workspace indefinido +
  reconstrução do contexto; nenhum entitlement anterior é herdado.
- Troca de workspace → cache de features limpo, entitlements do novo workspace.

### Regressão
- Novos testes: 10/10. Suíte completa: 408/408. Typecheck OK. Lint sem erros
  (restam 2 warnings pré-existentes de `react-refresh` em `use-active-context.tsx`).
- Build OK. Nenhuma alteração em RBAC, RLS, Storage, Portal, Brain, planos ou
  entitlements (12 de 14 features seguem habilitadas; `chat` e `midia_paga`
  desabilitadas).

### Riscos residuais
- O timeout de 3s do `waitForActiveWorkspace` é o pior caso quando o switcher não
  monta: nessa situação o usuário cai no dashboard com aviso de "selecione uma
  workspace" (nunca com mensagem de plano).
- Contas QA `super_admin` continuam pendentes (fora do escopo desta etapa).
