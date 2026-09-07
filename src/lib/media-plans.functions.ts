import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MediaPlan = {
  id: string;
  brand_id: string;
  client_id: string;
  title: string;
  period_start: string | null;
  period_end: string | null;
  monthly_budget: number;
  status: "draft" | "approved" | "archived";
  share_token: string | null;
  share_expires_at: string | null;
  updated_at: string;
  created_at: string;
};

export type MediaPlanItem = {
  id: string;
  plan_id: string;
  position: number;
  product_service: string | null;
  campaign_type: string | null;
  funnel_stage: "topo" | "meio" | "fundo" | null;
  objective: string | null;
  main_kpi: string | null;
  channel: string | null;
  audience: string | null;
  budget_pct: number;
  budget_amount: number;
  keywords: string[];
  benchmark: string | null;
  other_refs: string | null;
};

const uuid = z.string().uuid();

async function assertPlanAccess(supabase: unknown, planId: string) {
  const sb = supabase as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          val: string,
        ) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
  const { data, error } = await sb
    .from("media_plans")
    .select("id, brand_id, client_id")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("plan_not_found");
  return data;
}

export const listMediaPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ clientId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("media_plans")
      .select("*")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { plans: (rows ?? []) as MediaPlan[] };
  });

export const getMediaPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ planId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: plan, error } = await context.supabase
      .from("media_plans")
      .select("*")
      .eq("id", data.planId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!plan) throw new Error("plan_not_found");
    const { data: items, error: itemsErr } = await context.supabase
      .from("media_plan_items")
      .select("*")
      .eq("plan_id", data.planId)
      .order("position", { ascending: true });
    if (itemsErr) throw new Error(itemsErr.message);
    return {
      plan: plan as MediaPlan,
      items: (items ?? []) as MediaPlanItem[],
    };
  });

export const createMediaPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        brandId: uuid,
        clientId: uuid,
        title: z.string().min(1).max(200).default("Plano de mídia"),
        period_start: z.string().nullable().optional(),
        period_end: z.string().nullable().optional(),
        monthly_budget: z.number().nonnegative().default(0),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("media_plans")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        title: data.title,
        period_start: data.period_start ?? null,
        period_end: data.period_end ?? null,
        monthly_budget: data.monthly_budget,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { plan: row as MediaPlan };
  });

export const updateMediaPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        planId: uuid,
        patch: z
          .object({
            title: z.string().min(1).max(200).optional(),
            period_start: z.string().nullable().optional(),
            period_end: z.string().nullable().optional(),
            monthly_budget: z.number().nonnegative().optional(),
            status: z.enum(["draft", "approved", "archived"]).optional(),
          })
          .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" }),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("media_plans")
      .update(data.patch)
      .eq("id", data.planId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { plan: row as MediaPlan };
  });

export const deleteMediaPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ planId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("media_plans").delete().eq("id", data.planId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const itemSchema = z.object({
  id: uuid.optional(),
  position: z.number().int().nonnegative().optional(),
  product_service: z.string().max(300).nullable().optional(),
  campaign_type: z.string().max(120).nullable().optional(),
  funnel_stage: z.enum(["topo", "meio", "fundo"]).nullable().optional(),
  objective: z.string().max(500).nullable().optional(),
  main_kpi: z.string().max(200).nullable().optional(),
  channel: z.string().max(120).nullable().optional(),
  audience: z.string().max(500).nullable().optional(),
  budget_pct: z.number().min(0).max(1000).optional(),
  keywords: z.array(z.string().max(80)).max(50).optional(),
  benchmark: z.string().max(500).nullable().optional(),
  other_refs: z.string().max(500).nullable().optional(),
});

export const upsertMediaPlanItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ planId: uuid, item: itemSchema }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlanAccess(context.supabase as never, data.planId);
    const payload = { plan_id: data.planId, ...data.item };
    if (data.item.id) {
      const { data: row, error } = await context.supabase
        .from("media_plan_items")
        .update(payload)
        .eq("id", data.item.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return { item: row as MediaPlanItem };
    }
    // determine position
    if (payload.position === undefined) {
      const { data: last } = await context.supabase
        .from("media_plan_items")
        .select("position")
        .eq("plan_id", data.planId)
        .order("position", { ascending: false })
        .limit(1);
      payload.position = ((last?.[0]?.position ?? -1) as number) + 1;
    }
    const { data: row, error } = await context.supabase
      .from("media_plan_items")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { item: row as MediaPlanItem };
  });

export const deleteMediaPlanItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ itemId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("media_plan_items")
      .delete()
      .eq("id", data.itemId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderMediaPlanItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ planId: uuid, orderedIds: z.array(uuid).min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Update positions one by one (small N)
    for (let i = 0; i < data.orderedIds.length; i++) {
      const { error } = await context.supabase
        .from("media_plan_items")
        .update({ position: i })
        .eq("id", data.orderedIds[i])
        .eq("plan_id", data.planId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

function randomToken(len = 40) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

export const issueMediaPlanShareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        planId: uuid,
        expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const token = randomToken(40);
    const expires =
      data.expiresInDays == null
        ? null
        : new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: row, error } = await context.supabase
      .from("media_plans")
      .update({ share_token: token, share_expires_at: expires })
      .eq("id", data.planId)
      .select("share_token, share_expires_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      token: row.share_token as string,
      expires_at: row.share_expires_at as string | null,
    };
  });

export const revokeMediaPlanShareToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ planId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("media_plans")
      .update({ share_token: null, share_expires_at: null })
      .eq("id", data.planId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
