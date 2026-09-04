/**
 * Pessoas envolvidas no projeto (nível do projeto; jobs e tarefas herdam).
 * O responsável continua sendo 1 único usuário por atividade.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ProjectParticipant = {
  id: string;
  project_id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export const listProjectParticipantsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), projectId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<ProjectParticipant[]> => {
    const { data: rows, error } = await context.supabase
      .from("project_participants")
      .select("id, project_id, user_id, created_at")
      .eq("brand_id", data.brandId)
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const list = (rows ?? []) as Array<{ id: string; project_id: string; user_id: string }>;
    if (list.length === 0) return [];
    const { data: profs } = await context.supabase
      .from("user_profiles")
      .select("id, full_name, avatar_url")
      .in(
        "id",
        list.map((r) => r.user_id),
      );
    const map = new Map(
      (
        (profs ?? []) as Array<{ id: string; full_name: string | null; avatar_url: string | null }>
      ).map((p) => [p.id, p]),
    );
    return list.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      user_id: r.user_id,
      full_name: map.get(r.user_id)?.full_name ?? null,
      avatar_url: map.get(r.user_id)?.avatar_url ?? null,
    }));
  });

export const addProjectParticipantFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        userId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Idempotente: já envolvido não é erro.
    const { data: existing } = await context.supabase
      .from("project_participants")
      .select("id")
      .eq("project_id", data.projectId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (existing) return { ok: true };
    const { error } = await context.supabase.from("project_participants").insert({
      brand_id: data.brandId,
      project_id: data.projectId,
      user_id: data.userId,
    } as never);
    if (error) throw error;
    return { ok: true };
  });

export const removeProjectParticipantFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        projectId: z.string().uuid(),
        userId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("project_participants")
      .delete()
      .eq("brand_id", data.brandId)
      .eq("project_id", data.projectId)
      .eq("user_id", data.userId);
    if (error) throw error;
    return { ok: true };
  });
