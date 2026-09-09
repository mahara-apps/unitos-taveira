/**
 * Gate de RECURSO no servidor (autoridade final).
 *
 * A UI esconde o item de menu; aqui a leitura/escrita é efetivamente negada
 * quando o workspace tem o recurso desligado. Super Admin nunca é bloqueado.
 */

type FeatureClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export async function isFeatureEnabledForBrand(
  supabase: unknown,
  brandId: string | null | undefined,
  featureKey: string,
): Promise<boolean> {
  const db = supabase as FeatureClient;
  const { data: cat } = await db
    .from("feature_catalog")
    .select("is_core, default_enabled")
    .eq("key", featureKey)
    .maybeSingle();
  if (cat?.is_core) return true;
  if (!brandId) return false;
  const { data: row } = await db
    .from("brand_features")
    .select("enabled")
    .eq("brand_id", brandId)
    .eq("feature_key", featureKey)
    .maybeSingle();
  if (row) return row.enabled === true;
  return cat?.default_enabled === true;
}

/** Lança quando o recurso está desligado no workspace. */
export async function assertFeatureEnabled(
  supabase: unknown,
  brandId: string | null | undefined,
  featureKey: string,
): Promise<void> {
  const ok = await isFeatureEnabledForBrand(supabase, brandId, featureKey);
  if (!ok) throw new Error(`Forbidden: recurso ${featureKey} desativado neste workspace`);
}
