// ⚠️ Brain Context Engine — assembler principal.
//
// Monta um ContextPack REDUZIDO com apenas os fragmentos relevantes para a
// pergunta atual. O Brain NUNCA consulta o banco inteiro: cada topic detectado
// dispara uma única query com LIMIT baixo e filtros de escopo estritos.
//
// Escopo aplicado a TODA query: brand_id, client_id (se presente),
// project_id (se presente), period (se presente).
import { bucket } from "../observability";
import type { BrainContext, BrainStats } from "../core";
import * as memory from "../memory";
import * as insights from "../insights";
import * as recommendations from "../recommendations";
import * as query from "../query";
import { withCache, hashKey } from "../cache";
import { detectIntent, type DetectedIntent, type IntentTopic } from "./intent";
import { relevanceScore } from "./scoring";

const MAX_PER_BUCKET = 6;
const MIN_SCORE = 0.15;

export interface ContextItem<T = unknown> {
  kind: "memory" | "insight" | "recommendation" | "semantic" | "stat";
  id?: string;
  label: string;
  detail: string;
  score: number;
  confidence?: number | null;
  data?: T;
}

export interface ContextScope {
  brandId: string | null;
  clientId: string | null;
  projectId: string | null;
  module: string | null;
  period: { from?: string | null; to?: string | null } | null;
  permissions: string[];
}

export interface ContextPack {
  question: string;
  intent: DetectedIntent;
  scope: ContextScope;
  items: ContextItem[];
  stats: BrainStats;
  markdown: string;
  /** Contagem de itens candidatos ANTES do corte por relevância. */
  candidateCount: number;
  /**
   * Buckets que FALHARAM ao carregar. Um pacote degradado não é um pacote
   * vazio: a falha aparece no markdown enviado ao LLM e no diagnóstico, para
   * o Brain nunca "parecer sem memória" quando na verdade houve erro.
   */
  failures: string[];
}

export async function build(
  ctx: BrainContext,
  args: { question: string; module?: string | null },
): Promise<ContextPack> {
  const cacheKey = `brain:ctx:${ctx.brandId ?? "-"}:${ctx.clientId ?? "-"}:${ctx.projectId ?? "-"}:${args.module ?? "-"}:${hashKey(args.question.trim().toLowerCase())}`;
  return withCache<ContextPack>(cacheKey, 30_000, () => buildUncached(ctx, args));
}

async function buildUncached(
  ctx: BrainContext,
  args: { question: string; module?: string | null },
): Promise<ContextPack> {
  const intent = detectIntent(args.question);
  const scope: ContextScope = {
    brandId: ctx.brandId ?? null,
    clientId: ctx.clientId ?? null,
    projectId: ctx.projectId ?? null,
    module: args.module ?? ctx.module ?? null,
    period: ctx.period ?? (intent.period ? intent.period : null),
    permissions: ctx.permissions ?? [],
  };

  const wantsStats = intent.topics.some((t) =>
    (["posts", "tasks", "projects", "general"] as IntentTopic[]).includes(t),
  );

  const [memB, insB, recB, semB, statsB] = await Promise.all([
    bucket("memory.list", [] as Awaited<ReturnType<typeof memory.list>>, () =>
      memory.list(ctx, { limit: 20 }),
    ),
    bucket("insights.list", [] as Awaited<ReturnType<typeof insights.list>>, () =>
      intent.topics.includes("insights") || intent.topics.includes("general")
        ? insights.list(ctx, { limit: 15 })
        : Promise.resolve([]),
    ),
    bucket("recommendations.list", [] as Awaited<ReturnType<typeof recommendations.list>>, () =>
      intent.topics.includes("recommendations") || intent.topics.includes("general")
        ? recommendations.list(ctx, { limit: 10 })
        : Promise.resolve([]),
    ),
    bucket("query.semantic", [] as Awaited<ReturnType<typeof query.semantic>>, () =>
      args.question
        ? query.semantic(ctx, { query: args.question, matchCount: 6 })
        : Promise.resolve([]),
    ),
    bucket("query.stats", {} as BrainStats, () =>
      wantsStats ? query.stats(ctx) : Promise.resolve({} as BrainStats),
    ),
  ]);

  const memRows = memB.data;
  const activeInsights = insB.data;
  const activeRecs = recB.data;
  const semantic = semB.data;
  const stats = statsB.data;
  const failures = [memB.failure, insB.failure, recB.failure, semB.failure, statsB.failure].filter(
    (f): f is string => !!f,
  );

  const items: ContextItem[] = [];
  let candidateCount = 0;

  for (const m of memRows) {
    candidateCount++;
    const score = relevanceScore(
      { text: `${m.title} ${m.description} ${m.category}`, confidence: m.confidence },
      intent.keywords,
    );
    items.push({
      kind: "memory",
      label: m.title,
      detail: m.description,
      score,
      confidence: m.confidence,
    });
  }
  for (const i of activeInsights) {
    candidateCount++;
    const score = relevanceScore(
      { text: `${i.insight_type} ${i.description}`, confidence: i.confidence },
      intent.keywords,
    );
    items.push({
      kind: "insight",
      label: i.insight_type,
      detail: i.description,
      score,
      confidence: i.confidence,
    });
  }
  for (const r of activeRecs as Array<{
    id?: string;
    title: string;
    description?: string | null;
    confidence?: number | null;
  }>) {
    candidateCount++;
    const score = relevanceScore(
      { text: `${r.title} ${r.description ?? ""}`, confidence: r.confidence ?? null },
      intent.keywords,
    );
    items.push({
      kind: "recommendation",
      id: r.id,
      label: r.title,
      detail: r.description ?? "",
      score,
      confidence: r.confidence ?? null,
    });
  }
  for (const s of semantic) {
    candidateCount++;
    items.push({
      kind: "semantic",
      label: s.event_type,
      detail: s.content_summary,
      score: Math.max(MIN_SCORE, Math.min(1, s.similarity)),
      confidence: s.similarity,
    });
  }
  for (const [k, v] of Object.entries(stats)) {
    if (typeof v !== "number") continue;
    candidateCount++;
    items.push({
      kind: "stat",
      label: k,
      detail: String(v),
      score: intent.keywords.some((kw) => k.includes(kw)) ? 0.9 : 0.5,
    });
  }

  const pruned = items
    .filter((i) => i.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_BUCKET * 4);

  return {
    question: args.question,
    intent,
    scope,
    items: pruned,
    stats,
    markdown: renderMarkdown(pruned, stats, scope, failures),
    candidateCount,
    failures,
  };
}

function renderMarkdown(
  items: ContextItem[],
  stats: BrainStats,
  scope: ContextScope,
  failures: string[] = [],
): string {
  const parts: string[] = [];
  if (failures.length) {
    // O LLM precisa saber que o contexto está INCOMPLETO por falha técnica —
    // e não concluir que "não há histórico".
    parts.push(
      `### ⚠️ Contexto incompleto (falha técnica)\nAlgumas fontes do Brain não puderam ser lidas nesta consulta. NÃO afirme que não existe histórico ou memória; sinalize a indisponibilidade.\n${failures
        .map((f) => `- ${f}`)
        .join("\n")}`,
    );
  }
  const scopeLine = [
    scope.brandId ? `workspace:${scope.brandId.slice(0, 8)}` : "workspace:agência",
    scope.clientId ? `cliente:${scope.clientId.slice(0, 8)}` : null,
    scope.projectId ? `projeto:${scope.projectId.slice(0, 8)}` : null,
    scope.module ? `módulo:${scope.module}` : null,
    scope.period?.from
      ? `período:${scope.period.from.slice(0, 10)}→${(scope.period.to ?? "").slice(0, 10)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  parts.push(`### Escopo do contexto\n${scopeLine}`);

  const byKind = <K extends ContextItem["kind"]>(kind: K) =>
    items.filter((i) => i.kind === kind).slice(0, MAX_PER_BUCKET);

  const fmtScore = (n: number) => `_(rel ${Math.round(n * 100)}%)_`;

  const mems = byKind("memory");
  if (mems.length) {
    parts.push(
      `### Memórias relevantes\n${mems
        .map((m) => `- **${m.label}** ${fmtScore(m.score)}: ${m.detail}`)
        .join("\n")}`,
    );
  }
  const ins = byKind("insight");
  if (ins.length) {
    parts.push(
      `### Insights ativos\n${ins.map((i) => `- (${i.label}) ${fmtScore(i.score)} ${i.detail}`).join("\n")}`,
    );
  }
  const recs = byKind("recommendation");
  if (recs.length) {
    parts.push(
      `### Recomendações\n${recs.map((r) => `- ${r.label} ${fmtScore(r.score)}`).join("\n")}`,
    );
  }
  const sem = byKind("semantic");
  if (sem.length) {
    parts.push(
      `### Memórias semânticas\n${sem.map((s) => `- ${s.detail} ${fmtScore(s.score)}`).join("\n")}`,
    );
  }
  if (Object.keys(stats).length) {
    parts.push(
      `### Métricas do escopo\n${Object.entries(stats)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n")}`,
    );
  }
  return `## Contexto do Brain\n${parts.join("\n\n")}`;
}
