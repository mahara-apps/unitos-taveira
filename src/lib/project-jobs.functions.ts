import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProjectJob = {
  id: string;
  project_id: string;
  brand_id: string;
  name: string;
  description: string | null;
  color: string | null;
  position: number;
  assignee_id: string | null;
  start_date: string | null;
  due_at: string | null;
  status_id: string | null;
  done_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

const JOB_SELECT =
  "id, project_id, brand_id, name, description, color, position, assignee_id, start_date, due_at, status_id, done_at, archived_at, created_at, updated_at";

export const listJobsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        // Jobs concluídos são arquivados e saem da lista ativa por padrão.
        archive: z.enum(["active", "archived", "all"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<ProjectJob[]> => {
    const archive = data.archive ?? "active";
    let q = context.supabase
      .from("project_jobs")
      .select(JOB_SELECT)
      .eq("brand_id", data.brandId)
      .eq("project_id", data.projectId)
      .order("position", { ascending: true });
    if (archive === "active") q = q.is("archived_at", null);
    else if (archive === "archived") q = q.not("archived_at", "is", null);
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []) as ProjectJob[];
  });

export const createJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        color: z.string().max(20).nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        dueAt: z.string().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: max } = await context.supabase
      .from("project_jobs")
      .select("position")
      .eq("project_id", data.projectId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((max as { position: number } | null)?.position ?? -1) + 1;
    const { data: row, error } = await context.supabase
      .from("project_jobs")
      .insert({
        brand_id: data.brandId,
        project_id: data.projectId,
        name: data.name,
        color: data.color ?? "#8b5cf6",
        assignee_id: data.assigneeId ?? null,
        due_at: data.dueAt ?? null,
        position: nextPos,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return { id: (row as { id: string }).id };
  });

export const updateJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        jobId: z.string().uuid(),
        patch: z
          .object({
            name: z.string().trim().min(1).max(120).optional(),
            description: z.string().max(2000).nullable().optional(),
            color: z.string().max(20).nullable().optional(),
            position: z.number().int().optional(),
            assignee_id: z.string().uuid().nullable().optional(),
            start_date: z.string().nullable().optional(),
            due_at: z.string().nullable().optional(),
            status_id: z.string().uuid().nullable().optional(),
          })
          .partial(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_jobs")
      .update(data.patch as never)
      .eq("id", data.jobId)
      .eq("brand_id", data.brandId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteJobFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), jobId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_jobs")
      .delete()
      .eq("id", data.jobId)
      .eq("brand_id", data.brandId);
    if (error) throw error;
    return { ok: true };
  });

export type JobTask = {
  id: string;
  job_id: string | null;
  project_id: string | null;
  title: string;
  status: string;
  priority: string;
  assignee_id: string | null;
  due_at: string | null;
  start_date: string | null;
  status_id: string | null;
  done: boolean;
  done_at: string | null;
  archived_at: string | null;
  estimated_minutes: number | null;
  total_minutes: number;
  position: number;
};

export const listProjectTasksFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        archive: z.enum(["active", "archived", "all"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<JobTask[]> => {
    const { data: rows, error } = await context.supabase
      .from("tasks")
      .select(
        "id, job_id, project_id, title, status, priority, assignee_id, due_at, start_date, status_id, done, done_at, archived_at, estimated_minutes, total_minutes, position",
      )
      .eq("brand_id", data.brandId)
      .eq("project_id", data.projectId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    const archive = data.archive ?? "all";
    const list = (rows ?? []) as JobTask[];
    if (archive === "active") return list.filter((t) => !t.archived_at);
    if (archive === "archived") return list.filter((t) => !!t.archived_at);
    return list;
  });

export const createJobTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        jobId: z.string().uuid().nullable().optional(),
        title: z.string().trim().min(1).max(200),
        assigneeId: z.string().uuid().nullable().optional(),
        estimatedMinutes: z.number().int().min(0).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // fetch project brand/client for consistency
    const { data: proj } = await context.supabase
      .from("projects")
      .select("client_id")
      .eq("id", data.projectId)
      .maybeSingle();
    const { data: row, error } = await context.supabase
      .from("tasks")
      .insert({
        brand_id: data.brandId,
        client_id: (proj as { client_id: string | null } | null)?.client_id ?? null,
        project_id: data.projectId,
        job_id: data.jobId ?? null,
        title: data.title,
        status: "todo",
        priority: "medium",
        assignee_id: data.assigneeId ?? context.userId,
        estimated_minutes: data.estimatedMinutes ?? null,
        created_by: context.userId,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return { id: (row as { id: string }).id };
  });

export const updateJobTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        taskId: z.string().uuid(),
        patch: z
          .object({
            title: z.string().trim().min(1).max(200).optional(),
            job_id: z.string().uuid().nullable().optional(),
            status: z.string().optional(),
            priority: z.string().optional(),
            assignee_id: z.string().uuid().nullable().optional(),
            estimated_minutes: z.number().int().min(0).nullable().optional(),
            due_at: z.string().nullable().optional(),
            start_date: z.string().nullable().optional(),
            status_id: z.string().uuid().nullable().optional(),
            done: z.boolean().optional(),
          })
          .partial(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Concluir = marca conclusão e arquiva; reabrir desfaz os dois.
    const patch: Record<string, unknown> = { ...data.patch };
    if (patch.done === true) {
      patch.status = "done";
      patch.done_at = new Date().toISOString();
      patch.archived_at = new Date().toISOString();
    } else if (patch.done === false) {
      patch.done_at = null;
      patch.archived_at = null;
      if (!patch.status) patch.status = "todo";
    }
    const { error } = await context.supabase
      .from("tasks")
      .update(patch as never)
      .eq("id", data.taskId)
      .eq("brand_id", data.brandId);
    if (error) throw error;
    return { ok: true };
  });

/** Concluir/reabrir um job: conclusão arquiva automaticamente. */
export const setJobDoneFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        jobId: z.string().uuid(),
        done: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { data: rows, error } = await context.supabase
      .from("project_jobs")
      .update(
        (data.done
          ? { done_at: now, archived_at: now }
          : { done_at: null, archived_at: null }) as never,
      )
      .eq("id", data.jobId)
      .eq("brand_id", data.brandId)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error("Forbidden: job fora do seu escopo");
    return { ok: true };
  });

/**
 * Arquiva/restaura um job SEM mexer na conclusão — "arquivar" só tira o job
 * das listas ativas; "concluir" continua sendo outra ação (`setJobDoneFn`).
 */
export const setJobArchivedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        jobId: z.string().uuid(),
        archived: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("project_jobs")
      .update({ archived_at: data.archived ? new Date().toISOString() : null } as never)
      .eq("id", data.jobId)
      .eq("brand_id", data.brandId)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error("Forbidden: job fora do seu escopo");
    return { ok: true };
  });

