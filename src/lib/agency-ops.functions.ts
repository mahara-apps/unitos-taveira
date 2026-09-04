import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stageSlaHours } from "@/lib/content.functions";
import { resolveInclusiveRange } from "@/lib/date-range";

/**
 * Dashboard operacional consolidado da agência.
 * Visível apenas no modo Agência (sem cliente ativo). Reaproveita as tabelas
 * existentes — sem migração. Não sobrepõe métricas sociais.
 */

export type OverdueTaskLite = {
  id: string;
  title: string;
  due_at: string | null;
  hours_overdue: number;
  priority: string | null;
  client_id: string | null;
  client_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_avatar: string | null;
};

export type StageCount = {
  stage_id: string;
  label: string;
  color: string | null;
  count: number;
};

export type PendingApprovalLite = {
  post_id: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  waiting_hours: number;
  created_at: string;
};

export type SlaSummary = {
  onTrack: number;
  atRisk: number;
  overdue: number;
  overduePct: number;
  atRiskPct: number;
};

export type BottleneckStage = {
  stage_id: string;
  label: string;
  color: string | null;
  sla_hours: number;
  avg_hours_in_stage: number;
  overdue_count: number;
  total: number;
  overdue_pct: number;
};

export type TeamThroughputRow = {
  user_id: string;
  name: string;
  avatar: string | null;
  tasks_done: number;
  posts_approved: number;
  hours_logged: number;
};

export type AgencyOpsDashboard = {
  rangeDays: number;
  overdueTasks: { total: number; items: OverdueTaskLite[] };
  contentInProduction: { total: number; byStage: StageCount[] };
  pendingApproval: {
    total: number;
    avgWaitHours: number;
    items: PendingApprovalLite[];
  };
  slaSummary: SlaSummary;
  bottlenecks: BottleneckStage[];
  teamThroughput: TeamThroughputRow[];
};

function resolveRange(input?: { from?: string; to?: string }) {
  // Fonte de verdade única do período (contagem inclusiva, igual ao filtro).
  return resolveInclusiveRange(input, { defaultDays: 30 });
}

export const getAgencyOpsDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
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
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<AgencyOpsDashboard> => {
    const { supabase } = context;
    const range = resolveRange(data.range);
    const nowMs = Date.now();
    const brandId = data.brandId;

    // Paralelizar fetchs base
    const [
      overdueTasksRes,
      productionPostsRes,
      pendingApprovalsRes,
      stagesRes,
      pipelinesRes,
      periodTasksDoneRes,
      periodApprovalsRes,
      periodTimeEntriesRes,
      clientsRes,
    ] = await Promise.all([
      // Tarefas atrasadas ATIVAS (não concluídas, due_at no passado)
      supabase
        .from("tasks")
        .select("id, title, due_at, priority, client_id, assignee_id")
        .eq("brand_id", brandId)
        .eq("done", false)
        .not("due_at", "is", null)
        .lt("due_at", new Date(nowMs).toISOString())
        .order("due_at", { ascending: true })
        .limit(500),
      // Posts ativos (não terminais) para contagem por etapa + SLA
      supabase
        .from("posts")
        .select("id, stage_id, stage_entered_at")
        .eq("brand_id", brandId)
        .is("deleted_at", null)
        .not("stage_id", "is", null),
      // Aprovações pendentes -> juntar com posts para escopar por brand
      supabase
        .from("post_approvals")
        .select("id, post_id, created_at, posts!inner(id, title, brand_id, client_id)")
        .eq("status", "pending")
        .eq("posts.brand_id", brandId)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase
        .from("content_pipeline_stages")
        .select("id, pipeline_id, label, color, sla_days, sla_hours, is_terminal, position"),
      supabase.from("content_pipelines").select("id").eq("brand_id", brandId),
      // Tarefas concluídas no período (por responsável)
      supabase
        .from("tasks")
        .select("id, assignee_id")
        .eq("brand_id", brandId)
        .eq("done", true)
        .gte("done_at", range.fromIso)
        .lte("done_at", range.toIso)
        .limit(2000),
      // Aprovações no período (posts do brand)
      supabase
        .from("post_approvals")
        .select("id, decided_by, decided_at, posts!inner(brand_id)")
        .eq("status", "approved")
        .eq("posts.brand_id", brandId)
        .gte("decided_at", range.fromIso)
        .lte("decided_at", range.toIso)
        .limit(2000),
      // Horas registradas no período (timesheet)
      supabase
        .from("task_time_entries")
        .select("user_id, minutes")
        .eq("brand_id", brandId)
        .not("minutes", "is", null)
        .gte("started_at", range.fromIso)
        .lte("started_at", range.toIso)
        .limit(5000),
      supabase.from("clients").select("id, name").eq("brand_id", brandId),
    ]);

    const clientMap = new Map(
      ((clientsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
    );

    // ---------------- OVERDUE TASKS ----------------
    const overdueRows = (overdueTasksRes.data ?? []) as Array<{
      id: string;
      title: string;
      due_at: string | null;
      priority: string | null;
      client_id: string | null;
      assignee_id: string | null;
    }>;
    const assigneeIds = Array.from(
      new Set(overdueRows.map((r) => r.assignee_id).filter(Boolean) as string[]),
    );
    const { data: profs } = assigneeIds.length
      ? await supabase
          .from("user_profiles")
          .select("id, full_name, avatar_url")
          .in("id", assigneeIds)
      : { data: [] as Array<{ id: string; full_name: string | null; avatar_url: string | null }> };
    const profMap = new Map(
      (
        (profs ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null }>
      ).map((p) => [p.id, p]),
    );
    const overdueItems: OverdueTaskLite[] = overdueRows.slice(0, 10).map((t) => {
      const dueMs = t.due_at ? new Date(t.due_at).getTime() : nowMs;
      const p = t.assignee_id ? profMap.get(t.assignee_id) : null;
      return {
        id: t.id,
        title: t.title,
        due_at: t.due_at,
        hours_overdue: Math.max(0, (nowMs - dueMs) / 3_600_000),
        priority: t.priority,
        client_id: t.client_id,
        client_name: t.client_id ? (clientMap.get(t.client_id) ?? null) : null,
        assignee_id: t.assignee_id,
        assignee_name: p?.full_name ?? null,
        assignee_avatar: p?.avatar_url ?? null,
      };
    });

    // ---------------- STAGES / PRODUCTION / SLA / BOTTLENECKS ----------------
    const pipeIds = new Set(((pipelinesRes.data ?? []) as Array<{ id: string }>).map((p) => p.id));
    const allStages = (
      (stagesRes.data ?? []) as Array<{
        id: string;
        pipeline_id: string | null;
        label: string;
        color: string | null;
        sla_days: number | null;
        sla_hours: number | null;
        is_terminal: boolean;
        position: number;
      }>
    ).filter((s) => s.pipeline_id && pipeIds.has(s.pipeline_id));
    const stageMap = new Map(allStages.map((s) => [s.id, s]));

    const productionPosts = (productionPostsRes.data ?? []) as Array<{
      id: string;
      stage_id: string | null;
      stage_entered_at: string | null;
    }>;

    const byStageCount = new Map<string, number>();
    let onTrack = 0;
    let atRisk = 0;
    let overdue = 0;
    let productionTotal = 0;
    const stageStats = new Map<string, { hoursSum: number; count: number; overdue: number }>();

    for (const p of productionPosts) {
      if (!p.stage_id) continue;
      const s = stageMap.get(p.stage_id);
      if (!s || s.is_terminal) continue;
      productionTotal += 1;
      byStageCount.set(p.stage_id, (byStageCount.get(p.stage_id) ?? 0) + 1);

      const slaH = stageSlaHours(s);
      if (!slaH || !p.stage_entered_at) {
        onTrack += 1;
        continue;
      }
      const enteredMs = new Date(p.stage_entered_at).getTime();
      const hoursIn = Math.max(0, (nowMs - enteredMs) / 3_600_000);
      const prev = stageStats.get(p.stage_id) ?? {
        hoursSum: 0,
        count: 0,
        overdue: 0,
      };
      prev.hoursSum += hoursIn;
      prev.count += 1;
      const progress = hoursIn / slaH;
      if (progress >= 1) {
        overdue += 1;
        prev.overdue += 1;
      } else if (progress >= 0.8) {
        atRisk += 1;
      } else {
        onTrack += 1;
      }
      stageStats.set(p.stage_id, prev);
    }

    const byStage: StageCount[] = Array.from(byStageCount.entries())
      .map(([stage_id, count]) => {
        const s = stageMap.get(stage_id)!;
        return { stage_id, label: s.label, color: s.color, count };
      })
      .sort((a, b) => {
        const sa = stageMap.get(a.stage_id)?.position ?? 0;
        const sb = stageMap.get(b.stage_id)?.position ?? 0;
        return sa - sb;
      });

    const totalSla = onTrack + atRisk + overdue;
    const slaSummary: SlaSummary = {
      onTrack,
      atRisk,
      overdue,
      overduePct: totalSla ? Math.round((overdue / totalSla) * 100) : 0,
      atRiskPct: totalSla ? Math.round((atRisk / totalSla) * 100) : 0,
    };

    const bottlenecks: BottleneckStage[] = Array.from(stageStats.entries())
      .map(([stage_id, v]) => {
        const s = stageMap.get(stage_id)!;
        const slaH = stageSlaHours(s) ?? 0;
        return {
          stage_id,
          label: s.label,
          color: s.color,
          sla_hours: slaH,
          avg_hours_in_stage: v.count ? v.hoursSum / v.count : 0,
          overdue_count: v.overdue,
          total: v.count,
          overdue_pct: v.count ? Math.round((v.overdue / v.count) * 100) : 0,
        };
      })
      .sort((a, b) => b.overdue_pct - a.overdue_pct || b.avg_hours_in_stage - a.avg_hours_in_stage)
      .slice(0, 8);

    // ---------------- PENDING APPROVAL ----------------
    const approvalsRaw = (pendingApprovalsRes.data ?? []) as Array<{
      id: string;
      post_id: string;
      created_at: string;
      posts: { id: string; title: string; brand_id: string; client_id: string | null } | null;
    }>;
    const pendingItems: PendingApprovalLite[] = approvalsRaw
      .filter((a) => a.posts)
      .map((a) => {
        const waitMs = nowMs - new Date(a.created_at).getTime();
        return {
          post_id: a.post_id,
          title: a.posts?.title ?? "Sem título",
          client_id: a.posts?.client_id ?? null,
          client_name: a.posts?.client_id ? (clientMap.get(a.posts.client_id) ?? null) : null,
          waiting_hours: Math.max(0, waitMs / 3_600_000),
          created_at: a.created_at,
        };
      });
    const avgWait = pendingItems.length
      ? pendingItems.reduce((s, x) => s + x.waiting_hours, 0) / pendingItems.length
      : 0;
    const pendingApproval = {
      total: pendingItems.length,
      avgWaitHours: avgWait,
      items: pendingItems.slice(0, 10),
    };

    // ---------------- TEAM THROUGHPUT ----------------
    const tasksByUser = new Map<string, number>();
    for (const t of (periodTasksDoneRes.data ?? []) as Array<{ assignee_id: string | null }>) {
      if (!t.assignee_id) continue;
      tasksByUser.set(t.assignee_id, (tasksByUser.get(t.assignee_id) ?? 0) + 1);
    }
    const approvedByUser = new Map<string, number>();
    for (const a of (periodApprovalsRes.data ?? []) as Array<{ decided_by: string | null }>) {
      if (!a.decided_by) continue;
      approvedByUser.set(a.decided_by, (approvedByUser.get(a.decided_by) ?? 0) + 1);
    }
    const minutesByUser = new Map<string, number>();
    for (const e of (periodTimeEntriesRes.data ?? []) as Array<{
      user_id: string;
      minutes: number | null;
    }>) {
      minutesByUser.set(e.user_id, (minutesByUser.get(e.user_id) ?? 0) + (e.minutes ?? 0));
    }

    const teamUserIds = Array.from(
      new Set<string>([...tasksByUser.keys(), ...approvedByUser.keys(), ...minutesByUser.keys()]),
    );
    const { data: teamProfs } = teamUserIds.length
      ? await supabase
          .from("user_profiles")
          .select("id, full_name, avatar_url")
          .in("id", teamUserIds)
      : { data: [] as Array<{ id: string; full_name: string | null; avatar_url: string | null }> };
    const teamProfMap = new Map(
      (
        (teamProfs ?? []) as Array<{
          id: string;
          full_name: string | null;
          avatar_url: string | null;
        }>
      ).map((p) => [p.id, p]),
    );
    const teamThroughput: TeamThroughputRow[] = teamUserIds
      .map((uid) => {
        const p = teamProfMap.get(uid);
        return {
          user_id: uid,
          name: p?.full_name ?? "Sem nome",
          avatar: p?.avatar_url ?? null,
          tasks_done: tasksByUser.get(uid) ?? 0,
          posts_approved: approvedByUser.get(uid) ?? 0,
          hours_logged: Math.round(((minutesByUser.get(uid) ?? 0) / 60) * 10) / 10,
        };
      })
      .sort(
        (a, b) =>
          b.tasks_done + b.posts_approved - (a.tasks_done + a.posts_approved) ||
          b.hours_logged - a.hours_logged,
      )
      .slice(0, 12);

    return {
      rangeDays: range.days,
      overdueTasks: { total: overdueRows.length, items: overdueItems },
      contentInProduction: { total: productionTotal, byStage },
      pendingApproval,
      slaSummary,
      bottlenecks,
      teamThroughput,
    };
  });
