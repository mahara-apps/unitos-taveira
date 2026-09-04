# Brain Platform

O Brain é uma **plataforma interna independente** dentro da UNITOS. Ele consolida
eventos, memórias, insights, recomendações e conhecimento relacional da agência.

## Regra de arquitetura

> **Nenhum módulo da plataforma acessa tabelas `brain_*` diretamente.**
> Todo acesso passa pela **Brain API** exportada em `src/lib/brain/api.ts`.

```ts
import { brain } from "@/lib/brain/api";

const knowledge = await brain.chat.consolidate(ctx, { query: "…" });
const memories  = await brain.memory.list(ctx);
await brain.events.publish(ctx, { source_module: "chat", event_type: "chat.turn", ... });
```

Comportamento externo **não muda** com esta reorganização — apenas o layout
interno passa a ser modular.

## Componentes

| Módulo | Responsabilidade | Namespace |
|---|---|---|
| **Brain Core** | Tipos, `BrainContext`, contrato compartilhado | `./core` |
| **Event Bus** | Publicar/ler eventos (`brain_events`) | `brain.events` |
| **Learning Engine** | Fila e worker assíncronos (`brain_learning_queue`) | `brain.learning` |
| **Memory Store** | Memórias consolidadas (`brain_memory`) | `brain.memory` |
| **Knowledge Graph** | Nós e arestas (`brain_relationships`) | `brain.graph` |
| **Insight Engine** | Insights ativos (`brain_insights`) | `brain.insights` |
| **Recommendation Engine** | Recomendações (`brain_recommendations`) | `brain.recommendations` |
| **Query Engine** | Busca semântica, embeddings e stats | `brain.query` |
| **Chat Gateway** | Consolidação Brain-first + fallback LLM | `brain.chat` |
| **Context Engine** | Monta ContextPack escopado e scored p/ cada pergunta | `brain.context` |

## Brain API (alto nível)

Os 12 serviços que **todos os módulos** (Chat, Projetos, CRM, Conteúdo,
Analytics, Financeiro, Automações, Agentes, Dashboard) devem usar em vez de
tocar os módulos internos:

### Context Engine

```ts
// 1) monta contexto reduzido para a pergunta atual
const pack = await brain.buildContext(ctx, { question, module: "chat" });
// pack.items[] já vem filtrado por relevância (score >= 0.15) e ordenado desc
// pack.scope inclui workspace, cliente, projeto, período, módulo, permissões

// 2) após responder, registra provenance (memórias/insights usados)
await brain.recordContextUsage(ctx, {
  pack,
  responseId: assistantMessageId,
  consumer: "chat",
  usedLlm: true,
});
```

Regras:
- O Brain **nunca** consulta o banco inteiro; cada topic detectado dispara UMA
  query com `LIMIT` baixo e filtros de escopo estritos (`brand_id`, `client_id`,
  `project_id`, `period`).
- Todo item do `ContextPack` carrega `score` de relevância (0..1) usado para
  corte e ordenação.
- Provenance grava um evento `context.used` no Event Bus com os itens, seus
  scores e o `response_id` que os consumiu.

```ts
import { brain } from "@/lib/brain/api";

await brain.registerEvent(ctx, { source_module: "crm", event_type: "lead.created", payload });
await brain.learn(ctx, { job_type: "recompute-metrics" });
await brain.remember(ctx, { topic: "SLA médio de aprovação", summary: "…" });

const knowledge = await brain.searchKnowledge(ctx, { text: "posts atrasados" });
const hits      = await brain.runQuery(ctx, { query: "clientes com maior LTV" });

await brain.generateInsights(ctx, { insight_type: "pattern.retention", description: "…" });
await brain.recommend(ctx, { recommendation_type: "next-best-action", title: "…" });
await brain.relate(ctx, { source_type: "customer", source_id, target_type: "project", target_id, relationship_type: "owns" });

const patterns    = await brain.findPatterns(ctx);
const contextPack = await brain.getContext(ctx, { topic: "campanha Q4" });
const brief       = await brain.summarize(ctx);
const nextActions = await brain.getRecommendations(ctx);
```

> Regra: novos módulos **só** usam esta API. Os namespaces internos
> (`brain.memory`, `brain.insights`, `brain.chat`, …) seguem expostos para
> compat, mas são detalhes de implementação do Brain.

## Boundary rules

1. Apenas arquivos sob `src/lib/brain/**` podem `.from("brain_*")` ou `.rpc(...)` que toca tabelas Brain.
2. Módulos internos dependem **apenas** de `./core` — nunca de módulos irmãos.
   Composições vivem em `api.ts`.
3. Chamadas ao LLM ficam em `.server.ts` (server-only) para bloquear inclusão
   no bundle client.
4. `BrainContext` carrega o supabase autenticado (RLS aplicada como o usuário);
   nunca use `supabaseAdmin` sem verificar o papel do chamador antes.

## Layout físico

```
src/lib/brain/
├── api.ts               ← única porta pública (`import { brain } from "@/lib/brain/api"`)
├── core/                ← BrainContext + tipos compartilhados
├── event-bus/           ← publish/subscribe de brain_events
├── memory/              ← memory store + lifecycle (evolve, touch, decay, versions)
├── graph/               ← knowledge graph
├── insights/            ← insights ativos
├── recommendations/     ← recomendações ativas
├── learning/            ← fila e worker de aprendizado
├── query/               ← busca semântica e stats
├── chat-gateway/        ← consolidação Brain-first + LLM fallback
├── context-engine/      ← ContextPack escopado por pergunta
├── stream/              ← hook React (useBrainStream)
├── ingest-quiet.server  ← ingest fire-and-forget para consumidores externos
├── services.ts          ← 12 métodos de alto nível
└── legacy/              ← server fns oficiais que ainda expõem RPC via TanStack
                          (após Fase 1, apenas as com consumidor ativo: consolidate,
                          graph, intelligence, widget, embed). Roadmap de migração
                          em DEPRECATION.md.
```

Todos os arquivos `src/lib/brain-*.functions.ts` e `src/hooks/use-brain-stream.tsx`
foram **movidos** para `src/lib/brain/legacy/` e `src/lib/brain/stream/`. Os
antigos caminhos não existem mais — consumidores externos devem apontar para
`@/lib/brain/api`.

## Guardrails

- **ESLint** (`eslint.config.js`):
  - `no-restricted-imports` bloqueia `@/lib/brain-*` e `@/hooks/use-brain-stream`
    fora de `src/lib/brain/**`.
  - `no-restricted-syntax` bloqueia `.from("brain_*")` fora de
    `src/lib/brain/**`.
- **Client-safety**: `api.ts` só faz re-export top-level de módulos client-safe.
  Helpers server-only (`ingest-quiet.server`, `chat-gateway/llm.server`,
  `brain-consolidate`, `brain-retrieve`) são carregados via `await import(...)`
  ou consumidos apenas por server routes.

## Fase 1 — Deduplicação

Consulte [`DEPRECATION.md`](./DEPRECATION.md) para o relatório completo de
arquivos **Migrados / Mantidos / Deprecados / Removidos** e o roadmap das
próximas fases (2–4).