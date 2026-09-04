import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { callRpc } from "@/lib/supabase-rpc";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FiltersSchema = z.object({
  brand_id: z.string().uuid(),
  start: z.string(),
  end: z.string(),
  pipeline_ids: z.array(z.string().uuid()).optional().default([]),
  client_ids: z.array(z.string().uuid()).optional().default([]),
  assignee_ids: z.array(z.string().uuid()).optional().default([]),
  project_ids: z.array(z.string().uuid()).optional().default([]),
  tags: z.array(z.string()).optional().default([]),
  channels: z.array(z.string()).optional().default([]),
  /** Quando presente, escopo forçado ao cliente ativo — sobrescreve client_ids. */
  client_id: z.string().uuid().nullish(),
});

export type AnalyticsFilters = z.infer<typeof FiltersSchema>;

export type AnalyticsResult = {
  production: {
    onTime: number;
    delayed: number;
    pending: number;
    published: number;
    total: number;
    funnel: Array<{ stage: string; count: number }>;
    byChannel: Array<{ channel: string; count: number }>;
    byFormat: Array<{ format: string; count: number }>;
    dailySeries: Array<{ date: string; created: number; published: number }>;
  };
  social: {
    totalPosts: number;
    publishedPosts: number;
    scheduledPosts: number;
    byChannel: Array<{ channel: string; count: number }>;
    byFormat: Array<{ format: string; count: number }>;
    weekly: Array<{ week: string; count: number }>;
  };
  team: {
    members: Array<{
      user_id: string;
      full_name: string;
      avatar_url: string | null;
      role: string;
      openTasks: number;
      doneTasks: number;
      onTime: number;
      late: number;
      posts: number;
      punctuality: number;
    }>;
    avgPunctuality: number;
    totalOpen: number;
    totalDone: number;
  };
  clients: {
    items: Array<{
      client_id: string;
      name: string;
      color: string | null;
      posts: number;
      published: number;
      pendingApprovals: number;
      overdue: number;
      health: number;
      alerts: string[];
    }>;
  };
};

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const getAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => FiltersSchema.parse(raw))
  .handler(async ({ data, context }): Promise<AnalyticsResult> => {
    const { supabase, userId } = context;
    const { brand_id, start, end } = data;
    if (data.client_id) {
      data.client_ids = [data.client_id];
    }
    // Membership check — fonte canônica `is_brand_member` (cobre super admin
    // e membros ativos do workspace; ADMIN não tem autoridade global).
    const { data: isMember } = await callRpc<boolean | null>(supabase, "is_brand_member", {
      _brand_id: brand_id,
      _user_id: userId,
    });
    if (isMember !== true) throw new Error("forbidden");

    // -------- Posts ---------
    let postsQ = supabase
      .from("posts")
      .select(
        "id,brand_id,client_id,stage,channels,format,created_at,scheduled_at,published_at,assignee_id,assignees,pipeline_id,project_id,tags,review_status,deleted_at",
      )
      .eq("brand_id", brand_id)
      .is("deleted_at", null)
      .gte("created_at", start)
      .lte("created_at", end);
    if (data.client_ids.length) postsQ = postsQ.in("client_id", data.client_ids);
    if (data.pipeline_ids.length) postsQ = postsQ.in("pipeline_id", data.pipeline_ids);
    if (data.project_ids.length) postsQ = postsQ.in("project_id", data.project_ids);
    if (data.assignee_ids.length) postsQ = postsQ.in("assignee_id", data.assignee_ids);
    if (data.tags.length) postsQ = postsQ.overlaps("tags", data.tags);
    if (data.channels.length) postsQ = postsQ.overlaps("channels", data.channels as never);

    const { data: postsData, error: postsErr } = await postsQ;
    if (postsErr) throw postsErr;
    const posts = postsData ?? [];

    // -------- Tasks ---------
    let tasksQ = supabase
      .from("tasks")
      .select(
        "id,brand_id,client_id,assignee_id,status,priority,due_at,done,done_at,created_at,updated_at,project_id",
      )
      .eq("brand_id", brand_id)
      .gte("created_at", start)
      .lte("created_at", end);
    if (data.client_ids.length) tasksQ = tasksQ.in("client_id", data.client_ids);
    if (data.assignee_ids.length) tasksQ = tasksQ.in("assignee_id", data.assignee_ids);
    if (data.project_ids.length) tasksQ = tasksQ.in("project_id", data.project_ids);
    const { data: tasksData, error: tasksErr } = await tasksQ;
    if (tasksErr) throw tasksErr;
    const tasks = tasksData ?? [];

    // -------- Approvals (pending) ---------
    const postIds = posts.map((p) => p.id);
    let approvals: Array<{ post_id: string; status: string }> = [];
    if (postIds.length) {
      const { data: appr } = await supabase
        .from("post_approvals")
        .select("post_id,status")
        .in("post_id", postIds);
      approvals = (appr ?? []) as typeof approvals;
    }
    const pendingApprovalPostIds = new Set(
      approvals.filter((a) => a.status === "pending").map((a) => a.post_id),
    );

    // -------- Clients meta ---------
    const { data: clientsData } = await supabase
      .from("clients")
      .select("id,name,color")
      .eq("brand_id", brand_id);
    const clients = clientsData ?? [];

    // -------- Team ---------
    const { data: teamRowsData } = await supabase
      .from("brand_members")
      .select("user_id,role")
      .eq("brand_id", brand_id);
    const teamRows = teamRowsData ?? [];
    const userIds = teamRows.map((m) => m.user_id);
    const profilesRes = userIds.length
      ? await supabase.from("user_profiles").select("id,full_name,avatar_url").in("id", userIds)
      : { data: [] as Array<{ id: string; full_name: string; avatar_url: string | null }> };
    const profiles = profilesRes.data ?? [];
    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    // -------- Production tab ---------
    const now = new Date();
    let onTime = 0;
    let delayed = 0;
    let pending = 0;
    let published = 0;
    const funnelMap = new Map<string, number>();
    const channelMap = new Map<string, number>();
    const formatMap = new Map<string, number>();
    const dailyMap = new Map<string, { created: number; published: number }>();

    for (const p of posts) {
      funnelMap.set(p.stage, (funnelMap.get(p.stage) ?? 0) + 1);
      for (const c of p.channels ?? []) channelMap.set(c, (channelMap.get(c) ?? 0) + 1);
      if (p.format) formatMap.set(p.format, (formatMap.get(p.format) ?? 0) + 1);
      const created = toDate(p.created_at);
      if (created) {
        const k = isoDate(created);
        const cur = dailyMap.get(k) ?? { created: 0, published: 0 };
        cur.created += 1;
        dailyMap.set(k, cur);
      }
      const pub = toDate(p.published_at);
      const sched = toDate(p.scheduled_at);
      if (p.stage === "published" || pub) {
        published += 1;
        if (pub) {
          const k = isoDate(pub);
          const cur = dailyMap.get(k) ?? { created: 0, published: 0 };
          cur.published += 1;
          dailyMap.set(k, cur);
        }
        if (sched && pub && pub.getTime() <= sched.getTime() + 86400000) onTime += 1;
        else if (sched && pub && pub.getTime() > sched.getTime() + 86400000) delayed += 1;
        else onTime += 1;
      } else if (sched) {
        if (sched.getTime() < now.getTime()) delayed += 1;
        else pending += 1;
      } else {
        pending += 1;
      }
    }

    const dailySeries = Array.from(dailyMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({ date, created: v.created, published: v.published }));

    // -------- Social tab ---------
    const weeklyMap = new Map<string, number>();
    let publishedPosts = 0;
    let scheduledPosts = 0;
    for (const p of posts) {
      const pub = toDate(p.published_at);
      const sched = toDate(p.scheduled_at);
      if (pub) {
        publishedPosts += 1;
        const wk = isoWeek(pub);
        weeklyMap.set(wk, (weeklyMap.get(wk) ?? 0) + 1);
      } else if (sched && sched.getTime() > now.getTime()) {
        scheduledPosts += 1;
      }
    }
    const weekly = Array.from(weeklyMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([week, count]) => ({ week, count }));

    // -------- Team tab ---------
    type MemberAgg = {
      user_id: string;
      full_name: string;
      avatar_url: string | null;
      role: string;
      openTasks: number;
      doneTasks: number;
      onTime: number;
      late: number;
      posts: number;
      punctuality: number;
    };
    const memberMap = new Map<string, MemberAgg>();
    for (const m of teamRows) {
      const prof = profileMap.get(m.user_id);
      memberMap.set(m.user_id, {
        user_id: m.user_id,
        full_name: prof?.full_name ?? "Membro",
        avatar_url: prof?.avatar_url ?? null,
        role: m.role,
        openTasks: 0,
        doneTasks: 0,
        onTime: 0,
        late: 0,
        posts: 0,
        punctuality: 100,
      });
    }
    for (const t of tasks) {
      if (!t.assignee_id) continue;
      const agg = memberMap.get(t.assignee_id);
      if (!agg) continue;
      if (t.done || t.status === "done") {
        agg.doneTasks += 1;
        const due = toDate(t.due_at);
        const doneAt = toDate(t.done_at ?? t.updated_at);
        if (due && doneAt && doneAt.getTime() <= due.getTime()) agg.onTime += 1;
        else if (due && doneAt) agg.late += 1;
        else agg.onTime += 1;
      } else {
        agg.openTasks += 1;
        const due = toDate(t.due_at);
        if (due && due.getTime() < now.getTime()) agg.late += 1;
      }
    }
    for (const p of posts) {
      if (!p.assignee_id) continue;
      const agg = memberMap.get(p.assignee_id);
      if (!agg) continue;
      agg.posts += 1;
    }
    let totalOpen = 0;
    let totalDone = 0;
    let sumPunct = 0;
    let punctCount = 0;
    for (const agg of memberMap.values()) {
      const total = agg.onTime + agg.late;
      agg.punctuality = total > 0 ? Math.round((agg.onTime / total) * 100) : 100;
      totalOpen += agg.openTasks;
      totalDone += agg.doneTasks;
      if (total > 0) {
        sumPunct += agg.punctuality;
        punctCount += 1;
      }
    }
    const members = Array.from(memberMap.values()).sort(
      (a, b) => b.openTasks + b.posts - (a.openTasks + a.posts),
    );
    const avgPunctuality = punctCount > 0 ? Math.round(sumPunct / punctCount) : 100;

    // -------- Clients tab ---------
    const clientMap = new Map<
      string,
      {
        client_id: string;
        name: string;
        color: string | null;
        posts: number;
        published: number;
        pendingApprovals: number;
        overdue: number;
        health: number;
        alerts: string[];
      }
    >();
    for (const c of clients) {
      clientMap.set(c.id, {
        client_id: c.id,
        name: c.name,
        color: c.color,
        posts: 0,
        published: 0,
        pendingApprovals: 0,
        overdue: 0,
        health: 100,
        alerts: [],
      });
    }
    for (const p of posts) {
      const agg = clientMap.get(p.client_id);
      if (!agg) continue;
      agg.posts += 1;
      if (p.published_at) agg.published += 1;
      if (pendingApprovalPostIds.has(p.id)) agg.pendingApprovals += 1;
      const sched = toDate(p.scheduled_at);
      if (!p.published_at && sched && sched.getTime() < now.getTime()) agg.overdue += 1;
    }
    for (const agg of clientMap.values()) {
      let health = 100;
      if (agg.overdue > 0) health -= Math.min(40, agg.overdue * 8);
      if (agg.pendingApprovals > 3) health -= 15;
      if (agg.posts === 0) health = 60;
      agg.health = Math.max(0, Math.min(100, health));
      if (agg.overdue > 0) agg.alerts.push(`${agg.overdue} atrasado(s)`);
      if (agg.pendingApprovals > 0)
        agg.alerts.push(`${agg.pendingApprovals} aprovação(ões) pendentes`);
      if (agg.posts === 0) agg.alerts.push("Sem produção no período");
    }
    const clientItems = Array.from(clientMap.values())
      .filter((c) => data.client_ids.length === 0 || data.client_ids.includes(c.client_id))
      .sort((a, b) => a.health - b.health);

    return {
      production: {
        onTime,
        delayed,
        pending,
        published,
        total: posts.length,
        funnel: Array.from(funnelMap.entries()).map(([stage, count]) => ({ stage, count })),
        byChannel: Array.from(channelMap.entries()).map(([channel, count]) => ({ channel, count })),
        byFormat: Array.from(formatMap.entries()).map(([format, count]) => ({ format, count })),
        dailySeries,
      },
      social: {
        totalPosts: posts.length,
        publishedPosts,
        scheduledPosts,
        byChannel: Array.from(channelMap.entries()).map(([channel, count]) => ({ channel, count })),
        byFormat: Array.from(formatMap.entries()).map(([format, count]) => ({ format, count })),
        weekly,
      },
      team: {
        members,
        avgPunctuality,
        totalOpen,
        totalDone,
      },
      clients: { items: clientItems },
    };
  });
