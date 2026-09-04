import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildBrandContextBlueprint } from "./ai-agents.functions";
import {
  AGENT_VARIABLE_CATALOG,
  type ResolvedVariable,
  type ResolvedVariableMap,
} from "./agent-variables";

const Input = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export const resolveAgentVariablesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<ResolvedVariableMap> => {
    const { supabase } = context;
    const { brandId, clientId } = data;

    const [
      blueprintResult,
      { data: personasRow },
      { data: voiceRow },
      { data: clientRow },
      { data: competitorsRow },
    ] = await Promise.all([
      buildBrandContextBlueprint(supabase as never, brandId, clientId).catch(() => ({
        blueprint: "",
      })),
      supabase
        .from("brand_personas")
        .select("data")
        .eq("brand_id", brandId)
        .eq("client_id", clientId)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("brand_voice_cards")
        .select("data")
        .eq("brand_id", brandId)
        .eq("client_id", clientId)
        .eq("is_active", true)
        .maybeSingle(),
      supabase.from("clients").select("brand_hub, tone_of_voice").eq("id", clientId).maybeSingle(),
      supabase
        .from("brand_competitors")
        .select("handle")
        .eq("brand_id", brandId)
        .eq("client_id", clientId)
        .limit(12),
    ]);

    const hub = ((clientRow?.brand_hub ?? {}) as Record<string, unknown>) || {};
    const paletteRaw = Array.isArray(hub.palette)
      ? (hub.palette as { label?: string; hex?: string }[])
      : [];
    const palette = paletteRaw
      .map((p) => (p?.hex ? `${p.label ?? "cor"}: ${p.hex}` : null))
      .filter((v): v is string => Boolean(v));
    const hashtags = Array.isArray(hub.hashtags) ? (hub.hashtags as string[]) : [];
    const description = typeof hub.description === "string" ? hub.description : "";
    const mission = typeof hub.mission === "string" ? hub.mission : "";
    const brandContextText = [mission, description].filter(Boolean).join(" — ");
    const logoUrl = typeof hub.logo_url === "string" ? hub.logo_url : "";

    const competitorsStr = (competitorsRow ?? []).map((c) => `- @${c.handle}`).join("\n");

    const personasStr = personasRow?.data ? JSON.stringify(personasRow.data).slice(0, 4000) : "";
    const personaFirst = personasRow?.data ? JSON.stringify(personasRow.data).slice(0, 1800) : "";
    const voiceStr = voiceRow?.data ? JSON.stringify(voiceRow.data).slice(0, 2500) : "";

    const values: Record<string, string> = {
      CONTEXT: blueprintResult.blueprint,
      BRAND_CONTEXT: brandContextText,
      PERSONAS: personasStr,
      PERSONA: personaFirst,
      TONE: voiceStr || (clientRow?.tone_of_voice ?? ""),
      TONE_OF_VOICE: clientRow?.tone_of_voice ?? "",
      HASHTAGS: hashtags.slice(0, 20).join(" "),
      COMPETITORS: competitorsStr,
      PRIMARY_COLORS: palette.slice(0, 4).join(", "),
      SECONDARY_COLORS: palette.slice(4, 8).join(", "),
      TERTIARY_COLORS: palette.slice(8).join(", "),
      LOGO_URL: logoUrl,
      VISUAL_ANALYSIS: "", // reserved: hydrated by monthly-plan when available
    };

    const map: ResolvedVariableMap = {};
    for (const key of Object.keys(AGENT_VARIABLE_CATALOG)) {
      const spec = AGENT_VARIABLE_CATALOG[key];
      if (spec.runtimeProvided) {
        map[key] = {
          key,
          value: "",
          resolved: true, // runtime-provided values are considered fine
          source: spec.source,
        };
        continue;
      }
      const value = values[key] ?? "";
      map[key] = {
        key,
        value,
        resolved: Boolean(value && value.trim().length > 0),
        source: spec.source,
      };
    }
    return map;
  });

/** Convert a resolved map into a flat string dictionary for renderPrompt(). */
export function resolvedToValues(
  map: ResolvedVariableMap,
  overrides?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, r] of Object.entries(map)) out[k] = r.value;
  if (overrides) for (const [k, v] of Object.entries(overrides)) if (v) out[k] = v;
  return out;
}

export type ResolvedVariableRow = ResolvedVariable;
