# Auditoria READ-ONLY — Painel do Cliente (`/customers/$customerId`)

Nada foi alterado: sem mudanças em código, banco, RLS, RPC, dados ou UI.

## 1. Mapa atual

Rota-mãe: `src/routes/_authenticated/customers.$customerId.tsx` (431 linhas) — header de identidade + 8 abas + wizard de onboarding.

| Aba | Componente | Classificação |
|---|---|---|
| Visão geral | `customer/overview/*` (10 arquivos) | FUNCIONA |
| Briefing | `brand-hub/briefing-workspace` | FUNCIONA |
| Estratégia IA | `ai-agents/strategy-results` | FUNCIONA |
| Pauta | `monthly-plan/monthly-plan-view` | FUNCIONA |
| Produção | `customer/production/*` | FUNCIONA |
| Canais | `customer/channels-tab` | FUNCIONA PARCIALMENTE (ver 3.4) |
| Gestão da conta | `customer/account-management-tab` (775 linhas) | FUNCIONA PARCIALMENTE |
| Cadastro | `customer/basic-info-tab` | DUPLICADO (ver 3.3) |

Sub-rotas: `.brain` (painel próprio, fora das abas), `.briefing` e `.pauta` (redirects legados, corretos), `.media-plan` (952 linhas, tela paralela).

Fora do painel, mas escopadas por cliente ativo: `/calendar`, `/content`, `/tasks`, `/projects`, `/connections`, `/brain`.

## 2. O que NÃO deve ser mexido (já correto)

- Toda a camada de dados: cada server function do painel usa `.middleware([requireSupabaseAuth])` + `context.supabase` (RLS como usuário). Amostragem em `monthly-plans.functions.ts`: 20/20 funções com middleware. Sem `supabaseAdmin` em caminho de leitura de tela.
- `customer-queries.ts` + prefetch paralelo (core suspende, target/market/pautas em prefetch) — elimina waterfall entre abas. Manter.
- Redirects legados `.briefing` / `.pauta` preservando `?planId=`.
- `ProductionTab` — único ponto do painel já 100% aderente ao padrão `PageKpi`/`PageKpiGrid`.
- Guardas de escopo do topo da rota (workspace ausente, UUID inválido, cliente fora do workspace) com mensagens específicas.
- Portal (`portal-link-card` → `portal-access-section` + `portal-theme-form`), validado em fase anterior.

## 3. Problemas

### 3.1 `customer/customer-dashboard.tsx` — FANTASMA / DEVE SER REMOVIDO — P1
- Onde: 646 linhas, com `ClientHealthPanel` acoplado.
- Causa: substituído pelo grid `overview/*`; nenhum importador (`CustomerDashboard` tem 0 referências).
- Impacto: 646 linhas mortas no bundle-graph de manutenção; duas versões conflitantes da "visão geral" convivendo, fonte recorrente de refatoração incompleta.
- Recomendação: remover o arquivo e avaliar `client-health-panel` (só é consumido por ele).

### 3.2 Aba "brain" fantasma no contrato de rota — LEGADO — P2
- Onde: `tab` enum e `useEffect(() => { if (activeTab === "brain") setActiveTab("briefing") })`; `ALL_TABS` já não tem "brain".
- Causa: aba removida sem limpar o schema de search e o efeito de redirecionamento.
- Impacto: `?tab=brain` renderiza Briefing sem corrigir a URL; efeito roda a cada render de aba.
- Recomendação: tirar "brain" do enum e trocar o efeito por redirect de URL único; `/customers/$id/brain` continua como rota própria.

### 3.3 "Cadastro" vs "Gestão da conta" — DUPLICADO — P1
- Onde: `basic-info-tab` (349) e `account-management-tab` (775) editam o mesmo registro `clients` (contato, dados básicos) com forms e regras de permissão próprias.
- Causa: crescimento incremental; "Gestão" nasceu para jornada/portal/equipe e absorveu campos de cadastro.
- Impacto: usuário não sabe onde editar; risco de sobrescrita entre dois forms com caches distintos; dobro de superfície de permissão.
- Recomendação: uma aba "Conta" com seções (Dados, Responsáveis, Jornada, Portal). Não fundir agora — depende de decidir a fonte única de cada campo.

### 3.4 Canais: painel do cliente vs Centro de Canais — DUPLICADO PARCIAL — P2
- Onde: `customer/channels-tab` (648) e `connections/channels-center`.
- Causa: pós-refatoração de workspace, o vínculo cliente↔conta ficou no painel e a conexão no workspace — correto —, mas badges de status, `providerLabel` e `accountType` foram reimplementados localmente.
- Impacto: divergência visual/semântica de status entre as duas telas.
- Recomendação: extrair primitivas compartilhadas de canal; manter a separação de responsabilidade.

### 3.5 Atalho "ver tarefas" aponta para "Gestão da conta" — QUEBRADO (funcional) — P1
- Onde: `customer-overview.tsx`, `onOpenTasks={() => onOpenTab?.("gestao")}` no card de atenção (tarefas atrasadas).
- Causa: quando as abas foram renomeadas, o alvo de tarefas não existia mais.
- Impacto: clicar em tarefa atrasada leva a uma tela sem tarefas — beco sem saída no fluxo mais crítico da Visão geral.
- Recomendação: apontar para `/tasks` com o cliente ativo (ou abrir a tarefa diretamente).

### 3.6 Tarefas / Conteúdo / Calendário / Aprovações fora do painel — ARQUITETURA / DEVE SER MOVIDO — P2
- Onde: a Visão geral agrega tarefas, pipeline, publicações e aprovações, mas nenhuma dessas superfícies tem aba; vivem em rotas globais dependentes do `clientId` do `ActiveContext`.
- Causa: painel construído depois das telas globais.
- Impacto: navegação perde o contexto do cliente (o header de cliente desaparece); dependência implícita de estado global — abrir `/tasks` em nova aba pode mostrar outro cliente.
- Recomendação: a médio prazo, abas "Trabalho" (tarefas/projetos) e "Publicações" (calendário/pipeline/aprovações) reusando os mesmos componentes com `clientId` explícito por prop, não por contexto.

### 3.7 Enforcement de acesso ao cliente é client-side — RISCO DE SEGURANÇA (baixo) — P1
- Onde: `useEffect` com `allowedClientIds` + toast/redirect; `listClients` filtra por `brand_id` e delega o resto à RLS.
- Causa: checagem de responsável por cliente vive na UI.
- Impacto: dados do cliente já renderizam antes do redirect; a proteção real é a RLS — se alguma policy de tabela satélite for por brand e não por cliente, um editor não-responsável lê dados via server function.
- Recomendação: mover a checagem para `beforeLoad` e auditar policy a policy quais tabelas satélite validam `can_access_client` (a P0 só existe se alguma não valida — não confirmado nesta auditoria, que não tocou o banco).

### 3.8 `getPlanVolumetryFn` recebe só `clientId` — RISCO / INCONSISTÊNCIA — P2
- Onde: `monthly-plans.functions.ts:225`.
- Causa: assinatura sem `brandId`, ao contrário do resto do painel.
- Impacto: escopo depende exclusivamente da RLS de `clients`; a chave de cache `["monthly-plan","volumetry",clientId]` também ignora o brand.
- Recomendação: padronizar entrada `{brandId, clientId}` e a chave de cache.

### 3.9 `media-plan` como tela paralela — LEGADO / DEVE SER MOVIDO — P2
- Onde: `customers.$customerId.media-plan.tsx`, 952 linhas em rota irmã, sem entrada nas abas.
- Impacto: só acessível por link direto; fora do padrão do painel; concentra lógica não reutilizada.
- Recomendação: decidir entre virar aba ou ser descontinuada; hoje é um órfão navegável.

### 3.10 KPIs fora do padrão — INCONSISTÊNCIA VISUAL — P2
- Onde: `overview-performance.tsx:86` (`Metric` local), `dashboard/client-account-dashboard.tsx:753` (`MetricCell`), `monthly-plan/volumetry-cards.tsx:41` (`MetricCard`).
- Causa: componentes criados antes do `PageKpi`.
- Impacto: viola a regra do projeto (DESIGN_SYSTEM 3.0): todo KPI usa `PageKpi`/`PageKpiGrid`.
- Recomendação: transformar os três em adaptadores finos de `PageKpi`.

### 3.11 Ponte por `window` event entre abas — LEGADO — P2
- Onde: listener `nx:switch-customer-tab` na rota-mãe.
- Causa: workaround para o link "Editar em Cadastro" dentro do Cérebro.
- Impacto: navegação invisível ao roteador, não compartilhável, difícil de rastrear; convive com o `?tab=` que já resolve isso.
- Recomendação: substituir por `Link to="/customers/$customerId" search={{tab:"cadastro"}}`.

### 3.12 Header duplicado — DUPLICADO — P3
- Onde: `usePageHeader` (título/subtítulo no header do shell) + faixa de identidade com o mesmo nome e nicho logo abaixo.
- Impacto: nome do cliente aparece duas vezes na dobra; a faixa só existe de fato para o botão "Completar onboarding".
- Recomendação: manter uma fonte e mover a ação para o header do shell via `actions`.

### 3.13 Erros e vazios inconsistentes — FUNCIONA PARCIALMENTE — P2
- Onde: Visão geral trata erro com `toast` + skeleton infinito (`if (!q.data) return <OverviewSkeleton/>`), sem estado de erro nem "tentar novamente"; `overview-shared` tem `OverviewEmpty` que as outras abas não usam; sub-rota `brain` mostra texto cru "Selecione um workspace." sem a moldura das demais.
- Impacto: falha de rede na Visão geral = carregando eterno; linguagem de vazio/erro varia por aba.
- Recomendação: um `PanelState` (loading/empty/error+retry) para todas as abas.

### 3.14 Rolagem própria com altura fixa — MOBILE — P2
- Onde: `ScrollArea className="h-[calc(100vh-3.5rem)]"` na rota-mãe (e no fallback).
- Causa: assume header de 56px e `100vh`.
- Impacto: em navegador mobile, `100vh` inclui a barra de URL → conteúdo cortado e rolagem aninhada; a fila de 8 `TabsTrigger` com `flex-wrap` ocupa 3 linhas em telas estreitas.
- Recomendação: rolagem do documento (`min-h-dvh`) e tabs com rolagem horizontal ou `Select` de aba no mobile.

### 3.15 Sem dados reais só quando a origem está vazia — SEM DADOS REAIS (aceitável) — P3
- Verificação: nenhum mock, seed ou número hardcoded encontrado em `components/customer/**`; todos os cards consomem server functions. `OverviewBrain` usa um tópico fixo de busca semântica (`TOPIC`) — é parâmetro de consulta, não dado falso, mas está hardcoded no componente e deveria ser configurável.

## 4. Arquitetura simplificada proposta

```text
/customers/$customerId            (rota-mãe: escopo + header + estado do painel)
  ├─ Visão geral      resumo, atenção, próximos passos
  ├─ Conta            dados, responsáveis, jornada, portal, canais   (funde Cadastro+Gestão)
  ├─ Briefing         briefing + estratégia IA (estratégia como seção)
  ├─ Pauta            pauta -> aprovação -> produção
  ├─ Trabalho         projetos, tarefas, subtarefas do cliente
  └─ Publicações      calendário, pipeline, aprovações, arquivos

Fora do painel: /connections (workspace), /brain (global), /settings.
Regra: nenhum componente do painel lê clientId de contexto global — sempre por prop.
```

De 8 abas + 2 telas órfãs para 6 abas, uma fonte por dado e um único conjunto de estados.

## 5. Fases curtas de refatoração

- **Fase 1 — Segurança.** Mover a checagem de acesso ao cliente para `beforeLoad`; auditar policies das tabelas satélite quanto a `can_access_client`; padronizar `getPlanVolumetryFn` com `brandId`. Testes de isolamento como regressão.
- **Fase 2 — Funcionamento.** Corrigir o atalho de tarefas (3.5); estado de erro + retry na Visão geral (3.13); remover `customer-dashboard.tsx` e o resíduo da aba "brain".
- **Fase 3 — Arquitetura.** Unificar Cadastro + Gestão em "Conta"; decidir o destino de `media-plan`; trocar o evento `window` por navegação por rota; `clientId` sempre por prop.
- **Fase 4 — UX.** Abas "Trabalho" e "Publicações" reusando os componentes existentes; header único com a ação de onboarding.
- **Fase 5 — Polimento.** `PageKpi` nos três KPIs legados; primitivas de canal compartilhadas; rolagem/tabs no mobile; `TOPIC` do Brain configurável.

Cada fase é fechada e testável isoladamente; nenhuma depende da seguinte.

## Fase 2 — resultado (executada)

- **Cadastro × Gestão da conta:** unificados na aba única **Conta**
  (`?tab=conta`). `BasicInfoTab` continua fonte única de identidade/contato/redes;
  `AccountManagementTab` continua fonte única de contrato/jornada/portal.
  Nenhuma server function ou campo alterado. `?tab=cadastro` e `?tab=gestao`
  seguem válidos como aliases legados e resolvem para `conta`.
- **Search `brain`:** removido do enum e do tipo `CustomerTab` (sem consumidor;
  havia apenas o redirect defensivo para `briefing`).
- **Media plan:** **PRESERVADO** — possui consumidores reais
  (`/media-plans` (lista), `create-media-plan-dialog`, `brand-client-switcher`).
  Local definitivo: sub-rota `/customers/$customerId/media-plan`, fora das 6 abas.
- **Ponte `window` `nx:switch-customer-tab`:** removida (não existia dispatcher).
  Troca de aba usa apenas `onOpenTab` (prop) + `?tab=` na URL.
- **KPIs:** `overview-summary` e `overview-performance` migrados para
  `PageKpi`/`PageKpiGrid`; `ProfileStat` já era adaptador fino de `PageKpi`.
  Métricas e consultas inalteradas.
- **Erros da Visão geral:** `loading` / `empty` / `error` agora são estados
  distintos, com botão "Tentar novamente" (`refetch`).

### Fica para a Fase 3
- Reorganização final em 6 abas (Trabalho e Publicações ainda não existem).
- Guarda de acesso em `beforeLoad`.
- Layout mobile / `ScrollArea` com `100vh` fixo.

## Fase 3 — resultado (executada)

Estrutura final (`/customers/$customerId?tab=`):
`overview` Visão geral · `conta` Conta · `briefing` Briefing (inclui Estratégia IA)
· `pauta` Pauta · `trabalho` Trabalho · `publicacoes` Publicações.

- **Fonte única de navegação:** `src/lib/customer-tabs.ts` (abas, labels, ordem,
  aliases, rota canônica, `customerPanelLink`, `customerBreadcrumbs`). Nenhum
  outro arquivo declara mapa de abas do cliente.
- **Guard de rota:** `beforeLoad` valida o `customerId` (UUID) → redirect para
  `/customers`, e normaliza aliases de `?tab=` por redirect antes de montar a
  tela. O gate de responsabilidade por cliente (`my_access`) continua bloqueando
  a renderização antes de qualquer dado protegido. RLS segue como camada
  definitiva de autorização.
- **Aliases mantidos** (apenas para URLs/bookmarks antigos; links internos já
  usam os valores canônicos): `cadastro`/`gestao`→`conta`,
  `estrategia`→`briefing`, `producao`→`trabalho`, `channels`→`publicacoes`.
- **Trabalho** = reúso de `listProjects`, `listTasksFn`, `TaskDrawer`/badges de
  `components/tasks/shared` e `ProductionTab`.
- **Publicações** = reúso de `listPublicationBoardFn`, `PublicationRow`,
  `PublicationDetailModal` e `ChannelsTab`. O `ScheduleWizard` NÃO foi
  incorporado (depende do contexto/estado da Central de Publicação) — a edição
  continua em `/calendario`, sem duplicação.
- **Sub-rotas preservadas (têm consumidor real):** `/customers/$id/brain`
  (brand-client-switcher, new-customer-wizard), `/customers/$id/media-plan`
  (/media-plans, create-media-plan-dialog), e os redirects `/briefing` e
  `/pauta`.
- **Mobile:** `100vh` → `100dvh`; tablist deixou de usar `flex-wrap` e agora é
  uma faixa horizontal rolável (`flex-nowrap overflow-x-auto`, triggers
  `shrink-0`), sem quebrar em 3 linhas e sem scroll duplo.

### Fica para a Fase 4 (redesign visual)
- Redesign de cards/hierarquia visual do painel e do header do cliente.
- Reavaliar se "Estratégia IA" merece bloco colapsável dentro de Briefing.
