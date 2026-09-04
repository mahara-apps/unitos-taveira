import type { SupabaseClient } from "@supabase/supabase-js";
import { computeBriefingCompletion } from "@/lib/briefing-progress";
import type { BrandHubData } from "@/lib/brand-hub.functions";
import { BRIEFING_STATUSES, type BriefingStatus } from "@/lib/briefing-source.server";

/**
 * FASE 2 — Escrita canônica do briefing.
 *
 * Todo fluxo que altera o briefing (IA, documentos, pipeline, edição manual)
 * passa por aqui: o patch é mesclado em `clients.brand_hub` (fonte única) e um
 * snapshot é registrado em `brand_briefing_versions` (cliente, autor, data,
 * status, origem, campos alterados, completude) para auditoria.
 *
 * `brand_briefings` não é mais escrito — os 19 registros legados permanecem
 * intactos apenas como histórico.
 */

export type BriefingWriteOrigin =
  | "manual"
  | "ai.briefing"
  | "ai.pipeline"
  | "ai.edit"
  | "ai.import"
  | "document"
  | "portal";


export type BriefingWriteResult = {
  hub: BrandHubData;
  completion: number;
  changedFields: string[];
  versionId: string | null;
};

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export async function writeCanonicalBriefing(
  supabase: SupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    patch: Record<string, unknown>;
    authorId?: string | null;
    origin: BriefingWriteOrigin;
    /** Quando true, valores vazios do patch não sobrescrevem o hub (default: true). */
    skipEmpty?: boolean;
    /** Status opcional a aplicar junto da alteração. */
    status?: BriefingStatus;
  },
): Promise<BriefingWriteResult> {
  const { data: clientRow, error: readErr } = await supabase
    .from("clients")
    .select("brand_hub, tone_of_voice, briefing_status")
    .eq("id", args.clientId)
    .eq("brand_id", args.brandId)
    .maybeSingle();
  if (readErr) throw readErr;

  const current = (clientRow?.brand_hub ?? {}) as Record<string, unknown>;
  const skipEmpty = args.skipEmpty !== false;
  const next: Record<string, unknown> = { ...current };
  const changedFields: string[] = [];

  for (const [key, value] of Object.entries(args.patch)) {
    if (skipEmpty && isEmpty(value)) continue;
    if (sameValue(current[key], value)) continue;
    next[key] = value;
    changedFields.push(key);
  }

  const completion = computeBriefingCompletion(next as BrandHubData, {
    tone_of_voice: (clientRow?.tone_of_voice as string | null) ?? null,
  });

  const status: BriefingStatus =
    args.status && BRIEFING_STATUSES.includes(args.status)
      ? args.status
      : ((clientRow?.briefing_status as BriefingStatus | null) ?? "draft");

  const statusChanged = status !== ((clientRow?.briefing_status as string | null) ?? "draft");

  if (changedFields.length === 0 && !statusChanged) {
    return { hub: current as BrandHubData, completion, changedFields: [], versionId: null };
  }

  // updated_at explícito: não dependemos do gatilho trg_clients_updated, que
  // pode não existir em instalações com schema defasado.
  const update: Record<string, unknown> = {
    brand_hub: next,
    updated_at: new Date().toISOString(),
  };
  if (statusChanged) {
    update.briefing_status = status;
    update.briefing_status_at = new Date().toISOString();
    update.briefing_status_by = args.authorId ?? null;
  }

  const { error: writeErr } = await supabase
    .from("clients")
    .update(update as never)
    .eq("id", args.clientId)
    .eq("brand_id", args.brandId);
  if (writeErr) throw writeErr;

  const { data: version, error: verErr } = await supabase
    .from("brand_briefing_versions")
    .insert({
      brand_id: args.brandId,
      client_id: args.clientId,
      snapshot: next as never,
      completion,
      status,
      origin: args.origin,
      changed_fields: changedFields,
      changed_by: args.authorId ?? null,
    } as never)
    .select("id")
    .maybeSingle();
  // Falha de auditoria não deve derrubar a escrita canônica, mas é registrada.
  if (verErr) console.error("[briefing-write] version insert failed:", verErr);

  return {
    hub: next as BrandHubData,
    completion,
    changedFields,
    versionId: (version as { id?: string } | null)?.id ?? null,
  };
}

/** Transição de status do briefing, registrando snapshot para auditoria. */
export async function setBriefingStatus(
  supabase: SupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    status: BriefingStatus;
    authorId?: string | null;
  },
): Promise<BriefingWriteResult> {
  return writeCanonicalBriefing(supabase, {
    brandId: args.brandId,
    clientId: args.clientId,
    patch: {},
    authorId: args.authorId ?? null,
    origin: "manual",
    status: args.status,
  });
}
