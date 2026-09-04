import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BrandInput = z.object({ brandId: z.string().uuid() });

export type UsageOverview = {
  brand: {
    spent: number;
    limit: number | null;
    hard_stop: boolean | null;
    notify_at_pct: number | null;
  };
  clients: Array<{
    client_id: string;
    client_name: string;
    spent: number;
    limit: number | null;
    hard_stop: boolean | null;
    notify_at_pct: number | null;
    limit_id: string | null;
  }>;
  unassigned_client_spent: number;
  users: Array<{
    user_id: string;
    client_id: string | null;
    display_name: string | null;
    email: string | null;
    spent: number;
    limit: number | null;
    hard_stop: boolean | null;
    notify_at_pct: number | null;
    limit_id: string | null;
  }>;
};

export const listAiUsageOverviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandInput.parse(i))
  .handler(async ({ data, context }): Promise<UsageOverview> => {
    const { data: overview, error } = await context.supabase.rpc("list_ai_usage_overview", {
      _brand_id: data.brandId,
    });
    if (error) throw error;
    return overview as unknown as UsageOverview;
  });

const UpsertLimitInput = z.object({
  brandId: z.string().uuid(),
  scope: z.enum(["brand", "client", "user"]),
  clientId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  limitUsd: z.number().min(0),
  hardStop: z.boolean().default(true),
  notifyAtPct: z.number().int().min(1).max(100).default(80),
});

export const upsertAiUsageLimitFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertLimitInput.parse(i))
  .handler(async ({ data, context }) => {
    // Hierarchy validation: child limits cannot exceed the parent.
    if (data.scope !== "brand") {
      const { data: brandLim } = await context.supabase
        .from("ai_usage_limits")
        .select("limit_usd")
        .eq("brand_id", data.brandId)
        .eq("scope", "brand")
        .maybeSingle();
      if (brandLim && data.limitUsd > Number(brandLim.limit_usd)) {
        throw new Error("O limite não pode ser maior que o limite da agência.");
      }
    }
    if (data.scope === "user" && data.clientId) {
      const { data: clientLim } = await context.supabase
        .from("ai_usage_limits")
        .select("limit_usd")
        .eq("brand_id", data.brandId)
        .eq("scope", "client")
        .eq("client_id", data.clientId)
        .maybeSingle();
      if (clientLim && data.limitUsd > Number(clientLim.limit_usd)) {
        throw new Error("O limite não pode ser maior que o limite do cliente.");
      }
    }

    const row = {
      brand_id: data.brandId,
      scope: data.scope,
      client_id: data.scope === "brand" ? null : (data.clientId ?? null),
      user_id: data.scope === "user" ? (data.userId ?? null) : null,
      limit_usd: data.limitUsd,
      hard_stop: data.hardStop,
      notify_at_pct: data.notifyAtPct,
      created_by: context.userId,
    };

    // Manual upsert per scope (partial unique indexes prevent duplicates).
    let existingId: string | null = null;
    const q = context.supabase
      .from("ai_usage_limits")
      .select("id")
      .eq("brand_id", data.brandId)
      .eq("scope", data.scope);
    if (data.scope === "client") q.eq("client_id", data.clientId!);
    if (data.scope === "user") {
      q.eq("user_id", data.userId!);
      if (data.clientId) q.eq("client_id", data.clientId);
      else q.is("client_id", null);
    }
    const { data: found, error: findErr } = await q.maybeSingle();
    if (findErr) throw findErr;
    existingId = found?.id ?? null;

    if (existingId) {
      const { error } = await context.supabase
        .from("ai_usage_limits")
        .update({
          limit_usd: row.limit_usd,
          hard_stop: row.hard_stop,
          notify_at_pct: row.notify_at_pct,
        })
        .eq("id", existingId);
      if (error) throw error;
      return { id: existingId };
    }
    const { data: inserted, error: insErr } = await context.supabase
      .from("ai_usage_limits")
      .insert(row)
      .select("id")
      .single();
    if (insErr) throw insErr;
    return { id: inserted.id };
  });

const DeleteLimitInput = z.object({ id: z.string().uuid() });
export const deleteAiUsageLimitFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => DeleteLimitInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("ai_usage_limits").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
