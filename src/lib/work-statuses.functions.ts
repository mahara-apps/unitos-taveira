/**
 * Status cadastráveis por workspace, com escopo (projeto / job / tarefa).
 *
 * Enquanto o workspace não cadastrar status próprios, as telas continuam
 * usando os status embutidos (enum) — nada quebra.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const WORK_STATUS_SCOPES = ["project", "job", "task"] as const;
export type WorkStatusScope = (typeof WORK_STATUS_SCOPES)[number];

export type WorkStatus = {
  id: string;
  brand_id: string;
  scope: WorkStatusScope;
  name: string;
  color: string;
  position: number;
  is_done: boolean;
  is_default: boolean;
};

const SELECT = "id, brand_id, scope, name, color, position, is_done, is_default";

export const listWorkStatusesFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        scope: z.enum(WORK_STATUS_SCOPES).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<WorkStatus[]> => {
    let q = context.supabase
      .from("work_statuses")
      .select(SELECT)
      .eq("brand_id", data.brandId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (data.scope) q = q.eq("scope", data.scope);
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []) as WorkStatus[];
  });

export const createWorkStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        scope: z.enum(WORK_STATUS_SCOPES),
        name: z.string().trim().min(1).max(60),
        color: z.string().max(20).optional(),
        isDone: z.boolean().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: last } = await context.supabase
      .from("work_statuses")
      .select("position")
      .eq("brand_id", data.brandId)
      .eq("scope", data.scope)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextPos = ((last as { position: number } | null)?.position ?? -1) + 1;
    const { data: row, error } = await context.supabase
      .from("work_statuses")
      .insert({
        brand_id: data.brandId,
        scope: data.scope,
        name: data.name,
        color: data.color ?? "#8b5cf6",
        is_done: data.isDone ?? false,
        position: nextPos,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return { id: (row as { id: string }).id };
  });

export const updateWorkStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        statusId: z.string().uuid(),
        patch: z
          .object({
            name: z.string().trim().min(1).max(60).optional(),
            color: z.string().max(20).optional(),
            position: z.number().int().min(0).optional(),
            is_done: z.boolean().optional(),
            is_default: z.boolean().optional(),
          })
          .partial(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("work_statuses")
      .update(data.patch as never)
      .eq("id", data.statusId)
      .eq("brand_id", data.brandId)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error("Forbidden: status fora do seu escopo");
    return { ok: true };
  });

export const deleteWorkStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), statusId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("work_statuses")
      .delete()
      .eq("id", data.statusId)
      .eq("brand_id", data.brandId)
      .select("id");
    if (error) throw error;
    if (!rows || rows.length === 0) throw new Error("Forbidden: status fora do seu escopo");
    return { ok: true };
  });
