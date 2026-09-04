import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperAdmin } from "@/lib/super-admin";
import type { RpcClient } from "@/lib/access-guard";

/**
 * Administração do ambiente (marca ativa) — exclusiva de Super Admin.
 * Leituras informativas + renome do ambiente + trilha de auditoria.
 */

const BrandIdInput = z.object({ brandId: z.string().uuid() });

export const getEnvironmentInfoFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase as unknown as RpcClient, context.userId);

    const { data: brand, error } = await context.supabase
      .from("brands")
      .select("id, name, slug, nome_fantasia, created_at, updated_at")
      .eq("id", data.brandId)
      .maybeSingle();
    if (error) throw error;

    const { data: catalog, error: catErr } = await context.supabase
      .from("feature_catalog")
      .select("key, is_core, default_enabled");
    if (catErr) throw catErr;

    const { data: rows, error: rowsErr } = await context.supabase
      .from("brand_features")
      .select("feature_key, enabled")
      .eq("brand_id", data.brandId);
    if (rowsErr) throw rowsErr;

    const byKey = new Map((rows ?? []).map((r) => [r.feature_key, r.enabled]));
    const total = (catalog ?? []).length;
    const active = (catalog ?? []).filter((c) =>
      c.is_core ? true : (byKey.get(c.key) ?? c.default_enabled),
    ).length;

    const [{ count: memberCount }, { count: clientCount }] = await Promise.all([
      context.supabase
        .from("brand_members")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", data.brandId),
      context.supabase
        .from("clients")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", data.brandId),
    ]);

    return {
      brandId: data.brandId,
      name: brand?.nome_fantasia || brand?.name || "—",
      slug: brand?.slug ?? null,
      createdAt: brand?.created_at ?? null,
      updatedAt: brand?.updated_at ?? null,
      featuresActive: active,
      featuresTotal: total,
      members: memberCount ?? 0,
      clients: clientCount ?? 0,
    };
  });

const RenameInput = z.object({
  brandId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
});

export const updateEnvironmentNameFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RenameInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase as unknown as RpcClient, context.userId);

    const { data: prev } = await context.supabase
      .from("brands")
      .select("name")
      .eq("id", data.brandId)
      .maybeSingle();

    const { error } = await context.supabase
      .from("brands")
      .update({ name: data.name, updated_at: new Date().toISOString() } as never)
      .eq("id", data.brandId);
    if (error) throw error;

    await context.supabase.from("activity_events").insert({
      brand_id: data.brandId,
      actor_id: context.userId,
      entity_type: "brand_identity",
      verb: "identity.renamed",
      payload: { field: "name", previous_value: prev?.name ?? null, new_value: data.name },
    } as never);

    return { ok: true };
  });

export const listAdminAuditFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase as unknown as RpcClient, context.userId);

    const { data: rows, error } = await context.supabase
      .from("activity_events")
      .select("id, actor_id, entity_type, verb, payload, created_at")
      .eq("brand_id", data.brandId)
      .in("entity_type", ["brand_feature", "brand_identity"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const actorIds = Array.from(
      new Set((rows ?? []).map((r) => r.actor_id).filter((v): v is string => !!v)),
    );
    let names = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await context.supabase
        .from("user_profiles")
        .select("id, full_name")
        .in("id", actorIds);
      names = new Map(
        (profiles ?? []).map((p) => [p.id, p.full_name || "Usuário"]),
      );
    }

    return (rows ?? []).map((r) => {
      const payload = (r.payload ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        actorName: r.actor_id ? (names.get(r.actor_id) ?? "Usuário") : "Sistema",
        entityType: r.entity_type,
        verb: r.verb,
        featureName: (payload["feature_name"] as string) ?? (payload["feature_key"] as string) ?? null,
        field: (payload["field"] as string) ?? null,
        previousValue: payload["previous_value"] ?? null,
        newValue: payload["new_value"] ?? null,
        createdAt: r.created_at,
      };
    });
  });
