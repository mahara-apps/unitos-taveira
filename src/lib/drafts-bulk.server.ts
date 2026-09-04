/**
 * Aplicação EM MASSA sobre rascunhos do calendário.
 *
 * Reaproveita exatamente as mesmas regras do wizard individual:
 * - destinos passam pela guarda de escopo (client_social_accounts) e por
 *   `syncPostPlacements` (placements publicados continuam intocados);
 * - agenda em massa grava apenas PROPOSTA (`schedule_status = 'proposed'`),
 *   nunca agenda na fila real nem publica;
 * - horários vêm da mesma base das pautas (histórico real + distribuição
 *   determinística no fuso America/Sao_Paulo).
 *
 * Nada é privilegiado: todas as escritas usam o client do usuário (RLS).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  syncPostPlacements,
  deriveChannelsFromDestinations,
  deriveTargetConnectionIds,
  type PlacementDestination,
} from "@/lib/placements.server";
import { resolveStageIdByKey } from "@/lib/post-stage.server";
import { loadBestTimesContext } from "@/lib/client-best-times.server";
import { resolveMonthlySchedule, type SlotSuggestion } from "@/lib/monthly-plan-schedule.server";

/** Destino de placement no lote — mesmo contrato do save individual. */
export type BulkDestination = PlacementDestination;


export type BulkApplyInput = {
  brandId: string;
  clientId: string;
  postIds: string[];
  userId: string;
  destinations?: { mode: "replace" | "add"; list: BulkDestination[] } | null;
  schedule?: {
    mode: "suggest" | "fixed";
    /** 0=domingo … 6=sábado (apenas no modo fixed). */
    weekday?: number | null;
    /** "HH:MM" (apenas no modo fixed). */
    time?: string | null;
    overwrite?: boolean;
    monthAnchor?: string | null;
  } | null;
  hashtags?: string[] | null;
  firstComment?: string | null;
  sendToProduction?: boolean;
  now?: Date;
};

export type BulkItemResult = {
  postId: string;
  status: "applied" | "skipped" | "error";
  reason?: string;
  proposedAt?: string | null;
};

export type BulkApplyResult = {
  applied: number;
  skipped: number;
  errors: number;
  items: BulkItemResult[];
  scheduleConfidence?: "low" | "medium" | "high";
  scheduleSample?: number;
};

type PostRow = Record<string, unknown>;

const POST_SELECT =
  "id,title,copy,stage,stage_id,pipeline_id,reference_media,proposed_at,scheduled_at,published_at,monthly_plan_topic_id,client_id,brand_id";

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Estado atual de mídia/legenda auxiliar da peça (para não perder nada no sync). */
async function loadPostContext(sb: SupabaseClient, postId: string) {
  const { data: pls, error } = await sb
    .from("post_placements")
    .select("format, connection_id, copy_override, media, status")
    .eq("post_id", postId);
  if (error) throw new Error(error.message);

  let hashtags: string[] = [];
  let firstComment: string | null = null;
  let linkUrl: string | null = null;
  let locationName: string | null = null;
  let locationId: string | null = null;
  const placementPaths: string[] = [];
  const existing: BulkDestination[] = [];

  for (const pl of pls ?? []) {
    const co = ((pl as PostRow).copy_override ?? {}) as Record<string, unknown>;
    const connectionId = str((pl as PostRow).connection_id);
    const channel = str(co.channel);
    if (connectionId && channel && (pl as PostRow).status !== "published") {
      const fmt = String((pl as PostRow).format);
      existing.push({
        connectionId,
        channel,
        format: (["feed", "stories", "reels", "carrossel"].includes(fmt)
          ? fmt
          : "feed") as BulkDestination["format"],
      });

    }
    if (Array.isArray(co.hashtags) && hashtags.length === 0) {
      hashtags = (co.hashtags as unknown[]).filter((h): h is string => typeof h === "string");
    }
    if (!firstComment) firstComment = str(co.first_comment);
    if (!linkUrl) linkUrl = str(co.link);
    if (!locationName) locationName = str(co.location_name);
    if (!locationId) locationId = str(co.location_id);
    for (const m of Array.isArray((pl as PostRow).media) ? ((pl as PostRow).media as unknown[]) : []) {
      const p = str((m as Record<string, unknown>)?.storagePath);
      if (p) placementPaths.push(p);
    }
  }
  return { hashtags, firstComment, linkUrl, locationName, locationId, placementPaths, existing };
}

/** Conexões efetivamente vinculadas ao cliente hoje (fail-closed). */
async function loadScopedConnections(
  sb: SupabaseClient,
  brandId: string,
  clientId: string,
): Promise<Set<string>> {
  const { data, error } = await sb
    .from("client_social_accounts")
    .select("connection_id")
    .eq("brand_id", brandId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as Array<{ connection_id: string }>).map((l) => l.connection_id));
}

function dedupe(list: BulkDestination[]): BulkDestination[] {
  const map = new Map<string, BulkDestination>();
  for (const d of list) {
    const key = `${d.connectionId}::${d.format}`;
    if (!map.has(key)) map.set(key, d);
  }
  return Array.from(map.values());
}

export async function bulkApplyToDrafts(
  sb: SupabaseClient,
  input: BulkApplyInput,
): Promise<BulkApplyResult> {
  const now = input.now ?? new Date();
  const items: BulkItemResult[] = [];

  const { data: rows, error } = await sb
    .from("posts")
    .select(POST_SELECT)
    .in("id", input.postIds)
    .eq("brand_id", input.brandId)
    .eq("client_id", input.clientId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);

  const byId = new Map((rows ?? []).map((r) => [String((r as PostRow).id), r as PostRow]));

  // --------------------------------------------------------------- destinos
  let destinations: BulkDestination[] | null = null;
  if (input.destinations && input.destinations.list.length > 0) {
    const scoped = await loadScopedConnections(sb, input.brandId, input.clientId);
    const orphan = input.destinations.list.filter((d) => !scoped.has(d.connectionId));
    if (orphan.length > 0) {
      const labels = Array.from(new Set(orphan.map((d) => d.channel))).join(", ");
      throw new Error(
        `Destino inválido: o canal ${labels} não está vinculado a este cliente. Vincule a conta em Perfil do cliente > Canais.`,
      );
    }
    destinations = dedupe(input.destinations.list);
  }

  // ----------------------------------------------------------------- agenda
  const slotByPost = new Map<string, Date>();
  let scheduleConfidence: "low" | "medium" | "high" | undefined;
  let scheduleSample: number | undefined;
  if (input.schedule) {
    const overwrite = input.schedule.overwrite === true;
    const candidates = input.postIds.filter((id) => {
      const row = byId.get(id);
      if (!row) return false;
      if (str(row.published_at) || row.stage === "published") return false;
      if (str(row.scheduled_at)) return false;
      if (str(row.proposed_at) && !overwrite) return false;
      return true;
    });

    if (candidates.length > 0) {
      const monthAnchor = input.schedule.monthAnchor
        ? new Date(input.schedule.monthAnchor)
        : new Date(now);

      let suggestions: SlotSuggestion[];
      if (input.schedule.mode === "fixed") {
        const time = input.schedule.time ?? "19:00";
        const weekday =
          typeof input.schedule.weekday === "number" ? input.schedule.weekday : null;
        suggestions = candidates.map((id) => ({ key: id, weekday, time }));
      } else {
        const best = await loadBestTimesContext(sb, {
          brandId: input.brandId,
          clientId: input.clientId,
          now,
        });
        scheduleConfidence = best.confidence;
        scheduleSample = best.sample;
        suggestions = candidates.map((id, index) => {
          const hit = best.top.length ? best.top[index % best.top.length] : null;
          return {
            key: id,
            weekday: hit ? hit.weekday : null,
            time: hit ? `${String(hit.hour).padStart(2, "0")}:00` : null,
          };
        });
      }

      const slots = resolveMonthlySchedule({ monthAnchor, items: suggestions, now });
      for (const s of slots) slotByPost.set(s.key, s.at);
    }
  }

  // ------------------------------------------------------------- aplicação
  for (const postId of input.postIds) {
    const row = byId.get(postId);
    if (!row) {
      items.push({ postId, status: "skipped", reason: "Peça fora do escopo ou removida." });
      continue;
    }
    if (str(row.published_at) || row.stage === "published") {
      items.push({ postId, status: "skipped", reason: "Peça já publicada." });
      continue;
    }

    try {
      let touched = false;
      const ctx = await loadPostContext(sb, postId);

      // ---- destinos ----
      if (destinations) {
        const finalList =
          input.destinations!.mode === "replace"
            ? destinations
            : dedupe([...ctx.existing, ...destinations]);

        const refPaths = (Array.isArray(row.reference_media) ? row.reference_media : [])
          .map((r) => str((r as Record<string, unknown>)?.path))
          .filter((p): p is string => !!p);
        const mediaPaths = Array.from(new Set([...refPaths, ...ctx.placementPaths]));

        const hashtags = input.hashtags?.length
          ? Array.from(new Set([...ctx.hashtags, ...input.hashtags]))
          : ctx.hashtags;
        const firstComment =
          input.firstComment && input.firstComment.trim().length > 0
            ? input.firstComment.trim()
            : ctx.firstComment;

        await syncPostPlacements(sb, {
          postId,
          brandId: input.brandId,
          clientId: input.clientId,
          destinations: finalList,
          mediaPaths,
          hashtags,
          firstComment,
          linkUrl: ctx.linkUrl,
          locationName: ctx.locationName,
          locationId: ctx.locationId,
          scheduledIso: null,
          status: "draft",
        });

        const { error: upErr } = await sb
          .from("posts")
          .update({
            channels: deriveChannelsFromDestinations(finalList),
            target_connection_ids: deriveTargetConnectionIds(finalList),
          } as never)
          .eq("id", postId)
          .eq("brand_id", input.brandId);
        if (upErr) throw new Error(upErr.message);
        touched = true;
      } else if (
        (input.hashtags && input.hashtags.length > 0) ||
        (input.firstComment && input.firstComment.trim().length > 0)
      ) {
        // Sem troca de destinos: só complementa legenda auxiliar dos destinos atuais.
        if (ctx.existing.length > 0) {
          const refPaths = (Array.isArray(row.reference_media) ? row.reference_media : [])
            .map((r) => str((r as Record<string, unknown>)?.path))
            .filter((p): p is string => !!p);
          await syncPostPlacements(sb, {
            postId,
            brandId: input.brandId,
            clientId: input.clientId,
            destinations: ctx.existing,
            mediaPaths: Array.from(new Set([...refPaths, ...ctx.placementPaths])),
            hashtags: Array.from(new Set([...ctx.hashtags, ...(input.hashtags ?? [])])),
            firstComment:
              input.firstComment && input.firstComment.trim().length > 0
                ? input.firstComment.trim()
                : ctx.firstComment,
            linkUrl: ctx.linkUrl,
            locationName: ctx.locationName,
            locationId: ctx.locationId,
            scheduledIso: null,
            status: "draft",
          });
          touched = true;
        }
      }

      // ---- agenda proposta ----
      const slot = slotByPost.get(postId);
      if (slot) {
        const { error: schErr } = await sb
          .from("posts")
          .update({
            proposed_at: slot.toISOString(),
            schedule_status: "proposed",
            schedule_approved_at: null,
            schedule_approved_by: null,
            schedule_client_decision_at: null,
            schedule_client_comment: null,
          } as never)
          .eq("id", postId)
          .eq("brand_id", input.brandId)
          .eq("client_id", input.clientId)
          .is("scheduled_at", null);
        if (schErr) throw new Error(schErr.message);
        touched = true;

        const topicId = str(row.monthly_plan_topic_id);
        if (topicId) {
          await sb
            .from("monthly_plan_topics")
            .update({
              suggested_at: slot.toISOString(),
              suggested_slot_rationale:
                input.schedule?.mode === "fixed"
                  ? "Definido manualmente em lote pela operação."
                  : "Sugerido a partir do histórico real de publicação do cliente.",
              suggested_confidence: scheduleConfidence ?? "low",
            } as never)
            .eq("id", topicId);
        }
      }

      // ---- enviar para produção ----
      if (input.sendToProduction && row.stage === "idea") {
        const stageId = await resolveStageIdByKey(
          sb,
          str(row.pipeline_id),
          ["production", "producao", "in_progress"],
        );
        const patch: Record<string, unknown> = { stage: "production" };
        if (stageId) patch.stage_id = stageId;
        const { error: stErr } = await sb
          .from("posts")
          .update(patch as never)
          .eq("id", postId)
          .eq("brand_id", input.brandId);
        if (stErr) throw new Error(stErr.message);
        touched = true;
      }

      items.push({
        postId,
        status: touched ? "applied" : "skipped",
        reason: touched ? undefined : "Nada a alterar nesta peça.",
        proposedAt: slot ? slot.toISOString() : null,
      });
    } catch (e) {
      items.push({
        postId,
        status: "error",
        reason: e instanceof Error ? e.message : "Falha ao aplicar.",
      });
    }
  }

  return {
    applied: items.filter((i) => i.status === "applied").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    errors: items.filter((i) => i.status === "error").length,
    items,
    scheduleConfidence,
    scheduleSample,
  };
}
