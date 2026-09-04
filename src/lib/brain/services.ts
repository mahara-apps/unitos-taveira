// ============================================================================
// Brain Services — API pública de alto nível.
//
// Estes 12 métodos são o contrato oficial que os módulos da plataforma (Chat,
// Projetos, CRM, Conteúdo, Analytics, Financeiro, Automações, Agentes,
// Dashboard) devem consumir. Nenhum módulo deve acessar `brain_*` direto.
//
//   brain.learn()                brain.relate()
//   brain.remember()             brain.findPatterns()
//   brain.searchKnowledge()      brain.registerEvent()
//   brain.generateInsights()     brain.getContext()
//   brain.recommend()            brain.summarize()
//   brain.query()                brain.getRecommendations()
// ============================================================================
import * as events from "./event-bus";
import * as memory from "./memory";
import * as graph from "./graph";
import * as insights from "./insights";
import * as recommendations from "./recommendations";
import * as learning from "./learning";
import * as query from "./query";
import * as chatGw from "./chat-gateway";
import * as context from "./context-engine";
import { getNicheFallbackMarkdown } from "./context-engine/niche-fallback";
import type { BrainContext, BrainEventInput } from "./core";

// ----------------------------------------------------------------------------
// 1. registerEvent — publica um evento no Event Bus (assíncrono, best-effort).
// ----------------------------------------------------------------------------
export async function registerEvent(
  ctx: BrainContext,
  event: Omit<BrainEventInput, "brand_id"> & { brand_id?: string | null },
): Promise<void> {
  await events.publish(ctx, {
    brand_id: event.brand_id ?? ctx.brandId ?? null,
    client_id: event.client_id ?? ctx.clientId ?? null,
    source_module: event.source_module,
    event_type: event.event_type,
    payload: event.payload,
  });
}

// ----------------------------------------------------------------------------
// 2. learn — enfileira um job de aprendizado assíncrono.
// ----------------------------------------------------------------------------
// Aprender NÃO é uma fila paralela: todo evento registrado por `registerEvent`
// já entra na fila de aprendizado pelo trigger do banco. Portanto `learn` apenas
// registra a evidência como evento (com `learning: true` no payload) — nunca
// insere um segundo item na fila para o mesmo fato.
export async function learn(
  ctx: BrainContext,
  args: { job_type: string; payload?: Record<string, unknown> },
): Promise<void> {
  await registerEvent(ctx, {
    source_module: "brain.learning",
    event_type: args.job_type,
    payload: { ...(args.payload ?? {}), learning: true },
  });
}

/** Reprocessa um evento específico já registrado. */
export const requeueLearningEvent = learning.requeueEvent;
export const learningFailed = learning.failed;

// ----------------------------------------------------------------------------
// 3. remember — persiste uma memória consolidada no Memory Store.
// ----------------------------------------------------------------------------
export const remember = memory.remember;

/**
 * evolve — upsert-com-evidência. Sempre preferir sobre `remember` quando houver
 * uma entidade identificável, para evitar memórias duplicadas e permitir que o
 * score de confiança evolua com novas evidências.
 */
export const evolveMemory = memory.evolve;
export const touchMemories = memory.touch;
export const memoryVersions = memory.versions;
export const decayMemories = memory.decay;

// ----------------------------------------------------------------------------
// 4. searchKnowledge — busca híbrida (semântica + textual) em memórias.
// ----------------------------------------------------------------------------
export async function searchKnowledge(ctx: BrainContext, args: { text: string; limit?: number }) {
  const [semantic, textual] = await Promise.all([
    query.semantic(ctx, { query: args.text, matchCount: args.limit ?? 6 }),
    memory.search(ctx, { text: args.text, limit: args.limit ?? 10 }),
  ]);
  return { semantic, textual };
}

// ----------------------------------------------------------------------------
// 5. query — busca semântica pura (embeddings + pgvector).
// ----------------------------------------------------------------------------
export const query_ = query.semantic;

// ----------------------------------------------------------------------------
// 6. generateInsights — cria um insight ativo no Insight Engine.
// ----------------------------------------------------------------------------
export const generateInsights = insights.create;

// ----------------------------------------------------------------------------
// 7. findPatterns — retorna insights do tipo padrão descoberto.
// ----------------------------------------------------------------------------
export const findPatterns = insights.patterns;

// ----------------------------------------------------------------------------
// 8. recommend — cria uma recomendação no Recommendation Engine.
// ----------------------------------------------------------------------------
export const recommend = recommendations.create;

// ----------------------------------------------------------------------------
// 9. getRecommendations — lista recomendações ativas.
// ----------------------------------------------------------------------------
export const getRecommendations = recommendations.list;

// ----------------------------------------------------------------------------
// 10. relate — cria uma aresta no Knowledge Graph.
// ----------------------------------------------------------------------------
export const relate = graph.relate;

// ----------------------------------------------------------------------------
// 11. getContext — contexto consolidado do Brain para um tema/pergunta.
//     Base do Chat Brain-first; reutilizável por Agentes e Automações.
// ----------------------------------------------------------------------------
export async function getContext(
  ctx: BrainContext,
  args: { topic: string; nicheHint?: string | null },
) {
  const pack = await chatGw.consolidate(ctx, { query: args.topic });
  const isColdStart =
    !pack.markdown ||
    (pack.memoryRows.length === 0 && pack.insights.length === 0 && pack.memories.length === 0);
  if (isColdStart) {
    const fb = getNicheFallbackMarkdown(args.nicheHint ?? null);
    return { ...pack, markdown: fb };
  }
  return pack;
}

// ----------------------------------------------------------------------------
// 11b. buildContext — Context Engine: monta um ContextPack escopado e scored.
// ----------------------------------------------------------------------------
export async function buildContext(
  ctx: BrainContext,
  args: { question: string; module?: string | null },
) {
  return context.build(ctx, args);
}

// ----------------------------------------------------------------------------
// 11c. recordContextUsage — registra provenance (memórias/insights usados).
// ----------------------------------------------------------------------------
export async function recordContextUsage(
  ctx: BrainContext,
  input: context.ProvenanceInput,
): Promise<void> {
  await context.record(ctx, input);
}

// ----------------------------------------------------------------------------
// 12. summarize — snapshot textual do estado atual do Brain no escopo.
// ----------------------------------------------------------------------------
export async function summarize(ctx: BrainContext): Promise<string> {
  const [mems, ins, recs, stats] = await Promise.all([
    memory.list(ctx, { limit: 5 }),
    insights.list(ctx, { limit: 5 }),
    recommendations.list(ctx, { limit: 5 }),
    query.stats(ctx),
  ]);
  const lines: string[] = [];
  lines.push(
    `Operação: ${stats.projects ?? 0} projetos · ${stats.tasks ?? 0} tarefas · ${stats.posts ?? 0} posts.`,
  );
  if (mems.length) {
    lines.push("Memórias-chave:");
    for (const m of mems) lines.push(`- ${m.title}: ${m.description}`);
  }
  if (ins.length) {
    lines.push("Insights ativos:");
    for (const i of ins) lines.push(`- [${i.insight_type}] ${i.description}`);
  }
  if (recs.length) {
    lines.push("Recomendações:");
    for (const r of recs) lines.push(`- ${r.title}`);
  }
  return lines.join("\n");
}
