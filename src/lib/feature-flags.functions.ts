import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperAdmin, resolveIsSuperAdmin } from "@/lib/super-admin";
import type { RpcClient } from "@/lib/access-guard";

/**
 * Feature flags por marca (ambiente) — o Master carrega TODO o código e o
 * banco decide o que está liberado em cada ambiente.
 *
 * - `feature_catalog`  → catálogo global (a feature existe no Master).
 * - `brand_features`   → ativação por ambiente (a feature está liberada aqui).
 *
 * Sem linha em `brand_features`, vale `feature_catalog.default_enabled`.
 * Features `is_core` (espinha dorsal da navegação) são sempre habilitadas.
 * Escritas: exclusivas de Super Admin (validado no servidor, além da RLS).
 */

export const listFeatureCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("feature_catalog")
      .select(
        "id, key, name, description, category, icon, is_core, sort_order, is_available, default_enabled, created_at, updated_at",
      )
      .order("sort_order")
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

const BrandIdInput = z.object({ brandId: z.string().uuid() });

type CatalogRow = {
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  is_core: boolean;
  sort_order: number | null;
  is_available: boolean;
  default_enabled: boolean;
};
type BrandFeatureRow = {
  feature_key: string;
  enabled: boolean;
  enabled_at: string | null;
  enabled_by: string | null;
  notes: string | null;
  updated_at: string | null;
};
type FeatureReaderClient = {
  from: (table: string) => {
    select: (cols: string) => any;
  };
};

/**
 * Leitura do estado de features de um ambiente.
 *
 * Continua acessível a membros porque alimenta o GATE de navegação
 * (`useBrandFeatures`). A tela **Administração do Cliente → Recursos** usa a
 * variante `listBrandFeaturesForAdmin`, exclusiva de Super Admin.
 */
async function readBrandFeatures(supabase: FeatureReaderClient, brandId: string) {
  const { data: catalog, error: catErr } = await supabase
    .from("feature_catalog")
    .select(
      "key, name, description, category, icon, is_core, sort_order, is_available, default_enabled",
    )
    .order("sort_order")
    .order("name");
  if (catErr) throw catErr;

  const { data: rows, error } = await supabase
    .from("brand_features")
    .select("id, brand_id, feature_key, enabled, enabled_at, enabled_by, notes, updated_at")
    .eq("brand_id", brandId);
  if (error) throw error;

  const byKey = new Map<string, BrandFeatureRow>(
    ((rows ?? []) as BrandFeatureRow[]).map((r) => [r.feature_key, r]),
  );
  return ((catalog ?? []) as CatalogRow[]).map((c) => {
    const row = byKey.get(c.key);
    const configured = row?.enabled ?? null;
    return {
      key: c.key,
      name: c.name,
      description: c.description,
      category: c.category,
      icon: c.icon,
      is_core: c.is_core,
      sort_order: c.sort_order,
      is_available: c.is_available,
      default_enabled: c.default_enabled,
      enabled: c.is_core ? true : (configured ?? c.default_enabled),
      configured,
      enabled_at: row?.enabled_at ?? null,
      enabled_by: row?.enabled_by ?? null,
      notes: row?.notes ?? null,
      updated_at: row?.updated_at ?? null,
    };
  });
}


export const listBrandFeatures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandIdInput.parse(i))
  .handler(async ({ data, context }) => readBrandFeatures(context.supabase, data.brandId));

/**
 * Mesma leitura, mas restrita a SUPER ADMIN — usada pela tela
 * Administração do Cliente → Recursos. Owner/Admin/Manager/User recebem erro
 * mesmo forçando a rota ou chamando a RPC diretamente.
 */
export const listBrandFeaturesForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase as unknown as RpcClient, context.userId);
    return readBrandFeatures(context.supabase, data.brandId);
  });

const SetFeatureInput = z.object({
  brandId: z.string().uuid(),
  featureKey: z.string().min(1).max(64),
  enabled: z.boolean(),
  notes: z.string().max(500).optional().nullable(),
});

export const setBrandFeature = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetFeatureInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase as unknown as RpcClient, context.userId);

    const { data: cat, error: catErr } = await context.supabase
      .from("feature_catalog")
      .select("key, name, is_core, default_enabled")
      .eq("key", data.featureKey)
      .maybeSingle();
    if (catErr) throw catErr;
    if (!cat) throw new Error("Feature inexistente no catálogo");
    if (cat.is_core && !data.enabled) {
      throw new Error("Recurso obrigatório do sistema — não pode ser desativado");
    }

    const { data: prev } = await context.supabase
      .from("brand_features")
      .select("enabled")
      .eq("brand_id", data.brandId)
      .eq("feature_key", data.featureKey)
      .maybeSingle();
    const previousValue = prev?.enabled ?? cat.default_enabled;

    const now = new Date().toISOString();
    const { error } = await context.supabase.from("brand_features").upsert(
      {
        brand_id: data.brandId,
        feature_key: data.featureKey,
        enabled: data.enabled,
        enabled_at: data.enabled ? now : null,
        enabled_by: data.enabled ? context.userId : null,
        notes: data.notes ?? null,
        updated_at: now,
      },
      { onConflict: "brand_id,feature_key" },
    );
    if (error) throw error;

    // Auditoria (best-effort): quem mudou o quê, em qual ambiente.
    await context.supabase.from("activity_events").insert({
      brand_id: data.brandId,
      actor_id: context.userId,
      entity_type: "brand_feature",
      verb: data.enabled ? "feature.enabled" : "feature.disabled",
      payload: {
        feature_key: data.featureKey,
        feature_name: cat.name,
        previous_value: previousValue,
        new_value: data.enabled,
        notes: data.notes ?? null,
      },
    } as never);

    return { ok: true };
  });

export const listBrandsWithFeatureCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase as unknown as RpcClient, context.userId);
    const { data: brands, error } = await context.supabase
      .from("brands")
      .select("id, name, slug, color")
      .order("name");
    if (error) throw error;
    const list = brands ?? [];
    if (list.length === 0) return [];
    const { data: feats, error: fErr } = await context.supabase
      .from("brand_features")
      .select("brand_id, enabled")
      .eq("enabled", true);
    if (fErr) throw fErr;
    const counts = new Map<string, number>();
    for (const f of feats ?? []) counts.set(f.brand_id, (counts.get(f.brand_id) ?? 0) + 1);
    return list.map((b) => ({ ...b, active_features: counts.get(b.id) ?? 0 }));
  });

const RequireInput = z.object({
  brandId: z.string().uuid().nullable().optional(),
  featureKey: z.string().min(1).max(64),
});

/**
 * Bloqueio server-side de acesso a módulos.
 * - Super admin: sempre `enabled: true` (administração e testes).
 * - Features `is_core`: sempre habilitadas.
 * - Sem linha em `brand_features`: vale `default_enabled` do catálogo.
 */
export const requireFeatureAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RequireInput.parse(i))
  .handler(async ({ data, context }) => {
    const isSuper = await resolveIsSuperAdmin(
      context.supabase as unknown as RpcClient,
      context.userId,
    );
    if (isSuper) return { enabled: true, reason: "super_admin" as const };

    const { data: cat } = await context.supabase
      .from("feature_catalog")
      .select("is_core, default_enabled")
      .eq("key", data.featureKey)
      .maybeSingle();
    if (cat?.is_core) return { enabled: true, reason: "core" as const };

    if (!data.brandId) return { enabled: false, reason: "no_brand" as const };

    const { data: row, error } = await context.supabase
      .from("brand_features")
      .select("enabled")
      .eq("brand_id", data.brandId)
      .eq("feature_key", data.featureKey)
      .maybeSingle();
    if (error) throw error;
    const enabled = row ? row.enabled : (cat?.default_enabled ?? false);
    return { enabled, reason: enabled ? "granted" : ("denied" as const) };
  });

export const amISuperAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isSuperAdmin = await resolveIsSuperAdmin(
      context.supabase as unknown as RpcClient,
      context.userId,
    );
    return { isSuperAdmin };
  });
