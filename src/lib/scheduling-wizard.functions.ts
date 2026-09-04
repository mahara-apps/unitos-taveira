import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  syncPostPlacements,
  deriveChannelsFromDestinations,
  deriveTargetConnectionIds,
} from "@/lib/placements.server";
import {
  hasPlacementOptions,
  normalizePlacementOptions,
  type PlacementOptions,
} from "@/lib/placement-options";
import { resolveStageIdByKey } from "@/lib/post-stage.server";
import { assertScheduleLead } from "@/lib/schedule-rules";
import { describeQueueInsertError } from "@/lib/social/queue-conflict";

/** Extensões tratadas como vídeo ao resolver mídia de destino. */
const IS_VIDEO_PATH = /\.(mp4|mov|m4v|webm|3gp)$/i;



/**
 * Server functions do wizard de agendamento (/calendar).
 * Reaproveita `posts` + `post_placements` + `social_connections`.
 * Leituras de posts filtram por (brand_id, client_id); canais vêm do vínculo
 * client_social_accounts (o campo legado social_connections.client_id não é usado).
 */

// ============================================================
// Types
// ============================================================

export type WizardConnection = {
  connectionId: string;
  channel: string; // instagram | facebook | ...
  accountLabel: string;
  handle: string | null;
  avatarUrl: string | null;
  status: string;
};

export type PendingSchedulePost = {
  postId: string;
  title: string;
  copy: string;
  coverUrl: string | null;
  channels: string[];
  targetConnectionIds: string[];
  approvedAt: string | null;
  placements: Array<{ channel: string; format: string }>;
};

// ============================================================
// listClientSocialConnectionsFn
// ============================================================

export const listClientSocialConnectionsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<WizardConnection[]> => {
    // Contas sociais são globais na marca (/connections) e atribuídas ao
    // cliente a partir do perfil do cliente (aba "Canais"). O wizard lê o
    // vínculo em client_social_accounts.
    const { data: assigns, error: aErr } = await context.supabase
      .from("client_social_accounts")
      .select("connection_id")
      .eq("client_id", data.clientId)
      .eq("brand_id", data.brandId);
    if (aErr) throw new Error(aErr.message);
    const ids = (assigns ?? []).map((a) => a.connection_id);
    if (!ids.length) return [];
    const { data: rows, error } = await context.supabase
      .from("social_connections")
      .select("id, channel, external_name, account_username, status, metadata")
      .eq("brand_id", data.brandId)
      .in("id", ids)
      .eq("status", "active");
    if (error) throw new Error(error.message);

    return (rows ?? []).map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const avatar =
        r.channel === "instagram"
          ? ((meta.instagram_picture_url ?? meta.page_picture_url ?? null) as string | null)
          : r.channel === "facebook"
            ? ((meta.page_picture_url ?? null) as string | null)
            : null;
      const handle =
        r.channel === "instagram" ? (r.account_username ?? null) : (r.external_name ?? null);
      return {
        connectionId: r.id as string,
        channel: r.channel as string,
        accountLabel: (r.external_name ?? handle ?? r.channel) as string,
        handle,
        avatarUrl: avatar,
        status: r.status as string,
      };
    });
  });

// ============================================================
// listApprovedUnscheduledFn — painel lateral
// ============================================================

export const listApprovedUnscheduledFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PendingSchedulePost[]> => {
    let q = context.supabase
      .from("posts")
      .select("id, title, copy, cover_url, channels, approved_at, target_connection_ids")
      .eq("brand_id", data.brandId)
      .eq("stage", "approved")
      .is("scheduled_at", null)
      .is("deleted_at", null)
      .order("approved_at", { ascending: true, nullsFirst: false })
      .limit(50);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const postIds = (rows ?? []).map((r) => r.id as string);
    const placementsByPost = new Map<string, Array<{ channel: string; format: string }>>();
    if (postIds.length) {
      const { data: pls, error: plErr } = await context.supabase
        .from("post_placements")
        .select("post_id, format, copy_override")
        .in("post_id", postIds);
      if (plErr) throw new Error(plErr.message);
      for (const pl of pls ?? []) {
        const key = pl.post_id as string;
        const arr = placementsByPost.get(key) ?? [];
        const co = (pl.copy_override ?? {}) as Record<string, unknown>;
        const channel = typeof co.channel === "string" ? co.channel : "";
        arr.push({
          channel,
          format: pl.format as string,
        });
        placementsByPost.set(key, arr);
      }
    }
    return (rows ?? []).map((p) => ({
      postId: p.id as string,
      title: (p.title as string) ?? "Sem título",
      copy: (p.copy as string) ?? "",
      coverUrl: (p.cover_url as string | null) ?? null,
      channels: (p.channels as string[] | null) ?? [],
      targetConnectionIds: (p.target_connection_ids as string[] | null) ?? [],
      approvedAt: (p.approved_at as string | null) ?? null,
      placements: placementsByPost.get(p.id as string) ?? [],
    }));
  });

// ============================================================
// saveScheduledPostFn — cria/atualiza post + placements
// ============================================================

// ============================================================
// listDraftsFn — rascunhos (stage=idea) do wizard
// ============================================================

export const listDraftsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PendingSchedulePost[]> => {
    let q = context.supabase
      .from("posts")
      .select(
        "id, title, copy, cover_url, reference_media, channels, updated_at, target_connection_ids",
      )
      .eq("brand_id", data.brandId)
      .eq("stage", "idea")
      .is("scheduled_at", null)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const out: PendingSchedulePost[] = [];
    for (const p of rows ?? []) {
      // Thumb do rascunho: cover_url quando existir; senão assina a 1ª mídia
      // persistida em reference_media (bucket privado brand-media).
      let cover = (p.cover_url as string | null) ?? null;
      if (!cover) {
        const first = (Array.isArray(p.reference_media) ? p.reference_media : [])
          .map((r) => r as Record<string, unknown>)
          .find((r) => typeof r?.path === "string");
        if (first) {
          const bucket =
            typeof first.bucket === "string" ? (first.bucket as string) : "brand-media";
          const { data: signed } = await context.supabase.storage
            .from(bucket)
            .createSignedUrl(first.path as string, 3600);
          cover = signed?.signedUrl ?? null;
        }
      }
      out.push({
        postId: p.id as string,
        title: (p.title as string) ?? "Sem título",
        copy: (p.copy as string) ?? "",
        coverUrl: cover,
        channels: (p.channels as string[] | null) ?? [],
        targetConnectionIds: (p.target_connection_ids as string[] | null) ?? [],
        approvedAt: (p.updated_at as string | null) ?? null,
        placements: [],
      });
    }
    return out;
  });

// ============================================================
// loadPostStateFn — restaura o estado COMPLETO de uma peça no wizard
// (destinos reais, mídia selecionada, hashtags, link, local, agendamento).
// ============================================================

export type WizardPostState = {
  postId: string;
  title: string;
  copy: string;
  hashtags: string[];
  firstComment: string | null;
  linkUrl: string | null;
  locationName: string | null;
  locationId: string | null;
  scheduledAt: string | null;
  stage: string;
  destinations: Array<{
    connectionId: string;
    channel: string;
    format: string;
    options?: PlacementOptions;
  }>;
  media: Array<{
    id: string;
    storagePath: string;
    name: string;
    mimeType: string;
    kind: "image" | "video" | "other";
    publicUrl: string | null;
  }>;
};

export const loadPostStateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ postId: z.string().uuid(), brandId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<WizardPostState> => {
    const { data: post, error: pErr } = await context.supabase
      .from("posts")
      .select("id, title, copy, stage, scheduled_at, reference_media, tags")
      .eq("id", data.postId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!post) throw new Error("Peça não encontrada.");

    const { data: pls, error: plErr } = await context.supabase
      .from("post_placements")
      .select("format, connection_id, copy_override, media, scheduled_at, status, client_id")
      .eq("post_id", data.postId);
    if (plErr) throw new Error(plErr.message);

    // RECONCILIAÇÃO: destino atual = conexão ATIVA e vinculada ao cliente hoje
    // (client_social_accounts). Placement histórico com conexão removida/sem
    // vínculo NÃO volta como destino selecionado (fail-closed) — ele continua
    // visível apenas no painel de histórico da publicação.
    const clientIdOfPost =
      ((pls ?? []).find((p) => p.client_id)?.client_id as string | null) ?? null;
    const currentConnectionIds = new Set<string>();
    if (clientIdOfPost) {
      const { data: links } = await context.supabase
        .from("client_social_accounts")
        .select("connection_id")
        .eq("brand_id", data.brandId)
        .eq("client_id", clientIdOfPost);
      const linkedIds = (links ?? []).map((l) => l.connection_id as string);
      if (linkedIds.length) {
        const { data: conns } = await context.supabase
          .from("social_connections")
          .select("id")
          .eq("brand_id", data.brandId)
          .in("id", linkedIds)
          .eq("status", "active");
        for (const c of conns ?? []) currentConnectionIds.add(c.id as string);
      }
    }

    const destinations: WizardPostState["destinations"] = [];
    let hashtags: string[] = [];
    let firstComment: string | null = null;
    let linkUrl: string | null = null;
    let locationName: string | null = null;
    let locationId: string | null = null;
    const placementPaths: string[] = [];

    for (const pl of pls ?? []) {
      const co = (pl.copy_override ?? {}) as Record<string, unknown>;
      const connectionId = pl.connection_id as string | null;
      const channel = typeof co.channel === "string" ? (co.channel as string) : "";
      if (connectionId && channel && currentConnectionIds.has(connectionId)) {
        const options =
          co.options && typeof co.options === "object"
            ? normalizePlacementOptions(channel as never, pl.format as never, co.options)
            : undefined;
        destinations.push({
          connectionId,
          channel,
          format: pl.format as string,
          ...(options && hasPlacementOptions(options) ? { options } : {}),
        });
      }

      if (Array.isArray(co.hashtags) && !hashtags.length) {
        hashtags = (co.hashtags as unknown[]).filter((h): h is string => typeof h === "string");
      }
      if (typeof co.first_comment === "string" && !firstComment)
        firstComment = co.first_comment as string;
      if (typeof co.link === "string" && !linkUrl) linkUrl = co.link as string;
      if (typeof co.location_name === "string" && !locationName)
        locationName = co.location_name as string;
      if (typeof co.location_id === "string" && !locationId) locationId = co.location_id as string;
      for (const m of Array.isArray(pl.media) ? pl.media : []) {
        const rec = m as Record<string, unknown>;
        if (typeof rec?.storagePath === "string") placementPaths.push(rec.storagePath);
      }
    }

    // Fonte de verdade da mídia da peça: posts.reference_media (persistido no
    // save) com fallback nos placements (peças antigas).
    const refPaths = (Array.isArray(post.reference_media) ? post.reference_media : [])
      .map((r) => (r as Record<string, unknown>)?.path)
      .filter((p): p is string => typeof p === "string");
    const paths = Array.from(new Set([...refPaths, ...placementPaths]));

    let media: WizardPostState["media"] = [];
    if (paths.length) {
      const { data: assets, error: aErr } = await context.supabase
        .from("brand_media_assets")
        .select("id, storage_path, name, mime_type, kind")
        .eq("brand_id", data.brandId)
        .in("storage_path", paths);
      if (aErr) throw new Error(aErr.message);
      const byPath = new Map((assets ?? []).map((a) => [a.storage_path as string, a]));
      media = await Promise.all(
        paths.map(async (path) => {
          const a = byPath.get(path);
          const { data: signed } = await context.supabase.storage
            .from("brand-media")
            .createSignedUrl(path, 3600);
          const mime = (a?.mime_type as string | undefined) ?? "";
          const kind =
            (a?.kind as "image" | "video" | "other" | undefined) ??
            (/\.(mp4|mov|m4v|webm|3gp)$/i.test(path) ? "video" : "image");
          return {
            id: (a?.id as string | undefined) ?? path,
            storagePath: path,
            name: (a?.name as string | undefined) ?? path.split("/").pop() ?? path,
            mimeType: mime,
            kind,
            publicUrl: signed?.signedUrl ?? null,
          };
        }),
      );
    }

    return {
      postId: post.id as string,
      title: (post.title as string) ?? "",
      copy: (post.copy as string) ?? "",
      hashtags,
      firstComment,
      linkUrl,
      locationName,
      locationId,
      scheduledAt: (post.scheduled_at as string | null) ?? null,
      stage: (post.stage as string) ?? "idea",
      destinations,
      media,
    };
  });

const DestinationSchema = z.object({
  connectionId: z.string().uuid(),
  channel: z.enum(["instagram", "facebook", "linkedin", "tiktok", "youtube", "x", "threads"]),
  format: z.enum(["feed", "stories", "reels", "carrossel"]),
  copyOverride: z.string().nullable().optional(),
  /** Opções avançadas do destino — normalizadas no servidor. */
  options: z.record(z.string(), z.unknown()).nullable().optional(),
});

const SaveInput = z
  .object({
    postId: z.string().uuid().nullable().optional(),
    brandId: z.string().uuid(),
    clientId: z.string().uuid(),
    title: z.string().min(1).max(160),
    copy: z.string().default(""),
    mediaPaths: z.array(z.string()).default([]),
    // IDs de brand_media_assets na MESMA ordem de mediaPaths (opcional).
    mediaAssetIds: z.array(z.string()).default([]),

    hashtags: z.array(z.string()).default([]),
    firstComment: z.string().max(2200).nullable().optional(),
    linkUrl: z.string().url().nullable().optional(),
    locationName: z.string().max(120).nullable().optional(),
    locationId: z.string().max(64).nullable().optional(),
    destinations: z.array(DestinationSchema).default([]),
    scheduledAt: z.string().nullable().optional(), // ISO
    action: z.enum(["draft", "publish", "schedule", "save_draft"]),
  })
  .superRefine((v, ctx) => {
    if (v.action !== "save_draft" && v.destinations.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destinations"],
        message: "Selecione ao menos um canal.",
      });
    }
  });

export const saveScheduledPostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveInput.parse(i))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    // Regra dos 5 minutos (fonte única: @/lib/schedule-rules)
    let scheduledIso: string | null = null;
    if (data.action === "schedule") {
      if (!data.scheduledAt) throw new Error("Data de agendamento obrigatória");
      const scheduled = new Date(data.scheduledAt);
      if (Number.isNaN(scheduled.getTime())) {
        throw new Error("Data de agendamento inválida");
      }
      assertScheduleLead(scheduled);
      scheduledIso = scheduled.toISOString();
    }

    // Pré-validação de agendamento: antes de gravar o post como "scheduled",
    // conferimos que cada destino suportado tem conexão ativa, token presente
    // e vínculo com o cliente. Sem isso, o Kanban ficaria marcado como
    // agendado mesmo com a conexão social quebrada — e o cron nunca publicaria.
    type ValidatedScheduleTarget = {
      destination: (typeof data.destinations)[number];
      connection: { id: string; provider: string };
    };
    const validatedScheduleTargets: ValidatedScheduleTarget[] = [];
    const scheduleWarnings: Array<{ channel: string; format: string; error: string }> = [];
    if (data.action === "schedule") {
      const connIds = Array.from(new Set(data.destinations.map((d) => d.connectionId)));
      const { data: conns, error: connsErr } = await supabase
        .from("social_connections")
        .select("id, brand_id, channel, provider, status, access_token_ciphertext")
        .eq("brand_id", data.brandId)
        .in("id", connIds);
      if (connsErr) throw new Error(connsErr.message);
      const connMap = new Map((conns ?? []).map((c) => [c.id as string, c]));
      // Vínculo canal ↔ cliente: única fonte de verdade.
      const { data: links, error: linksErr } = await supabase
        .from("client_social_accounts")
        .select("connection_id")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId);
      if (linksErr) throw new Error(linksErr.message);
      const linkedIds = new Set(
        ((links ?? []) as Array<{ connection_id: string }>).map((l) => l.connection_id),
      );
      for (const d of data.destinations) {
        // Suportado hoje: Feed IG/FB, Carrossel IG/FB, Stories IG e Reels IG.
        const supported =
          (d.format === "feed" && (d.channel === "instagram" || d.channel === "facebook")) ||
          (d.format === "carrossel" && (d.channel === "instagram" || d.channel === "facebook")) ||
          (d.format === "stories" && d.channel === "instagram") ||
          (d.format === "reels" && d.channel === "instagram");
        if (!supported) {
          scheduleWarnings.push({
            channel: d.channel,
            format: d.format,
            error:
              "Formato ainda não agendável (Feed IG/FB, Carrossel IG/FB, Stories IG ou Reels IG)",
          });
          continue;
        }
        // Reels exige vídeo — sem isso o agendamento falharia só na hora do
        // disparo, deixando o operador achando que estava tudo certo.
        if (d.format === "reels" && !data.mediaPaths.some((m) => IS_VIDEO_PATH.test(m))) {
          scheduleWarnings.push({
            channel: d.channel,
            format: d.format,
            error: "Reels exige um vídeo (MP4) na peça. Anexe o vídeo antes de agendar.",
          });
          continue;
        }
        if (d.format === "carrossel" && data.mediaPaths.length < 2) {
          scheduleWarnings.push({
            channel: d.channel,
            format: d.format,
            error: "Carrossel exige pelo menos 2 mídias. Anexe mais mídias antes de agendar.",
          });
          continue;
        }

        const conn = connMap.get(d.connectionId);
        if (!conn) {
          throw new Error(
            `CONNECTION_SCOPE_MISMATCH: conexão ${d.channel} não pertence a esta marca.`,
          );
        }
        if (!conn.access_token_ciphertext) {
          throw new Error(`Conexão ${d.channel} sem token — reconecte a página antes de agendar.`);
        }
        if (!linkedIds.has(d.connectionId)) {
          throw new Error(
            `CONNECTION_SCOPE_MISMATCH: canal ${d.channel} não está vinculado a este cliente. Vincule em Perfil do cliente > Canais.`,
          );
        }
        // Plataforma da conexão precisa bater com o canal do destino — nunca
        // publicar um destino Instagram numa conexão Facebook (ou vice-versa).
        if ((conn as { channel?: string | null }).channel !== d.channel) {
          throw new Error(
            `CONNECTION_SCOPE_MISMATCH: conexão selecionada é de ${(conn as { channel?: string | null }).channel ?? "canal desconhecido"}, mas o destino é ${d.channel}.`,
          );
        }
        if (conn.status !== "active") {
          throw new Error(`Conexão ${d.channel} não está ativa — reconecte antes de agendar.`);
        }
        // PRÉ-FLIGHT de autorização granular da Meta: só agenda se a Meta
        // autorizou a publicação PARA ESTA conta (target_id). Fail closed.
        const { resolvePublishTarget } = await import("@/lib/meta/publish-capability.server");
        const { capability } = await resolvePublishTarget(supabase, {
          brandId: data.brandId,
          clientId: data.clientId,
          connectionId: d.connectionId,
          channel: d.channel,
          format: d.format,
        });
        if (!capability.publishReady) {
          throw new Error(capability.message);
        }
        validatedScheduleTargets.push({
          destination: d,
          connection: {
            id: conn.id as string,
            provider: conn.provider as string,
          },
        });
      }
      if (validatedScheduleTargets.length === 0) {
        throw new Error(
          scheduleWarnings[0]?.error ??
            "Nenhum destino suportado para agendamento (Feed IG/FB, Stories IG ou Reels IG).",
        );
      }
    }

    // Canais únicos (post.channels usa enum post_channel — filtra os aceitos)
    const channels = deriveChannelsFromDestinations(data.destinations);

    const stage =
      data.action === "schedule"
        ? "scheduled"
        : data.action === "publish"
          ? "approved"
          : data.action === "save_draft"
            ? "idea"
            : "approved";

    // ---- Upsert post ----
    let postId = data.postId ?? null;
    const targetConnIds = deriveTargetConnectionIds(data.destinations);
    // Mídia da peça persistida na própria peça (fonte de verdade para reabrir
    // o rascunho): reference_media = [{ path, bucket, assetId }].
    const referenceMedia = data.mediaPaths.map((path, i) => ({
      path,
      bucket: "brand-media",
      ...(data.mediaAssetIds[i] ? { assetId: data.mediaAssetIds[i] } : {}),
    }));
    if (!postId) {
      const { data: inserted, error } = await supabase
        .from("posts")
        .insert({
          brand_id: data.brandId,
          client_id: data.clientId,
          title: data.title,
          copy: data.copy,
          channels,
          target_connection_ids: targetConnIds,
          reference_media: referenceMedia as never,
          stage,
          scheduled_at: scheduledIso,
          created_by: context.userId,
          approved_at: data.action === "save_draft" ? null : new Date().toISOString(),
          review_status: data.action === "save_draft" ? "pending" : "approved",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      postId = inserted.id as string;
    } else {
      const { error } = await supabase
        .from("posts")
        .update({
          title: data.title,
          copy: data.copy,
          channels,
          target_connection_ids: targetConnIds,
          reference_media: referenceMedia as never,
          stage,
          scheduled_at: scheduledIso,
        })
        .eq("id", postId)
        .eq("brand_id", data.brandId);
      if (error) throw new Error(error.message);
    }

    // ---- Estágio operacional (stage_id) acompanha a ação ----
    // O wizard historicamente escrevia só o campo legado `posts.stage`, o que
    // deixava a peça parada na coluna antiga do Kanban. Aqui movemos a coluna
    // real do pipeline da peça (quando existir equivalente).
    {
      const { data: row } = await supabase
        .from("posts")
        .select("pipeline_id, stage_id")
        .eq("id", postId)
        .maybeSingle();
      const pipelineId = (row?.pipeline_id as string | null) ?? null;
      const keys =
        data.action === "schedule"
          ? ["scheduled"]
          : data.action === "save_draft"
            ? ["idea", "briefing"]
            : ["approved"];
      const stageId = await resolveStageIdByKey(supabase, pipelineId, keys);
      if (stageId && stageId !== (row?.stage_id as string | null)) {
        await supabase
          .from("posts")
          .update({ stage_id: stageId } as never)
          .eq("id", postId)
          .eq("brand_id", data.brandId);
      }
    }

    // ---- Guarda de escopo: destino precisa estar vinculado ao cliente ----
    // Sem isso, o trigger validate_placement_connection derruba o save com um
    // erro cru de banco (tela branca). Acontece quando a peça foi restaurada
    // com um canal que depois foi desvinculado do cliente.
    if (data.destinations.length > 0) {
      const { data: scopeLinks, error: scopeErr } = await supabase
        .from("client_social_accounts")
        .select("connection_id")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId);
      if (scopeErr) throw new Error(scopeErr.message);
      const scopedIds = new Set(
        ((scopeLinks ?? []) as Array<{ connection_id: string }>).map((l) => l.connection_id),
      );
      const orphan = data.destinations.filter((d) => !scopedIds.has(d.connectionId));
      if (orphan.length > 0) {
        const labels = Array.from(new Set(orphan.map((d) => d.channel))).join(", ");
        throw new Error(
          `Destino inválido: o canal ${labels} não está mais vinculado a este cliente. Remova o destino ou vincule a conta em Perfil do cliente > Canais.`,
        );
      }
    }

    // ---- Sync placements por (channel, format) via helper compartilhado ----
    await syncPostPlacements(supabase, {
      postId,
      brandId: data.brandId,
      clientId: data.clientId,
      destinations: data.destinations,
      mediaPaths: data.mediaPaths,
      hashtags: data.hashtags,
      firstComment: data.firstComment ?? null,
      linkUrl: data.linkUrl ?? null,
      locationName: data.locationName ?? null,
      locationId: data.locationId ?? null,
      scheduledIso,
      status: data.action === "schedule" ? "scheduled" : "draft",
    });

    // ---- Agendar: cria linhas em social_posts para o worker pg_cron drenar ----
    // Sem isso, o horário passa e nada é publicado (Kanban fica "Agendado" para sempre).
    if (data.action === "schedule" && scheduledIso) {
      // Reagendamento de peça já agendada: limpa a fila pendente antes de
      // re-enfileirar (evita duplicidade e conflito de índice único).
      // Inclui linhas `publishing` órfãs (sem lock de worker) — sem isso o
      // índice `social_posts_active_dest_key` recusa a nova inserção.
      await supabase
        .from("social_posts")
        .update({ status: "cancelled" })
        .eq("post_id", postId)
        .eq("brand_id", data.brandId)
        .in("status", ["scheduled", "failed", "publishing"])
        .is("publish_locked_at", null);


      // Formatos ainda não agendáveis viram avisos (mesmo padrão da branch publish).
      const enqueueResults: Array<{
        channel: string;
        format: string;
        ok: boolean;
        error?: string;
      }> = scheduleWarnings.map((w) => ({ ...w, ok: false }));

      for (const { destination: d, connection: conn } of validatedScheduleTargets) {
        const isStory = d.format === "stories";
        const isReel = d.format === "reels";
        const isCarousel = d.format === "carrossel";
        // Stories NUNCA carrega caption (Meta API ignora / retorna erro).
        const caption = isStory
          ? null
          : [
              d.copyOverride ?? data.copy,
              ...(data.hashtags.length
                ? [data.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")]
                : []),
            ]
              .filter(Boolean)
              .join("\n\n")
              .trim() || null;

        // Stories multi-frame: 1 social_posts por mídia, +1 minuto por frame.
        // Carrossel: 1 linha com todas as mídias. Feed/Reels: 1 linha.
        const frames =
          isStory && data.mediaPaths.length > 0
            ? data.mediaPaths
            : isReel
              ? [data.mediaPaths.find((m) => IS_VIDEO_PATH.test(m))]
              : [data.mediaPaths[0] as string | undefined];
        const baseMs = new Date(scheduledIso!).getTime();

        let frameErr: string | null = null;
        for (let i = 0; i < frames.length; i++) {
          const path = frames[i];
          const destOptions = normalizePlacementOptions(
            d.channel as never,
            d.format as never,
            (d as { options?: unknown }).options,
          );
          const optionsPart = hasPlacementOptions(destOptions) ? { options: destOptions } : {};
          const media = isCarousel
            ? {
                storagePaths: data.mediaPaths.slice(0, 10),
                ...(data.linkUrl ? { link: data.linkUrl } : {}),
                ...optionsPart,
              }
            : path
              ? {
                  storagePath: path,
                  ...(isStory ? {} : data.linkUrl ? { link: data.linkUrl } : {}),
                  ...optionsPart,
                }
              : !isStory && data.linkUrl
                ? { link: data.linkUrl, ...optionsPart }
                : { ...optionsPart };
          const frameIso = new Date(baseMs + i * 60_000).toISOString();
          const { error: spErr } = await supabase.from("social_posts").insert({
            brand_id: data.brandId,
            client_id: data.clientId,
            connection_id: d.connectionId,
            provider: conn.provider,
            placement: isStory ? "story" : isReel ? "reel" : isCarousel ? "carousel" : "feed",

            caption: isStory ? null : caption,
            hashtags: isStory ? [] : data.hashtags,
            mentions: [],
            media,
            post_id: postId,
            status: "scheduled",
            scheduled_at: frameIso,
            created_by: context.userId,
            location_id: isStory ? null : (data.locationId ?? null),
          });
          if (spErr) {
            frameErr = describeQueueInsertError(spErr.message, d.channel, d.format);
            break;
          }
        }
        if (frameErr) {
          // Rollback: o post não pode ficar como "scheduled" no Kanban se não
          // conseguimos enfileirar todas as publicações — o cron não vai
          // publicar e o usuário ficaria com um agendamento fantasma.
          await supabase
            .from("social_posts")
            .delete()
            .eq("post_id", postId)
            .eq("status", "scheduled");
          await supabase
            .from("posts")
            .update({ stage: "approved", scheduled_at: null })
            .eq("id", postId)
            .eq("brand_id", data.brandId);
          throw new Error(`Falha ao agendar ${d.channel}: ${frameErr}`);
        }

        enqueueResults.push({ channel: d.channel, format: d.format, ok: true });
      }

      return {
        ok: true,
        postId,
        scheduled: validatedScheduleTargets.length,
        results: enqueueResults,
      };
    }

    // ---- Publicar agora: dispara Meta para cada destino suportado ----
    if (data.action === "publish") {
      const { MetaPublishingService, formatPublishError } =
        await import("@/lib/meta/publishing.server");
      const svc = new MetaPublishingService();
      // Vínculo canal ↔ cliente (client_social_accounts) = fonte de verdade.
      const { data: pubLinks, error: pubLinksErr } = await supabase
        .from("client_social_accounts")
        .select("connection_id")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId);
      if (pubLinksErr) throw new Error(pubLinksErr.message);
      const publishLinkedIds = new Set(
        ((pubLinks ?? []) as Array<{ connection_id: string }>).map((l) => l.connection_id),
      );
      const results: Array<{
        channel: string;
        format: string;
        ok: boolean;
        error?: string;
        permalink?: string | null;
        connectionId?: string;
      }> = [];
      for (const d of data.destinations) {
        // Publicação direta: Feed IG/FB, Stories IG (multi-frame), Reels IG e
        // Carrossel (IG: até 10 mídias; FB: álbum de fotos via attached_media).
        const supported =
          (d.format === "feed" && (d.channel === "instagram" || d.channel === "facebook")) ||
          (d.format === "carrossel" && (d.channel === "instagram" || d.channel === "facebook")) ||
          (d.format === "stories" && d.channel === "instagram") ||
          (d.format === "reels" && d.channel === "instagram");
        if (!supported) {
          results.push({
            channel: d.channel,
            format: d.format,
            ok: false,
            error: "Formato ainda não publicável (Feed IG/FB, Carrossel IG/FB, Stories IG ou Reels IG)",
          });
          continue;
        }
        const isStory = d.format === "stories";
        const isReel = d.format === "reels";
        const isCarousel = d.format === "carrossel";
        if (isReel && !data.mediaPaths.some((m) => IS_VIDEO_PATH.test(m))) {
          results.push({
            channel: d.channel,
            format: d.format,
            ok: false,
            error: "Reels exige um vídeo (MP4) na peça. Anexe o vídeo antes de publicar.",
          });
          continue;
        }
        if (isCarousel && data.mediaPaths.length < 2) {
          results.push({
            channel: d.channel,
            format: d.format,
            ok: false,
            error: "Carrossel exige pelo menos 2 mídias. Anexe mais mídias antes de publicar.",
          });
          continue;
        }
        // Valor persistido em social_posts.placement (CHECK constraint) e enviado
        // ao provider como identificador de superfície.
        const providerPlacement:
          | "instagram_feed"
          | "facebook_feed"
          | "instagram_story"
          | "instagram_reels"
          | "instagram_carousel"
          | "facebook_carousel" = isStory
          ? "instagram_story"
          : isReel
            ? "instagram_reels"
            : isCarousel
              ? d.channel === "instagram"
                ? "instagram_carousel"
                : "facebook_carousel"
              : d.channel === "instagram"
                ? "instagram_feed"
                : "facebook_feed";
        const dbPlacement: "feed" | "story" | "reel" | "carousel" = isStory
          ? "story"
          : isReel
            ? "reel"
            : isCarousel
              ? "carousel"
              : "feed";

        try {
          // Carrega conexão do workspace (a marca é a dona do canal)
          const { data: conn, error: connErr } = await supabase
            .from("social_connections")
            .select(
              "id, brand_id, channel, provider, external_id, account_id, access_token_ciphertext, status",
            )
            .eq("id", d.connectionId)
            .eq("brand_id", data.brandId)
            .maybeSingle();
          if (connErr) throw new Error(connErr.message);
          if (!conn) {
            throw new Error("CONNECTION_SCOPE_MISMATCH: conexão não pertence a esta marca");
          }
          if (!conn.access_token_ciphertext)
            throw new Error("Conexão sem token — reconecte a página");
          if (!publishLinkedIds.has(d.connectionId)) {
            throw new Error("CONNECTION_SCOPE_MISMATCH: canal não vinculado a este cliente");
          }
          if ((conn as { channel?: string | null }).channel !== d.channel) {
            throw new Error(
              `CONNECTION_SCOPE_MISMATCH: conexão é de ${(conn as { channel?: string | null }).channel ?? "canal desconhecido"}, destino é ${d.channel}`,
            );
          }
          if (conn.status !== "active") {
            throw new Error("Conexão não está ativa — reconecte antes de publicar");
          }
          if (isStory && (conn as { channel?: string | null }).channel !== "instagram") {
            throw new Error("Stories só é suportado no Instagram");
          }
          if (!(conn as { account_id?: string | null }).account_id && d.channel === "instagram") {
            throw new Error("Conexão sem conta Instagram Business vinculada");
          }
          // PRÉ-FLIGHT: autorização granular da Meta para ESTA conta.
          {
            const { resolvePublishTarget } = await import("@/lib/meta/publish-capability.server");
            const { capability } = await resolvePublishTarget(supabase, {
              brandId: data.brandId,
              clientId: data.clientId,
              connectionId: d.connectionId,
              channel: d.channel,
              format: d.format,
            });
            if (!capability.publishReady) throw new Error(capability.message);
          }

          // Item pendente do MESMO destino (por exemplo, adiado por limite de
          // requisições da Meta) impede a inserção pelo índice único de destino
          // ativo. Encerramos o pendente — nunca linha publicada nem linha
          // travada por worker em execução.
          await supabase
            .from("social_posts")
            .update({ status: "cancelled" })
            .eq("post_id", postId)
            .eq("brand_id", data.brandId)
            .eq("connection_id", d.connectionId)
            .eq("placement", dbPlacement)
            .in("status", ["scheduled", "failed", "publishing"])
            .is("publish_locked_at", null);


          // Stories multi-frame: publica cada mídia como um Story separado.
          // Carrossel: 1 chamada com todas as mídias (na ordem da peça).
          // Feed/Reels: 1 chamada, primeira mídia.
          const frames =
            isStory && data.mediaPaths.length > 0
              ? data.mediaPaths
              : isReel
                ? [data.mediaPaths.find((m) => IS_VIDEO_PATH.test(m))]
                : [data.mediaPaths[0] as string | undefined];

          // Assina TODAS as mídias do carrossel (a peça inteira é um post só).
          const signPath = async (p: string) => {
            if (!p.startsWith(`${data.brandId}/`))
              throw new Error("Mídia fora do escopo da marca");
            const { data: signed, error: sErr } = await supabase.storage
              .from("brand-media")
              .createSignedUrl(p, 3600);
            if (sErr) throw new Error(`Falha ao assinar mídia: ${sErr.message}`);
            return signed.signedUrl;
          };
          const carouselItems: Array<{ imageUrl?: string; videoUrl?: string }> = [];
          if (isCarousel) {
            for (const p of data.mediaPaths.slice(0, 10)) {
              const url = await signPath(p);
              carouselItems.push(IS_VIDEO_PATH.test(p) ? { videoUrl: url } : { imageUrl: url });
            }
          }


          const caption = isStory
            ? undefined
            : [
                data.copy,
                ...(data.hashtags.length
                  ? [data.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")]
                  : []),
              ]
                .filter(Boolean)
                .join("\n\n")
                .trim() || undefined;

          let lastPermalink: string | null = null;
          for (const path of frames) {
            // Resolve mídia por frame (signed URL curta).
            const mediaOut: {
              imageUrl?: string;
              videoUrl?: string;
              link?: string;
              items?: Array<{ imageUrl?: string; videoUrl?: string }>;
            } = {};
            if (!isStory && data.linkUrl) mediaOut.link = data.linkUrl;
            if (isCarousel) {
              mediaOut.items = carouselItems;
              if (carouselItems[0]?.imageUrl) mediaOut.imageUrl = carouselItems[0].imageUrl;
            } else if (path) {
              const url = await signPath(path);
              if (IS_VIDEO_PATH.test(path)) mediaOut.videoUrl = url;
              else mediaOut.imageUrl = url;
            }
            if (providerPlacement === "instagram_feed" && !mediaOut.imageUrl) {
              throw new Error("Feed do Instagram exige uma imagem");
            }
            if (
              providerPlacement === "instagram_story" &&
              !mediaOut.imageUrl &&
              !mediaOut.videoUrl
            ) {
              throw new Error("Stories exige imagem ou vídeo");
            }
            if (providerPlacement === "instagram_reels" && !mediaOut.videoUrl) {
              throw new Error("Reels exige um vídeo (MP4) na peça.");
            }
            if (isCarousel && carouselItems.length < 2) {
              throw new Error("Carrossel exige pelo menos 2 mídias na peça.");
            }

            // Registro de auditoria em social_posts (1 por frame)
            const { data: sp, error: spErr } = await supabase
              .from("social_posts")
              .insert({
                brand_id: data.brandId,
                client_id: data.clientId,
                connection_id: d.connectionId,
                provider: conn.provider,
                placement: dbPlacement,
                caption: caption ?? null,
                hashtags: isStory ? [] : data.hashtags,
                mentions: [],
                media: isCarousel
                  ? {
                      storagePaths: data.mediaPaths.slice(0, 10),
                      ...(data.linkUrl ? { link: data.linkUrl } : {}),
                    }
                  : path
                    ? {
                        storagePath: path,
                        ...(!isStory && data.linkUrl ? { link: data.linkUrl } : {}),
                      }
                    : !isStory && data.linkUrl
                      ? { link: data.linkUrl }
                      : {},

                post_id: postId,
                status: "publishing",
                created_by: context.userId,
                location_id: isStory ? null : (data.locationId ?? null),
              })
              .select("id")
              .single();
            if (spErr) throw new Error(describeQueueInsertError(spErr.message, d.channel, d.format));


            try {
              const publishOptions = normalizePlacementOptions(
                d.channel as never,
                d.format as never,
                (d as { options?: unknown }).options,
              );
              const result = await svc.publish(conn as any, {
                placement: providerPlacement,
                caption,
                media: mediaOut,
                ...(hasPlacementOptions(publishOptions) ? { options: publishOptions } : {}),
              });
              await supabase
                .from("social_posts")
                .update({
                  status: "published",
                  published_at: new Date().toISOString(),
                  external_post_id: result.externalPostId,
                  external_permalink: result.externalPermalink,
                  provider_response: result.providerResponse as any,
                  last_error: null,
                })
                .eq("id", sp.id);
              lastPermalink = result.externalPermalink;
            } catch (err) {
              const msg = formatPublishError(err);
              await supabase
                .from("social_posts")
                .update({ status: "failed", last_error: msg })
                .eq("id", sp.id);
              throw new Error(msg);
            }
          }
          results.push({
            channel: d.channel,
            format: d.format,
            ok: true,
            permalink: lastPermalink,
            connectionId: d.connectionId,
          });
        } catch (err) {
          results.push({
            channel: d.channel,
            format: d.format,
            ok: false,
            error: (err as Error).message,
            connectionId: d.connectionId,
          });
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.filter((r) => !r.ok).length;
      if (okCount > 0) {
        const nowIso = new Date().toISOString();
        // Placements viram histórico por DESTINO REAL (post + canal + formato).
        for (const r of results) {
          if (!r.connectionId) continue;
          await supabase
            .from("post_placements")
            .update(
              (r.ok
                ? { status: "published", published_at: nowIso }
                : { status: "failed" }) as never,
            )
            .eq("post_id", postId)
            .eq("connection_id", r.connectionId)
            .eq("format", r.format)
            .neq("status", "published");
        }

        // PUBLICAÇÃO PARCIAL: a peça só vira `published` quando TODOS os
        // destinos publicaram. Com qualquer falha, a peça NÃO é publicada — o
        // estado real fica visível pelos placements ("Publicação parcial").
        // O caminho canônico é o trigger `trg_social_posts_sync_publication`
        // → `sync_post_publication_state`, que já aplica a mesma regra.
        if (failCount === 0) {
          await supabase
            .from("posts")
            .update({ stage: "published", published_at: nowIso } as any)
            .eq("id", postId)
            .eq("brand_id", data.brandId);
        }
      }

      return { ok: okCount > 0, postId, published: okCount, results };
    }

    return { ok: true, postId };
  });

// ============================================================
// deleteDraftPostFn — remove rascunho (stage=idea) do wizard
// ============================================================

export const deleteDraftPostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        brandId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Confirma que é rascunho antes de deletar (evita apagar post publicado/agendado).
    const { data: row, error: rErr } = await context.supabase
      .from("posts")
      .select("id, stage")
      .eq("id", data.postId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!row) throw new Error("Rascunho não encontrado.");
    if (row.stage !== "idea") {
      throw new Error("Apenas rascunhos podem ser excluídos por aqui.");
    }
    // Placements dependem do post — remove primeiro por segurança se não houver cascade.
    await context.supabase.from("post_placements").delete().eq("post_id", data.postId);
    const { error } = await context.supabase
      .from("posts")
      .delete()
      .eq("id", data.postId)
      .eq("brand_id", data.brandId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// deleteApprovedPostFn — remove post aprovado aguardando agendamento
// ============================================================

export const deleteApprovedPostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        brandId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error: rErr } = await context.supabase
      .from("posts")
      .select("id, stage")
      .eq("id", data.postId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!row) throw new Error("Post não encontrado ou sem permissão.");
    // Bloqueia exclusão quando há publicações em andamento ou já publicadas.
    const { data: spRows, error: spErr } = await context.supabase
      .from("social_posts")
      .select("id, status")
      .eq("post_id", data.postId);
    if (spErr) throw new Error(spErr.message);
    const blocking = (spRows ?? []).filter((r) => r.status && r.status !== "scheduled");
    if (blocking.length > 0) {
      throw new Error("Não é possível excluir: já existem publicações em andamento ou publicadas.");
    }
    // Ordem: social_posts (scheduled) → placements → posts
    await context.supabase.from("social_posts").delete().eq("post_id", data.postId);
    await context.supabase.from("post_placements").delete().eq("post_id", data.postId);
    const { error } = await context.supabase
      .from("posts")
      .delete()
      .eq("id", data.postId)
      .eq("brand_id", data.brandId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
// cancelPostScheduleFn — cancela o agendamento SEM apagar conteúdo
// ============================================================
// Regras:
//  - Não deleta post, placements, mídia nem social_posts (apenas muda status).
//  - Proteção contra corrida: se o worker já reivindicou (publish_locked_at)
//    ou está em `publishing`/`published`, o cancelamento é recusado.
//  - Devolve a peça para um estado editável (stage/scheduled_at coerentes).

export const cancelPostScheduleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ postId: z.string().uuid(), brandId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const { data: post, error: pErr } = await supabase
      .from("posts")
      .select("id, stage, pipeline_id, stage_id")
      .eq("id", data.postId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!post) throw new Error("Peça não encontrada.");

    const { data: spRows, error: spErr } = await supabase
      .from("social_posts")
      .select("id, status, publish_locked_at, scheduled_at")
      .eq("post_id", data.postId)
      .eq("brand_id", data.brandId);
    if (spErr) throw new Error(spErr.message);
    const rows = spRows ?? [];

    if (rows.some((r) => r.status === "published")) {
      throw new Error("Esta peça já foi publicada — não é possível cancelar o agendamento.");
    }
    const inFlight = rows.filter((r) => r.status === "publishing" || !!r.publish_locked_at);
    if (inFlight.length > 0) {
      throw new Error(
        "A publicação já está em processamento pelo worker. Aguarde a conclusão antes de cancelar.",
      );
    }

    // 1) Fila: scheduled/failed → cancelled (só se ainda não reivindicado).
    const cancellable = rows.filter((r) => r.status === "scheduled" || r.status === "failed");
    let cancelledCount = 0;
    if (cancellable.length > 0) {
      const { data: updated, error: uErr } = await supabase
        .from("social_posts")
        .update({ status: "cancelled" })
        .in(
          "id",
          cancellable.map((r) => r.id as string),
        )
        .is("publish_locked_at", null)
        .in("status", ["scheduled", "failed"])
        .select("id");
      if (uErr) throw new Error(uErr.message);
      cancelledCount = (updated ?? []).length;
      if (cancelledCount < cancellable.length) {
        throw new Error(
          "A publicação foi reivindicada pelo worker durante o cancelamento. Recarregue e tente novamente.",
        );
      }
    }

    // 2) Placements voltam para rascunho (nunca mexe nos já publicados).
    const { error: plErr } = await supabase
      .from("post_placements")
      .update({ status: "draft", scheduled_at: null })
      .eq("post_id", data.postId)
      .neq("status", "published");
    if (plErr) throw new Error(plErr.message);

    // 3) Peça volta a um estado editável, preservando copy/mídia/briefings.
    const { error: postErr } = await supabase
      .from("posts")
      .update({ stage: "approved", scheduled_at: null })
      .eq("id", data.postId)
      .eq("brand_id", data.brandId);
    if (postErr) throw new Error(postErr.message);

    const stageId = await resolveStageIdByKey(
      supabase,
      (post.pipeline_id as string | null) ?? null,
      ["approved"],
    );
    if (stageId && stageId !== (post.stage_id as string | null)) {
      await supabase
        .from("posts")
        .update({ stage_id: stageId } as never)
        .eq("id", data.postId)
        .eq("brand_id", data.brandId);
    }

    return { ok: true, cancelledQueueItems: cancelledCount };
  });
