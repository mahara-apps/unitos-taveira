/**
 * Sugestão de agenda em massa para peças que ainda não têm data.
 *
 * Usa a MESMA base das pautas novas: histórico real de publicação do cliente
 * (`client-best-times.server.ts`) + distribuição determinística no mês
 * (`monthly-plan-schedule.server.ts`), no fuso oficial America/Sao_Paulo.
 *
 * Nunca toca em peças já datadas ou publicadas e nunca publica/agenda de fato:
 * o resultado entra como "Agenda sugerida" (`schedule_status = 'proposed'`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBestTimesContext } from "@/lib/client-best-times.server";
import { resolveMonthlySchedule, type SlotSuggestion } from "@/lib/monthly-plan-schedule.server";

export type UndatedPost = {
  postId: string;
  title: string;
  stage: string;
  channels: string[];
  formats: string[];
  coverUrl: string | null;
  updatedAt: string | null;
};

const UNDATED_SELECT =
  "id,title,stage,channels,format,cover_url,updated_at,monthly_plan_topic_id,proposed_at,scheduled_at,published_at";

function readChannels(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((c): c is string => typeof c === "string");
  return [];
}

/** Peças do escopo sem nenhuma data (nem proposta, nem agendada, nem publicada). */
export async function listUndatedPosts(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string | null; limit?: number },
): Promise<UndatedPost[]> {
  let q = sb
    .from("posts")
    .select(UNDATED_SELECT)
    .eq("brand_id", args.brandId)
    .is("deleted_at", null)
    .is("proposed_at", null)
    .is("scheduled_at", null)
    .is("published_at", null)
    .neq("stage", "published")
    .order("updated_at", { ascending: false })
    .limit(args.limit ?? 200);
  if (args.clientId) q = q.eq("client_id", args.clientId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((raw) => {
    const r = raw as unknown as Record<string, unknown>;
    return {
      postId: String(r.id),
      title: (typeof r.title === "string" && r.title) || "Sem título",
      stage: typeof r.stage === "string" ? r.stage : "idea",
      channels: readChannels(r.channels),
      formats: typeof r.format === "string" && r.format ? [r.format] : [],
      coverUrl: typeof r.cover_url === "string" ? r.cover_url : null,
      updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
    };
  });
}

export type SuggestResult = {
  updated: number;
  skipped: number;
  confidence: "low" | "medium" | "high";
  sample: number;
};

/**
 * Distribui dia/hora para todas as peças sem data do cliente dentro do mês de
 * referência, gravando a proposta. Idempotente por natureza: uma peça que já
 * recebeu data deixa de ser candidata.
 */
export async function suggestSchedulesForUndated(
  sb: SupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    /** Qualquer instante do mês de referência (default: agora). */
    monthAnchor?: Date;
    now?: Date;
    userId?: string;
  },
): Promise<SuggestResult> {
  const now = args.now ?? new Date();
  const monthAnchor = args.monthAnchor ?? now;

  const q = sb
    .from("posts")
    .select(UNDATED_SELECT)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .is("deleted_at", null)
    .is("proposed_at", null)
    .is("scheduled_at", null)
    .is("published_at", null)
    .neq("stage", "published")
    .order("created_at", { ascending: true })
    .limit(200);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    return { updated: 0, skipped: 0, confidence: "low", sample: 0 };
  }

  const best = await loadBestTimesContext(sb, {
    brandId: args.brandId,
    clientId: args.clientId,
    now,
  });

  const items: SlotSuggestion[] = rows.map((row, index) => {
    const hit = best.top.length ? best.top[index % best.top.length] : null;
    return {
      key: String(row.id),
      weekday: hit ? hit.weekday : null,
      time: hit ? `${String(hit.hour).padStart(2, "0")}:00` : null,
    };
  });

  const slots = resolveMonthlySchedule({ monthAnchor, items, now });
  const byKey = new Map(slots.map((s) => [s.key, s.at]));

  const rationale =
    best.top.length > 0
      ? `Sugerido a partir do histórico real de publicação do cliente (${best.sample} publicações nos últimos 120 dias).`
      : "Sugerido por distribuição em dias úteis — ainda sem histórico de publicação suficiente.";

  let updated = 0;
  for (const row of rows) {
    const at = byKey.get(String(row.id));
    if (!at) continue;
    const { error: upErr } = await sb
      .from("posts")
      .update({
        proposed_at: at.toISOString(),
        schedule_status: "proposed",
        schedule_approved_at: null,
        schedule_approved_by: null,
        schedule_client_decision_at: null,
        schedule_client_comment: null,
      } as never)
      .eq("id", String(row.id))
      .eq("brand_id", args.brandId)
      .eq("client_id", args.clientId)
      .is("proposed_at", null)
      .is("scheduled_at", null);
    if (upErr) throw new Error(upErr.message);
    updated += 1;

    const topicId = typeof row.monthly_plan_topic_id === "string" ? row.monthly_plan_topic_id : null;
    if (topicId) {
      // Espelha a data na pauta de origem; falha aqui não invalida a proposta.
      await sb
        .from("monthly_plan_topics")
        .update({
          suggested_at: at.toISOString(),
          suggested_slot_rationale: rationale,
          suggested_confidence: best.confidence,
        } as never)
        .eq("id", topicId);
    }
  }

  return {
    updated,
    skipped: rows.length - updated,
    confidence: best.confidence,
    sample: best.sample,
  };
}
