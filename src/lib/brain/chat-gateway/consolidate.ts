// ⚠️ Brain Chat Gateway — consolidação de contexto para respostas conversacionais.
// Nunca acessa tabelas brain_* diretamente: compõe via memory / insights / query.
import type {
  BrainContext,
  BrainInsightRow,
  BrainMemoryRow,
  SemanticMemoryHit,
  BrainStats,
} from "../core";
import * as memory from "../memory";
import * as insights from "../insights";
import * as query from "../query";

export interface BrainConsolidated {
  memories: SemanticMemoryHit[];
  insights: Array<{ description: string; insight_type: string; confidence: number | null }>;
  /** Projeção enxuta de memórias (title/description) usada pelo LLM. */
  memoryRows: Array<{
    title: string;
    description: string;
    confidence: number | null;
    scope?: BrainMemoryRow["scope"];
  }>;
  stats: BrainStats;
  markdown: string;
}

export async function consolidate(
  ctx: BrainContext,
  args: { query: string },
): Promise<BrainConsolidated> {
  const [semanticHits, activeInsights, memRows, stats] = await Promise.all([
    query.semantic(ctx, { query: args.query, matchCount: 6 }),
    insights.list(ctx, { limit: 15 }),
    memory.list(ctx, { limit: 15 }),
    query.stats(ctx),
  ]);

  const insightsProjected = activeInsights.slice(0, 8).map((r: BrainInsightRow) => ({
    insight_type: r.insight_type,
    description: r.description,
    confidence: r.confidence,
  }));

  const memoryRowsProjected = memRows.slice(0, 8);

  const parts: string[] = [];
  if (Object.keys(stats).length) {
    parts.push(
      `### Estatísticas atuais\n${Object.entries(stats)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")}`,
    );
  }
  if (memoryRowsProjected.length) {
    parts.push(
      `### Memórias consolidadas\n${memoryRowsProjected
        .map(
          (m) =>
            `- **${m.title}**${m.confidence != null ? ` _(conf ${Math.round((m.confidence ?? 0) * 100)}%)_` : ""} _[${m.scope}]_: ${m.description}`,
        )
        .join("\n")}`,
    );
  }
  if (insightsProjected.length) {
    parts.push(
      `### Insights ativos\n${insightsProjected
        .map(
          (i) =>
            `- (${i.insight_type}${i.confidence != null ? ` · ${Math.round((i.confidence ?? 0) * 100)}%` : ""}) ${i.description}`,
        )
        .join("\n")}`,
    );
  }
  if (semanticHits.length) {
    parts.push(
      `### Memórias semânticas (top)\n${semanticHits
        .map((m) => `- ${m.content_summary} _(sim ${m.similarity.toFixed(2)})_`)
        .join("\n")}`,
    );
  }

  return {
    memories: semanticHits,
    insights: insightsProjected,
    memoryRows: memoryRowsProjected,
    stats,
    markdown: parts.length ? `## Conhecimento do Brain\n${parts.join("\n\n")}` : "",
  };
}

/**
 * Tenta responder sem LLM quando há um match semântico muito forte.
 * Retorna null quando o LLM deve ser acionado.
 */
export function tryDirectAnswer(question: string, ctx: BrainConsolidated): string | null {
  if (!question) return null;
  const top = ctx.memories[0];
  if (top && top.similarity >= 0.9 && question.length < 180) {
    return `**Encontrei no Brain (memória semelhante, ${(top.similarity * 100).toFixed(0)}%):**\n\n${top.content_summary}`;
  }
  return null;
}
