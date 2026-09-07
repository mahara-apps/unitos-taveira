import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callRpc } from "@/lib/supabase-rpc";
import type { TimesheetEntry } from "@/lib/timesheet-report";

/**
 * Leitura do relatório de timesheet.
 *
 * O escopo (quem vê quais apontamentos) é resolvido no banco pela função
 * `timesheet_report_entries` (security definer, fail-closed):
 * Owner/Admin veem o workspace, Manager só clientes atribuídos, demais só os
 * próprios apontamentos. O custo só volta preenchido quando o papel autoriza.
 */

const MAX_ENTRIES = 20000;

const Filters = z.object({
  brandId: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  userIds: z.array(z.string().uuid()).default([]),
  clientIds: z.array(z.string().uuid()).default([]),
  projectIds: z.array(z.string().uuid()).default([]),
  source: z.enum(["all", "timer", "manual"]).default("all"),
  onlyRework: z.boolean().default(false),
});

export type TimesheetFilters = z.infer<typeof Filters>;

export type TimesheetReport = {
  entries: TimesheetEntry[];
  /** Total do período anterior (mesma duração) para variação. */
  previous: { seconds: number; costCents: number };
  canViewCost: boolean;
  role: string | null;
  scope: "workspace" | "clients" | "self";
  truncated: boolean;
  running: Array<{
    entryId: string;
    userId: string;
    userName: string | null;
    taskId: string;
    taskTitle: string | null;
    startedAt: string;
  }>;
  /** Pessoas do workspace sem valor/hora definido (só para quem vê custo). */
  membersWithoutRate: Array<{ userId: string; name: string }>;
};

type RpcRow = {
  entry_id: string;
  started_at: string;
  ended_at: string | null;
  seconds: number | null;
  is_rework: boolean | null;
  source: string | null;
  description: string | null;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  avatar_url: string | null;
  hourly_cost_cents: number | null;
  task_id: string;
  task_title: string | null;
  task_estimated_minutes: number | null;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  client_name: string | null;
};

function toEntry(r: RpcRow): TimesheetEntry {
  return {
    entry_id: r.entry_id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    seconds: Math.max(0, r.seconds ?? 0),
    is_rework: !!r.is_rework,
    source: (r.source as TimesheetEntry["source"]) ?? "timer",
    description: r.description,
    user_id: r.user_id,
    user_name: r.user_name,
    user_email: r.user_email,
    avatar_url: r.avatar_url,
    hourly_cost_cents: Math.max(0, r.hourly_cost_cents ?? 0),
    task_id: r.task_id,
    task_title: r.task_title,
    task_estimated_minutes: r.task_estimated_minutes,
    project_id: r.project_id,
    project_name: r.project_name,
    client_id: r.client_id,
    client_name: r.client_name,
  };
}

function applyFilters(rows: TimesheetEntry[], f: TimesheetFilters): TimesheetEntry[] {
  const users = new Set(f.userIds);
  const clients = new Set(f.clientIds);
  const projects = new Set(f.projectIds);
  return rows.filter((e) => {
    if (users.size && !users.has(e.user_id)) return false;
    if (clients.size && !(e.client_id && clients.has(e.client_id))) return false;
    if (projects.size && !(e.project_id && projects.has(e.project_id))) return false;
    if (f.source !== "all") {
      const src = e.source === "manual" ? "manual" : "timer";
      if (src !== f.source) return false;
    }
    if (f.onlyRework && !e.is_rework) return false;
    return true;
  });
}

export const getTimesheetReportFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Filters.parse(i))
  .handler(async ({ data, context }): Promise<TimesheetReport> => {
    const { supabase, userId } = context;

    const from = new Date(data.from);
    const to = new Date(data.to);
    const span = Math.max(1, to.getTime() - from.getTime());
    const prevFrom = new Date(from.getTime() - span);
    const prevTo = new Date(from.getTime() - 1000);

    const roleRes = await callRpc<string | null>(supabase, "app_access_role", {
      _user_id: userId,
      _brand_id: data.brandId,
    });
    const role = (roleRes.data as string | null) ?? null;
    const canViewCost = role === "super_admin" || role === "admin" || role === "manager";
    const scope: TimesheetReport["scope"] =
      role === "super_admin" || role === "admin"
        ? "workspace"
        : role === "manager"
          ? "clients"
          : "self";

    const [currRes, prevRes, runningRes] = await Promise.all([
      callRpc<RpcRow[]>(supabase, "timesheet_report_entries", {
        _brand_id: data.brandId,
        _from: from.toISOString(),
        _to: to.toISOString(),
      }),
      callRpc<RpcRow[]>(supabase, "timesheet_report_entries", {
        _brand_id: data.brandId,
        _from: prevFrom.toISOString(),
        _to: prevTo.toISOString(),
      }),
      supabase
        .from("task_time_entries")
        .select("id, user_id, task_id, started_at")
        .eq("brand_id", data.brandId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(50),
    ]);
    if (currRes.error) throw new Error(currRes.error.message);
    if (prevRes.error) throw new Error(prevRes.error.message);

    const allCurrent = ((currRes.data ?? []) as RpcRow[]).map(toEntry);
    const entriesAll = applyFilters(allCurrent, data);
    const truncated = entriesAll.length > MAX_ENTRIES;
    const entries = truncated ? entriesAll.slice(0, MAX_ENTRIES) : entriesAll;

    const prevEntries = applyFilters(((prevRes.data ?? []) as RpcRow[]).map(toEntry), data);
    const previous = prevEntries.reduce(
      (acc, e) => ({
        seconds: acc.seconds + e.seconds,
        costCents:
          acc.costCents +
          Math.round((e.seconds / 3600) * (e.hourly_cost_cents ?? 0)),
      }),
      { seconds: 0, costCents: 0 },
    );

    // Cronômetros em aberto (não contam como tempo fechado).
    const nameById = new Map<string, string | null>();
    const titleById = new Map<string, string | null>();
    for (const e of allCurrent) {
      nameById.set(e.user_id, e.user_name);
      titleById.set(e.task_id, e.task_title);
    }
    const runningRows = (runningRes.data ?? []) as Array<{
      id: string;
      user_id: string;
      task_id: string;
      started_at: string;
    }>;
    const running = runningRows
      .filter((r) => scope === "workspace" || r.user_id === userId)
      .map((r) => ({
        entryId: r.id,
        userId: r.user_id,
        userName: nameById.get(r.user_id) ?? null,
        taskId: r.task_id,
        taskTitle: titleById.get(r.task_id) ?? null,
        startedAt: r.started_at,
      }));

    let membersWithoutRate: TimesheetReport["membersWithoutRate"] = [];
    if (canViewCost) {
      const present = new Set(entries.map((e) => e.user_id));
      const missing = new Map<string, string>();
      for (const e of entries) {
        if (!e.hourly_cost_cents && present.has(e.user_id)) {
          missing.set(e.user_id, e.user_name?.trim() || e.user_email?.trim() || "Sem nome");
        }
      }
      membersWithoutRate = Array.from(missing, ([userId, name]) => ({ userId, name }));
    }

    return {
      entries,
      previous,
      canViewCost,
      role,
      scope,
      truncated,
      running,
      membersWithoutRate,
    };
  });

export const setMemberHourlyCostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        userId: z.string().uuid(),
        hourlyCostCents: z.number().int().min(0).max(100_000_00),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const res = await callRpc<number>(context.supabase, "set_member_hourly_cost", {
      _brand_id: data.brandId,
      _user_id: data.userId,
      _hourly_cost_cents: data.hourlyCostCents,
    });
    if (res.error) throw new Error(res.error.message);
    return { hourlyCostCents: data.hourlyCostCents };
  });

export const listMemberHourlyCostsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ brandId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Valor/hora é dado sensível: só quem administra o workspace pode ler.
    const roleRes = await callRpc<string>(context.supabase, "app_access_role", {
      _user_id: context.userId,
      _brand_id: data.brandId,
    });
    const role = (roleRes.data ?? "").toLowerCase();
    if (role !== "admin" && role !== "super_admin") {
      throw new Error("Sem permissão para ver valores por hora deste workspace.");
    }
    const { data: rows, error } = await context.supabase
      .from("brand_members")
      .select("user_id, hourly_cost_cents")
      .eq("brand_id", data.brandId);
    if (error) throw error;

    return {
      costs: ((rows ?? []) as Array<{ user_id: string; hourly_cost_cents: number | null }>).map(
        (r) => ({ userId: r.user_id, hourlyCostCents: r.hourly_cost_cents ?? 0 }),
      ),
    };
  });
