import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { computeClientHealthScore } from "@/lib/client-health";
import { assertBrandMember, assertClientInBrand } from "@/lib/access-guard";
import { resolveInclusiveRange } from "@/lib/date-range";
import {
  channelDisplayLabel,
  connectionDisplayName,
  connectionHandle,
} from "@/lib/channel-display-name";


type SupaCtx = { supabase: SupabaseClient<Database>; userId: string };

const BrandInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  range: z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    })
    .optional(),
});

type ResolvedRange = {
  fromIso: string;
  toIso: string;
  fromMs: number;
  toMs: number;
  days: number;
};

function resolveRange(input?: { from?: string; to?: string }): ResolvedRange {
  // Fonte de verdade única do período (contagem inclusiva, igual ao filtro).
  return resolveInclusiveRange(input, { defaultDays: 30, maxDays: 90 });
}

async function ignore<T>(p: PromiseLike<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error("[dashboard.ignore]", err);
    return null;
  }
}

function sinceIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}
function untilIso(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export type ActivityEvent = {
  id: string;
  verb: string;
  entity_type: string;
  payload: { title?: string; from?: string; to?: string } | null;
  created_at: string;
  actor_id: string | null;
  client_id: string | null;
};

export type DashboardStats = {
  counts: {
    clients: number;
    projects_active: number;
    tasks_open: number;
    tasks_overdue: number;
    tasks_done_7d: number;
    posts_total: number;
    approvals_pending: number;
    posts_approved_30d: number;
  };
  tasksByStatus: Record<string, number>;
  postsByStage: Record<string, number>;
  pipelineStages: Array<{
    key: string;
    label: string;
    color: string | null;
    position: number;
    count: number;
  }>;
  myTasks: Array<{
    id: string;
    title: string;
    due_at: string | null;
    priority: string;
    status: string;
    client_id: string | null;
  }>;
  upcomingPosts: Array<{
    id: string;
    title: string;
    scheduled_at: string | null;
    channels: string[];
    client_id: string;
    stage: string;
  }>;
  sparkline: number[];
  recentActivity: ActivityEvent[];
  channelCounts: Record<string, number>;
  publishTrend14d: number[];
  avgLeadTimeDays: number | null;
  aiUsage: AiUsageSummary;
};

export type AiUsageSummary = {
  cost: number;
  jobs: number;
  tokens: number;
  spark: number[];
  byAgent: Array<{ agent: string; cost: number; jobs: number }>;
  byClient: Array<{ client_id: string | null; client_name: string; cost: number; jobs: number }>;
  topAgent: { agent: string; cost: number; jobs: number } | null;
};

async function computeAiUsage(
  supabase: SupabaseClient<Database>,
  brandId: string,
  range: ResolvedRange,
  clientNameById?: Map<string, string>,
): Promise<AiUsageSummary> {
  const res = await ignore(
    supabase
      .from("brand_ai_usage")
      .select("agent,cost_usd,created_at,client_id,input_tokens,output_tokens")
      .eq("brand_id", brandId)
      .gte("created_at", range.fromIso)
      .lte("created_at", range.toIso),
  );
  const rows = (
    (res?.data ?? []) as Array<{
      agent: string | null;
      cost_usd: number | string | null;
      created_at: string;
      client_id: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
    }>
  ).map((r) => ({
    agent: r.agent ?? "outros",
    cost: Number(r.cost_usd ?? 0),
    at: new Date(r.created_at).getTime(),
    client_id: r.client_id,
    tokens: Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0),
  }));
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const jobs = rows.length;
  const tokens = rows.reduce((s, r) => s + r.tokens, 0);
  const bucketCount = Math.max(1, Math.min(range.days, 60));
  const bucketMs = (range.toMs - range.fromMs) / bucketCount;
  const spark = Array.from({ length: bucketCount }, (_, i) => {
    const start = range.fromMs + i * bucketMs;
    const end = start + bucketMs;
    return rows.filter((r) => r.at >= start && r.at < end).reduce((s, r) => s + r.cost, 0);
  });
  const agg = new Map<string, { cost: number; jobs: number }>();
  for (const r of rows) {
    const cur = agg.get(r.agent) ?? { cost: 0, jobs: 0 };
    cur.cost += r.cost;
    cur.jobs += 1;
    agg.set(r.agent, cur);
  }
  const byAgent = Array.from(agg.entries())
    .map(([agent, v]) => ({ agent, cost: v.cost, jobs: v.jobs }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 6);
  const clientAgg = new Map<string | null, { cost: number; jobs: number }>();
  for (const r of rows) {
    const cur = clientAgg.get(r.client_id) ?? { cost: 0, jobs: 0 };
    cur.cost += r.cost;
    cur.jobs += 1;
    clientAgg.set(r.client_id, cur);
  }
  const byClient = Array.from(clientAgg.entries())
    .map(([client_id, v]) => ({
      client_id,
      client_name: client_id
        ? (clientNameById?.get(client_id) ?? "Sem cliente")
        : "Global / sem cliente",
      cost: v.cost,
      jobs: v.jobs,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);
  const topAgent = byAgent[0] ?? null;
  return { cost, jobs, tokens, spark, byAgent, byClient, topAgent };
}

async function computeStats(
  ctx: SupaCtx,
  brandId: string,
  clientId?: string | null,
  rangeInput?: { from?: string; to?: string },
): Promise<DashboardStats> {
  const { supabase, userId } = ctx;
  const range = resolveRange(rangeInput);
  // Os pipelines não dependem do escopo resolvido (filtram por client_id /
  // brand_id direto), então a consulta começa aqui e é aguardada mais abaixo —
  // antes era um roundtrip serial extra no fim da função.
  const pipelinesPromise = ignore(
    clientId
      ? supabase
          .from("content_pipelines")
          .select("id,client_id")
          .eq("client_id", clientId)
          .eq("is_default", true)
      : supabase
          .from("content_pipelines")
          .select("id,client_id,clients!inner(brand_id)")
          .eq("clients.brand_id", brandId)
          .eq("is_default", true),
  );
  // Defesa em profundidade (10D.2): sem cliente selecionado, MANAGER/USER
  // agregam SOMENTE os clientes atribuídos — nunca a marca inteira. Admin e
  // super admin recebem `null` (workspace completo).
  const { resolveScopedClientIds } = await import("@/lib/access-guard");
  const allowedClientIds = clientId
    ? null
    : await resolveScopedClientIds(supabase as never, brandId, null);
  const NO_CLIENT = "00000000-0000-0000-0000-000000000000";
  const scope = <Q extends { eq: (col: string, val: string) => Q }>(q: Q): Q => {
    if (clientId) return q.eq("client_id", clientId);
    if (!allowedClientIds) return q;
    const list = allowedClientIds.length > 0 ? allowedClientIds : [NO_CLIENT];
    return (q as unknown as { in: (c: string, v: string[]) => Q }).in("client_id", list);
  };

  const [
    clientsRes,
    projectsRes,
    tasksOpenRes,
    tasksOverdueRes,
    tasksDone7dRes,
    postsRes,
    approvalsRes,
    myTasksRes,
    upcomingPostsRes,
    activityRes,
    tasksStatusRes,
    postsStageRes,
    postsApproved30dRes,
    postsFullRes,
    aiUsage,
    socialPublishedRes,
  ] = await Promise.all([
    ignore(
      supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", brandId)
        .is("archived_at", null),
    ),
    ignore(
      scope(
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .in("status", ["planning", "in_progress", "active"]),
      ),
    ),
    ignore(
      scope(
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .eq("done", false),
      ),
    ),
    ignore(
      scope(
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .eq("done", false)
          .lt("due_at", new Date().toISOString()),
      ),
    ),
    ignore(
      scope(
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("brand_id", brandId)
          .eq("done", true)
          .gte("done_at", range.fromIso)
          .lte("done_at", range.toIso),
      ),
    ),
    ignore(
      scope(
        supabase.from("posts").select("id", { count: "exact", head: true }).eq("brand_id", brandId),
      ),
    ),
    // Aprovações pendentes = tabela real post_approvals (única fonte de verdade).
    // Join com posts para filtrar por brand/cliente.
    ignore(
      clientId
        ? supabase
            .from("post_approvals")
            .select("id, posts!inner(brand_id,client_id)", { count: "exact", head: true })
            .eq("status", "pending")
            .eq("posts.brand_id", brandId)
            .eq("posts.client_id", clientId)
        : supabase
            .from("post_approvals")
            .select("id, posts!inner(brand_id)", { count: "exact", head: true })
            .eq("status", "pending")
            .eq("posts.brand_id", brandId),
    ),
    ignore(
      scope(
        supabase
          .from("tasks")
          .select("id,title,due_at,priority,status,client_id")
          .eq("brand_id", brandId)
          .eq("assignee_id", userId)
          .eq("done", false)
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(8),
      ),
    ),
    ignore(
      scope(
        supabase
          .from("posts")
          .select("id,title,scheduled_at,channels,client_id,stage")
          .eq("brand_id", brandId)
          .in("stage", ["scheduled", "approved"])
          .gte("scheduled_at", new Date().toISOString())
          .lte("scheduled_at", untilIso(7))
          .order("scheduled_at", { ascending: true })
          .limit(8),
      ),
    ),
    ignore(
      scope(
        supabase
          .from("activity_events")
          .select("id,verb,entity_type,payload,created_at,actor_id,client_id")
          .eq("brand_id", brandId)
          .gte("created_at", range.fromIso)
          .lte("created_at", range.toIso)
          .order("created_at", { ascending: false })
          .limit(200),
      ),
    ),
    ignore(
      scope(supabase.from("tasks").select("status").eq("brand_id", brandId).eq("done", false)),
    ),
    ignore(scope(supabase.from("posts").select("stage,stage_id").eq("brand_id", brandId))),
    // Publicações aprovadas 30d = post_approvals.status='approved' na janela (fonte real).
    ignore(
      clientId
        ? supabase
            .from("post_approvals")
            .select("id, posts!inner(brand_id,client_id)", { count: "exact", head: true })
            .eq("status", "approved")
            .eq("posts.brand_id", brandId)
            .eq("posts.client_id", clientId)
            .gte("created_at", range.fromIso)
            .lte("created_at", range.toIso)
        : supabase
            .from("post_approvals")
            .select("id, posts!inner(brand_id)", { count: "exact", head: true })
            .eq("status", "approved")
            .eq("posts.brand_id", brandId)
            .gte("created_at", range.fromIso)
            .lte("created_at", range.toIso),
    ),
    ignore(
      scope(
        supabase
          .from("posts")
          .select("id,channels,created_at,published_at")
          .eq("brand_id", brandId)
          .gte("created_at", range.fromIso)
          .lte("created_at", range.toIso),
      ),
    ),
    computeAiUsage(supabase, brandId, range),
    // Fonte adicional de publicações realizadas: worker de agendamento grava aqui,
    // não em posts.published_at. Necessário para o Ritmo de publicações refletir a realidade.
    ignore(
      scope(
        supabase
          .from("social_posts")
          .select("id,post_id,provider,published_at")
          .eq("brand_id", brandId)
          .eq("status", "published")
          .gte("published_at", range.fromIso)
          .lte("published_at", range.toIso),
      ),
    ),
  ]);

  const activityAll = (activityRes?.data ?? []) as ActivityEvent[];
  const activity = clientId ? activityAll.filter((a) => a.client_id === clientId) : activityAll;

  const sparkBuckets = Math.max(1, Math.min(range.days, 60));
  const sparkStep = (range.toMs - range.fromMs) / sparkBuckets;
  const sparkline = Array.from({ length: sparkBuckets }, (_, i) => {
    const start = range.fromMs + i * sparkStep;
    const end = start + sparkStep;
    return activity.filter((a) => {
      const t = new Date(a.created_at).getTime();
      return t >= start && t < end;
    }).length;
  });

  const tasksByStatus = ((tasksStatusRes?.data ?? []) as Array<{ status: string }>).reduce<
    Record<string, number>
  >((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});
  const stageRows = (postsStageRes?.data ?? []) as Array<{
    stage: string | null;
    stage_id: string | null;
  }>;
  const stageIds = Array.from(
    new Set(stageRows.map((r) => r.stage_id).filter((v): v is string => !!v)),
  );
  // Load dynamic pipeline stages: use client's default pipeline when scoped,
  // otherwise union across all default pipelines for the brand's clients.
  // (a consulta já foi disparada no início da função — ver `pipelinesPromise`)
  const pipelinesRes = await pipelinesPromise;
  const pipelineIds = ((pipelinesRes?.data ?? []) as Array<{ id: string }>).map((p) => p.id);
  const pipelineStagesRes = pipelineIds.length
    ? await ignore(
        supabase
          .from("content_pipeline_stages")
          .select("id,key,label,color,position,pipeline_id")
          .in("pipeline_id", pipelineIds)
          .order("position", { ascending: true }),
      )
    : null;
  const allStageRows = (pipelineStagesRes?.data ?? []) as Array<{
    id: string;
    key: string;
    label: string;
    color: string | null;
    position: number;
    pipeline_id: string;
  }>;
  const stageKeyById = new Map(allStageRows.map((s) => [s.id, s.key.toLowerCase()]));
  // Union by canonical key
  const unionByKey = new Map<
    string,
    { key: string; label: string; color: string | null; position: number; count: number }
  >();
  for (const s of allStageRows) {
    const k = s.key.toLowerCase();
    const prev = unionByKey.get(k);
    if (!prev) {
      unionByKey.set(k, { key: k, label: s.label, color: s.color, position: s.position, count: 0 });
    } else if (s.position < prev.position) {
      prev.position = s.position;
    }
  }
  const postsByStage: Record<string, number> = {};
  for (const r of stageRows) {
    const key = (r.stage_id && stageKeyById.get(r.stage_id)) || (r.stage ?? "").toLowerCase();
    if (!key) continue;
    postsByStage[key] = (postsByStage[key] ?? 0) + 1;
    const entry = unionByKey.get(key);
    if (entry) entry.count += 1;
  }
  const pipelineStages = Array.from(unionByKey.values()).sort((a, b) => a.position - b.position);

  const postsFull = (postsFullRes?.data ?? []) as Array<{
    id: string;
    channels: string[] | null;
    created_at: string;
    published_at: string | null;
  }>;
  const socialPublished = (socialPublishedRes?.data ?? []) as Array<{
    id: string;
    post_id: string | null;
    provider: string | null;
    published_at: string | null;
  }>;
  const channelCounts: Record<string, number> = {};
  for (const p of postsFull) {
    for (const ch of p.channels ?? []) channelCounts[ch] = (channelCounts[ch] ?? 0) + 1;
  }
  // Enriquecer com provider real dos posts publicados via worker (não gravam posts.channels legado).
  for (const sp of socialPublished) {
    if (!sp.provider) continue;
    channelCounts[sp.provider] = (channelCounts[sp.provider] ?? 0) + 1;
  }
  // publishTrend14d = união de posts.published_at (fluxo "Publicar agora") +
  // social_posts.published_at (worker de agendamento). Deduplica por post_id no mesmo bucket.
  const publishTrend14d = Array.from({ length: sparkBuckets }, (_, i) => {
    const start = range.fromMs + i * sparkStep;
    const end = start + sparkStep;
    const seen = new Set<string>();
    for (const p of postsFull) {
      if (!p.published_at) continue;
      const t = new Date(p.published_at).getTime();
      if (t >= start && t < end) seen.add(`post|${p.id}`);
    }
    for (const sp of socialPublished) {
      if (!sp.published_at) continue;
      const t = new Date(sp.published_at).getTime();
      if (t < start || t >= end) continue;
      seen.add(sp.post_id ? `post|${sp.post_id}` : `sp|${sp.id}`);
    }
    return seen.size;
  });
  const publishedWithLead = postsFull.filter((p) => p.published_at);
  const avgLeadTimeDays =
    publishedWithLead.length === 0
      ? null
      : publishedWithLead.reduce(
          (s, p) =>
            s +
            (new Date(p.published_at as string).getTime() - new Date(p.created_at).getTime()) /
              86_400_000,
          0,
        ) / publishedWithLead.length;

  return {
    counts: {
      clients: clientsRes?.count ?? 0,
      projects_active: projectsRes?.count ?? 0,
      tasks_open: tasksOpenRes?.count ?? 0,
      tasks_overdue: tasksOverdueRes?.count ?? 0,
      tasks_done_7d: tasksDone7dRes?.count ?? 0,
      posts_total: postsRes?.count ?? 0,
      approvals_pending: approvalsRes?.count ?? 0,
      posts_approved_30d: postsApproved30dRes?.count ?? 0,
    },
    tasksByStatus,
    postsByStage,
    pipelineStages,
    myTasks: (myTasksRes?.data ?? []) as DashboardStats["myTasks"],
    upcomingPosts: (upcomingPostsRes?.data ?? []) as DashboardStats["upcomingPosts"],
    sparkline,
    recentActivity: activity.slice(0, 20),
    channelCounts,
    publishTrend14d,
    avgLeadTimeDays,
    aiUsage,
  };
}

export const getDashboardStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }) => {
    // Defesa em profundidade: brandId/clientId vêm do contexto ativo do
    // frontend. Exigimos pertencimento ao workspace e, quando há cliente
    // selecionado, que ele pertença a ESTE workspace e ao escopo do usuário
    // (bloqueia pares cross-workspace residuais).
    await assertBrandMember(context.supabase, context.userId, data.brandId);
    if (data.clientId) {
      await assertClientInBrand(context.supabase, context.userId, data.brandId, data.clientId);
    }
    return computeStats(context, data.brandId, data.clientId ?? null, data.range);
  });


// ==================== Agency dashboard ====================

export type AgencyAlert = {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  count: number;
  href?: string;
};

export type ClientHealth = {
  id: string;
  name: string;
  color: string | null;
  score: number;
  breakdown: { onTime: number; approvals: number; briefing: number; schedule: number };
  openTasks: number;
  overdueTasks: number;
  approvalsPending: number;
  lastPostAt: string | null;
};

export type AgencyDashboard = {
  counts: DashboardStats["counts"];
  sparkline: number[];
  alerts: AgencyAlert[];
  healths: ClientHealth[];
  approvalsQueue: Array<{
    id: string;
    title: string;
    client_id: string;
    client_name: string;
    channels: string[];
    waiting_since: string;
  }>;
  upcoming: Array<{
    kind: "task" | "post";
    id: string;
    title: string;
    when: string;
    client_id: string | null;
    client_name: string | null;
  }>;
  heatmap: number[];
  postsByStage: Record<string, number>;
  pipelineStages: Array<{
    key: string;
    label: string;
    color: string | null;
    position: number;
    count: number;
  }>;
  publishTrend14d: number[];
  /** Data (YYYY-MM-DD) de cada bucket de `publishTrend14d` — eixo X real. */
  publishTrendDays: string[];
  aiUsage: AiUsageSummary;
  avgLeadTimeDays: number | null;
  /** `label` = plataforma (Instagram, Facebook…); `handle` = @perfil opcional. */
  topChannels: Array<{ channel: string; count: number; label: string; handle: string | null }>;
  tasksByBucket: {
    open: number;
    in_progress: number;
    review: number;
    done: number;
    overdue: number;
  };
  approvalsByClient: Array<{
    client_id: string;
    client_name: string;
    pending: number;
    approved: number;
  }>;
  rangeDays: number;
};

async function computeAgency(
  ctx: SupaCtx,
  brandId: string,
  rangeInput?: { from?: string; to?: string },
): Promise<AgencyDashboard> {
  const { supabase } = ctx;
  const range = resolveRange(rangeInput);
  const [
    clientsRes,
    tasksRes,
    postsRes,
    briefingsRes,
    activityRes,
    upcomingRes,
    approvalsRes,
    approvalsAggRes,
    aiUsage,
    socialPublishedRes,
  ] = await Promise.all([
    ignore(
      supabase
        .from("clients")
        .select("id,name,color")
        .eq("brand_id", brandId)
        .is("archived_at", null),
    ),
    ignore(
      supabase
        .from("tasks")
        .select("id,title,status,done,done_at,due_at,client_id")
        .eq("brand_id", brandId),
    ),
    ignore(
      supabase
        .from("posts")
        .select(
          "id,title,stage,stage_id,channels,scheduled_at,published_at,client_id,updated_at,created_at",
        )
        .eq("brand_id", brandId),
    ),
    ignore(supabase.from("client_briefings").select("client_id,updated_at")),
    ignore(
      supabase
        .from("activity_events")
        .select("id,created_at,client_id")
        .eq("brand_id", brandId)
        .gte("created_at", range.fromIso)
        .lte("created_at", range.toIso)
        .order("created_at", { ascending: false })
        .limit(1000),
    ),
    ignore(
      supabase
        .from("posts")
        .select("id,title,scheduled_at,client_id,channels")
        .eq("brand_id", brandId)
        .in("stage", ["scheduled", "approved"])
        .gte("scheduled_at", new Date().toISOString())
        .lte("scheduled_at", untilIso(7))
        .order("scheduled_at", { ascending: true })
        .limit(20),
    ),
    ignore(
      supabase
        .from("post_approvals")
        .select("id,created_at,posts!inner(id,title,client_id,channels,brand_id)")
        .eq("status", "pending")
        .eq("posts.brand_id", brandId)
        .order("created_at", { ascending: true })
        .limit(12),
    ),
    // post_approvals (fonte de verdade) — join com posts para escopar por brand.
    ignore(
      supabase
        .from("post_approvals")
        .select("id,status,updated_at,posts!inner(brand_id)")
        .eq("posts.brand_id", brandId)
        .gte("created_at", range.fromIso)
        .lte("created_at", range.toIso),
    ),
    computeAiUsage(supabase, brandId, range),
    // Publicações realizadas pelo worker de agendamento (não gravam posts.published_at).
    ignore(
      supabase
        .from("social_posts")
        .select("id,post_id,provider,connection_id,published_at,client_id")
        .eq("brand_id", brandId)
        .eq("status", "published")
        .gte("published_at", range.fromIso)
        .lte("published_at", range.toIso),
    ),
  ]);

  const clients = (clientsRes?.data ?? []) as Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  const tasks = (tasksRes?.data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    done: boolean;
    done_at: string | null;
    due_at: string | null;
    client_id: string | null;
  }>;
  const posts = (postsRes?.data ?? []) as Array<{
    id: string;
    title: string;
    stage: string;
    stage_id: string | null;
    channels: string[] | null;
    scheduled_at: string | null;
    published_at: string | null;
    client_id: string;
    updated_at: string | null;
    created_at: string | null;
  }>;
  const socialPublished = (socialPublishedRes?.data ?? []) as Array<{
    id: string;
    post_id: string | null;
    provider: string | null;
    connection_id: string | null;
    published_at: string | null;
    client_id: string | null;
  }>;
  const briefings = new Map<string, string>(
    ((briefingsRes?.data ?? []) as Array<{ client_id: string; updated_at: string }>).map((b) => [
      b.client_id,
      b.updated_at,
    ]),
  );
  const activity = (activityRes?.data ?? []) as Array<{
    id: string;
    created_at: string;
    client_id: string | null;
  }>;

  const now = Date.now();
  const nameById = new Map(clients.map((c) => [c.id, c.name] as const));

  const approvalRows = (approvalsAggRes?.data ?? []) as Array<{
    id: string;
    status: string;
    updated_at: string;
  }>;
  const approvalsPendingReal = approvalRows.filter((a) => a.status === "pending").length;
  const postsApproved30dReal = approvalRows.filter((a) => a.status === "approved").length;

  const counts: DashboardStats["counts"] = {
    clients: clients.length,
    projects_active: 0,
    tasks_open: tasks.filter((t) => !t.done).length,
    tasks_overdue: tasks.filter((t) => !t.done && t.due_at && new Date(t.due_at).getTime() < now)
      .length,
    tasks_done_7d: tasks.filter(
      (t) =>
        t.done &&
        t.done_at &&
        new Date(t.done_at).getTime() >= range.fromMs &&
        new Date(t.done_at).getTime() <= range.toMs,
    ).length,
    posts_total: posts.length,
    approvals_pending: approvalsPendingReal,
    posts_approved_30d: postsApproved30dReal,
  };

  const sparkBuckets = Math.max(1, Math.min(range.days, 60));
  const sparkStep = (range.toMs - range.fromMs) / sparkBuckets;
  const sparkline = Array.from({ length: sparkBuckets }, (_, i) => {
    const start = range.fromMs + i * sparkStep;
    const end = start + sparkStep;
    return activity.filter((a) => {
      const t = new Date(a.created_at).getTime();
      return t >= start && t < end;
    }).length;
  });

  const heatBuckets = Math.max(7, Math.min(range.days, 60));
  const heatStep = (range.toMs - range.fromMs) / heatBuckets;
  const heatmap = Array.from({ length: heatBuckets }, (_, i) => {
    const start = range.fromMs + i * heatStep;
    const end = start + heatStep;
    return posts.filter((p) => {
      if (!p.published_at) return false;
      const t = new Date(p.published_at).getTime();
      return t >= start && t < end;
    }).length;
  });

  const alerts: AgencyAlert[] = [];
  if (counts.tasks_overdue > 0) {
    alerts.push({
      id: "overdue_tasks",
      severity: counts.tasks_overdue > 5 ? "critical" : "warning",
      title: "Tarefas atrasadas",
      description: `${counts.tasks_overdue} tarefa(s) com prazo vencido.`,
      count: counts.tasks_overdue,
      href: "/content",
    });
  }
  const briefingless = clients.filter((c) => !briefings.has(c.id));
  if (briefingless.length > 0) {
    alerts.push({
      id: "clients_without_briefing",
      severity: "warning",
      title: "Clientes sem briefing",
      description: `${briefingless.length} cliente(s) precisam de briefing.`,
      count: briefingless.length,
      href: "/customers",
    });
  }
  const noScheduleClients = clients.filter(
    (c) =>
      !posts.some(
        (p) => p.client_id === c.id && p.scheduled_at && new Date(p.scheduled_at).getTime() > now,
      ),
  );
  if (noScheduleClients.length > 0) {
    alerts.push({
      id: "clients_without_schedule",
      severity: "info",
      title: "Sem publicações agendadas",
      description: `${noScheduleClients.length} cliente(s) sem posts futuros.`,
      count: noScheduleClients.length,
      href: "/customers",
    });
  }
  if (counts.approvals_pending > 0) {
    alerts.push({
      id: "approvals",
      severity: counts.approvals_pending > 6 ? "warning" : "info",
      title: "Aprovações pendentes",
      description: `${counts.approvals_pending} publicação(ões) aguardando aprovação.`,
      count: counts.approvals_pending,
      href: "/customers",
    });
  }

  const healths: ClientHealth[] = clients.map((c) => {
    const cTasks = tasks.filter((t) => t.client_id === c.id);
    const openTasks = cTasks.filter((t) => !t.done).length;
    const overdueTasks = cTasks.filter(
      (t) => !t.done && t.due_at && new Date(t.due_at).getTime() < now,
    ).length;
    const cPosts = posts.filter((p) => p.client_id === c.id);
    const { score, breakdown } = computeClientHealthScore({
      now,
      tasks: cTasks,
      posts: cPosts,
      briefingUpdatedAt: briefings.get(c.id) ?? null,
    });
    const lastPost =
      cPosts
        .filter((p) => p.published_at)
        .map((p) => p.published_at as string)
        .sort()
        .at(-1) ?? null;

    return {
      id: c.id,
      name: c.name,
      color: c.color,
      score,
      breakdown,
      openTasks,
      overdueTasks,
      approvalsPending: cPosts.filter((p) => p.stage === "review").length,
      lastPostAt: lastPost,
    };
  });

  const approvalsQueue = (
    (approvalsRes?.data ?? []) as Array<{
      id: string;
      created_at: string;
      posts: {
        id: string;
        title: string;
        client_id: string;
        channels: string[] | null;
      } | null;
    }>
  )
    .filter((r) => !!r.posts)
    .map((r) => ({
      id: r.id,
      title: r.posts!.title,
      client_id: r.posts!.client_id,
      client_name: nameById.get(r.posts!.client_id) ?? "—",
      channels: (r.posts!.channels ?? []) as string[],
      waiting_since: r.created_at,
    }));

  const upcomingTasks = tasks
    .filter(
      (t) =>
        !t.done &&
        t.due_at &&
        new Date(t.due_at).getTime() > now &&
        new Date(t.due_at).getTime() < now + 7 * 86_400_000,
    )
    .map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      when: t.due_at as string,
      client_id: t.client_id,
      client_name: t.client_id ? (nameById.get(t.client_id) ?? null) : null,
    }));
  const upcomingPosts = (
    (upcomingRes?.data ?? []) as Array<{
      id: string;
      title: string;
      scheduled_at: string;
      client_id: string;
    }>
  ).map((p) => ({
    kind: "post" as const,
    id: p.id,
    title: p.title,
    when: p.scheduled_at,
    client_id: p.client_id,
    client_name: nameById.get(p.client_id) ?? null,
  }));
  const upcoming = [...upcomingTasks, ...upcomingPosts]
    .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime())
    .slice(0, 12);

  // Dynamic pipeline stages: union of default pipeline stages across the brand's clients.
  const clientIds = clients.map((c) => c.id);
  const defaultPipelinesRes = clientIds.length
    ? await ignore(
        supabase
          .from("content_pipelines")
          .select("id,client_id")
          .in("client_id", clientIds)
          .eq("is_default", true),
      )
    : null;
  const defaultPipelines = (defaultPipelinesRes?.data ?? []) as Array<{
    id: string;
    client_id: string;
  }>;
  const pipelineIds = defaultPipelines.map((p) => p.id);
  const stagesRes = pipelineIds.length
    ? await ignore(
        supabase
          .from("content_pipeline_stages")
          .select("id,key,label,color,position,pipeline_id")
          .in("pipeline_id", pipelineIds)
          .order("position", { ascending: true }),
      )
    : null;
  const stageRows = (stagesRes?.data ?? []) as Array<{
    id: string;
    key: string;
    label: string;
    color: string | null;
    position: number;
    pipeline_id: string;
  }>;
  const stageById = new Map(stageRows.map((s) => [s.id, s]));
  // Union by canonical key (lowercased) — merges identical stages across pipelines.
  const unionByKey = new Map<
    string,
    { key: string; label: string; color: string | null; position: number; count: number }
  >();
  for (const s of stageRows) {
    const k = s.key.toLowerCase();
    const prev = unionByKey.get(k);
    if (!prev) {
      unionByKey.set(k, {
        key: k,
        label: s.label,
        color: s.color,
        position: s.position,
        count: 0,
      });
    } else if (s.position < prev.position) {
      prev.position = s.position;
    }
  }
  const postsByStage: Record<string, number> = {};
  for (const p of posts) {
    let key: string | null = null;
    if (p.stage_id) {
      const row = stageById.get(p.stage_id);
      if (row) key = row.key.toLowerCase();
    }
    if (!key && p.stage) key = String(p.stage).toLowerCase();
    if (!key) continue;
    postsByStage[key] = (postsByStage[key] ?? 0) + 1;
    const entry = unionByKey.get(key);
    if (entry) entry.count += 1;
  }
  const pipelineStages = Array.from(unionByKey.values()).sort((a, b) => a.position - b.position);

  // União posts.published_at + social_posts.published_at (worker). Dedupe por post_id/bucket.
  const publishTrend14d = Array.from({ length: sparkBuckets }, (_, i) => {
    const start = range.fromMs + i * sparkStep;
    const end = start + sparkStep;
    const seen = new Set<string>();
    for (const p of posts) {
      if (!p.published_at) continue;
      const t = new Date(p.published_at).getTime();
      if (t >= start && t < end) seen.add(`post|${p.id}`);
    }
    for (const sp of socialPublished) {
      if (!sp.published_at) continue;
      const t = new Date(sp.published_at).getTime();
      if (t < start || t >= end) continue;
      seen.add(sp.post_id ? `post|${sp.post_id}` : `sp|${sp.id}`);
    }
    return seen.size;
  });
  const publishTrendDays = Array.from({ length: sparkBuckets }, (_, i) =>
    new Date(range.fromMs + i * sparkStep).toISOString().slice(0, 10),
  );

  // Nome real do canal: `social_connections.channel_name` (nome configurado)
  // com fallback para o nome externo / @usuário. Nunca exibir o provider.
  const connectionIds = Array.from(
    new Set(socialPublished.map((sp) => sp.connection_id).filter(Boolean) as string[]),
  );
  const connectionsRes = connectionIds.length
    ? await ignore(
        supabase
          .from("social_connections")
          .select("id,channel,provider,channel_name,external_name,account_username")
          .eq("brand_id", brandId)
          .in("id", connectionIds),
      )
    : null;
  const connectionLabel = new Map<
    string,
    { label: string; channel: string; handle: string | null }
  >();
  for (const c of (connectionsRes?.data ?? []) as Array<Record<string, any>>) {
    connectionLabel.set(String(c.id), {
      channel: String(c.channel ?? c.provider ?? ""),
      label: connectionDisplayName(c),
      handle: connectionHandle(c),
    });
  }

  const channelAgg = new Map<
    string,
    { channel: string; label: string; handle: string | null; count: number }
  >();
  const bump = (key: string, channel: string, label: string, handle: string | null) => {
    const prev = channelAgg.get(key);
    if (prev) prev.count += 1;
    else channelAgg.set(key, { channel, label, handle, count: 1 });
  };
  for (const p of posts) {
    for (const ch of p.channels ?? []) bump(`ch:${ch}`, ch, channelDisplayLabel(ch), null);
  }
  for (const sp of socialPublished) {
    const conn = sp.connection_id ? connectionLabel.get(sp.connection_id) : undefined;
    if (conn) bump(`conn:${sp.connection_id}`, conn.channel, conn.label, conn.handle);
    else if (sp.provider)
      bump(`ch:${sp.provider}`, sp.provider, channelDisplayLabel(sp.provider), null);
  }
  const topChannels = Array.from(channelAgg.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const publishedPosts = posts.filter((p) => p.published_at);
  // Lead time canônico: created_at → published_at (mesma fórmula do computeStats).
  const avgLeadTimeDays =
    publishedPosts.length === 0
      ? null
      : publishedPosts.reduce((s, p) => {
          const start = p.created_at
            ? new Date(p.created_at).getTime()
            : p.updated_at
              ? new Date(p.updated_at).getTime()
              : new Date(p.published_at as string).getTime();
          const end = new Date(p.published_at as string).getTime();
          return s + Math.max(0, (end - start) / 86_400_000);
        }, 0) / publishedPosts.length;

  // Backfill client_name in aiUsage.byClient with real names.
  const aiUsageEnriched: AiUsageSummary = {
    ...aiUsage,
    byClient: aiUsage.byClient.map((r) => ({
      ...r,
      client_name: r.client_id
        ? (nameById.get(r.client_id) ?? r.client_name)
        : "Global / sem cliente",
    })),
  };

  // Task buckets (open/in_progress/review/done/overdue) — todos filtrados por range para "done".
  const tasksByBucket = {
    open: tasks.filter((t) => !t.done && t.status !== "in_progress" && t.status !== "review")
      .length,
    in_progress: tasks.filter((t) => !t.done && t.status === "in_progress").length,
    review: tasks.filter((t) => !t.done && t.status === "review").length,
    done: tasks.filter(
      (t) =>
        t.done &&
        t.done_at &&
        new Date(t.done_at).getTime() >= range.fromMs &&
        new Date(t.done_at).getTime() <= range.toMs,
    ).length,
    overdue: counts.tasks_overdue,
  };

  // Aprovações agrupadas por cliente (a partir de approvalRows + join com posts.client_id)
  const approvalsWithClient = (approvalsAggRes?.data ?? []) as Array<{
    id: string;
    status: string;
    posts: { brand_id: string; client_id?: string | null } | null;
  }>;
  const abcMap = new Map<string, { pending: number; approved: number }>();
  for (const a of approvalsWithClient) {
    const cid = a.posts?.client_id;
    if (!cid) continue;
    const cur = abcMap.get(cid) ?? { pending: 0, approved: 0 };
    if (a.status === "pending") cur.pending += 1;
    else if (a.status === "approved") cur.approved += 1;
    abcMap.set(cid, cur);
  }
  const approvalsByClient = Array.from(abcMap.entries())
    .map(([client_id, v]) => ({
      client_id,
      client_name: nameById.get(client_id) ?? "—",
      pending: v.pending,
      approved: v.approved,
    }))
    .sort((a, b) => b.pending + b.approved - (a.pending + a.approved))
    .slice(0, 8);

  return {
    counts,
    sparkline,
    alerts,
    healths,
    approvalsQueue,
    upcoming,
    heatmap,
    postsByStage,
    pipelineStages,
    publishTrend14d,
    publishTrendDays,
    aiUsage: aiUsageEnriched,
    avgLeadTimeDays,
    topChannels,
    tasksByBucket,
    approvalsByClient,
    rangeDays: range.days,
  };
}

export const getAgencyDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        range: z
          .object({
            from: z.string().datetime().optional(),
            to: z.string().datetime().optional(),
          })
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Dashboard gerencial do workspace: exige pertencimento ao workspace.
    // O escopo por cliente continua sendo aplicado pela RLS (manager/user só
    // agregam clientes atribuídos).
    await assertBrandMember(context.supabase, context.userId, data.brandId);
    return computeAgency(context, data.brandId, data.range);
  });

// ==================== AI Insights ====================

export type DashboardInsights = {
  headline: string;
  actions: Array<{ title: string; why: string; href?: string }>;
  risks: string[];
};

export const getDashboardInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }): Promise<DashboardInsights | null> => {
    await assertBrandMember(context.supabase, context.userId, data.brandId);
    if (data.clientId) {
      await assertClientInBrand(context.supabase, context.userId, data.brandId, data.clientId);
    }
    const brief = data.clientId
      ? await computeStats(context, data.brandId, data.clientId).then((s) => ({
          mode: "client" as const,
          counts: s.counts,
          postsByStage: s.postsByStage,
          tasksByStatus: s.tasksByStatus,
          upcomingCount: s.upcomingPosts.length,
          myTasksCount: s.myTasks.length,
        }))
      : await computeAgency(context, data.brandId).then((a) => ({
          mode: "agency" as const,
          counts: a.counts,
          alerts: a.alerts.map((x) => ({ id: x.id, severity: x.severity, count: x.count })),
          worstHealth: a.healths
            .slice()
            .sort((x, y) => x.score - y.score)
            .slice(0, 3)
            .map((h) => ({ name: h.name, score: h.score })),
          approvalsQueueSize: a.approvalsQueue.length,
          upcomingCount: a.upcoming.length,
        }));

    try {
      const { getBrandAiModel } = await import("./ai-provider.server");
      const { model } = await getBrandAiModel(
        context.supabase,
        data.brandId,
        "text",
        "operational",
        { agent: "dashboard.insights", userId: context.userId },
      );

      const { output } = await generateText({
        model,
        output: Output.object({
          schema: z.object({
            headline: z.string(),
            actions: z.array(
              z.object({
                title: z.string(),
                why: z.string(),
                href: z.string().nullable(),
              }),
            ),
            risks: z.array(z.string()),
          }),
        }),
        prompt: `Você é o chefe de operações de uma agência de conteúdo. Analise este resumo do dashboard e responda em português (BR).
Gere no máximo 3 ações prioritárias, cada uma com um "why" curto (menos de 20 palavras), e no máximo 3 riscos curtos (menos de 12 palavras).
A headline deve ter no máximo 12 palavras. hrefs válidos: "/content", "/customers", "/content" ou null.

RESUMO:
${JSON.stringify(brief, null, 2)}`,
      });
      return {
        headline: output.headline.slice(0, 140),
        actions: output.actions.slice(0, 3).map((a) => ({
          title: a.title.slice(0, 80),
          why: a.why.slice(0, 160),
          href: a.href ?? undefined,
        })),
        risks: output.risks.slice(0, 3).map((r) => r.slice(0, 140)),
      };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) return null;
      console.error("[insights]", error);
      return null;
    }
  });

// ==================== Command palette search ====================

export const searchWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ brandId: z.string().uuid(), q: z.string().trim().min(1).max(80) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandMember(context.supabase, context.userId, data.brandId);
    const like = `%${data.q}%`;
    const [clients, projects, tasks, posts] = await Promise.all([
      ignore(
        context.supabase
          .from("clients")
          .select("id,name")
          .eq("brand_id", data.brandId)
          .ilike("name", like)
          .limit(5),
      ),
      ignore(
        context.supabase
          .from("projects")
          .select("id,name,client_id")
          .eq("brand_id", data.brandId)
          .ilike("name", like)
          .limit(5),
      ),
      ignore(
        context.supabase
          .from("tasks")
          .select("id,title,client_id")
          .eq("brand_id", data.brandId)
          .ilike("title", like)
          .limit(5),
      ),
      ignore(
        context.supabase
          .from("posts")
          .select("id,title,client_id")
          .eq("brand_id", data.brandId)
          .ilike("title", like)
          .limit(5),
      ),
    ]);
    return {
      clients: (clients?.data ?? []) as Array<{ id: string; name: string }>,
      projects: (projects?.data ?? []) as Array<{
        id: string;
        name: string;
        client_id: string | null;
      }>,
      tasks: (tasks?.data ?? []) as Array<{ id: string; title: string; client_id: string | null }>,
      posts: (posts?.data ?? []) as Array<{ id: string; title: string; client_id: string }>,
    };
  });
