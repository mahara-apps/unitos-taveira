import type { SupabaseClient } from "@supabase/supabase-js";

type PlanContextSources = Record<string, unknown> | null | undefined;

export function briefingVersionFromSources(sources: PlanContextSources): string | null {
  const value = sources?.["briefing_version_id"];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Resolve uma versão atual do briefing no escopo exato da geração.
 * O ID retornado pertence a `brand_briefing_versions` e nunca deve ser gravado
 * na FK legada `monthly_plans.input_briefing_id`.
 */
export async function resolvePlanBriefingVersion(
  supabase: SupabaseClient,
  args: { briefingVersionId?: string | null; brandId: string; clientId: string },
): Promise<string | null> {
  if (!args.briefingVersionId) return null;

  const { data, error } = await supabase
    .from("brand_briefing_versions")
    .select("id")
    .eq("id", args.briefingVersionId)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("briefing_version_invalid");
  return (data as { id: string }).id;
}