import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AiJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type AiJobResult = {
  title?: string;
  content?: string;
  hashtags?: string[];
  postId?: string | null;
  injected?: boolean;
};

export type AiJobRow = {
  id: string;
  brand_id: string;
  client_id: string | null;
  user_id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  status: AiJobStatus;
  progress: number;
  step_label: string | null;
  error: string | null;
  target_route: string | null;
  result: AiJobResult | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export const listMyAiJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiJobRow[]> => {
    const { data, error } = await context.supabase
      .from("ai_jobs")
      .select(
        "id, brand_id, client_id, user_id, kind, title, subtitle, status, progress, step_label, error, target_route, result, created_at, updated_at, started_at, finished_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw error;
    return (data ?? []) as unknown as AiJobRow[];
  });

export const dismissAiJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_jobs")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const clearFinishedAiJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("ai_jobs")
      .delete()
      .eq("user_id", context.userId)
      .in("status", ["succeeded", "failed", "cancelled"]);
    if (error) throw error;
    return { ok: true };
  });
