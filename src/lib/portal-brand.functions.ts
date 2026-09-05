import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePortalSessionScope } from "@/lib/portal-permissions.server";
import { resolveSessionScope, resolveTokenScope, scopedAdmin } from "@/lib/portal-scope.server";

/**
 * FASE 1 — "Minha Marca" no Portal: leitura do `clients.brand_hub` já existente.
 *
 * Sem RPC nova e sem alteração de RLS: o escopo (cliente + marca) continua sendo
 * resolvido exclusivamente por `portal_resolve` (token ou sessão) e só depois a
 * linha do cliente é lida. Somente leitura, apenas campos de marca.
 */

export type PortalBrandHub = {
  clientName: string | null;
  niche: string | null;
  toneOfVoice: string | null;
  updatedAt: string | null;
  /** Campos de marca já normalizados em texto (somente leitura). */
  hub: Record<string, string>;
};

async function readBrandHub(clientId: string, brandId: string): Promise<PortalBrandHub> {
  const admin = await scopedAdmin();
  const { data, error } = await admin
    .from("clients")
    .select("name, niche, tone_of_voice, brand_hub, briefing_status_at, updated_at")
    .eq("id", clientId)
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  const raw = (row["brand_hub"] ?? {}) as Record<string, unknown>;
  const hub: Record<string, string> = {};
  for (const [k, v] of Object.entries(typeof raw === "object" && raw !== null ? raw : {})) {
    if (v == null) continue;
    const text = Array.isArray(v)
      ? v.filter((x) => typeof x === "string" || typeof x === "number").join("\n")
      : typeof v === "string" || typeof v === "number"
        ? String(v)
        : "";
    if (text.trim()) hub[k] = text.trim();
  }
  return {
    clientName: (row["name"] as string) ?? null,
    niche: (row["niche"] as string) ?? null,
    toneOfVoice: (row["tone_of_voice"] as string) ?? null,
    updatedAt: (row["briefing_status_at"] as string) ?? (row["updated_at"] as string) ?? null,
    hub,
  };
}

export const getPortalBrandHubFn = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(8) }).parse(i))
  .handler(async ({ data }): Promise<PortalBrandHub> => {
    const scope = await resolveTokenScope(data.token);
    return readBrandHub(scope.clientId, scope.brandId);
  });

export const getPortalSessionBrandHubFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i ?? {}))
  .handler(async ({ context, data }): Promise<PortalBrandHub> => {
    const scope = await resolvePortalSessionScope(
      (context as { supabase: unknown }).supabase,
      data.clientId,
      "brand",
      "view",
    );
    return readBrandHub(scope.clientId, scope.brandId);
  });
