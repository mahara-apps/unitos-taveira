import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { describeQueueInsertError } from "@/lib/social/queue-conflict";

/**
 * Publicação parcial e republicação por DESTINO.
 *
 * Regra funcional: uma peça só é `published` quando TODOS os destinos
 * publicaram (garantido no banco por `sync_post_publication_state`). Quando
 * parte falha, a peça fica em "publicação parcial" e cada destino com falha
 * pode ser reenfileirado individualmente.
 *
 * A republicação NÃO publica direto no provider: ela apenas recoloca UMA linha
 * em `social_posts` (status `scheduled`) para o worker existente
 * (`/api/public/meta/publish-scheduled`) drenar, reaproveitando claim/lock e
 * retry já implementados. Idempotência extra vem do índice único
 * `social_posts_active_dest_key (post_id, connection_id, placement)`.
 */

export type PublicationDestinationState = {
  placementId: string;
  connectionId: string | null;
  channel: string;
  accountLabel: string;
  format: string;
  /** published | failed | awaiting_retry | scheduled | publishing | draft */
  status: string;
  publishedAt: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  canRetry: boolean;
  /**
   * true quando a conexão do placement não existe mais / não está ativa / não
   * está mais vinculada ao cliente. Nesse caso o destino é HISTÓRICO: não pode
   * ser publicado nem tratado como destino atual (fail-closed).
   */
  historical: boolean;
  /** Destino histórico recuperável: falhou e precisa de conta atual. */
  needsRebind: boolean;
  /** Quando o item na fila está aguardando nova tentativa, o horário previsto. */
  nextAttemptAt: string | null;
  /** Item pendente pode ser cancelado da fila (libera reagendamento imediato). */
  canCancelQueue: boolean;
};


/** Conta atualmente vinculada ao cliente (única fonte de destinos atuais). */
export type AvailableTarget = {
  connectionId: string;
  channel: string;
  accountLabel: string;
  handle: string | null;
  externalId: string | null;
};

export type PublicationState = {
  postId: string;
  /** none | pending | partial | published */
  overall: "none" | "pending" | "partial" | "published";
  postStage: string | null;
  destinations: PublicationDestinationState[];
  /** workspace → cliente → client_social_accounts → social_connections */
  availableTargets: AvailableTarget[];
};

const familyOf = (format: string) =>
  format === "stories"
    ? "story"
    : format === "reels"
      ? "reel"
      : format === "carrossel"
        ? "carousel"
        : "feed";

// ============================================================
// listPostPublicationStateFn
// ============================================================

export const listPostPublicationStateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ postId: z.string().uuid(), brandId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<PublicationState> => {
    const supabase = context.supabase;

    const { data: post, error: pErr } = await supabase
      .from("posts")
      .select("id, stage")
      .eq("id", data.postId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!post) throw new Error("Peça não encontrada.");

    const { data: placements, error: plErr } = await supabase
      .from("post_placements")
      .select("id, format, status, connection_id, published_at, client_id, copy_override")
      .eq("post_id", data.postId)
      .eq("brand_id", data.brandId);
    if (plErr) throw new Error(plErr.message);

    const { data: queue, error: qErr } = await supabase
      .from("social_posts")
      .select(
        "id, connection_id, placement, status, last_error, publish_attempts, published_at, external_permalink, next_attempt_at, deferred_since, publish_locked_at",
      )

      .eq("post_id", data.postId)
      .eq("brand_id", data.brandId);
    if (qErr) throw new Error(qErr.message);
    const rows = queue ?? [];

    // ---- Destinos ATUAIS: workspace → cliente → client_social_accounts ----
    const clientId =
      ((placements ?? []).find((p) => p.client_id)?.client_id as string | null) ?? null;
    const availableTargets: AvailableTarget[] = [];
    const currentByConnection = new Map<string, AvailableTarget>();
    if (clientId) {
      const { data: links, error: lErr } = await supabase
        .from("client_social_accounts")
        .select("connection_id")
        .eq("brand_id", data.brandId)
        .eq("client_id", clientId);
      if (lErr) throw new Error(lErr.message);
      const linkedIds = (links ?? []).map((l) => l.connection_id as string);
      if (linkedIds.length) {
        const { data: conns, error: cErr } = await supabase
          .from("social_connections")
          .select("id, channel, external_name, account_username, external_id, account_id")
          .eq("brand_id", data.brandId)
          .in("id", linkedIds)
          .eq("status", "active");
        if (cErr) throw new Error(cErr.message);
        for (const c of conns ?? []) {
          const t: AvailableTarget = {
            connectionId: c.id as string,
            channel: (c.channel as string) ?? "",
            accountLabel:
              (c.account_username as string | null) ??
              (c.external_name as string | null) ??
              "Conta",
            handle: (c.account_username as string | null) ?? null,
            externalId: (c.account_id as string | null) ?? (c.external_id as string | null) ?? null,
          };
          availableTargets.push(t);
          currentByConnection.set(t.connectionId, t);
        }
      }
    }

    // Rótulo histórico (conexão pode não existir mais) — só apresentação.
    const connIds = Array.from(
      new Set(
        (placements ?? [])
          .map((p) => p.connection_id as string | null)
          .filter((v): v is string => !!v),
      ),
    );
    const connMap = new Map<string, { channel: string; label: string; status: string }>();
    if (connIds.length) {
      const { data: conns } = await supabase
        .from("social_connections")
        .select("id, channel, external_name, account_username, status")
        .eq("brand_id", data.brandId)
        .in("id", connIds);
      for (const c of conns ?? []) {
        connMap.set(c.id as string, {
          channel: (c.channel as string) ?? "",
          label:
            (c.account_username as string | null) ?? (c.external_name as string | null) ?? "Conta",
          status: (c.status as string) ?? "",
        });
      }
    }

    const destinations: PublicationDestinationState[] = (placements ?? []).map((pl) => {
      const connectionId = (pl.connection_id as string | null) ?? null;
      const conn = connectionId ? connMap.get(connectionId) : undefined;
      const co = (pl.copy_override ?? {}) as Record<string, unknown>;
      const historicChannel = typeof co.channel === "string" ? (co.channel as string) : "";
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
      const failed = mine.find((r) => r.status === "failed");
      const blocked = mine.find((r) => r.status === "blocked");
      const inFlight = mine.find((r) => r.status === "scheduled" || r.status === "publishing");
      const plStatus = (pl.status as string) ?? "draft";
      // AGUARDANDO NOVA TENTATIVA: item continua na fila após um erro temporário
      // (limite de requisições da rede social). Não é falha e não pode ser
      // reenfileirado — o índice de destino ativo recusaria a nova linha.
      const awaitingRetry =
        !published &&
        !!inFlight &&
        (inFlight.status as string) === "scheduled" &&
        (!!inFlight.next_attempt_at ||
          !!inFlight.deferred_since ||
          Number(inFlight.publish_attempts ?? 0) > 0 ||
          !!inFlight.last_error);
      const status = published
        ? "published"
        : awaitingRetry
          ? "awaiting_retry"
          : inFlight
            ? (inFlight.status as string)
            : blocked || plStatus === "connection_required" || plStatus === "authorization_required"
              ? plStatus === "authorization_required"
                ? "authorization_required"
                : "connection_required"
              : failed
                ? "failed"
                : plStatus;
      // HISTÓRICO: conexão inexistente, inativa ou sem vínculo atual com o
      // cliente. Nunca tratado como destino publicável (fail-closed).
      const historical = !connectionId || !currentByConnection.has(connectionId);
      return {
        placementId: pl.id as string,
        connectionId,
        channel: conn?.channel || historicChannel,
        accountLabel: conn?.label ?? "Conta removida",
        format: pl.format as string,
        status,
        publishedAt:
          (published?.published_at as string | null) ?? (pl.published_at as string | null) ?? null,
        permalink: (published?.external_permalink as string | null) ?? null,
        error: published
          ? null
          : ((blocked?.last_error as string | null) ??
            (failed?.last_error as string | null) ??
            (awaitingRetry ? ((inFlight?.last_error as string | null) ?? null) : null)),
        attempts: Number(failed?.publish_attempts ?? inFlight?.publish_attempts ?? 0),
        canRetry:
          !published &&
          !inFlight &&
          !historical &&
          (status === "failed" ||
            status === "connection_required" ||
            status === "authorization_required") &&
          !!connectionId,
        historical,
        needsRebind: !published && !inFlight && historical,
        nextAttemptAt: awaitingRetry ? ((inFlight?.next_attempt_at as string | null) ?? null) : null,
        canCancelQueue:
          !published && !!inFlight && !inFlight.publish_locked_at && !historical && !!connectionId,
      };

    });

    const anyPublished = destinations.some((d) => d.status === "published");
    const allPublished =
      destinations.length > 0 && destinations.every((d) => d.status === "published");
    const overall: PublicationState["overall"] = allPublished
      ? "published"
      : anyPublished
        ? "partial"
        : destinations.length
          ? "pending"
          : "none";

    return {
      postId: data.postId,
      overall,
      postStage: (post.stage as string | null) ?? null,
      destinations,
      availableTargets,
    };
  });

// ============================================================
// rebindPlacementConnectionFn — reconecta destino HISTÓRICO a uma conta ATUAL
// ============================================================

/**
 * Recuperação operacional de um destino histórico: aponta o placement para uma
 * conexão ATUALMENTE vinculada ao cliente, escolhida explicitamente pelo
 * usuário (nunca por username/nome). O histórico publicado nunca é tocado e a
 * ação fica registrada em `activity_events`.
 */
export const rebindPlacementConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        brandId: z.string().uuid(),
        placementId: z.string().uuid(),
        connectionId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    const { data: pl, error: plErr } = await supabase
      .from("post_placements")
      .select("id, client_id, format, status, connection_id, copy_override")
      .eq("id", data.placementId)
      .eq("post_id", data.postId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (plErr) throw new Error(plErr.message);
    if (!pl) throw new Error("Destino não encontrado nesta peça.");
    if ((pl.status as string) === "published") {
      throw new Error("Este destino já foi publicado — nada a recuperar.");
    }

    const clientId = pl.client_id as string | null;
    if (!clientId) {
      throw new Error("Peça sem cliente definido — reabra a peça e selecione o cliente.");
    }

    // Vínculo atual é a ÚNICA fonte de destino permitida.
    const { data: link, error: lErr } = await supabase
      .from("client_social_accounts")
      .select("id")
      .eq("brand_id", data.brandId)
      .eq("client_id", clientId)
      .eq("connection_id", data.connectionId)
      .maybeSingle();
    if (lErr) throw new Error(lErr.message);
    if (!link) {
      throw new Error(
        "Esta conta não está vinculada ao cliente. Vincule em Perfil do cliente > Canais.",
      );
    }

    const { data: conn, error: cErr } = await supabase
      .from("social_connections")
      .select("id, channel, status, account_id, external_id, account_username, external_name")
      .eq("id", data.connectionId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!conn) throw new Error("Conexão não pertence a esta marca.");
    if (conn.status !== "active") {
      throw new Error("Conexão não está ativa — reconecte a conta em Conexões.");
    }

    const co = (pl.copy_override ?? {}) as Record<string, unknown>;
    const historicChannel = typeof co.channel === "string" ? (co.channel as string) : null;
    if (historicChannel && historicChannel !== conn.channel) {
      throw new Error(
        `Este destino é do canal ${historicChannel}. Selecione uma conta do mesmo canal.`,
      );
    }
    if ((pl.format as string) === "stories" && conn.channel !== "instagram") {
      throw new Error("Stories só é suportado em conexões Instagram.");
    }

    const oldConnectionId =
      (pl.connection_id as string | null) ??
      (typeof co.connection_id === "string" ? (co.connection_id as string) : null);

    const { error: uErr } = await supabase
      .from("post_placements")
      .update({
        connection_id: data.connectionId,
        copy_override: {
          ...co,
          channel: conn.channel,
          connection_id: data.connectionId,
        },
      })
      .eq("id", data.placementId)
      .neq("status", "published");
    if (uErr) throw new Error(uErr.message);

    await supabase.from("activity_events").insert({
      brand_id: data.brandId,
      client_id: clientId,
      actor_id: context.userId,
      entity_type: "post_placement",
      entity_id: data.placementId,
      verb: "destination_rebound",
      payload: {
        post_id: data.postId,
        placement_id: data.placementId,
        previous_connection_id: oldConnectionId,
        new_connection_id: data.connectionId,
        channel: conn.channel,
        target_account_id:
          (conn.account_id as string | null) ?? (conn.external_id as string | null) ?? null,
        target_label:
          (conn.account_username as string | null) ?? (conn.external_name as string | null) ?? null,
      },
    });

    return {
      ok: true,
      channel: conn.channel as string,
      accountLabel:
        (conn.account_username as string | null) ??
        (conn.external_name as string | null) ??
        "Conta",
    };
  });

// ============================================================
// retryFailedPlacementFn — reenfileira SOMENTE o destino com falha
// ============================================================

export const retryFailedPlacementFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        brandId: z.string().uuid(),
        placementId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    // 1) Placement pertence ao post/marca e está em falha
    const { data: pl, error: plErr } = await supabase
      .from("post_placements")
      .select(
        "id, post_id, brand_id, client_id, format, status, connection_id, media, copy_override",
      )
      .eq("id", data.placementId)
      .eq("post_id", data.postId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (plErr) throw new Error(plErr.message);
    if (!pl) throw new Error("Destino não encontrado nesta peça.");
    if (!pl.connection_id) {
      throw new Error("Destino sem conta vinculada — reabra a peça e escolha a conta.");
    }
    const clientId = pl.client_id as string | null;
    const family = familyOf(pl.format as string);
    const dbPlacement: "feed" | "story" | "reel" | "carousel" = family as
      | "feed"
      | "story"
      | "reel"
      | "carousel";

    // 2) Não pode existir publicação bem-sucedida nem item ativo para o destino
    const { data: queue, error: qErr } = await supabase
      .from("social_posts")
      .select(
        "id, status, placement, caption, hashtags, media, location_id, provider, publish_locked_at",
      )
      .eq("post_id", data.postId)
      .eq("brand_id", data.brandId)
      .eq("connection_id", pl.connection_id);
    if (qErr) throw new Error(qErr.message);
    const mine = (queue ?? []).filter((r) => (r.placement as string) === dbPlacement);
    if (mine.some((r) => r.status === "published")) {
      throw new Error("Este destino já foi publicado — nada a republicar.");
    }
    if (
      mine.some(
        (r) => r.status === "scheduled" || r.status === "publishing" || !!r.publish_locked_at,
      )
    ) {
      throw new Error("Já existe uma republicação em andamento para este destino.");
    }
    const failedRow =
      mine.find((r) => r.status === "failed") ?? mine.find((r) => r.status === "blocked");
    const retryableStatuses = ["failed", "connection_required", "authorization_required"];
    if (!failedRow && !retryableStatuses.includes(pl.status as string)) {
      throw new Error("Este destino não está em falha.");
    }

    // 3) Conexão ativa, do canal certo e vinculada ao cliente
    const { data: conn, error: cErr } = await supabase
      .from("social_connections")
      .select("id, channel, provider, status, external_id, account_id, access_token_ciphertext")
      .eq("id", pl.connection_id)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!conn) throw new Error("Conexão não pertence a esta marca.");
    if (conn.status !== "active") {
      throw new Error("Conexão não está ativa — reconecte a conta em Canais.");
    }
    if (!conn.access_token_ciphertext) {
      throw new Error("Conexão sem token — reconecte a conta em Canais.");
    }
    if (dbPlacement === "story" && conn.channel !== "instagram") {
      throw new Error("Stories só é suportado em conexões Instagram.");
    }
    if (dbPlacement === "reel" && conn.channel !== "instagram") {
      throw new Error("Reels só é suportado em conexões Instagram.");
    }
    if (conn.channel === "instagram" && !conn.account_id) {
      throw new Error("Conexão sem conta Instagram Business vinculada.");
    }
    if (clientId) {
      const { data: link, error: lErr } = await supabase
        .from("client_social_accounts")
        .select("id")
        .eq("brand_id", data.brandId)
        .eq("client_id", clientId)
        .eq("connection_id", pl.connection_id)
        .maybeSingle();
      if (lErr) throw new Error(lErr.message);
      if (!link) {
        throw new Error(
          "Este canal não está mais vinculado ao cliente. Vincule em Perfil do cliente > Canais.",
        );
      }
    }

    // 4) Mídia: reaproveita exatamente a mesma da tentativa anterior
    const prevMedia = (failedRow?.media ?? null) as {
      storagePath?: string;
      storagePaths?: string[];
      link?: string;
      imageUrl?: string;
      videoUrl?: string;
    } | null;
    const plMediaArr = Array.isArray(pl.media)
      ? (pl.media as Array<{ storagePath?: string }>)
      : [];
    // Carrossel: a peça é UMA publicação com N mídias; preservamos a lista.
    let storagePaths: string[] =
      prevMedia?.storagePaths && prevMedia.storagePaths.length
        ? prevMedia.storagePaths
        : dbPlacement === "carousel"
          ? plMediaArr.map((m) => m?.storagePath).filter((v): v is string => Boolean(v))
          : [];
    storagePaths = storagePaths.slice(0, 10);
    let storagePath: string | null = prevMedia?.storagePath ?? storagePaths[0] ?? null;
    if (!storagePath) {
      storagePath = plMediaArr.find((m) => m?.storagePath)?.storagePath ?? null;
    }
    if (dbPlacement === "carousel" && storagePaths.length < 2) {
      throw new Error("Carrossel exige pelo menos 2 mídias na peça — reabra a peça e anexe.");
    }
    const link = prevMedia?.link ?? null;
    if (!storagePath && !link) {
      throw new Error("Sem mídia para republicar — reabra a peça e anexe a mídia.");
    }
    if (storagePath) {
      if (!storagePath.startsWith(`${data.brandId}/`)) {
        throw new Error("Mídia fora do escopo da marca.");
      }
      // Confirma que o arquivo continua acessível ANTES de gastar tentativa.
      const { data: signed, error: sErr } = await supabase.storage
        .from("brand-media")
        .createSignedUrl(storagePath, 120);
      if (sErr || !signed?.signedUrl) {
        throw new Error("Mídia indisponível no armazenamento — reanexe o arquivo.");
      }
      const head = await fetch(signed.signedUrl, { method: "HEAD" });
      if (!head.ok) {
        throw new Error("URL da mídia não está acessível — reanexe o arquivo.");
      }
    }
    if (conn.channel === "instagram" && !storagePath) {
      throw new Error("Instagram exige mídia (imagem ou vídeo).");
    }

    // 5) Pré-flight completo de capacidade (cadeia + granular scope do target).
    //    Bloqueia ANTES de reenfileirar, sem consumir tentativa do worker.
    if (conn.provider === "meta") {
      const { resolvePublishTarget } = await import("@/lib/meta/publish-capability.server");
      const { capability } = await resolvePublishTarget(supabase, {
        brandId: data.brandId,
        clientId: clientId ?? null,
        connectionId: pl.connection_id as string,
        channel: conn.channel as string,
        force: true,
      });
      if (!capability.publishReady) throw new Error(capability.message);
    }

    // 6) Caption/hashtags: reaproveita a tentativa anterior; senão deriva do post
    let caption: string | null = (failedRow?.caption as string | null) ?? null;
    let hashtags: string[] = ((failedRow?.hashtags as string[] | null) ?? []) as string[];
    if (!failedRow) {
      const { data: post } = await supabase
        .from("posts")
        .select("copy")
        .eq("id", data.postId)
        .maybeSingle();
      const co = (pl.copy_override ?? {}) as {
        copy?: string;
        hashtags?: string[];
      };
      hashtags = co.hashtags ?? [];
      const base = co.copy ?? (post?.copy as string | null) ?? null;
      caption =
        dbPlacement === "story"
          ? null
          : [
              base,
              hashtags.length
                ? hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")
                : null,
            ]
              .filter(Boolean)
              .join("\n\n")
              .trim() || null;
    }

    // 7) Reenfileira UMA linha (o worker existente publica com claim/lock)
    const nowIso = new Date().toISOString();
    const { error: insErr } = await supabase.from("social_posts").insert({
      brand_id: data.brandId,
      client_id: clientId,
      connection_id: pl.connection_id,
      provider: conn.provider,
      placement: dbPlacement,
      caption: dbPlacement === "story" ? null : caption,
      hashtags: dbPlacement === "story" ? [] : hashtags,
      mentions: [],
      media: {
        ...(dbPlacement === "carousel"
          ? { storagePaths }
          : storagePath
            ? { storagePath }
            : {}),
        ...(link && dbPlacement !== "story" ? { link } : {}),
      },
      post_id: data.postId,
      status: "scheduled",
      scheduled_at: nowIso,
      created_by: context.userId,
      location_id: (failedRow?.location_id as string | null) ?? null,
    });
    if (insErr) {
      // Índice único de destino ativo = já existe item pendente para o destino.
      throw new Error(
        describeQueueInsertError(insErr.message, conn.channel as string, pl.format as string),
      );
    }

    // 8) Placement volta para "agendado" (histórico publicado nunca é tocado)
    await supabase
      .from("post_placements")
      .update({ status: "scheduled", scheduled_at: nowIso })
      .eq("id", data.placementId)
      .neq("status", "published");

    return { ok: true, queuedAt: nowIso, channel: conn.channel as string };
  });

// ============================================================
// cancelQueuedPlacementFn — cancela o item PENDENTE da fila de um destino
// ============================================================

/**
 * Libera o destino para reagendamento imediato quando existe item aguardando
 * nova tentativa (por exemplo, adiado por limite de requisições da rede).
 * Nunca toca em linha publicada nem em linha travada por worker em execução.
 */
export const cancelQueuedPlacementFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: z.string().uuid(),
        brandId: z.string().uuid(),
        placementId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    const { data: pl, error: plErr } = await supabase
      .from("post_placements")
      .select("id, format, status, connection_id, client_id")
      .eq("id", data.placementId)
      .eq("post_id", data.postId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (plErr) throw new Error(plErr.message);
    if (!pl) throw new Error("Destino não encontrado nesta peça.");
    if (!pl.connection_id) throw new Error("Destino sem conta vinculada.");
    if ((pl.status as string) === "published") {
      throw new Error("Este destino já foi publicado — nada a cancelar.");
    }

    const dbPlacement: "feed" | "story" | "reel" | "carousel" = familyOf(pl.format as string) as
      | "feed"
      | "story"
      | "reel"
      | "carousel";

    const { data: cancelled, error: cErr } = await supabase
      .from("social_posts")
      .update({ status: "cancelled" })
      .eq("post_id", data.postId)
      .eq("brand_id", data.brandId)
      .eq("connection_id", pl.connection_id)
      .eq("placement", dbPlacement)
      .in("status", ["scheduled", "publishing"])
      .is("publish_locked_at", null)
      .select("id");
    if (cErr) throw new Error(cErr.message);
    if (!cancelled?.length) {
      throw new Error(
        "Nenhum item pendente para cancelar — a publicação já está em execução ou finalizada.",
      );
    }

    await supabase
      .from("post_placements")
      .update({ status: "failed" })
      .eq("id", data.placementId)
      .neq("status", "published");

    await supabase.from("activity_events").insert({
      brand_id: data.brandId,
      client_id: (pl.client_id as string | null) ?? null,
      actor_id: context.userId,
      entity_type: "post_placement",
      entity_id: data.placementId,
      verb: "queue_item_cancelled",
      payload: {
        post_id: data.postId,
        placement: dbPlacement,
        connection_id: pl.connection_id,
        cancelled_rows: cancelled.length,
      },
    });

    return { ok: true, cancelled: cancelled.length };
  });
