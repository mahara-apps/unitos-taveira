# Brain — Plataforma de Inteligência da UNITOS

O **Brain** é a camada central de conhecimento da UNITOS. Consolida eventos operacionais, memórias, insights, recomendações e relacionamentos em uma única plataforma, isolada por *boundary rules* rígidos: **nenhum módulo acessa tabelas `brain_*` diretamente** — todo consumo passa pela **Brain API** em `@/lib/brain/api`.

> Status: **Fase 1 (Deduplicação) concluída.** Ver [`src/lib/brain/DEPRECATION.md`](src/lib/brain/DEPRECATION.md).

---

## 1. Princípios

1. **Uma única porta pública**: `import { brain } from "@/lib/brain/api"`.
2. **Escopo estrito**: toda query carrega `brand_id`, `client_id`, `project_id` e `period` quando aplicável; nunca faz varredura ampla.
3. **RLS-first**: `BrainContext` carrega o cliente Supabase autenticado; a RLS aplica-se como o usuário. `supabaseAdmin` só após verificação de papel.
4. **Server-only para LLM**: qualquer chamada a modelo mora em `*.server.ts` e é carregada via `await import(...)` para não vazar no bundle client.
5. **Feature-flag**: exposição na UI é gated por `useFeatureAccess("brain")`. Sem a flag, a plataforma opera silenciosamente (event bus, learning queue), mas dashboards e chat Brain-first ficam ocultos.

---

## 2. Componentes internos

| Namespace | Pasta | Responsabilidade | Tabelas |
|---|---|---|---|
| `brain.core` | `core/` | `BrainContext`, tipos compartilhados | — |
| `brain.events` | `event-bus/` | Publish/subscribe de eventos | `brain_events` (particionada por mês), `brain_events_archive` |
| `brain.learning` | `learning/` | Fila + worker assíncrono | `brain_learning_queue` |
| `brain.memory` | `memory/` | Memórias consolidadas + lifecycle | `brain_memory`, `brain_memory_versions` |
| `brain.graph` | `graph/` | Nós/arestas do Knowledge Graph | `brain_relationships` |
| `brain.insights` | `insights/` | Insights ativos | `brain_insights` |
| `brain.recommendations` | `recommendations/` | Recomendações (next-best-action) | `brain_recommendations` |
| `brain.query` | `query/` | Busca semântica + stats | `brain_embeddings`, `brain_metrics_snapshots` |
| `brain.chat` | `chat-gateway/` | Consolidação Brain-first + fallback LLM | (lê tudo via API) |
| `brain.context` | `context-engine/` | Monta `ContextPack` escopado por pergunta | — |
| `brain.stream` | `stream/` | Hook React `useBrainStream` para live UI | — |
| `brain.reasoning` | `reasoning/` | Pipeline Intent → Plan → Tools → Decision → Response | `brain_reasoning_logs` |
| `brain.retention` | interno | Políticas de retenção por tipo | `brain_retention_config` |

### Suporte

- `services.ts` — 12 métodos de alto nível.
- `ingest-quiet.server.ts` — ingest *fire-and-forget* para caminhos hot-path.
- `cache.ts` — cache curto in-memory por request.
- `diagnostics.functions.ts` — health-check consumido por `/brain/diagnostics`.
- `legacy/` — server functions oficiais expostas via TanStack RPC (consolidate, graph, intelligence, widget, embed).

---

## 3. Brain API (contrato público)

```ts
import { brain } from "@/lib/brain/api";

// Ingest de eventos operacionais
await brain.registerEvent(ctx, {
  source_module: "content",
  event_type: "post.approved",
  payload: { post_id, client_id },
});

// Learning (dispara worker)
await brain.learn(ctx, { job_type: "recompute-metrics" });

// Memória
await brain.remember(ctx, { topic: "SLA de aprovação", summary: "…" });
const memories = await brain.memory.list(ctx);

// Knowledge Graph
await brain.relate(ctx, {
  source_type: "customer", source_id,
  target_type: "project",  target_id,
  relationship_type: "owns",
});

// Insights & Recommendations
await brain.generateInsights(ctx, { insight_type: "pattern.retention", description: "…" });
const next = await brain.getRecommendations(ctx);

// Busca / retrieval
const hits = await brain.searchKnowledge(ctx, { text: "posts atrasados" });
const rows = await brain.runQuery(ctx, { query: "clientes com maior LTV" });

// Chat Brain-first
const knowledge = await brain.chat.consolidate(ctx, { query: "…" });

// Context Engine (fluxo canônico de uma resposta LLM)
const pack = await brain.buildContext(ctx, { question, module: "chat" });
// pack.items[] já filtrado por score >= 0.15 e ordenado desc
await brain.recordContextUsage(ctx, {
  pack,
  responseId: assistantMessageId,
  consumer: "chat",
  usedLlm: true,
});
```

---

## 4. Fluxo operacional

```text
 módulos da plataforma
   │  registerEvent / ingestQuiet
   ▼
┌─ Event Bus (brain_events, particionada por mês) ────────────────────┐
│   trigger SQL → enfileira em brain_learning_queue                    │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌─ Learning Worker (cron pg_net → /api/public/hooks/brain-consolidate)┐
│   consome fila → gera embeddings, memórias, relacionamentos, insights│
│   → grava em brain_memory / brain_relationships / brain_insights     │
│   → snapshot em brain_metrics_snapshots                              │
└──────────────────────────────────────────────────────────────────────┘
   │
   ▼
┌─ Query / Context Engine ─────────────────────────────────────────────┐
│   buildContext(question) → intent → scoring → assemble → ContextPack │
│   Chat Gateway consome pack + LLM (multimodal, tools)                │
│   recordContextUsage() → provenance event no bus                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Retenção**: `brain_retention_config` define TTL por `event_type`. Eventos expirados vão para `brain_events_archive` via job de manutenção.

---

## 5. Superfícies de UI

| Rota / Componente | Papel |
|---|---|
| `src/routes/_authenticated/brain.tsx` | Painel principal (agency scope) |
| `src/routes/_authenticated/brain.graph.tsx` | Knowledge Graph interativo (SVG) |
| `src/routes/_authenticated/brain.diagnostics.tsx` | Saúde da plataforma, fila, retenção |
| `src/routes/_authenticated/customers.$customerId.brain.tsx` | Brain escopado ao cliente ativo |
| `src/components/brain/brain-dashboard.tsx` | KPIs + insights via `brainIntelligenceFn` |
| `src/components/brain/brain-widget.tsx` | Widget compacto (sidebar, home) |
| `src/components/brain/knowledge-graph.tsx` | Renderer do grafo |
| `src/components/brain/neural-network-canvas.tsx` | Background animado |
| `src/lib/brain/stream/use-brain-stream.tsx` | Hook para live-events |

Todas as rotas Brain respeitam `useFeatureAccess("brain")` e o escopo ativo (`useActiveContext()`): em contexto de cliente, mostram somente dados daquele `client_id`; em modo agência, agregam por brand.

---

## 6. Guardrails

`eslint.config.js` bloqueia:

- `no-restricted-imports`: `@/lib/brain-*` e `@/hooks/use-brain-stream` fora de `src/lib/brain/**`.
- `no-restricted-syntax`: `.from("brain_*")` fora de `src/lib/brain/**`.

Client-safety: `api.ts` só re-exporta módulos client-safe. Server-only: `ingest-quiet.server`, `chat-gateway/llm.server`, `chat-gateway/multimodal.server`, `chat-gateway/tools.server`, `legacy/brain-consolidate.functions`, `legacy/brain-embed.server`.

---

## 7. Server functions (legacy expostas via RPC)

Mantidas por terem consumidor ativo real:

| Função | Consumidor |
|---|---|
| `brainConsolidateFn` | cron `/api/public/hooks/brain-consolidate` |
| `brainGraphFn` | `components/brain/knowledge-graph.tsx` |
| `brainIntelligenceFn` | `components/brain/brain-dashboard.tsx` |
| `loadBrainWidget` | `components/brain/brain-widget.tsx` |
| `brain-embed.server` | helper server-only de embeddings |

Removidas na Fase 1 (duplicadas pela Brain API): `brain-memory`, `brain-learning`, `brain-ingest`, `brain-infra`, `brain-retrieve`, `brain-stats`, `brainNeighborhoodFn`. `classifyBrainEvent` migrou para `stream/classify.ts`.

---

## 8. Cron & manutenção

- **Consolidação**: `pg_cron` → `pg_net` → `POST /api/public/hooks/brain-consolidate` (autenticado via `apikey` = Supabase anon). Processa lotes de `brain_learning_queue`.
- **Snapshots de métricas**: job diário grava em `brain_metrics_snapshots`.
- **Retenção**: job varre `brain_events` por `brain_retention_config`, move para `brain_events_archive`.
- **AI model health**: `ai_model_health` (semanal) garante que o provider configurado no brand ainda responde antes de ser usado pelo Chat Gateway.

---

## 8b. Reasoning Engine v1

`src/lib/brain/reasoning/` implementa um pipeline determinístico usado pelo Chat Gateway antes (e às vezes em vez) do LLM:

```text
question ─▶ classifyIntent ─▶ buildPlan ─▶ executePlan (tools) ─▶ decide
                                                                    │
                             ┌───────────── deterministic ──────────┤
                             │                                      │
                             ▼                                      ▼
                     renderAnswer (sem LLM)                    hybrid → LLM com contexto
                                                                    │
                                                                    ▼
                                                          logReasoning → brain_reasoning_logs
```

Arquivos: `intent.ts`, `planner.ts`, `tools.server.ts`, `decision.ts`, `response.ts`, `logger.server.ts`, `orchestrator.server.ts`. Entrada única: `reason(ctx, supabase, { question, conversationId })` → `ReasoningOutcome` com `deterministicAnswer`, `shouldCallLlm`, `llmContextMarkdown` e `latencyMs`. Toda execução é auditada em `brain_reasoning_logs` (intent, plano, tools chamadas, decisão, se usou LLM).

---

## 9. Como um novo módulo consome o Brain

1. Nunca leia `brain_*`. Importe `@/lib/brain/api`.
2. Publique eventos com `brain.registerEvent` (transacional) ou `brain.ingestQuiet` (fire-and-forget, hot path).
3. Para respostas assistidas por IA:
   - `pack = await brain.buildContext(ctx, { question, module })`
   - Envie `pack.items` ao LLM
   - `await brain.recordContextUsage(ctx, { pack, responseId, consumer, usedLlm })`
4. Para exibir memórias/insights do escopo atual, use os leitores públicos (`brain.memory.list`, `brain.insights.list`, `brain.recommendations.list`).
5. Não crie novas server fns `brain-*.functions.ts` fora de `src/lib/brain/`.

---

## 10. Roadmap

- **Fase 2**: substituir consumidores restantes de `legacy/*` por chamadas diretas à Brain API.
- **Fase 3**: unificar Chat Gateway multimodal + tools num único pipeline streaming (SSE) com provenance inline.
- **Fase 4**: expor Brain como MCP para agentes externos (read-only por brand, escrita apenas via eventos).

Referências:

- [`src/lib/brain/README.md`](src/lib/brain/README.md) — visão interna
- [`src/lib/brain/DEPRECATION.md`](src/lib/brain/DEPRECATION.md) — status Fase 1
- [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) — tokens visuais das superfícies Brain
