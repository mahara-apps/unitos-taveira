import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadStageMap, effectiveStage } from "@/lib/post-stage.server";
import { assertBrandMember, assertClientInBrand, assertProjectScope } from "@/lib/access-guard";

const ProjectStatus = z.enum(["planning", "active", "in_progress", "paused", "done", "archived"]);

export type ProjectPlanRef = { id: string; title: string | null; status: string };

type ProjectListRow = {
  id: string;
  brand_id: string;
  client_id: string | null;
  name: string;
  description: string | null;
  status: string;
  status_id: string | null;
  color: string | null;
  progress: number | null;
  start_date: string | null;
  due_at: string | null;
  goals: string | null;
  owner_id: string | null;
  done_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  monthly_plan_id: string | null;
  monthly_plans: ProjectPlanRef | null;
};

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
        status: ProjectStatus.nullable().optional(),
        ownerId: z.string().uuid().nullable().optional(),
        q: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("projects")
      .select(
        "id, brand_id, client_id, name, description, status, status_id, color, progress, start_date, due_at, goals, owner_id, done_at, archived_at, created_at, updated_at, monthly_plan_id, monthly_plans!projects_monthly_plan_id_fkey(id, title, status)",
      )
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false });

    if (data.clientId) query = query.eq("client_id", data.clientId);
    if (data.status) query = query.eq("status", data.status);
    if (data.ownerId) query = query.eq("owner_id", data.ownerId);
    if (data.q && data.q.trim()) query = query.ilike("name", `%${data.q.trim()}%`);

    const { data: rawRows, error } = await query;
    if (error) throw error;
    const projects = ((rawRows ?? []) as unknown as ProjectListRow[]).map((p) => ({
      ...p,
      plan: p.monthly_plans
        ? { id: p.monthly_plans.id, title: p.monthly_plans.title, status: p.monthly_plans.status }
        : null,
    }));
    if (projects.length === 0) return { projects: [], stats: {} as Record<string, ProjectStats> };

    const ids = projects.map((p) => p.id);

    const { data: postRows, error: postErr } = await context.supabase
      .from("posts")
      .select("id, project_id, stage, stage_id, published_at, review_status")
      .eq("brand_id", data.brandId)
      .in("project_id", ids);
    if (postErr) throw postErr;

    // `stage_id` é a fonte operacional; o enum legado é só fallback.
    const stageMap = await loadStageMap(
      context.supabase,
      (postRows ?? []).map((p) => p.stage_id as string | null),
    );

    const stats: Record<string, ProjectStats> = {};
    for (const id of ids) stats[id] = { total: 0, approved: 0, published: 0, pending: 0 };
    for (const p of postRows ?? []) {
      const s = stats[p.project_id as string];
      if (!s) continue;
      s.total += 1;
      const stage = effectiveStage(p.stage_id as string | null, p.stage as string | null, stageMap);
      const review = String(p.review_status ?? "").toLowerCase();
      const published = !!p.published_at || stage === "published";
      if (published) s.published += 1;
      if (review === "approved" || stage === "approved") s.approved += 1;
      if (!published && review !== "approved" && stage !== "approved") s.pending += 1;
    }

    return { projects, stats };
  });

export type ProjectStats = { total: number; approved: number; published: number; pending: number };

export type ProjectPlanItem = {
  topic_id: string;
  title: string;
  channel: string | null;
  format: string | null;
  topic_status: string | null;
  client_status: string | null;
  post: {
    id: string;
    stage: string | null;
    review_status: string | null;
    published_at: string | null;
    scheduled_at: string | null;
    assignee_id: string | null;
    cover_url: string | null;
  } | null;
  tasks: {
    count: number;
    open: number;
    assignee_id: string | null;
    assignee_name: string | null;
    due_at: string | null;
  };
};

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ brandId: z.string().uuid(), projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: projectRaw, error } = await context.supabase
      .from("projects")
      .select(
        "id, brand_id, client_id, name, description, status, status_id, color, progress, start_date, due_at, goals, owner_id, done_at, archived_at, created_at, updated_at, monthly_plan_id, monthly_plans!projects_monthly_plan_id_fkey(id, title, status)",
      )
      .eq("brand_id", data.brandId)
      .eq("id", data.projectId)
      .maybeSingle();
    if (error) throw error;
    if (!projectRaw) throw new Error("Projeto não encontrado");
    const projectRow = projectRaw as unknown as ProjectListRow;
    const project = {
      ...projectRow,
      plan: projectRow.monthly_plans
        ? {
            id: projectRow.monthly_plans.id,
            title: projectRow.monthly_plans.title,
            status: projectRow.monthly_plans.status,
          }
        : null,
    };

    const { data: postRows } = await context.supabase
      .from("posts")
      .select(
        "id, title, stage, stage_id, review_status, published_at, scheduled_at, channels, cover_url, created_at, updated_at, monthly_plan_topic_id, assignee_id, format",
      )
      .eq("brand_id", data.brandId)
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });

    const posts = postRows ?? [];
    const stageMap = await loadStageMap(
      context.supabase,
      posts.map((p) => p.stage_id as string | null),
    );
    const stageOf = (p: { stage_id?: string | null; stage?: string | null }) =>
      effectiveStage(p.stage_id ?? null, p.stage ?? null, stageMap);
    const stats: ProjectStats = { total: posts.length, approved: 0, published: 0, pending: 0 };
    for (const p of posts) {
      const stage = stageOf(p);
      const review = String(p.review_status ?? "").toLowerCase();
      const published = !!p.published_at || stage === "published";
      if (published) stats.published += 1;
      if (review === "approved" || stage === "approved") stats.approved += 1;
      if (!published && review !== "approved" && stage !== "approved") stats.pending += 1;
    }

    // Itens da pauta vinculada (inclui os que ainda não viraram peça).
    const items: ProjectPlanItem[] = [];
    if (projectRow.monthly_plan_id) {
      const { data: topicRows } = await context.supabase
        .from("monthly_plan_topics" as never)
        .select("id, topic_title, channel, content_format, status, client_status, position")
        .eq("monthly_plan_id", projectRow.monthly_plan_id)
        .order("position", { ascending: true });
      const topics = (topicRows ?? []) as unknown as Array<{
        id: string;
        topic_title: string;
        channel: string | null;
        content_format: string | null;
        status: string | null;
        client_status: string | null;
        position: number;
      }>;
      const byTopic = new Map<string, (typeof posts)[number]>();
      for (const p of posts) {
        const tid = (p as { monthly_plan_topic_id?: string | null }).monthly_plan_topic_id;
        if (tid) byTopic.set(tid, p);
      }
      // Tarefas de produção vinculadas às peças (execução operacional).
      const postIds = posts.map((p) => p.id as string);
      const tasksByPost = new Map<
        string,
        { count: number; open: number; assignee_id: string | null; due_at: string | null }
      >();
      const assigneeNames = new Map<string, string>();
      if (postIds.length > 0) {
        const { data: taskRows } = await context.supabase
          .from("tasks")
          .select("id, post_id, status, assignee_id, due_at")
          .eq("brand_id", data.brandId)
          .in("post_id", postIds);
        const tasks = (taskRows ?? []) as unknown as Array<{
          post_id: string | null;
          status: string | null;
          assignee_id: string | null;
          due_at: string | null;
        }>;
        for (const t of tasks) {
          if (!t.post_id) continue;
          const cur = tasksByPost.get(t.post_id) ?? {
            count: 0,
            open: 0,
            assignee_id: null,
            due_at: null,
          };
          cur.count += 1;
          if (String(t.status ?? "") !== "done") cur.open += 1;
          if (!cur.assignee_id && t.assignee_id) cur.assignee_id = t.assignee_id;
          if (!cur.due_at && t.due_at) cur.due_at = t.due_at;
          tasksByPost.set(t.post_id, cur);
        }
        const ids = Array.from(
          new Set(
            Array.from(tasksByPost.values())
              .map((v) => v.assignee_id)
              .filter(Boolean),
          ),
        ) as string[];
        if (ids.length > 0) {
          const { data: profiles } = await context.supabase
            .from("user_profiles")
            .select("id, full_name")
            .in("id", ids);
          for (const pr of (profiles ?? []) as unknown as Array<{
            id: string;
            full_name: string | null;
          }>) {
            if (pr.full_name) assigneeNames.set(pr.id, pr.full_name);
          }
        }
      }

      for (const t of topics) {
        const post = byTopic.get(t.id) ?? null;
        const agg = post ? (tasksByPost.get(post.id as string) ?? null) : null;
        items.push({
          topic_id: t.id,
          title: t.topic_title,
          channel: t.channel,
          format: t.content_format,
          topic_status: t.status,
          client_status: t.client_status,
          post: post
            ? {
                id: post.id,
                stage: stageOf(post as { stage_id?: string | null; stage?: string | null }),
                review_status: (post.review_status as string | null) ?? null,
                published_at: (post.published_at as string | null) ?? null,
                scheduled_at: (post.scheduled_at as string | null) ?? null,
                assignee_id: (post as { assignee_id?: string | null }).assignee_id ?? null,
                cover_url: (post.cover_url as string | null) ?? null,
              }
            : null,
          tasks: {
            count: agg?.count ?? 0,
            open: agg?.open ?? 0,
            assignee_id: agg?.assignee_id ?? null,
            assignee_name: agg?.assignee_id ? (assigneeNames.get(agg.assignee_id) ?? null) : null,
            due_at: agg?.due_at ?? null,
          },
        });
      }
    }

    return { project, posts, stats, items };
  });

const ProjectPayload = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(2000).nullable().optional(),
  status: ProjectStatus.optional(),
  color: z.string().max(20).nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  start_date: z.string().nullable().optional(),
  due_at: z.string().nullable().optional(),
  goals: z.string().max(4000).nullable().optional(),
  status_id: z.string().uuid().nullable().optional(),
  done_at: z.string().nullable().optional(),
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ brandId: z.string().uuid(), values: ProjectPayload }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const v = data.values;
    const role = await assertBrandMember(context.supabase as never, context.userId, data.brandId);
    if (v.client_id) {
      // Bloqueia par forjado (brand A + client B) e cliente fora do escopo.
      await assertClientInBrand(
        context.supabase as never,
        context.userId,
        data.brandId,
        v.client_id,
      );
    } else if (role !== "super_admin" && role !== "admin") {
      // Projeto workspace-level (client_id NULL) só existe para autoridade de
      // workspace. MANAGER/USER precisam informar um cliente atribuído.
      throw new Error("Forbidden: selecione um cliente para criar o projeto");
    }
    const { data: row, error } = await context.supabase
      .from("projects")
      .insert({
        brand_id: data.brandId,
        name: v.name,
        description: v.description ?? null,
        status: v.status ?? "active",
        color: v.color ?? "#8b5cf6",
        client_id: v.client_id ?? null,
        owner_id: v.owner_id ?? null,
        start_date: v.start_date ?? null,
        due_at: v.due_at ?? null,
        goals: v.goals ?? null,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return { id: (row as { id: string }).id };
  });

/** RLS não erra em UPDATE/DELETE sem linhas: falha explícita evita "sucesso" falso. */
function assertAffected(rows: unknown, action: string): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`Forbidden: projeto fora do seu escopo (${action})`);
  }
}

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        patch: ProjectPayload.partial(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const role = await assertBrandMember(context.supabase as never, context.userId, data.brandId);
    if (data.patch.client_id) {
      await assertClientInBrand(
        context.supabase as never,
        context.userId,
        data.brandId,
        data.patch.client_id,
      );
    } else if (data.patch.client_id === null && role !== "super_admin" && role !== "admin") {
      // Tornar o projeto workspace-level exige autoridade de workspace.
      throw new Error("Forbidden: projeto sem cliente exige autoridade de workspace");
    }
    const { data: rows, error } = await context.supabase
      .from("projects")
      .update(data.patch as never)
      .eq("id", data.projectId)
      .eq("brand_id", data.brandId)
      .select("id");
    if (error) throw error;
    assertAffected(rows, "atualizar");
    return { ok: true };
  });

export const archiveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ brandId: z.string().uuid(), projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("projects")
      .update({ status: "archived" } as never)
      .eq("id", data.projectId)
      .eq("brand_id", data.brandId)
      .select("id");
    if (error) throw error;
    assertAffected(rows, "arquivar");
    return { ok: true };
  });

/**
 * Arquiva/restaura o projeto. Restaurar devolve o projeto para um status ativo
 * (padrão: "in_progress") — nada é apagado nas duas direções.
 */
export const setProjectArchivedFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        archived: z.boolean(),
        restoreStatus: ProjectStatus.exclude(["archived"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertBrandMember(context.supabase as never, context.userId, data.brandId);
    await assertProjectScope(context.supabase as never, context.userId, data.projectId);
    const status = data.archived ? "archived" : (data.restoreStatus ?? "in_progress");
    const { data: rows, error } = await context.supabase
      .from("projects")
      .update({ status } as never)
      .eq("id", data.projectId)
      .eq("brand_id", data.brandId)
      .select("id");
    if (error) throw error;
    assertAffected(rows, data.archived ? "arquivar" : "restaurar");
    return { ok: true };
  });


export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ brandId: z.string().uuid(), projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Escopo antes de qualquer efeito colateral (desvincular posts).
    await assertProjectScope(context.supabase as never, context.userId, data.projectId);
    await context.supabase
      .from("posts")
      .update({ project_id: null } as never)
      .eq("brand_id", data.brandId)
      .eq("project_id", data.projectId);
    const { data: rows, error } = await context.supabase
      .from("projects")
      .delete()
      .eq("id", data.projectId)
      .eq("brand_id", data.brandId)
      .select("id");
    if (error) throw error;
    assertAffected(rows, "excluir");
    return { ok: true };
  });

/**
 * Detalhe completo (SOMENTE LEITURA) de um item da pauta para o modal aberto na
 * tela do projeto: briefing, legenda, agendamento, rede, formato e local de
 * postagem. Nada é gravado aqui; edição continua na tela de Conteúdo.
 */
type PautaJson = string | number | boolean | null | PautaJson[] | { [k: string]: PautaJson };

export type PautaPlacement = {
  id: string;
  format: string | null;
  status: string | null;
  is_primary: boolean;
  scheduled_at: string | null;
  published_at: string | null;
  connection_label: string | null;
  connection_channel: string | null;
};

export type PautaDetail = {
  topic: {
    title: string;
    angle: string | null;
    rationale: string | null;
    target_audience: string | null;
    status: string | null;
    client_status: string | null;
    client_comment: string | null;
  } | null;
  post: {
    id: string;
    title: string | null;
    format: string | null;
    channels: string[];
    scheduled_at: string | null;
    schedule_status: string | null;
    published_at: string | null;
    review_status: string | null;
    stage: string | null;
    priority: string | null;
    tags: string[];
    copy: string | null;
    script: PautaJson;
    internal_briefing: string | null;
    client_briefing: string | null;
    design_brief: string | null;
    references: PautaJson;
    reference_media: PautaJson;
    cover_url: string | null;
  } | null;
  placements: PautaPlacement[];
};

export const getPautaDetailFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        postId: z.string().uuid().nullable().optional(),
        topicId: z.string().uuid().nullable().optional(),
      })
      .refine((v) => !!v.postId || !!v.topicId, "informe postId ou topicId")
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<PautaDetail> => {
    await assertBrandMember(context.supabase as never, context.userId, data.brandId);
    await assertProjectScope(context.supabase as never, context.userId, data.projectId);

    let post: PautaDetail["post"] = null;
    if (data.postId) {
      const { data: row, error } = await context.supabase
        .from("posts")
        .select(
          "id, title, format, channels, scheduled_at, schedule_status, published_at, review_status, stage, stage_id, priority, tags, copy, script, internal_briefing, client_briefing, design_brief, references, reference_media, cover_url, monthly_plan_topic_id",
        )
        .eq("brand_id", data.brandId)
        .eq("project_id", data.projectId)
        .eq("id", data.postId)
        .maybeSingle();
      if (error) throw error;
      if (row) {
        const r = row as unknown as Record<string, unknown>;
        const stageMap = await loadStageMap(context.supabase, [
          (r["stage_id"] as string | null) ?? null,
        ]);
        post = {
          id: r["id"] as string,
          title: (r["title"] as string | null) ?? null,
          format: (r["format"] as string | null) ?? null,
          channels: (r["channels"] as string[] | null) ?? [],
          scheduled_at: (r["scheduled_at"] as string | null) ?? null,
          schedule_status: (r["schedule_status"] as string | null) ?? null,
          published_at: (r["published_at"] as string | null) ?? null,
          review_status: (r["review_status"] as string | null) ?? null,
          stage: effectiveStage(
            (r["stage_id"] as string | null) ?? null,
            (r["stage"] as string | null) ?? null,
            stageMap,
          ),
          priority: (r["priority"] as string | null) ?? null,
          tags: (r["tags"] as string[] | null) ?? [],
          copy: (r["copy"] as string | null) ?? null,
          script: (r["script"] as PautaJson) ?? null,
          internal_briefing: (r["internal_briefing"] as string | null) ?? null,
          client_briefing: (r["client_briefing"] as string | null) ?? null,
          design_brief: (r["design_brief"] as string | null) ?? null,
          references: (r["references"] as PautaJson) ?? null,
          reference_media: (r["reference_media"] as PautaJson) ?? null,
          cover_url: (r["cover_url"] as string | null) ?? null,
        };
      }
    }

    // Tópico da pauta — pode vir do parâmetro ou da peça já criada.
    const topicId = data.topicId ?? null;
    let topic: PautaDetail["topic"] = null;
    if (topicId) {
      const { data: row } = await context.supabase
        .from("monthly_plan_topics" as never)
        .select(
          "topic_title, angle, rationale, target_audience, status, client_status, client_comment",
        )
        .eq("id", topicId)
        .maybeSingle();
      if (row) {
        const t = row as unknown as Record<string, unknown>;
        topic = {
          title: (t["topic_title"] as string | null) ?? "",
          angle: (t["angle"] as string | null) ?? null,
          rationale: (t["rationale"] as string | null) ?? null,
          target_audience: (t["target_audience"] as string | null) ?? null,
          status: (t["status"] as string | null) ?? null,
          client_status: (t["client_status"] as string | null) ?? null,
          client_comment: (t["client_comment"] as string | null) ?? null,
        };
      }
    }

    // Local de postagem: placements + conta conectada correspondente.
    const placements: PautaPlacement[] = [];
    if (post) {
      const { data: rows } = await context.supabase
        .from("post_placements")
        .select("id, format, status, is_primary, scheduled_at, published_at, connection_id")
        .eq("brand_id", data.brandId)
        .eq("post_id", post.id)
        .order("is_primary", { ascending: false });
      const list = (rows ?? []) as unknown as Array<Record<string, unknown>>;
      const connIds = Array.from(
        new Set(list.map((p) => p["connection_id"] as string | null).filter(Boolean)),
      ) as string[];
      const connMap = new Map<string, { label: string | null; channel: string | null }>();
      if (connIds.length > 0) {
        const { data: conns } = await context.supabase
          .from("social_connections")
          .select("id, channel, channel_name, account_username, external_name")
          .eq("brand_id", data.brandId)
          .in("id", connIds);
        for (const c of (conns ?? []) as unknown as Array<Record<string, unknown>>) {
          connMap.set(c["id"] as string, {
            label:
              (c["channel_name"] as string | null) ||
              (c["external_name"] as string | null) ||
              (c["account_username"] as string | null) ||
              null,
            channel: (c["channel"] as string | null) ?? null,
          });
        }
      }
      for (const p of list) {
        const conn = p["connection_id"] ? connMap.get(p["connection_id"] as string) : undefined;
        placements.push({
          id: p["id"] as string,
          format: (p["format"] as string | null) ?? null,
          status: (p["status"] as string | null) ?? null,
          is_primary: !!p["is_primary"],
          scheduled_at: (p["scheduled_at"] as string | null) ?? null,
          published_at: (p["published_at"] as string | null) ?? null,
          connection_label: conn?.label ?? null,
          connection_channel: conn?.channel ?? null,
        });
      }
    }

    return { topic, post, placements };
  });
