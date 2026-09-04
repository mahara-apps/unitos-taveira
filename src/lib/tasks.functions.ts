import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const TASK_STATUSES = ["todo", "in_progress", "review", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type TaskRow = {
  id: string;
  brand_id: string;
  client_id: string | null;
  project_id: string | null;
  post_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_at: string | null;
  start_date: string | null;
  status_id: string | null;
  done: boolean;
  done_at: string | null;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // joined
  assignee_name?: string | null;
  assignee_avatar?: string | null;
  client_name?: string | null;
  project_name?: string | null;
  comments_count?: number;
  time_spent_seconds?: number;
  subtasks_total?: number;
  subtasks_done?: number;
};

export type TaskComment = {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  body: string;
  mentions: string[];
  created_at: string;
};

export const listTasksFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
        // Arquivadas ficam fora da lista ativa por padrão (nunca são excluídas).
        archive: z.enum(["active", "archived", "all"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<TaskRow[]> => {
    const archive = data.archive ?? "active";
    let q = context.supabase
      .from("tasks")
      .select(
        "id, brand_id, client_id, project_id, post_id, title, description, status, priority, assignee_id, due_at, start_date, status_id, done, done_at, archived_at, created_by, created_at, updated_at",
      )
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    if (archive === "active") q = q.is("archived_at", null);
    else if (archive === "archived") q = q.not("archived_at", "is", null);
    const { data: rows, error } = await q;
    if (error) throw error;
    const tasks = rows ?? [];
    if (tasks.length === 0) return [];

    const userIds = Array.from(
      new Set(tasks.map((t) => t.assignee_id).filter(Boolean) as string[]),
    );
    const clientIds = Array.from(
      new Set(tasks.map((t) => t.client_id).filter(Boolean) as string[]),
    );
    const projectIds = Array.from(
      new Set(tasks.map((t) => t.project_id).filter(Boolean) as string[]),
    );

    const [profilesRes, clientsRes, projectsRes, commentsRes, timeRes, subtasksRes] =
      await Promise.all([
        userIds.length
          ? context.supabase
              .from("user_profiles")
              .select("id, full_name, avatar_url")
              .in("id", userIds)
          : Promise.resolve({ data: [], error: null } as never),
        clientIds.length
          ? context.supabase.from("clients").select("id, name").in("id", clientIds)
          : Promise.resolve({ data: [], error: null } as never),
        projectIds.length
          ? context.supabase.from("projects").select("id, name").in("id", projectIds)
          : Promise.resolve({ data: [], error: null } as never),
        context.supabase
          .from("task_comments")
          .select("task_id")
          .in(
            "task_id",
            tasks.map((t) => t.id),
          ),
        context.supabase
          .from("task_time_entries")
          .select("task_id, seconds, minutes")
          .in(
            "task_id",
            tasks.map((t) => t.id),
          ),
        context.supabase
          .from("task_subtasks")
          .select("task_id, done")
          .in(
            "task_id",
            tasks.map((t) => t.id),
          ),
      ]);

    const profMap = new Map(
      (
        (profilesRes.data ?? []) as Array<{
          id: string;
          full_name: string | null;
          avatar_url: string | null;
        }>
      ).map((p) => [p.id, p]),
    );
    const clientMap = new Map(
      ((clientsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
    );
    const projectMap = new Map(
      ((projectsRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
    );
    const commentCounts = new Map<string, number>();
    for (const c of (commentsRes.data ?? []) as Array<{ task_id: string }>) {
      commentCounts.set(c.task_id, (commentCounts.get(c.task_id) ?? 0) + 1);
    }
    const timeSeconds = new Map<string, number>();
    for (const e of (timeRes.data ?? []) as Array<{
      task_id: string;
      seconds: number | null;
      minutes: number | null;
    }>) {
      const secs = e.seconds ?? (e.minutes ?? 0) * 60;
      timeSeconds.set(e.task_id, (timeSeconds.get(e.task_id) ?? 0) + secs);
    }

    const subTotal = new Map<string, number>();
    const subDone = new Map<string, number>();
    for (const st of (subtasksRes.data ?? []) as Array<{ task_id: string; done: boolean }>) {
      subTotal.set(st.task_id, (subTotal.get(st.task_id) ?? 0) + 1);
      if (st.done) subDone.set(st.task_id, (subDone.get(st.task_id) ?? 0) + 1);
    }

    return tasks.map((t) => {
      const p = t.assignee_id ? profMap.get(t.assignee_id) : null;
      return {
        ...t,
        status: t.status as TaskStatus,
        priority: t.priority as TaskPriority,
        assignee_name: p?.full_name ?? null,
        assignee_avatar: p?.avatar_url ?? null,
        client_name: t.client_id ? (clientMap.get(t.client_id) ?? null) : null,
        project_name: t.project_id ? (projectMap.get(t.project_id) ?? null) : null,
        comments_count: commentCounts.get(t.id) ?? 0,
        time_spent_seconds: timeSeconds.get(t.id) ?? 0,
        subtasks_total: subTotal.get(t.id) ?? 0,
        subtasks_done: subDone.get(t.id) ?? 0,
      } as TaskRow;
    });
  });

export type TaskProjectOption = {
  id: string;
  name: string;
  client_id: string | null;
  status: string;
};

/** Projetos selecionáveis por uma tarefa: mesma workspace, sem arquivados/concluídos. */
export const listProjectsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        includeInactive: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<TaskProjectOption[]> => {
    let q = context.supabase
      .from("projects")
      .select("id, name, client_id, status")
      .eq("brand_id", data.brandId)
      .order("name");
    if (!data.includeInactive) q = q.not("status", "in", "(archived,done)");
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []) as TaskProjectOption[];
  });

export const countMyPendingTasksFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ count: number }> => {
    let q = context.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("brand_id", data.brandId)
      .eq("assignee_id", context.userId)
      .neq("status", "done");
    // Respeita o escopo do cliente ativo na sidebar.
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { count, error } = await q;
    if (error) throw error;
    return { count: count ?? 0 };
  });

/**
 * Garante a hierarquia Projeto → Tarefa: o projeto precisa ser da mesma workspace
 * e do mesmo cliente da tarefa. Complementa o trigger no banco com mensagem clara.
 */
async function assertProjectScope(
  supabase: { from: (t: string) => any },
  args: { brandId: string; clientId: string | null; projectId: string | null },
): Promise<void> {
  if (!args.projectId) return;
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, brand_id, client_id, status")
    .eq("id", args.projectId)
    .maybeSingle();
  if (error) throw error;
  if (!project) throw new Error("Projeto não encontrado.");
  if (project.brand_id !== args.brandId) {
    throw new Error("Este projeto pertence a outra workspace.");
  }
  if (project.client_id && project.client_id !== args.clientId) {
    throw new Error("Este projeto pertence a outro cliente. Selecione o cliente correto.");
  }
}

const CreateTaskInput = z.object({
  brandId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).optional().nullable(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  due_at: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  status_id: z.string().uuid().nullable().optional(),
});

export const createTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateTaskInput.parse(i))
  .handler(async ({ data, context }) => {
    const { assertBrandMember, assertClientInBrand } = await import("@/lib/access-guard");
    // O workspace enviado pelo frontend nunca é confiável.
    const role = await assertBrandMember(context.supabase as never, context.userId, data.brandId);

    // Cliente derivado do projeto quando o projeto é client-scoped: o
    // `client_id` do frontend não pode "descer" para outro cliente.
    let clientId = data.client_id ?? null;
    if (data.project_id) {
      const { data: project, error: projErr } = await context.supabase
        .from("projects")
        .select("id, brand_id, client_id")
        .eq("id", data.project_id)
        .maybeSingle();
      if (projErr) throw projErr;
      if (!project) throw new Error("Projeto não encontrado.");
      if (project.brand_id !== data.brandId) {
        throw new Error("Este projeto pertence a outra workspace.");
      }
      if (project.client_id) clientId = project.client_id as string;
    }

    if (clientId) {
      // Valida par workspace+cliente e escopo do ator (MANAGER/USER só em
      // clientes atribuídos).
      await assertClientInBrand(context.supabase as never, context.userId, data.brandId, clientId);
    } else if (role !== "super_admin" && role !== "admin") {
      // Tarefa workspace-level (client_id NULL) é caso legítimo apenas para
      // autoridade de workspace (ADMIN/SUPER ADMIN). Sem default silencioso.
      throw new Error("Forbidden: selecione um cliente para criar a tarefa");
    }

    await assertProjectScope(context.supabase as never, {
      brandId: data.brandId,
      clientId,
      projectId: data.project_id ?? null,
    });
    const { data: row, error } = await context.supabase
      .from("tasks")
      .insert({
        brand_id: data.brandId,
        title: data.title,
        description: data.description ?? null,
        status: data.status ?? "todo",
        priority: data.priority ?? "medium",
        assignee_id: data.assignee_id ?? null,
        client_id: clientId,
        project_id: data.project_id ?? null,
        due_at: data.due_at ?? null,
        start_date: data.start_date ?? null,
        status_id: data.status_id ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: row!.id as string };
  });

const UpdateTaskInput = z.object({
  taskId: z.string().uuid(),
  patch: z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    client_id: z.string().uuid().nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
    due_at: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    status_id: z.string().uuid().nullable().optional(),
    done: z.boolean().optional(),
  }),
});

export const updateTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateTaskInput.parse(i))
  .handler(async ({ data, context }) => {
    const patch = { ...data.patch } as {
      title?: string;
      description?: string | null;
      status?: TaskStatus;
      priority?: TaskPriority;
      assignee_id?: string | null;
      client_id?: string | null;
      project_id?: string | null;
      due_at?: string | null;
      start_date?: string | null;
      status_id?: string | null;
      done?: boolean;
      done_at?: string | null;
      archived_at?: string | null;
    };
    if (patch.project_id !== undefined || patch.client_id !== undefined) {
      const { data: current, error: curErr } = await context.supabase
        .from("tasks")
        .select("brand_id, client_id, project_id")
        .eq("id", data.taskId)
        .single();
      if (curErr) throw curErr;
      const nextClientId =
        patch.client_id !== undefined ? patch.client_id : (current!.client_id as string | null);
      const nextProjectId =
        patch.project_id !== undefined ? patch.project_id : (current!.project_id as string | null);
      // Trocar de cliente invalida um projeto de outro cliente: desvincula em vez de falhar.
      if (patch.client_id !== undefined && patch.project_id === undefined && nextProjectId) {
        const { data: proj } = await context.supabase
          .from("projects")
          .select("client_id")
          .eq("id", nextProjectId)
          .maybeSingle();
        if (proj && proj.client_id && proj.client_id !== nextClientId) {
          patch.project_id = null;
        }
      }
      // Reescopo de cliente: valida cadeia workspace→cliente no servidor.
      const { assertBrandMember, assertClientInBrand } = await import("@/lib/access-guard");
      const brandId = current!.brand_id as string;
      const role = await assertBrandMember(context.supabase as never, context.userId, brandId);
      if (nextClientId) {
        await assertClientInBrand(
          context.supabase as never,
          context.userId,
          brandId,
          nextClientId,
        );
      } else if (role !== "super_admin" && role !== "admin") {
        throw new Error("Forbidden: tarefa sem cliente exige autoridade de workspace");
      }
      await assertProjectScope(context.supabase as never, {
        brandId,
        clientId: nextClientId,
        projectId: patch.project_id !== undefined ? patch.project_id : nextProjectId,
      });
    }
    if (patch.done === true) {
      // Concluir arquiva automaticamente (a tarefa segue consultável em "Concluídas").
      patch.status = "done";
      patch.done_at = new Date().toISOString();
      patch.archived_at = new Date().toISOString();
    } else if (patch.done === false) {
      patch.done_at = null;
      patch.archived_at = null;
    }
    const { data: rows, error } = await context.supabase
      .from("tasks")
      .update(patch)
      .eq("id", data.taskId)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error("Forbidden: tarefa fora do seu escopo");
    return { ok: true };
  });

export const deleteTaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ taskId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertTaskScope(context.supabase as never, context.userId, data.taskId);
    const { data: rows, error } = await context.supabase
      .from("tasks")
      .delete()
      .eq("id", data.taskId)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error("Forbidden: tarefa fora do seu escopo");
    return { ok: true };
  });

/** Arquivamento reversível: nunca apaga a tarefa nem as subtarefas. */
export const setTaskArchivedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ taskId: z.string().uuid(), archived: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tasks")
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("id", data.taskId)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error("Forbidden: tarefa fora do seu escopo");
    return { ok: true };
  });

export const listTaskCommentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ taskId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<TaskComment[]> => {
    const { data: rows, error } = await context.supabase
      .from("task_comments")
      .select("id, task_id, author_id, body, mentions, created_at")
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const list = rows ?? [];
    if (list.length === 0) return [];
    const authorIds = Array.from(new Set(list.map((c) => c.author_id as string)));
    const { data: profs } = await context.supabase
      .from("user_profiles")
      .select("id, full_name, avatar_url")
      .in("id", authorIds);
    const map = new Map(
      (
        (profs ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null }>
      ).map((p) => [p.id, p]),
    );
    return list.map((c) => {
      const p = map.get(c.author_id as string);
      return {
        id: c.id as string,
        task_id: c.task_id as string,
        author_id: c.author_id as string,
        author_name: p?.full_name ?? null,
        author_avatar: p?.avatar_url ?? null,
        body: c.body as string,
        mentions: (c.mentions as string[]) ?? [],
        created_at: c.created_at as string,
      };
    });
  });

export const addTaskCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        taskId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
        mentions: z.array(z.string().uuid()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: task, error: tErr } = await context.supabase
      .from("tasks")
      .select("brand_id, title")
      .eq("id", data.taskId)
      .single();
    if (tErr) throw tErr;
    const { data: inserted, error } = await context.supabase
      .from("task_comments")
      .insert({
        task_id: data.taskId,
        brand_id: task!.brand_id as string,
        author_id: context.userId,
        body: data.body,
        mentions: data.mentions ?? [],
      })
      .select("id")
      .single();
    if (error) throw error;

    const mentions = data.mentions ?? [];
    if (mentions.length > 0) {
      const { notifyMentionsSafe } = await import("@/lib/mention-notify.server");
      await notifyMentionsSafe(context.supabase, {
        brandId: task!.brand_id as string,
        authorId: context.userId,
        mentions,
        commentId: (inserted as { id: string } | null)?.id ?? null,
        title: `Você foi mencionado em: ${(task as { title?: string }).title ?? "tarefa"}`,
        body: data.body,
        href: `/tasks?taskId=${data.taskId}`,
      });
    }
    return { ok: true, id: (inserted as { id: string } | null)?.id ?? null };
  });

export const deleteTaskCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ commentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("task_comments")
      .delete()
      .eq("id", data.commentId)
      .eq("author_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
export type TaskSubtask = {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: number;
  created_at: string;
};

// Subtasks inherit the parent task scope: brand membership + client access.
async function assertTaskScope(
  supabase: { from: (t: string) => any },
  userId: string,
  taskId: string,
): Promise<{ brand_id: string; client_id: string | null }> {
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id, brand_id, client_id")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  if (!task) throw new Error("Tarefa não encontrada ou sem acesso.");
  const { data: allowed, error: rpcErr } = await (supabase as any).rpc("can_access_task", {
    _task_id: taskId,
    _user_id: userId,
  });
  if (rpcErr) throw rpcErr;
  if (allowed !== true) throw new Error("Sem acesso a esta tarefa.");
  return {
    brand_id: task.brand_id as string,
    client_id: (task.client_id ?? null) as string | null,
  };
}

async function assertSubtaskScope(
  supabase: { from: (t: string) => any },
  userId: string,
  subtaskId: string,
): Promise<string> {
  const { data: st, error } = await supabase
    .from("task_subtasks")
    .select("id, task_id")
    .eq("id", subtaskId)
    .maybeSingle();
  if (error) throw error;
  if (!st) throw new Error("Subtarefa não encontrada ou sem acesso.");
  await assertTaskScope(supabase, userId, st.task_id as string);
  return st.task_id as string;
}

export const listSubtasksFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ taskId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<TaskSubtask[]> => {
    await assertTaskScope(context.supabase as never, context.userId, data.taskId);
    const { data: rows, error } = await context.supabase
      .from("task_subtasks")
      .select("id, task_id, title, done, position, created_at")
      .eq("task_id", data.taskId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as TaskSubtask[];
  });

export const addSubtaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        taskId: z.string().uuid(),
        title: z.string().trim().min(1).max(300),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const task = await assertTaskScope(context.supabase as never, context.userId, data.taskId);
    const { data: last } = await context.supabase
      .from("task_subtasks")
      .select("position")
      .eq("task_id", data.taskId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = ((last?.[0]?.position as number | undefined) ?? -1) + 1;
    const { error } = await context.supabase.from("task_subtasks").insert({
      task_id: data.taskId,
      brand_id: task.brand_id,
      title: data.title,
      position: nextPos,
      created_by: context.userId,
    });
    if (error) throw error;
    return { ok: true };
  });

export const updateSubtaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        subtaskId: z.string().uuid(),
        patch: z.object({
          title: z.string().trim().min(1).max(300).optional(),
          done: z.boolean().optional(),
        }),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertSubtaskScope(context.supabase as never, context.userId, data.subtaskId);
    const { error } = await context.supabase
      .from("task_subtasks")
      .update(data.patch)
      .eq("id", data.subtaskId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteSubtaskFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ subtaskId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertSubtaskScope(context.supabase as never, context.userId, data.subtaskId);
    const { error } = await context.supabase
      .from("task_subtasks")
      .delete()
      .eq("id", data.subtaskId);
    if (error) throw error;
    return { ok: true };
  });
