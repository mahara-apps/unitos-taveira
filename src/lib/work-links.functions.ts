import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertBrandMember,
  assertProjectScope,
  assertTaskScope,
  type RpcClient,
} from "@/lib/access-guard";
import { detectLinkSource, normalizeLinkUrl } from "@/lib/link-source";

/**
 * Links de referência (Google Drive, Figma, etc.) ligados a UM item do
 * trabalho: projeto, job, tarefa, peça ou pauta. O alvo é resolvido no
 * servidor para descobrir `brand_id`/`client_id` — o frontend nunca decide
 * escopo. RLS de `work_links` continua sendo a última barreira.
 */

export type WorkLinkTarget = "project" | "job" | "task" | "post" | "topic";

export type WorkLink = {
  id: string;
  url: string;
  title: string | null;
  source: string;
  created_by: string | null;
  created_by_client: boolean;
  created_at: string;
  author_name: string | null;
};

export const MAX_LINKS_PER_ITEM = 50;

const LINK_SELECT = "id, url, title, source, created_by, created_by_client, created_at";

const targetIn = z.object({
  target: z.enum(["project", "job", "task", "post", "topic"]),
  targetId: z.string().uuid(),
});

type AnyClient = RpcClient & {
  from: (t: string) => {
    select: (c: string) => {
      eq: (k: string, v: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
        order?: unknown;
      };
    };
  };
};

type Scope = { brandId: string; clientId: string | null; projectId: string | null };

/** Resolve escopo do alvo e valida a autoridade do usuário sobre ele. */
export async function resolveLinkScope(
  supabase: AnyClient,
  userId: string,
  target: WorkLinkTarget,
  targetId: string,
): Promise<Scope> {
  const read = async (table: string, cols: string) => {
    const { data, error } = await supabase.from(table).select(cols).eq("id", targetId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Forbidden: item fora do seu escopo");
    return data;
  };

  if (target === "project") {
    await assertProjectScope(supabase, userId, targetId);
    const row = await read("projects", "brand_id, client_id");
    return {
      brandId: row["brand_id"] as string,
      clientId: (row["client_id"] as string | null) ?? null,
      projectId: targetId,
    };
  }

  if (target === "job") {
    const row = await read("project_jobs", "brand_id, project_id");
    const projectId = row["project_id"] as string;
    await assertProjectScope(supabase, userId, projectId);
    const project = await supabase
      .from("projects")
      .select("client_id")
      .eq("id", projectId)
      .maybeSingle();
    if (project.error) throw project.error;
    return {
      brandId: row["brand_id"] as string,
      clientId: (project.data?.["client_id"] as string | null) ?? null,
      projectId,
    };
  }

  if (target === "task") {
    await assertTaskScope(supabase, userId, targetId);
    const row = await read("tasks", "brand_id, client_id, project_id");
    return {
      brandId: row["brand_id"] as string,
      clientId: (row["client_id"] as string | null) ?? null,
      projectId: (row["project_id"] as string | null) ?? null,
    };
  }

  if (target === "post") {
    const row = await read("posts", "brand_id, client_id, project_id");
    const brandId = row["brand_id"] as string;
    await assertBrandMember(supabase, userId, brandId);
    return {
      brandId,
      clientId: (row["client_id"] as string | null) ?? null,
      projectId: (row["project_id"] as string | null) ?? null,
    };
  }

  // topic → monthly_plan_topics → monthly_plans
  const topic = await read("monthly_plan_topics", "monthly_plan_id");
  const plan = await supabase
    .from("monthly_plans")
    .select("brand_id, client_id")
    .eq("id", topic["monthly_plan_id"] as string)
    .maybeSingle();
  if (plan.error) throw plan.error;
  if (!plan.data) throw new Error("Forbidden: pauta fora do seu escopo");
  const brandId = plan.data["brand_id"] as string;
  await assertBrandMember(supabase, userId, brandId);
  return {
    brandId,
    clientId: (plan.data["client_id"] as string | null) ?? null,
    projectId: null,
  };
}

const targetColumn: Record<WorkLinkTarget, string> = {
  project: "project_id",
  job: "job_id",
  task: "task_id",
  post: "post_id",
  topic: "topic_id",
};

/** Anexa nome do autor (best-effort) para exibição na lista. */
async function withAuthors(
  supabase: AnyClient,
  rows: Array<Record<string, unknown>>,
): Promise<WorkLink[]> {
  const ids = Array.from(
    new Set(rows.map((r) => r["created_by"] as string | null).filter((v): v is string => !!v)),
  );
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const q = supabase.from("user_profiles") as unknown as {
      select: (c: string) => {
        in: (
          k: string,
          v: string[],
        ) => Promise<{ data: Array<{ user_id: string; full_name: string | null }> | null }>;
      };
    };
    const { data } = await q.select("user_id, full_name").in("user_id", ids);
    for (const p of data ?? []) if (p.full_name) names.set(p.user_id, p.full_name);
  }
  return rows.map((r) => ({
    id: r["id"] as string,
    url: r["url"] as string,
    title: (r["title"] as string | null) ?? null,
    source: (r["source"] as string) ?? "link",
    created_by: (r["created_by"] as string | null) ?? null,
    created_by_client: !!r["created_by_client"],
    created_at: r["created_at"] as string,
    author_name: names.get((r["created_by"] as string) ?? "") ?? null,
  }));
}

export const listWorkLinksFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => targetIn.parse(i))
  .handler(async ({ data, context }): Promise<WorkLink[]> => {
    const sb = context.supabase as unknown as AnyClient;
    await resolveLinkScope(sb, context.userId, data.target, data.targetId);
    const q = context.supabase
      .from("work_links")
      .select(LINK_SELECT)
      .eq(targetColumn[data.target], data.targetId)
      .order("created_at", { ascending: true })
      .limit(MAX_LINKS_PER_ITEM);
    const { data: rows, error } = await q;
    if (error) throw error;
    return withAuthors(sb, (rows ?? []) as unknown as Array<Record<string, unknown>>);
  });

export const addWorkLinkFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    targetIn
      .extend({
        url: z.string().trim().min(4).max(2000),
        title: z.string().trim().max(160).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; id: string }> => {
    const url = normalizeLinkUrl(data.url);
    if (!url) throw new Error("Link inválido: informe uma URL http(s) completa");
    const sb = context.supabase as unknown as AnyClient;
    const scope = await resolveLinkScope(sb, context.userId, data.target, data.targetId);

    const { count } = await context.supabase
      .from("work_links")
      .select("id", { count: "exact", head: true })
      .eq(targetColumn[data.target], data.targetId);
    if ((count ?? 0) >= MAX_LINKS_PER_ITEM) {
      throw new Error(`Limite de ${MAX_LINKS_PER_ITEM} links por item atingido`);
    }

    const { data: row, error } = await context.supabase
      .from("work_links")
      .insert({
        brand_id: scope.brandId,
        client_id: scope.clientId,
        [targetColumn[data.target]]: data.targetId,
        url,
        title: data.title?.trim() ? data.title.trim() : null,
        source: detectLinkSource(url),
        created_by: context.userId,
        created_by_client: false,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return { ok: true, id: (row as { id: string }).id };
  });

export const deleteWorkLinkFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ linkId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("work_links")
      .delete()
      .eq("id", data.linkId)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error("Forbidden: link fora do seu escopo");
    return { ok: true };
  });
