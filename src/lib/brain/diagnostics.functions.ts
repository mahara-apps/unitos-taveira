// ⚠️ Brain API boundary — parte da plataforma Brain.
// Painel temporário de diagnóstico do pipeline (Events → Learning → Memory
// → Embeddings → Insights → Recommendations).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  brandId: z.string().uuid().nullable().optional(),
});

export type BrainDiagnostics = {
  generatedAt: string;
  windows: {
    minute: WindowStats;
    hour: WindowStats;
    day: WindowStats;
    total: WindowStats;
  };
  /** Saúde do worker de aprendizado (pg_cron). Se estiver parado, o Brain
   *  não aprende — e isso precisa ser visível, não silencioso. */
  worker: {
    lastRunAt: string | null;
    lastStatus: string | null;
    lastDurationMs: number | null;
    lastError: string | null;
    minutesSinceLastRun: number | null;
    healthy: boolean;
    runs24h: number;
    failures24h: number;
    discarded24h: number;
    processed24h: number;
    memoriesTouched24h: number;
  };
  queue: {
    pending: number;
    running: number;
    failed: number;
    processedLastHour: number;
    avgProcessingMs: number | null;
    p95ProcessingMs: number | null;
    oldestPendingAgeSec: number | null;
  };
  recentEvents: Array<{
    id: string;
    event_type: string;
    source_module: string;
    created_at: string;
    processed_at: string | null;
  }>;
  recentMemories: Array<{
    id: string;
    memory_type: string;
    key: string;
    title: string | null;
    category: string | null;
    scope: string | null;
    version: number;
    confidence: number;
    updated_at: string;
    reinforcement_count: number;
  }>;
  recentInsights: Array<{
    id: string;
    insight_type: string;
    description: string;
    confidence: number;
    created_at: string;
  }>;
};

type WindowStats = {
  events: number;
  memoriesCreated: number;
  memoriesUpdated: number;
  relationshipsCreated: number;
  embeddings: number;
  insights: number;
  recommendations: number;
};

function isoAgo(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

async function windowStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  brandId: string | null,
  sinceIso: string | null,
): Promise<WindowStats> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = (q: any) => (brandId ? q.eq("brand_id", brandId) : q);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const since = (q: any, col: string) => (sinceIso ? q.gte(col, sinceIso) : q);
  const head = { count: "exact" as const, head: true };

  const [ev, mc, mu, rel, emb, ins, rec] = await Promise.all([
    since(scope(sb.from("brain_events").select("id", head)), "created_at"),
    since(scope(sb.from("brain_memory").select("id", head)), "created_at"),
    since(scope(sb.from("brain_memory_versions").select("id", head)), "created_at"),
    since(scope(sb.from("brain_relationships").select("id", head)), "created_at"),
    since(scope(sb.from("brain_embeddings").select("id", head)), "created_at"),
    since(scope(sb.from("brain_insights").select("id", head)), "created_at"),
    since(scope(sb.from("brain_recommendations").select("id", head)), "created_at"),
  ]);

  return {
    events: ev.count ?? 0,
    memoriesCreated: mc.count ?? 0,
    memoriesUpdated: mu.count ?? 0,
    relationshipsCreated: rel.count ?? 0,
    embeddings: emb.count ?? 0,
    insights: ins.count ?? 0,
    recommendations: rec.count ?? 0,
  };
}

export const brainDiagnosticsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<BrainDiagnostics> => {
    const sb = context.supabase;
    const brandId = data.brandId ?? null;

    const [minute, hour, day, total] = await Promise.all([
      windowStats(sb, brandId, isoAgo(60_000)),
      windowStats(sb, brandId, isoAgo(3_600_000)),
      windowStats(sb, brandId, isoAgo(86_400_000)),
      windowStats(sb, brandId, null),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scope = (q: any) => (brandId ? q.eq("brand_id", brandId) : q);

    const [pendingQ, runningQ, failedQ, processedQ, oldestPendingQ, timingsQ] = await Promise.all([
      scope(
        sb
          .from("brain_learning_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "queued"),
      ),
      scope(
        sb
          .from("brain_learning_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "running"),
      ),
      scope(
        sb
          .from("brain_learning_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "failed"),
      ),
      scope(
        sb
          .from("brain_learning_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "done")
          .gte("processed_at", isoAgo(3_600_000)),
      ),
      scope(
        sb
          .from("brain_learning_queue")
          .select("enqueued_at")
          .eq("status", "queued")
          .order("enqueued_at", { ascending: true })
          .limit(1),
      ),
      scope(
        sb
          .from("brain_learning_queue")
          .select("started_at,processed_at")
          .eq("status", "done")
          .gte("processed_at", isoAgo(3_600_000))
          .not("started_at", "is", null)
          .not("processed_at", "is", null)
          .limit(500),
      ),
    ]);

    const durations: number[] = (timingsQ.data ?? [])
      .map((r: { started_at: string | null; processed_at: string | null }) => {
        if (!r.started_at || !r.processed_at) return null;
        return new Date(r.processed_at).getTime() - new Date(r.started_at).getTime();
      })
      .filter((n: number | null): n is number => typeof n === "number" && n >= 0);

    const avg = durations.length
      ? Math.round(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
      : null;
    let p95: number | null = null;
    if (durations.length) {
      const sorted = [...durations].sort((a, b) => a - b);
      p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    }

    const oldestRow = (oldestPendingQ.data ?? [])[0] as { enqueued_at: string | null } | undefined;
    const oldestPendingAgeSec = oldestRow?.enqueued_at
      ? Math.round((Date.now() - new Date(oldestRow.enqueued_at).getTime()) / 1000)
      : null;

    // Saúde do worker: última execução + agregados de 24h.
    const [lastRunQ, runs24hQ] = await Promise.all([
      sb
        .from("brain_worker_runs")
        .select(
          "started_at,finished_at,status,duration_ms,error,processed,discarded,failed,memories_created,memories_updated",
        )
        .order("started_at", { ascending: false })
        .limit(1),
      sb
        .from("brain_worker_runs")
        .select("status,processed,discarded,failed,memories_created,memories_updated")
        .gte("started_at", isoAgo(86_400_000))
        .limit(2000),
    ]);

    type RunRow = {
      started_at: string;
      status: string | null;
      duration_ms: number | null;
      error: string | null;
      processed: number | null;
      discarded: number | null;
      failed: number | null;
      memories_created: number | null;
      memories_updated: number | null;
    };
    const lastRun = ((lastRunQ.data ?? [])[0] ?? null) as RunRow | null;
    const runs = (runs24hQ.data ?? []) as RunRow[];
    const sum = (k: keyof RunRow) =>
      runs.reduce((acc: number, r) => acc + (Number(r[k] ?? 0) || 0), 0);
    const minutesSinceLastRun = lastRun
      ? Math.round((Date.now() - new Date(lastRun.started_at).getTime()) / 60_000)
      : null;
    const worker = {
      lastRunAt: lastRun?.started_at ?? null,
      lastStatus: lastRun?.status ?? null,
      lastDurationMs: lastRun?.duration_ms ?? null,
      lastError: lastRun?.error ?? null,
      minutesSinceLastRun,
      // O cron roda a cada minuto; acima de 10min sem execução é falha.
      healthy: !!lastRun && lastRun.status !== "error" && (minutesSinceLastRun ?? 999) <= 10,
      runs24h: runs.length,
      failures24h: runs.filter((r) => r.status === "error").length,
      discarded24h: sum("discarded"),
      processed24h: sum("processed"),
      memoriesTouched24h: sum("memories_created") + sum("memories_updated"),
    };

    // Recent lists
    const [evRecent, memRecent, insRecent] = await Promise.all([
      scope(
        sb
          .from("brain_events")
          .select("id,event_type,source_module,created_at,processed_at")
          .order("created_at", { ascending: false })
          .limit(15),
      ),
      scope(
        sb
          .from("brain_memory")
          .select(
            "id,memory_type,key,title,category,scope,version,confidence,updated_at,reinforcement_count",
          )
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(10),
      ),
      scope(
        sb
          .from("brain_insights")
          .select("id,insight_type,description,confidence,created_at")
          .order("created_at", { ascending: false })
          .limit(8),
      ),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      windows: { minute, hour, day, total },
      worker,
      queue: {
        pending: pendingQ.count ?? 0,
        running: runningQ.count ?? 0,
        failed: failedQ.count ?? 0,
        processedLastHour: processedQ.count ?? 0,
        avgProcessingMs: avg,
        p95ProcessingMs: p95,
        oldestPendingAgeSec,
      },
      recentEvents: (evRecent.data ?? []) as BrainDiagnostics["recentEvents"],
      recentMemories: (memRecent.data ?? []) as BrainDiagnostics["recentMemories"],
      recentInsights: (insRecent.data ?? []) as BrainDiagnostics["recentInsights"],
    };
  });
