# Brain Deprecation Plan (Phase 1 — Duplication)

Escopo: consolidar responsabilidades duplicadas entre `src/lib/brain/**` e
os antigos `brain-*.functions.ts`, **sem** introduzir novas funcionalidades.

## Estado atual (após Fase 1)

Todos os consumidores externos passam pela Brain API (`@/lib/brain/api`).
O diretório `src/lib/brain/legacy/` contém apenas server functions e helpers
com **consumidor ativo real** — arquivos sem consumidor foram removidos.

| Arquivo legacy | Status | Substituto oficial |
|---|---|---|
| `legacy/brain-consolidate.functions.ts` (`brainConsolidateFn`) | **Mantido** | consumido pelo cron `/api/public/hooks/brain-consolidate` |
| `legacy/brain-graph.functions.ts` (`brainGraphFn`) | **Mantido** | consumido por `components/brain/knowledge-graph.tsx` via `brain.brainGraphFn` |
| `legacy/brain-intelligence.functions.ts` (`brainIntelligenceFn`) | **Mantido** | consumido por `components/brain/brain-dashboard.tsx` via `brain.brainIntelligenceFn` |
| `legacy/brain-widget.functions.ts` (`loadBrainWidget`) | **Mantido** | consumido por `components/brain/brain-widget.tsx` via `brain.loadBrainWidget` |
| `legacy/brain-embed.server.ts` | **Mantido** | helper server-only usado por `ingest-quiet.server.ts` |
| `legacy/brain-memory.functions.ts` | **Removido** | duplicava `brain.memory.*` (evolve/touch/versions/decay). Zero consumidores. |
| `legacy/brain-learning.functions.ts` | **Removido** | duplicava `brain.learning.*` / `brain.learn()`. Zero consumidores. |
| `legacy/brain-ingest.functions.ts` | **Removido** | duplicava `brain.ingestQuiet()` + `brain.registerEvent()`. Zero consumidores. |
| `legacy/brain-infra.functions.ts` | **Removido** | duplicava `brain.summarize()` e leituras de `event-bus`. Zero consumidores. |
| `legacy/brain-retrieve.functions.ts` | **Removido** | duplicava `brain.query.semantic()`. Zero consumidores. |
| `legacy/brain-stats.functions.ts` (`brainStatsFn`) | **Removido** | duplicava `brain.query.stats()` + `brain.events.list()`. |
| `legacy/brain-stats.functions.ts` (`classifyBrainEvent`) | **Migrado** → `stream/classify.ts` | helper client-safe, agora vive junto do seu único consumidor (`useBrainStream`). |
| `legacy/brain-graph.functions.ts` (`brainNeighborhoodFn`) | **Removido** | export sem consumidor. |

## Consultas / responsabilidades duplicadas resolvidas

- **`brain_memory` — leitura**: agora apenas `brain.memory.list/search` e
  `brain.evolveMemory/touchMemories/memoryVersions/decayMemories`.
  As server fns `listBrainMemories`, `groupBrainMemories`, `relateBrainMemory`,
  `consolidateBrainMemory`, `evolveBrainMemory`, `touchBrainMemory`,
  `getBrainMemoryVersions`, `decayBrainMemory` foram removidas.
- **`brain_events` — ingest**: um único caminho oficial
  (`brain.ingestQuiet` para background + `brain.registerEvent` para
  server fns transacionais). `brainIngestFn` foi eliminado.
- **`brain_events` — leitura**: `brain.events.list` é o único ponto.
  `brainInfraSummaryFn` e `brainStatsFn` foram eliminados.
- **`get_brain_graph` RPC**: uma única entrada (`brainGraphFn`).
  `brainNeighborhoodFn` foi eliminado.
- **`process_brain_learning_queue` RPC**: fica encapsulado em
  `brain.learn()` (enqueue) + worker externo. `runBrainLearning` e
  `getBrainLearningStatus` foram removidos.
- **`brain_embeddings` — busca**: `brain.query.semantic()` é canônico.
  `brainRetrieveFn` foi removido.

## Endpoints públicos

Um único endpoint público sobrevive: `/api/public/hooks/brain-consolidate`,
usado pelo cron para disparar `brainConsolidateFn` (job de consolidação LLM).
Nenhum outro endpoint redundante existe.

## Próximas fases (fora do escopo desta refatoração)

- **Fase 2** — quebrar `brain-intelligence.functions.ts` e `brain-widget.functions.ts`
  em serviços do namespace (`brain.intelligence`, `brain.widget`) mantendo os
  server fns como wrappers finos apenas para o transporte RPC.
- **Fase 3** — realinhar `chat-gateway/consolidate.ts` + `memory/list` ao
  schema real do `brain_memory` (`title`/`description`/`key`) e remover a
  projeção redundante `topic`/`summary` de `core/types.ts`.
- **Fase 4** — mover o job `brainConsolidateFn` para um worker interno e
  eliminar o endpoint público de cron dedicado.

## Fase 2 — Unificação da camada de memória (concluída)

**Removido**
- Tabela `public.brain_knowledge` — descontinuada.
- Trigger `brain_knowledge_touch`.

**Migrado**
- Todas as leituras em `brain-intelligence.functions.ts` agora usam `brain_memory`
  (`category` → `memory_type`; `client_id` → `subject_id` com `subject_type='client'`;
  `last_reinforced_at` → `updated_at`).
- Registros pré-existentes (se houvesse) copiados para `brain_memory` com
  `origin='migration:brain_knowledge'` e `source_refs.event_ids` preservados.

**Fonte única confirmada**
- Chave canônica: `(brand_id, subject_type, subject_id, memory_type, key)`.
- Versionamento: `brain_memory_versions` + trigger snapshot.
- Confidence: WMA via `brain_memory_evolve()`.
- Lifecycle: `evolve` / `touch` / `decay` / `archive` em `brain.memory.*`.
