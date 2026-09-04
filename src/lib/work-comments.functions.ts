/**
 * Comentários/observações de projeto e de job.
 * Tarefas seguem usando `task_comments` (ver tasks.functions.ts).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WorkComment = {
  id: string;
  project_id: string;
  job_id: string | null;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
  body: string;
  mentions: string[];
  created_at: string;
};

export const listWorkCommentsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        jobId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<WorkComment[]> => {
    let q = context.supabase
      .from("work_comments")
      .select("id, project_id, job_id, author_id, body, mentions, created_at")
      .eq("brand_id", data.brandId)
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (data.jobId) q = q.eq("job_id", data.jobId);
    else q = q.is("job_id", null);
    const { data: rows, error } = await q;
    if (error) throw error;
    const list = (rows ?? []) as Array<{
      id: string;
      project_id: string;
      job_id: string | null;
      author_id: string;
      body: string;
      mentions: string[] | null;
      created_at: string;
    }>;
    if (list.length === 0) return [];
    const { data: profs } = await context.supabase
      .from("user_profiles")
      .select("id, full_name, avatar_url")
      .in("id", Array.from(new Set(list.map((c) => c.author_id))));
    const map = new Map(
      (
        (profs ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null }>
      ).map((p) => [p.id, p]),
    );
    return list.map((c) => ({
      id: c.id,
      project_id: c.project_id,
      job_id: c.job_id,
      author_id: c.author_id,
      author_name: map.get(c.author_id)?.full_name ?? null,
      author_avatar: map.get(c.author_id)?.avatar_url ?? null,
      body: c.body,
      mentions: c.mentions ?? [],
      created_at: c.created_at,
    }));
  });

export const addWorkCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        jobId: z.string().uuid().nullable().optional(),
        body: z.string().trim().min(1).max(4000),
        mentions: z.array(z.string().uuid()).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase
      .from("work_comments")
      .insert({
        brand_id: data.brandId,
        project_id: data.projectId,
        job_id: data.jobId ?? null,
        author_id: context.userId,
        body: data.body,
        mentions: data.mentions ?? [],
      } as never)
      .select("id")
      .single();
    if (error) throw error;

    const mentions = data.mentions ?? [];
    if (mentions.length > 0) {
      const { notifyMentionsSafe } = await import("@/lib/mention-notify.server");
      const href = data.jobId
        ? `/projects/${data.projectId}?job=${data.jobId}`
        : `/projects/${data.projectId}`;
      await notifyMentionsSafe(context.supabase, {
        brandId: data.brandId,
        authorId: context.userId,
        mentions,
        commentId: (inserted as { id: string } | null)?.id ?? null,
        title: data.jobId ? "Você foi mencionado em um job" : "Você foi mencionado em um projeto",
        body: data.body,
        href,
      });
    }
    return { ok: true, id: (inserted as { id: string } | null)?.id ?? null };
  });

export const deleteWorkCommentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ commentId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("work_comments")
      .delete()
      .eq("id", data.commentId)
      .eq("author_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
