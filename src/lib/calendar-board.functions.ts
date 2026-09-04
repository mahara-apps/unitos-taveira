import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Central de Publicação — camada de leitura do Calendário.
 *
 * Agrupa PEÇAS (posts) com seus DESTINOS reais (post_placements + fila
 * social_posts). Nenhum estado novo é inventado: o status geral é derivado do
 * estado real dos destinos, exatamente como o pipeline persiste no banco.
 *
 *   rascunho → aprovação → agendado → fila → processando → publicado/parcial/falhou
 *
 * Não altera pipeline, workers ou integrações — apenas lê e transforma.
 */

export type PublicationDestination = {
  placementId: string | null;
  connectionId: string | null;
  /** instagram | facebook | ... (vazio quando o destino não tem conexão) */
  channel: string;
  accountLabel: string | null;
  format: string;
  /** draft | scheduled | publishing | published | failed | cancelled */
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  canRetry: boolean;
  /** Horário previsto da próxima tentativa automática, quando aguardando retry. */
  nextAttemptAt: string | null;
  /** Item pendente na fila pode ser cancelado (libera reagendamento). */
  canCancelQueue: boolean;
};

export type PublicationOverall =
  | "draft"
  | "awaiting_approval"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "partial"
  | "failed"
  | "cancelled"
  /** Agenda sugerida pela IA, aguardando aprovação (não reserva, não publica). */
  | "proposed"
  /** Agenda aprovada internamente e pelo cliente: data reservada, sem publicação. */
  | "reserved";

export type PublicationItem = {
  postId: string;
  title: string;
  copy: string;
  coverUrl: string | null;
  brandId: string;
  clientId: string;
  pipelineId: string | null;
  stageId: string | null;
  stage: string | null;
  reviewStatus: string | null;
  /** Data efetiva na agenda: agendamento OU publicação. */
  when: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Data/hora proposta (agenda sugerida), quando existir. */
  proposedAt: string | null;
  /** none | proposed | internal_approved | client_pending | client_changes | reserved */
  scheduleStatus: string;
  scheduleApprovedAt: string | null;
  scheduleClientComment: string | null;
  overall: PublicationOverall;
  channels: string[];
  formats: string[];
  destinations: PublicationDestination[];
  publishedCount: number;
  totalDestinations: number;
  author: { id: string; name: string | null; avatar_url: string | null } | null;
};

export type PublicationBoard = {
  items: PublicationItem[];
  /** Aguardando aprovação (com ou sem data), fora da janela quando necessário. */
  awaitingApproval: PublicationItem[];
};

const familyOf = (format: string) => {
  const f = (format ?? "").toLowerCase();
  if (f.includes("stor")) return "story";
  if (f.includes("reel")) return "reel";
  if (f.includes("carrossel") || f.includes("carousel")) return "carousel";
  return "feed";
};

const ACTIVE_PLACEMENT_STATUS = ["draft", "scheduled", "publishing", "published", "failed"];

export const listPublicationBoardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
        from: z.string(),
        to: z.string(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PublicationBoard> => {
    const supabase = context.supabase;
    const dateWindow = [
      `and(scheduled_at.gte.${data.from},scheduled_at.lte.${data.to})`,
      `and(published_at.gte.${data.from},published_at.lte.${data.to})`,
    ].join(",");

    // 1) Destinos com data na janela.
    let plq = supabase
      .from("post_placements")
      .select("post_id")
      .eq("brand_id", data.brandId)
      .in("status", ["scheduled", "publishing", "published", "failed"])
      .or(dateWindow);
    if (data.clientId) plq = plq.eq("client_id", data.clientId);
    const { data: windowPlacements, error: plErr } = await plq;
    if (plErr) throw new Error(plErr.message);

    // 2) Peças com data na janela (inclui publicação imediata sem scheduled_at).
    let dq = supabase
      .from("posts")
      .select("id")
      .eq("brand_id", data.brandId)
      .is("deleted_at", null)
      .in("stage", ["idea", "production", "review", "approved", "scheduled", "published"])
      .or(dateWindow);
    if (data.clientId) dq = dq.eq("client_id", data.clientId);
    const { data: windowPosts, error: dErr } = await dq;
    if (dErr) throw new Error(dErr.message);

    // 2.1) Peças com AGENDA PROPOSTA na janela (chips fantasma do calendário).
    let pq = supabase
      .from("posts")
      .select("id")
      .eq("brand_id", data.brandId)
      .is("deleted_at", null)
      .not("proposed_at", "is", null)
      .gte("proposed_at", data.from)
      .lte("proposed_at", data.to);
    if (data.clientId) pq = pq.eq("client_id", data.clientId);
    const { data: proposedPosts, error: pErr } = await pq;
    if (pErr) throw new Error(pErr.message);

    // 3) Peças aguardando aprovação (sempre relevantes para a operação).
    let aq = supabase
      .from("posts")
      .select("id")
      .eq("brand_id", data.brandId)
      .is("deleted_at", null)
      .eq("stage", "review")
      .order("updated_at", { ascending: false })
      .limit(30);
    if (data.clientId) aq = aq.eq("client_id", data.clientId);
    const { data: reviewPosts, error: aErr } = await aq;
    if (aErr) throw new Error(aErr.message);

    const reviewIds = new Set((reviewPosts ?? []).map((r) => r.id as string));
    const postIds = Array.from(
      new Set([
        ...(windowPlacements ?? []).map((p) => p.post_id as string),
        ...(windowPosts ?? []).map((p) => p.id as string),
        ...(proposedPosts ?? []).map((p) => p.id as string),
        ...reviewIds,
      ]),
    );
    if (postIds.length === 0) return { items: [], awaitingApproval: [] };

    const { data: posts, error: postErr } = await supabase
      .from("posts")
      .select(
        "id,title,copy,cover_url,reference_media,channels,client_id,brand_id,pipeline_id,stage_id,stage,review_status,scheduled_at,published_at,created_at,updated_at,created_by,proposed_at,schedule_status,schedule_approved_at,schedule_client_comment",
      )
      .in("id", postIds)
      .is("deleted_at", null);
    if (postErr) throw new Error(postErr.message);

    // 4) Todos os destinos das peças selecionadas.
    const { data: placements, error: allPlErr } = await supabase
      .from("post_placements")
      .select("id,post_id,format,status,connection_id,scheduled_at,published_at,copy_override")
      .in("post_id", postIds)
      .in("status", ACTIVE_PLACEMENT_STATUS);
    if (allPlErr) throw new Error(allPlErr.message);

    // 4.1) Thumbnails: cover_url quando existir; senão assina a 1ª mídia
    // persistida em reference_media (bucket privado brand-media).
    const coverByPost = new Map<string, string | null>();
    await Promise.all(
      (posts ?? []).map(async (p) => {
        const direct = (p.cover_url as string | null) ?? null;
        if (direct) {
          coverByPost.set(p.id as string, direct);
          return;
        }
        const first = (Array.isArray(p.reference_media) ? p.reference_media : [])
          .map((r) => r as Record<string, unknown>)
          .find((r) => typeof r?.path === "string");
        if (!first) {
          coverByPost.set(p.id as string, null);
          return;
        }
        const bucket = typeof first.bucket === "string" ? (first.bucket as string) : "brand-media";
        try {
          const { data: signed } = await supabase.storage
            .from(bucket)
            .createSignedUrl(first.path as string, 3600);
          coverByPost.set(p.id as string, signed?.signedUrl ?? null);
        } catch {
          coverByPost.set(p.id as string, null);
        }
      }),
    );

    // 5) Fila real de publicação (erro/permalink/tentativas).
    const { data: queue, error: qErr } = await supabase
      .from("social_posts")
      .select(
        "post_id,connection_id,placement,status,last_error,publish_attempts,published_at,external_permalink,scheduled_at,next_attempt_at,deferred_since,publish_locked_at",
      )
      .eq("brand_id", data.brandId)
      .in("post_id", postIds);
    if (qErr) throw new Error(qErr.message);

    // 6) Contas conectadas (rótulo/canal por destino).
    const connIds = Array.from(
      new Set(
        (placements ?? [])
          .map((p) => p.connection_id as string | null)
          .filter((v): v is string => !!v),
      ),
    );
    const connMap = new Map<string, { channel: string; label: string }>();
    if (connIds.length) {
      const { data: conns } = await supabase
        .from("social_connections")
        .select("id,channel,external_name,account_username")
        .eq("brand_id", data.brandId)
        .in("id", connIds);
      for (const c of conns ?? []) {
        connMap.set(
          c.id as string,
          {
            channel: (c.channel as string) ?? "",
            label:
              (c.account_username as string | null) ?? (c.external_name as string | null) ?? null,
          } as { channel: string; label: string },
        );
      }
    }

    // 7) Autores.
    const userIds = Array.from(
      new Set(
        (posts ?? []).map((p) => p.created_by as string | null).filter((v): v is string => !!v),
      ),
    );
    const authors = new Map<
      string,
      { id: string; name: string | null; avatar_url: string | null }
    >();
    if (userIds.length) {
      const { data: profs } = await supabase
        .from("user_profiles")
        .select("id,full_name,avatar_url")
        .in("id", userIds);
      for (const p of profs ?? []) {
        authors.set(p.id as string, {
          id: p.id as string,
          name: (p.full_name as string | null) ?? null,
          avatar_url: (p.avatar_url as string | null) ?? null,
        });
      }
    }

    const placementsByPost = new Map<string, typeof placements>();
    for (const pl of placements ?? []) {
      const key = pl.post_id as string;
      const arr = placementsByPost.get(key) ?? [];
      arr!.push(pl);
      placementsByPost.set(key, arr);
    }

    const items: PublicationItem[] = (posts ?? []).map((post) => {
      const pls = placementsByPost.get(post.id as string) ?? [];
      const rows = (queue ?? []).filter((r) => r.post_id === post.id);

      const destinations: PublicationDestination[] = (pls ?? []).map((pl) => {
        const connectionId = (pl.connection_id as string | null) ?? null;
        const conn = connectionId ? connMap.get(connectionId) : undefined;
        const co = (pl.copy_override ?? {}) as Record<string, unknown>;
        const family = familyOf(pl.format as string);
        const mine = rows.filter(
          (r) =>
            r.connection_id === connectionId &&
            familyOf(
              (r.placement as string) === "story"
                ? "stories"
                : (r.placement as string) === "reel"
                  ? "reels"
                  : (r.placement as string) === "carousel"
                    ? "carrossel"
                    : "feed",
            ) === family,
        );
        const published = mine.find((r) => r.status === "published");
        const inFlight = mine.find((r) => r.status === "publishing" || r.status === "scheduled");
        const failed = mine.find((r) => r.status === "failed");
        // AGUARDANDO NOVA TENTATIVA: item segue na fila após erro temporário
        // (limite de requisições da rede). Não é falha e não pode ser
        // reenfileirado enquanto existir — precisa ser cancelado da fila.
        const awaitingRetry =
          !published &&
          !!inFlight &&
          inFlight.status === "scheduled" &&
          (!!inFlight.next_attempt_at ||
            !!inFlight.deferred_since ||
            Number(inFlight.publish_attempts ?? 0) > 0 ||
            !!inFlight.last_error);
        const status = published
          ? "published"
          : awaitingRetry
            ? "awaiting_retry"
            : inFlight
              ? inFlight.status === "publishing"
                ? "publishing"
                : "scheduled"
              : failed
                ? "failed"
                : ((pl.status as string) ?? "draft");
        return {
          placementId: pl.id as string,
          connectionId,
          channel: conn?.channel ?? (typeof co.channel === "string" ? (co.channel as string) : ""),
          accountLabel: conn?.label ?? null,
          format: pl.format as string,
          status,
          scheduledAt:
            (pl.scheduled_at as string | null) ?? (inFlight?.scheduled_at as string | null) ?? null,
          publishedAt:
            (published?.published_at as string | null) ??
            (pl.published_at as string | null) ??
            null,
          permalink: (published?.external_permalink as string | null) ?? null,
          error: published
            ? null
            : ((failed?.last_error as string | null) ??
              (awaitingRetry ? ((inFlight?.last_error as string | null) ?? null) : null)),
          attempts: Number(failed?.publish_attempts ?? inFlight?.publish_attempts ?? 0),
          canRetry: !published && !inFlight && status === "failed" && !!connectionId,
          nextAttemptAt: awaitingRetry
            ? ((inFlight?.next_attempt_at as string | null) ?? null)
            : null,
          canCancelQueue:
            !published && !!inFlight && !inFlight.publish_locked_at && !!connectionId,
        };
      });

      const stage = (post.stage as string | null) ?? null;
      const publishedCount = destinations.filter((d) => d.status === "published").length;
      const total = destinations.length;

      let overall: PublicationOverall;
      if (total > 0 && publishedCount === total) overall = "published";
      else if (publishedCount > 0) overall = "partial";
      else if (destinations.some((d) => d.status === "publishing")) overall = "publishing";
      else if (destinations.some((d) => d.status === "failed")) overall = "failed";
      else if (destinations.some((d) => d.status === "scheduled")) overall = "scheduled";
      else if (stage === "review") overall = "awaiting_approval";
      else if (stage === "published") overall = "published";
      else if (stage === "scheduled") overall = "scheduled";
      else if (stage === "approved") overall = "ready";
      else if (
        (post.schedule_status as string | null) === "reserved" &&
        (post.proposed_at as string | null)
      )
        overall = "reserved";
      else if (
        (post.proposed_at as string | null) &&
        ["proposed", "internal_approved", "client_pending", "client_changes"].includes(
          (post.schedule_status as string | null) ?? "",
        )
      )
        overall = "proposed";
      else overall = "draft";

      const when =
        destinations.find((d) => d.status === "published")?.publishedAt ??
        (post.published_at as string | null) ??
        (post.scheduled_at as string | null) ??
        destinations.map((d) => d.scheduledAt).find((v) => !!v) ??
        // Agenda apenas proposta/reservada também aparece no calendário.
        (post.proposed_at as string | null) ??
        // Destino que falhou numa publicação imediata não tem data própria:
        // herda o último toque da peça para ficar visível no dia da tentativa.
        (total > 0 && (overall === "failed" || overall === "publishing")
          ? ((post.updated_at as string | null) ?? null)
          : null);

      const channels = Array.from(
        new Set([
          ...destinations.map((d) => d.channel).filter(Boolean),
          ...(((post.channels as string[] | null) ?? []) as string[]),
        ]),
      );

      return {
        postId: post.id as string,
        title: (post.title as string) ?? "Sem título",
        copy: (post.copy as string) ?? "",
        coverUrl: coverByPost.get(post.id as string) ?? (post.cover_url as string | null) ?? null,
        brandId: post.brand_id as string,
        clientId: post.client_id as string,
        pipelineId: (post.pipeline_id as string | null) ?? null,
        stageId: (post.stage_id as string | null) ?? null,
        stage,
        reviewStatus: (post.review_status as string | null) ?? null,
        when,
        scheduledAt: (post.scheduled_at as string | null) ?? null,
        proposedAt: (post.proposed_at as string | null) ?? null,
        scheduleStatus: ((post.schedule_status as string | null) ?? "none") as string,
        scheduleApprovedAt: (post.schedule_approved_at as string | null) ?? null,
        scheduleClientComment: (post.schedule_client_comment as string | null) ?? null,
        publishedAt: (post.published_at as string | null) ?? null,
        createdAt: (post.created_at as string | null) ?? null,
        updatedAt: (post.updated_at as string | null) ?? null,
        overall,
        channels,
        formats: Array.from(new Set(destinations.map((d) => d.format).filter(Boolean))),
        destinations,
        publishedCount,
        totalDestinations: total,
        author: post.created_by ? (authors.get(post.created_by as string) ?? null) : null,
      };
    });

    const inWindow = (v: string | null) => !!v && v >= data.from && v <= data.to;

    return {
      items: items.filter(
        (it) =>
          inWindow(it.when) ||
          it.destinations.some((d) => inWindow(d.scheduledAt) || inWindow(d.publishedAt)),
      ),
      awaitingApproval: items.filter((it) => it.overall === "awaiting_approval"),
    };
  });
