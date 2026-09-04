// Leitura agregada para o painel de inteligência do Brain.
// ⚠️ SOMENTE LEITURA: nenhuma escrita, nenhum efeito no pipeline de aprendizado.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BrainEvidence,
  BrainHealth,
  BrainLearning,
  BrainLearningDetail,
  BrainOverview,
  BrainScopeFilter,
  BrainTimelineDay,
  BrainTimelineItem,
  LearningScope,
} from "./overview.types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const AGENT_LABELS: Record<string, string> = {
  copywriter_senior: "Copywriter Sênior",
  roteirista_social: "Roteirista Social",
  art_director_social: "Direção de Arte",
  pauta: "Módulo de Pauta",
};

type MemoryRow = {
  id: string;
  scope: string | null;
  category: string | null;
  title: string | null;
  description: string | null;
  confidence: number | null;
  previous_confidence: number | null;
  reinforcement_count: number | null;
  contradiction_count: number | null;
  version: number | null;
  origin: string | null;
  content: Record<string, unknown> | null;
  client_id: string | null;
  last_observed_at: string | null;
  updated_at: string | null;
  created_at?: string | null;
  source_refs?: unknown;
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function normalizeScope(raw: string | null): LearningScope {
  return raw === "client" || raw === "global" ? raw : "brand";
}

function evidenceOf(content: Record<string, unknown> | null): BrainEvidence | null {
  if (!content) return null;
  const approved = num(content["approved"]);
  const rework = num(content["rework"]) + num(content["adjust"]);
  const rejected = num(content["rejected"]);
  const sample = num(content["sample"]) || num(content["sample_size"]);
  const total = sample || approved + rework + rejected;
  if (!total) return null;
  return { total, approved, rework, rejected };
}

function toLearning(row: MemoryRow, clientNames: Map<string, string>): BrainLearning {
  const content = row.content ?? null;
  const sample = num(content?.["sample"]) || num(content?.["sample_size"]);
  return {
    id: row.id,
    title: row.title ?? row.category ?? "Aprendizado",
    conclusion: row.description ?? "",
    confidence: num(row.confidence),
    previousConfidence: row.previous_confidence == null ? null : num(row.previous_confidence),
    scope: normalizeScope(row.scope),
    category: row.category,
    clientName: row.client_id ? (clientNames.get(row.client_id) ?? null) : null,
    sample,
    reinforcement: num(row.reinforcement_count),
    contradictions: num(row.contradiction_count),
    version: num(row.version) || 1,
    origin: row.origin,
    windowDays: content?.["window_days"] != null ? num(content["window_days"]) : null,
    channel: str(content?.["top_channel"]) ?? str(content?.["channel"]),
    format: str(content?.["top_format"]) ?? str(content?.["format"]),
    lastObservedAt: row.last_observed_at,
    updatedAt: row.updated_at ?? new Date().toISOString(),
    evidence: evidenceOf(content),
  };
}

/** Filtro de escopo — preserva o isolamento existente (global/marca/cliente). */
function scopeOr(scope: BrainScopeFilter, brandId: string | null, clientId: string | null): string {
  const parts: string[] = ["and(scope.eq.global,brand_id.is.null)"];
  if (scope === "global") return parts[0]!;
  if (brandId) parts.push(`and(scope.eq.brand,brand_id.eq.${brandId})`);
  if (scope === "client" && clientId) {
    parts.push(`and(scope.eq.client,client_id.eq.${clientId})`);
  }
  return parts.join(",");
}

const MEMORY_COLS =
  "id, scope, category, title, description, confidence, previous_confidence, reinforcement_count, contradiction_count, version, origin, content, client_id, last_observed_at, updated_at, created_at";

export async function buildBrainOverview(
  sb: SupabaseClient,
  args: {
    brandId: string | null;
    clientId: string | null;
    scope: BrainScopeFilter;
    days: number;
  },
): Promise<BrainOverview> {
  const { brandId, clientId, scope, days } = args;
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  const or = scopeOr(scope, brandId, clientId);
  const brandScoped = (q: any) => (brandId ? q.eq("brand_id", brandId) : q);

  const memQ = sb
    .from("brain_memory")
    .select(MEMORY_COLS)
    .eq("status", "active")
    .or(or)
    .order("confidence", { ascending: false })
    .limit(60);

  const insightsQ = brandScoped(
    sb
      .from("brain_insights")
      .select(
        "id, insight_type, description, confidence, based_on_events, scope, client_id, created_at, expires_at",
      )
      .order("confidence", { ascending: false })
      .limit(40),
  );

  const recsQ = brandScoped(
    sb
      .from("brain_recommendations")
      .select(
        "id, recommendation_type, title, description, confidence, priority, status, client_id, created_at, expires_at",
      )
      .order("created_at", { ascending: false })
      .limit(30),
  );

  const versionsQ = brandScoped(
    sb
      .from("brain_memory_versions")
      .select(
        "memory_id, version, confidence, previous_confidence, change_reason, title, created_at",
      )
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(400),
  );

  const events24hQ = brandScoped(
    sb
      .from("brain_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString()),
  );

  const activeMemQ = brandScoped(
    sb.from("brain_memory").select("id", { count: "exact", head: true }).eq("status", "active"),
  );

  const queuePendingQ = brandScoped(
    sb
      .from("brain_learning_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued"),
  );
  const queueFailedQ = brandScoped(
    sb
      .from("brain_learning_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
  );

  const workerRunsQ = sb
    .from("brain_worker_runs")
    .select("job_name, status, started_at, error")
    .order("started_at", { ascending: false })
    .limit(50);

  const clientsQ = brandScoped(sb.from("clients").select("id, name").order("name").limit(200));

  const [
    memR,
    insightsR,
    recsR,
    versionsR,
    events24h,
    activeMem,
    queuePending,
    queueFailed,
    workerRunsR,
    clientsR,
  ] = await Promise.all([
    memQ,
    insightsQ,
    recsQ,
    versionsQ,
    events24hQ,
    activeMemQ,
    queuePendingQ,
    queueFailedQ,
    workerRunsQ,
    clientsQ,
  ]);

  const clientNames = new Map<string, string>(
    ((clientsR.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );

  const memories = (memR.data ?? []) as MemoryRow[];
  const learnings = memories.map((m) => toLearning(m, clientNames));

  const avgConfidence = learnings.length
    ? learnings.reduce((a, l) => a + l.confidence, 0) / learnings.length
    : null;

  // Evidências agregadas (somente somas reais das memórias em escopo).
  let evidenceOutcomes: BrainEvidence | null = null;
  for (const l of learnings) {
    if (!l.evidence) continue;
    evidenceOutcomes ??= { total: 0, approved: 0, rework: 0, rejected: 0 };
    evidenceOutcomes.total += l.evidence.total;
    evidenceOutcomes.approved += l.evidence.approved;
    evidenceOutcomes.rework += l.evidence.rework;
    evidenceOutcomes.rejected += l.evidence.rejected;
  }
  if (
    evidenceOutcomes &&
    evidenceOutcomes.approved + evidenceOutcomes.rework + evidenceOutcomes.rejected === 0
  ) {
    evidenceOutcomes = null;
  }

  const now = Date.now();
  const insights = ((insightsR.data ?? []) as any[])
    .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
    .filter((r) =>
      scope === "client" && clientId ? !r.client_id || r.client_id === clientId : true,
    )
    .slice(0, 8)
    .map((r) => ({
      id: r.id as string,
      type: r.insight_type as string,
      description: r.description as string,
      confidence: num(r.confidence),
      basedOnEvents: num(r.based_on_events),
      scope: normalizeScope(r.scope ?? null),
      createdAt: r.created_at as string,
      expiresAt: (r.expires_at ?? null) as string | null,
    }));

  const recommendations = ((recsR.data ?? []) as any[])
    .filter((r) => !r.status || r.status === "pending" || r.status === "active")
    .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
    .filter((r) =>
      scope === "client" && clientId ? !r.client_id || r.client_id === clientId : true,
    )
    .slice(0, 8)
    .map((r) => ({
      id: r.id as string,
      type: (r.recommendation_type ?? "recomendação") as string,
      title: (r.title ?? "Recomendação") as string,
      description: (r.description ?? null) as string | null,
      confidence: num(r.confidence),
      priority: r.priority == null ? null : num(r.priority),
      scope: (r.client_id ? "client" : "brand") as LearningScope,
      createdAt: r.created_at as string,
    }));

  // ---- Timeline / séries: apenas eventos reais de aprendizado ----
  const scopedMemoryIds = new Set(memories.map((m) => m.id));
  const versions = ((versionsR.data ?? []) as any[]).filter((v) =>
    scopedMemoryIds.size ? scopedMemoryIds.has(v.memory_id) : true,
  );

  const dayMap = new Map<string, BrainTimelineItem[]>();
  const pushDay = (at: string, item: BrainTimelineItem) => {
    const day = at.slice(0, 10);
    const list = dayMap.get(day) ?? [];
    list.push(item);
    dayMap.set(day, list);
  };

  for (const m of memories) {
    if (m.created_at && m.created_at >= sinceIso) {
      pushDay(m.created_at, {
        kind: "memory_created",
        at: m.created_at,
        text: `Novo padrão identificado: ${m.title ?? m.category ?? "aprendizado"}`,
      });
    }
  }
  for (const v of versions) {
    const delta = num(v.confidence) - num(v.previous_confidence);
    const arrow = delta > 0.001 ? "↑" : delta < -0.001 ? "↓" : "•";
    pushDay(v.created_at as string, {
      kind: "confidence_updated",
      at: v.created_at as string,
      text: `${v.title ?? "Memória"} — confiança ${arrow} ${Math.round(num(v.confidence) * 100)}%${
        v.change_reason ? ` (${v.change_reason})` : ""
      }`,
    });
  }
  for (const i of insights) {
    if (i.createdAt >= sinceIso) {
      pushDay(i.createdAt, {
        kind: "insight",
        at: i.createdAt,
        text: `Insight consolidado: ${i.description}`,
      });
    }
  }

  const timeline: BrainTimelineDay[] = Array.from(dayMap.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 14)
    .map(([day, items]) => ({
      day,
      items: items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 6),
    }));

  const trendMap = new Map<string, { created: number; updated: number }>();
  for (const m of memories) {
    if (!m.created_at || m.created_at < sinceIso) continue;
    const day = m.created_at.slice(0, 10);
    const cur = trendMap.get(day) ?? { created: 0, updated: 0 };
    cur.created += 1;
    trendMap.set(day, cur);
  }
  for (const v of versions) {
    const day = (v.created_at as string).slice(0, 10);
    const cur = trendMap.get(day) ?? { created: 0, updated: 0 };
    cur.updated += 1;
    trendMap.set(day, cur);
  }
  const learningTrend = Array.from(trendMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, v]) => ({ day, ...v }));

  const confMap = new Map<string, { sum: number; n: number }>();
  for (const v of versions) {
    const day = (v.created_at as string).slice(0, 10);
    const cur = confMap.get(day) ?? { sum: 0, n: 0 };
    cur.sum += num(v.confidence);
    cur.n += 1;
    confMap.set(day, cur);
  }
  const confidenceTrend = Array.from(confMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, v]) => ({ day, confidence: v.sum / v.n }));

  // ---- Saúde ----
  const runs = (workerRunsR.data ?? []) as Array<{
    job_name: string | null;
    status: string | null;
    started_at: string;
    error: string | null;
  }>;
  const lastRun = runs[0] ?? null;
  const minutesSinceWorkerRun = lastRun
    ? Math.round((now - new Date(lastRun.started_at).getTime()) / 60_000)
    : null;
  const since24h = now - 86_400_000;
  const failures24h = runs.filter(
    (r) => r.status === "error" && new Date(r.started_at).getTime() >= since24h,
  ).length;
  const lastMining =
    runs.find((r) => (r.job_name ?? "").includes("mining"))?.started_at ??
    memories
      .filter((m) => m.origin === "mining")
      .map((m) => m.updated_at ?? "")
      .sort()
      .at(-1) ??
    null;

  const reasons: string[] = [];
  if (!lastRun) reasons.push("Nenhuma execução do worker registrada.");
  if (lastRun && (minutesSinceWorkerRun ?? 0) > 30)
    reasons.push(`Worker sem execução há ${minutesSinceWorkerRun} min.`);
  if (failures24h > 0) reasons.push(`${failures24h} falha(s) do worker em 24h.`);
  if ((queueFailed.count ?? 0) > 0)
    reasons.push(`${queueFailed.count} item(ns) na fila com falha.`);
  if ((queuePending.count ?? 0) > 50)
    reasons.push(`${queuePending.count} eventos aguardando processamento.`);

  const status: BrainHealth["status"] =
    !lastRun || failures24h > 3 ? "critical" : reasons.length ? "warning" : "healthy";

  const health: BrainHealth = {
    status,
    reasons,
    eventsProcessed24h: events24h.count ?? 0,
    lastWorkerRunAt: lastRun?.started_at ?? null,
    lastWorkerStatus: lastRun?.status ?? null,
    minutesSinceWorkerRun,
    failures24h,
    lastMiningAt: lastMining || null,
    activeMemories: activeMem.count ?? 0,
    activeInsights: insights.length,
    queuePending: queuePending.count ?? 0,
    queueFailed: queueFailed.count ?? 0,
  };

  return {
    generatedAt: new Date().toISOString(),
    scope,
    days,
    avgConfidence,
    learnings,
    timeline,
    learningTrend,
    confidenceTrend,
    evidenceOutcomes,
    insights,
    recommendations,
    health,
    clientsAvailable: Array.from(clientNames.entries()).map(([id, name]) => ({ id, name })),
  };
}

export async function buildLearningDetail(
  sb: SupabaseClient,
  memoryId: string,
): Promise<BrainLearningDetail | null> {
  const { data: row } = await sb
    .from("brain_memory")
    .select(`${MEMORY_COLS}, source_refs`)
    .eq("id", memoryId)
    .maybeSingle();
  if (!row) return null;

  const mem = row as MemoryRow;
  const clientNames = new Map<string, string>();
  if (mem.client_id) {
    const { data: c } = await sb
      .from("clients")
      .select("id, name")
      .eq("id", mem.client_id)
      .maybeSingle();
    if (c) clientNames.set(c.id as string, c.name as string);
  }

  const refs = Array.isArray(mem.source_refs)
    ? (mem.source_refs as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const [versionsR, eventsR] = await Promise.all([
    sb
      .from("brain_memory_versions")
      .select("version, confidence, previous_confidence, change_reason, created_at")
      .eq("memory_id", memoryId)
      .order("version", { ascending: true })
      .limit(40),
    refs.length
      ? sb
          .from("brain_events")
          .select("id, event_type, source_module, action, created_at")
          .in("id", refs.slice(0, 25))
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const { AGENT_PROFILES } = await import("./agent-context.server");
  const category = mem.category;
  const usedBy = category
    ? Object.entries(AGENT_PROFILES)
        .filter(([, p]) => p.categories.includes(category))
        .map(([key]) => AGENT_LABELS[key] ?? key)
    : [];

  return {
    learning: toLearning(mem, clientNames),
    confidenceHistory: ((versionsR.data ?? []) as any[]).map((v) => ({
      version: num(v.version) || 1,
      confidence: num(v.confidence),
      previousConfidence: v.previous_confidence == null ? null : num(v.previous_confidence),
      changeReason: (v.change_reason ?? null) as string | null,
      at: v.created_at as string,
    })),
    sourceEvents: ((eventsR.data ?? []) as any[]).map((e) => ({
      id: e.id as string,
      eventType: e.event_type as string,
      sourceModule: e.source_module as string,
      action: (e.action ?? null) as string | null,
      at: e.created_at as string,
    })),
    usedBy,
  };
}
