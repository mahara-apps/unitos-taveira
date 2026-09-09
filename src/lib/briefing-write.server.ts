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

/**
 * Janela de agrupamento: salvamentos seguidos do mesmo autor e da mesma origem
 * dentro desse intervalo atualizam a mesma versão em vez de criar outra.
 * Evita o histórico com registros separados por segundos.
 */
export const BRIEFING_VERSION_GROUP_WINDOW_MS = 10 * 60 * 1000;

/** Nome sugerido por origem, usado quando o chamador não informa um. */
export function suggestedVersionLabel(origin: BriefingWriteOrigin): string | null {
  switch (origin) {
    case "ai.import":
      return "Importação por IA";
    case "document":
      return "Importação de documento";
    case "portal":
      return "Resposta do cliente";
    case "ai.briefing":
    case "ai.edit":
    case "ai.pipeline":
      return "Preenchido pela IA";
    default:
      return null;
  }
}

/**
 * Grava a versão do briefing agrupando salvamentos da mesma sessão de edição.
 * Origens diferentes nunca são agrupadas entre si.
 */
export async function upsertBriefingVersion(
  supabase: SupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    snapshot: Record<string, unknown>;
    completion: number;
    status: BriefingStatus;
    origin: BriefingWriteOrigin;
    changedFields: string[];
    authorId: string | null;
    label?: string | null;
  },
): Promise<string | null> {
  const label = args.label ?? suggestedVersionLabel(args.origin);
  const since = new Date(Date.now() - BRIEFING_VERSION_GROUP_WINDOW_MS).toISOString();

  type RecentVersion = { id: string; changed_fields: string[] | null; label: string | null };
  let recent: RecentVersion | null = null;
  try {
    let q = supabase
      .from("brand_briefing_versions")
      .select("id, changed_fields, label")
      .eq("brand_id", args.brandId)
      .eq("client_id", args.clientId)
      .eq("origin", args.origin)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    q = args.authorId ? q.eq("changed_by", args.authorId) : q.is("changed_by", null);
    const { data } = await q.maybeSingle();
    recent = (data as RecentVersion | null) ?? null;
  } catch {
    recent = null;
  }


  if (recent) {
    const merged = Array.from(new Set([...(recent.changed_fields ?? []), ...args.changedFields]));
    const { error } = await supabase
      .from("brand_briefing_versions")
      .update({
        snapshot: args.snapshot as never,
        completion: args.completion,
        status: args.status,
        changed_fields: merged,
        created_at: new Date().toISOString(),
        label: recent.label ?? label,
      } as never)
      .eq("id", recent.id);
    if (!error) return recent.id;
    console.error("[briefing-write] version merge failed:", error);
  }

  const { data: version, error: verErr } = await supabase
    .from("brand_briefing_versions")
    .insert({
      brand_id: args.brandId,
      client_id: args.clientId,
      snapshot: args.snapshot as never,
      completion: args.completion,
      status: args.status,
      origin: args.origin,
      changed_fields: args.changedFields,
      changed_by: args.authorId,
      label,
    } as never)
    .select("id")
    .maybeSingle();
  // Falha de auditoria não deve derrubar a escrita canônica, mas é registrada.
  if (verErr) console.error("[briefing-write] version insert failed:", verErr);
  return (version as { id?: string } | null)?.id ?? null;
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
    /** Nome da versão no histórico; sem valor, usa o sugerido pela origem. */
    label?: string | null;
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

  // Salvamentos em sequência (assistente de 3 passos, edição por seção) não
  // devem virar uma versão nova por clique: dentro da janela, do mesmo autor e
  // da mesma origem, a versão existente é atualizada.
  const versionId = await upsertBriefingVersion(supabase, {
    brandId: args.brandId,
    clientId: args.clientId,
    snapshot: next,
    completion,
    status,
    origin: args.origin,
    changedFields,
    authorId: args.authorId ?? null,
    label: args.label ?? null,
  });

  return {
    hub: next as BrandHubData,
    completion,
    changedFields,
    versionId,
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
