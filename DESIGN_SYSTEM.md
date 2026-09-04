# Unitos — Design System

> **Regra fundamental (leia antes de criar qualquer tela):**
> Nenhuma tela nova ou refatoração deve introduzir um novo estilo de card,
> nova cor semântica ou novo componente de lista sem antes verificar se
> um dos componentes documentados abaixo já resolve o caso. Em caso de
> necessidade genuína de um componente novo, ele **deve ser adicionado
> a este arquivo** — caso contrário o padrão visual do sistema se
> fragmenta.

Este documento é a referência obrigatória para qualquer trabalho de UI
no Unitos. O padrão foi extraído do Dashboard geral (`/dashboard`) após
a consolidação dos primitivos `StatCard`, `AlertBanner`, `ScoreListRow`,
`FunnelStages`, `AgentUsageBar` e `ActivityTimelineItem`.

---

## 1. Paleta semântica

Cada cor tem **uma única aplicação semântica**. Nunca reutilize a mesma
cor para dois significados diferentes na mesma tela.

| Cor       | Hex (500) | Uso semântico exclusivo                                        | Token Tailwind         |
| --------- | --------- | -------------------------------------------------------------- | ---------------------- |
| Verde     | `#10b981` | Crescimento, saúde boa, aprovado, sucesso, "Aprovado"          | `emerald-500`          |
| Laranja   | `#f59e0b` | Atenção, pendente, em andamento, "Produção"                    | `amber-500`            |
| Vermelho  | `#f43f5e` | Crítico, atrasado, erro, bloqueio                              | `rose-500`             |
| Roxo      | `#8b5cf6` | Custo de IA, inteligência/geração, agendamento IA              | `violet-500`           |
| Azul      | `#0ea5e9` | Informativo, neutro, "Ideia", estados frios                    | `sky-500`              |
| Rosa      | `#ec4899` | Publicado (evento final do funil) — **exclusivo do funil**     | `pink-500`             |
| Neutro    | `bg-card` / `border-border/60` | Superfícies base, contorno padrão             | `border`, `card`       |

**Regras de aplicação:**

- Verde nunca representa "informativo"; azul nunca representa "sucesso".
- Vermelho é reservado para estados que exigem ação corretiva —
  não use para destaques visuais.
- Roxo é exclusivo do domínio de IA (custo, geração, agentes).
  Nunca use roxo como cor de marca ou de link.
- Para gradiente de IA, use `from-violet-500 to-fuchsia-500`
  (padrão do `AgentUsageBar`).
- Fundos coloridos usam sempre a opacidade `/10` sobre a cor 500 e
  borda `/30`–`/40`, para manter legibilidade em light/dark
  (ex.: `border-rose-500/40 bg-rose-500/10`).

---

## 2. Paleta fixa do funil editorial

Fonte da verdade: `FUNNEL_STAGE_COLORS` em
`src/components/ui/funnel-stages.tsx`. Qualquer visualização do funil
(Dashboard, página do cliente, Kanban, Calendário) **deve** usar
`funnelColorFor(stageKey)` — não reintroduza cores próprias por tela.

| Estágio    | Chaves aceitas                    | Hex       | Tailwind      |
| ---------- | --------------------------------- | --------- | ------------- |
| Ideia      | `idea`, `ideia`                   | `#0ea5e9` | `sky-500`     |
| Roteiro    | `roteiro`, `script`               | `#6366f1` | `indigo-500`  |
| Design     | `design`                          | `#14b8a6` | `teal-500`    |
| Produção   | `production`, `producao`, `produção` | `#f59e0b` | `amber-500` |
| Revisão    | `review`, `revisao`, `revisão`    | `#f97316` | `orange-500`  |
| Aprovado   | `approved`, `aprovado`            | `#10b981` | `emerald-500` |
| Agendado   | `scheduled`, `agendado`           | `#8b5cf6` | `violet-500`  |
| Publicado  | `published`, `publicado`          | `#ec4899` | `pink-500`    |

Observações:

- Ideia = azul (informativo/frio, início do fluxo).
- Produção e Revisão convivem em faixa quente laranja (âmbar → laranja
  mais saturado) — sinaliza "em andamento".
- Aprovado = verde (sucesso do fluxo).
- Agendado = roxo (agendamento assistido por IA/automação).
- Publicado = rosa (evento final, distinto de "aprovado").

---

## 3. Componentes canônicos

### 3.0 REGRA OBRIGATÓRIA — KPI único (`PageKpi` / `PageKpiGrid`)

**Arquivo canônico:** `src/components/ui/page-kpi.tsx`.

Todo KPI/resumo numérico do Unitos DEVE usar `PageKpi` dentro de
`PageKpiGrid`. É proibido criar novos componentes locais de KPI/Stat/Metric
(`MetricCard`, `QueueKpi`, `HeroStat`, `KpiBar`, etc.). Componentes legados
existentes (`KpiCard`, `StatCard`, `SettingsStatCard`, `ProfileStat`,
`HeroStat`, `QueueKpi`, `MetricCell`) são apenas **adaptadores finos** que
delegam a `PageKpi` — nunca reimplementam layout.

Consequências práticas: mesma altura (`min-h-[104px]`), mesmo raio
(`rounded-xl`), mesmo padding (`p-4`), mesmo tamanho de número
(`text-2xl`), tratamento único de ícone, cor apenas semântica
(`neutral | info | success | warning | danger`), sem gradientes, sem sombras
decorativas e sem sparkline/gráfico dentro do card. KPI só é clicável quando
representa um filtro/navegação real, sempre com estado `active` consistente;
KPI informativo nunca deve parecer botão. Grades usam `PageKpiGrid`
(`columns` 2–6), que quebra em linhas e nunca gera scroll horizontal.

### 3.1 `StatCard` — cartão de KPI (adaptador legado)

**Arquivo:** `src/components/ui/stat-card.tsx` (alias de `KpiCard`, que delega a `PageKpi`).

Usar sempre que houver: rótulo curto + valor numérico grande + subtítulo
opcional + sparkline/trend opcional. Substitui qualquer card artesanal
de métrica.

**Props principais:**

| Prop        | Tipo                                | Uso                                              |
| ----------- | ----------------------------------- | ------------------------------------------------ |
| `label`     | `string`                            | Rótulo em caps, monoespaçado                     |
| `value`     | `number \| string`                  | Número grande (2xl, semibold, tabular-nums)      |
| `sub`       | `ReactNode`                         | Contexto abaixo do valor (delta, período)        |
| `icon`      | `ReactNode`                         | Ícone Lucide 4x4 no chip 8x8                     |
| `tone`      | `emerald \| amber \| rose \| violet \| sky \| pink \| neutral` | Barra superior + cor do ícone (usa a paleta semântica) |
| `spark`     | `number[]`                          | Sparkline no canto superior direito              |
| `onClick`   | `() => void`                        | Torna o card interativo (hover + `aria-pressed`) |
| `active`    | `boolean`                           | Estado selecionado (ring + border reforçada)     |
| `dimmed`    | `boolean`                           | Estado esmaecido (opacity 60)                    |
| `trailing`  | `ReactNode`                         | Badge textual quando não houver sparkline        |

**Exemplo:**

```tsx
<StatCard
  tone="emerald"
  icon={<TrendingUp className="h-4 w-4" />}
  label="Aprovações na semana"
  value={128}
  sub="+12 vs. semana anterior"
  spark={[4, 6, 5, 9, 12, 10, 14]}
/>
```

### 3.2 `AlertBanner` — banner de alerta

**Arquivo:** `src/components/ui/alert-banner.tsx`.

Usar para linhas de alerta compactas dentro de painéis (não é toast).
Substitui qualquer `<div>` colorido feito à mão para alerta.

| Prop          | Tipo                                | Uso                                         |
| ------------- | ----------------------------------- | ------------------------------------------- |
| `severity`    | `critical \| warning \| info`       | Vermelho / Laranja / Azul                   |
| `title`       | `ReactNode`                         | Linha principal                             |
| `description` | `ReactNode`                         | Linha secundária muted                      |
| `icon`        | `ComponentType`                     | Sobrescreve o ícone padrão                  |
| `trailing`    | `ReactNode`                         | Chip mono à direita (contagem, atalho)      |

**Exemplo:**

```tsx
<AlertBanner
  severity="warning"
  title="3 aprovações pendentes há mais de 48h"
  description="Cliente Estúdio Lumina"
  trailing="3"
/>
```

### 3.3 `ScoreListRow` — linha de score

**Arquivo:** `src/components/ui/score-list-row.tsx`.

Usar em listas onde cada item tem um score 0–100 (saúde do cliente,
performance de agente, ranking). A cor da barra segue a regra semântica:
`≥70` verde, `50–70` laranja, `<50` vermelho — **não sobrescreva**.

| Prop          | Tipo                | Uso                                                  |
| ------------- | ------------------- | ---------------------------------------------------- |
| `avatarLabel` | `string`            | Iniciais (2 caracteres) no chip colorido             |
| `avatarColor` | `string \| null`    | Cor de fundo do chip (hex/CSS)                       |
| `name`        | `ReactNode`         | Nome — pode ser `<Link>`                             |
| `score`       | `number`            | 0–100                                                |
| `scoreSuffix` | `string`            | Ex.: `"%"`                                           |
| `meta`        | `ReactNode`         | Texto pequeno à direita da barra (breakdown/data)    |

**Exemplo:**

```tsx
<ScoreListRow
  avatarLabel="EL"
  avatarColor="#8b5cf6"
  name={<Link to="/customers/$customerId" params={{ customerId }}>Estúdio Lumina</Link>}
  score={82}
  scoreSuffix="%"
  meta="12 posts • 3 pendências"
/>
```

### 3.4 `FunnelStages` — funil editorial

**Arquivo:** `src/components/ui/funnel-stages.tsx`.

Único componente autorizado para representar o pipeline de conteúdo.
Aplica automaticamente a paleta fixa da seção 2.

| Prop     | Tipo             | Uso                                              |
| -------- | ---------------- | ------------------------------------------------ |
| `stages` | `FunnelStage[]`  | `{ key, label, count, color? }` — `key` casa com `FUNNEL_STAGE_COLORS` |

**Exemplo:**

```tsx
<FunnelStages
  stages={[
    { key: "ideia",     label: "Ideia",     count: 14 },
    { key: "roteiro",   label: "Roteiro",   count: 9  },
    { key: "design",    label: "Design",    count: 6  },
    { key: "producao",  label: "Produção",  count: 8  },
    { key: "revisao",   label: "Revisão",   count: 4  },
    { key: "aprovado",  label: "Aprovado",  count: 12 },
    { key: "agendado",  label: "Agendado",  count: 7  },
    { key: "publicado", label: "Publicado", count: 21 },
  ]}
/>
```

### 3.5 `AgentUsageBar` — consumo por agente de IA

**Arquivo:** `src/components/ui/agent-usage-bar.tsx`.

Usar para qualquer visualização de consumo/custo de IA por agente.
A barra tem gradiente violeta→fúcsia fixo (domínio IA).

| Prop        | Tipo     | Uso                                             |
| ----------- | -------- | ----------------------------------------------- |
| `agent`     | `string` | Nome do agente                                  |
| `cost`      | `number` | Custo em unidades monetárias                    |
| `jobs`      | `number` | Nº de execuções                                 |
| `max`       | `number` | Custo máximo do conjunto (proporção da barra)   |
| `precision` | `number` | Casas decimais (default 3)                      |
| `currency`  | `string` | Prefixo (default `"$"`)                         |

**Exemplo:**

```tsx
{agents.map((a) => (
  <AgentUsageBar key={a.agent} {...a} max={topCost} />
))}
```

### 3.6 `ActivityTimelineItem` — item de timeline

**Arquivo:** `src/components/ui/activity-timeline-item.tsx`.

Usar em qualquer feed de atividade (dashboard, cliente, notificações
embutidas). Existe `ACTIVITY_EVENT_PRESETS` para mapear evento →
`{ tone, icon }`.

| Prop          | Tipo                | Uso                                                     |
| ------------- | ------------------- | ------------------------------------------------------- |
| `title`       | `ReactNode`         | Ação principal                                          |
| `description` | `ReactNode`         | Contexto (autor, item afetado)                          |
| `timestamp`   | `ReactNode`         | "há 5 min", mono, tamanho `[10px]`                      |
| `tone`        | `info \| success \| warning \| critical \| neutral \| violet \| pink` | Cor do chip do ícone |
| `icon`        | `ComponentType`     | Ícone Lucide (default `Sparkles`)                       |

**Exemplo:**

```tsx
<ActivityTimelineItem
  tone="success"
  icon={BadgeCheck}
  title={<><b>Marina</b> aprovou 3 posts</>}
  description="Verde Vivo Nutrição • Feed"
  timestamp="há 12 min"
/>
```

---

## 4. Espaçamento e tipografia

Valores **extraídos do Dashboard geral** — use-os sem variação em telas
novas para preservar coerência visual.

### Superfícies (cards, painéis)

- Contorno padrão: `border border-border/60`
- Fundo: `bg-card`
- Raio: `rounded-xl` (12 px) para cards principais; `rounded-lg` (8 px)
  para chips/avatares; `rounded-md` (6 px) para elementos internos
  pequenos; `rounded-full` para barras de progresso e dots.
- Padding interno de card KPI: `p-4` (16 px)
- Padding de linhas em listas dentro de card: `px-4 py-3` (linhas densas
  de score) ou `px-4 py-2.5` (timeline)
- Hover interativo de card: `hover:border-foreground/20 hover:-translate-y-px`
- Estado ativo: `border-foreground/40 ring-2 ring-foreground/10 shadow-sm`

### Barra superior semântica dos StatCards

- Altura `h-0.5` (2 px), largura total, colorida pelo `tone` — nunca
  substitua por borda lateral colorida.

### Chips / ícones

- Chip de ícone em StatCard: `h-8 w-8`, `rounded-lg`, borda `border-border/60`,
  fundo `bg-background/60`, ícone Lucide `h-4 w-4`.
- Chip de ícone em timeline: `h-7 w-7`, `rounded-md`, ícone `h-3.5 w-3.5`.
- Avatar em `ScoreListRow`: `h-8 w-8`, `rounded-lg`, texto branco
  `text-xs font-semibold`, fundo colorido dinâmico.

### Tipografia

| Uso                              | Classes                                                                 |
| -------------------------------- | ----------------------------------------------------------------------- |
| Rótulo de KPI                    | `text-[11px] font-mono uppercase tracking-widest text-muted-foreground` |
| Rótulo curto (chip inline)       | `text-[10px] font-mono uppercase tracking-widest text-muted-foreground` |
| Valor grande de KPI              | `text-2xl font-semibold tracking-tight tabular-nums`                    |
| Subtítulo de KPI                 | `text-xs text-muted-foreground`                                         |
| Título de item de lista/timeline | `text-sm` (peso `font-medium` para score/alert)                         |
| Descrição secundária             | `text-xs text-muted-foreground`                                         |
| Timestamp                        | `text-[10px] font-mono text-muted-foreground`                           |
| Contador dentro do funil         | `text-[11px] font-medium`                                               |
| Números em geral                 | `tabular-nums` sempre                                                   |

### Barras de progresso

- Trilho: `bg-muted` (ou `bg-muted/50` sobre superfícies coloridas)
- Altura: `h-2` (ScoreListRow), `h-1.5` (AgentUsageBar), `h-6` (FunnelStages)
- Sempre `rounded-full` (barras horizontais) ou `rounded-md` (funil)
- Largura mínima visível: `max(4%, valor)` — nunca deixe a barra sumir

### Gaps

- Grid de KPIs: `gap-3` a `gap-4`
- Lista vertical dentro de card: `space-y-2` (funil) ou linhas com
  padding próprio (score/timeline)
- Cabeçalho de linha (avatar + conteúdo): `gap-3`

---

## 5. Checklist antes de criar uma tela nova

1. Preciso mostrar um número? → `StatCard`. Nunca crie um "cardzinho de
   métrica" próprio.
2. Preciso alertar? → `AlertBanner` (compacto) ou toast (global).
3. Lista com score numérico? → `ScoreListRow`.
4. Qualquer visualização de pipeline de conteúdo? → `FunnelStages` +
   `funnelColorFor()`. Não escolha cores próprias.
5. Consumo/custo de IA? → `AgentUsageBar`.
6. Feed de atividade/histórico? → `ActivityTimelineItem` +
   `ACTIVITY_EVENT_PRESETS`.
7. Cor semântica? → Consulte a seção 1. Uma cor = um significado por tela.
8. Nenhum componente serve? → **Adicione o novo componente aqui antes
   de usá-lo em produção.**

---

## Brain Platform (arquitetura interna)

O Brain é uma plataforma independente dentro da UNITOS. Sua superfície pública
é o namespace `brain` exportado em `src/lib/brain/api.ts`. Toda leitura ou
escrita de dados do Brain — memórias, insights, eventos, grafo, embeddings,
recomendações, consolidação para chat — passa por ele.

**Regra dura:** nenhum arquivo fora de `src/lib/brain/**` acessa tabelas
`brain_*` diretamente. Se você precisa de dados do Brain em uma tela, um
`*.functions.ts` ou um agente, importe `brain` e use o método correspondente.

Componentes:

- `brain.events` — Event Bus
- `brain.learning` — Learning Engine
- `brain.memory` — Memory Store
- `brain.graph` — Knowledge Graph
- `brain.insights` — Insight Engine
- `brain.recommendations` — Recommendation Engine
- `brain.query` — Query Engine (busca semântica, embeddings, stats)
- `brain.chat` — Chat Gateway (Brain-first + fallback LLM)

Detalhes de contrato em `src/lib/brain/README.md`.
