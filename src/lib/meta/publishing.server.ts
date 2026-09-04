// Meta Publishing Service — server-only.
// Publishes/schedules Feed posts to Facebook Pages and Instagram Business
// via the Graph API. Suporta Feed (IG/FB), Stories IG e Reels IG.
// Carrossel segue fora de escopo (validado na camada de placement).
//
// State lives in `social_posts`:
//   status: draft | scheduled | publishing | published | failed | canceled
//   placement: instagram_feed | facebook_feed | instagram_story | instagram_reels

import { MetaProvider, MetaGraphError } from "./provider.server";
import { isMediaNotReady } from "./rate-limit";
import { decryptCredential } from "@/lib/credentials-crypto.server";
import type { PlacementOptions } from "@/lib/placement-options";


export type SupportedPlacement =
  | "instagram_feed"
  | "facebook_feed"
  | "instagram_story"
  | "instagram_reels"
  | "instagram_carousel"
  | "facebook_carousel";
export const SUPPORTED_PLACEMENTS: SupportedPlacement[] = [
  "instagram_feed",
  "facebook_feed",
  "instagram_story",
  "instagram_reels",
  "instagram_carousel",
  "facebook_carousel",
];

/** Item de carrossel (ordem = ordem das mídias da peça). */
export type CarouselItem = { imageUrl?: string; videoUrl?: string };

export type PublishMedia = {
  /** Publicly reachable image URL. Required for IG Feed. */
  imageUrl?: string;
  /** Publicly reachable video URL (Stories/Reels). */
  videoUrl?: string;
  /** Optional external link (Facebook feed only). */
  link?: string;
  /** Carrossel: 2 a 10 mídias, na ordem de exibição. */
  items?: CarouselItem[];
};

export type PublishInput = {
  placement: SupportedPlacement;
  caption?: string;
  media: PublishMedia;
  /** Reels: também publicar no Feed do Instagram (padrão: true). */
  shareToFeed?: boolean;
  /** Opções avançadas do destino (primeiro comentário, tags, colaborador…). */
  options?: PlacementOptions;
};


export type PublishResult = {
  externalPostId: string;
  externalPermalink: string | null;
  providerResponse: Record<string, unknown>;
  /** Opções que não puderam ser aplicadas — nunca derrubam a publicação. */
  warnings?: string[];
};


export type MetaConnectionRow = {
  id: string;
  provider: string;
  external_id: string; // Page ID
  account_id: string | null; // Instagram Business Account ID
  access_token_ciphertext: string; // Page-scoped token
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MetaPublishingService {
  private provider: MetaProvider;

  constructor(provider?: MetaProvider) {
    this.provider = provider ?? new MetaProvider();
  }

  /**
   * Publishes immediately to the target placement. Returns the external post
   * id and permalink so callers can persist them on the `social_posts` row.
   */
  async publish(connection: MetaConnectionRow, input: PublishInput): Promise<PublishResult> {
    assertSupported(input.placement);
    const pageToken = await decryptCredential(connection.access_token_ciphertext);
    return this.dispatch(connection, pageToken, input);
  }

  /**
   * Same as `publish()` but accepts a pre-decrypted page token. Used by the
   * high-level SocialProvider layer where the token is already available in
   * `SocialProviderContext.accessToken`.
   */
  async publishWithDecryptedToken(
    connection: Omit<MetaConnectionRow, "access_token_ciphertext">,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    assertSupported(input.placement);
    const row = { ...connection, access_token_ciphertext: "" } as MetaConnectionRow;
    return this.dispatch(row, pageToken, input);
  }

  private async dispatch(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    const result = await this.dispatchPlacement(connection, pageToken, input);
    // Opções pós-publicação (primeiro comentário, comentários desativados):
    // best-effort — falha aqui NUNCA invalida a publicação já feita.
    const warnings = [
      ...(result.warnings ?? []),
      ...(await this.applyPostPublishOptions(connection, pageToken, input, result)),
    ];
    return warnings.length ? { ...result, warnings } : result;

  }

  private dispatchPlacement(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    switch (input.placement) {
      case "instagram_feed":
        return this.publishInstagramFeed(connection, pageToken, input);
      case "instagram_story":
        return this.publishInstagramStory(connection, pageToken, input);
      case "instagram_reels":
        return this.publishInstagramReels(connection, pageToken, input);
      case "instagram_carousel":
        return this.publishInstagramCarousel(connection, pageToken, input);
      case "facebook_carousel":
        return this.publishFacebookCarousel(connection, pageToken, input);
      default:
        return this.publishFacebookFeed(connection, pageToken, input);
    }
  }

  /**
   * Parâmetros de container do Instagram derivados das opções do destino.
   * Localização só é aplicada quando o ID numérico do local é informado —
   * nome livre não é aceito pela Graph API.
   */
  private igContainerOptions(
    input: PublishInput,
    opts: { withUserTags?: boolean } = {},
  ): { query: Record<string, string>; warnings: string[] } {
    const o = input.options ?? {};
    const query: Record<string, string> = {};
    const warnings: string[] = [];

    if (o.collaborators?.length) {
      query.collaborators = JSON.stringify(o.collaborators.slice(0, 3));
    }
    if (o.location) {
      if (/^\d+$/.test(o.location)) query.location_id = o.location;
      else
        warnings.push(
          "Localização não aplicada: informe o ID numérico do local do Facebook para marcar na publicação.",
        );
    }
    if (o.userTags?.length) {
      if (opts.withUserTags) {
        query.user_tags = JSON.stringify(
          o.userTags.slice(0, 20).map((username) => ({ username, x: 0.5, y: 0.5 })),
        );
      } else {
        warnings.push("Marcação de pessoas não aplicada neste formato.");
      }
    }
    return { query, warnings };
  }

  private async applyPostPublishOptions(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
    result: PublishResult,
  ): Promise<string[]> {
    const o = input.options ?? {};
    const warnings: string[] = [];
    const isInstagram = input.placement.startsWith("instagram");
    const isStory = input.placement === "instagram_story";

    if (o.disableComments && isInstagram && !isStory) {
      try {
        await this.provider.graph(`/${result.externalPostId}`, {
          accessToken: pageToken,
          method: "POST",
          query: { comment_enabled: "false" },
        });
      } catch {
        warnings.push("Não foi possível desativar os comentários desta publicação.");
      }
    }

    if (o.firstComment && !isStory) {
      try {
        await this.provider.graph(`/${result.externalPostId}/comments`, {
          accessToken: pageToken,
          method: "POST",
          query: { message: o.firstComment },
        });
      } catch {
        warnings.push("A publicação foi feita, mas o primeiro comentário não pôde ser postado.");
      }
    }

    // Anotações operacionais nunca são enviadas — apenas sinalizadas.
    void connection;
    return warnings;
  }



  // ------------------------------------------------------------ Instagram ---
  private async publishInstagramFeed(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    if (!connection.account_id) {
      throw new Error("Esta Página do Facebook não tem conta Instagram Business vinculada.");
    }
    if (!input.media.imageUrl) {
      throw new Error("Feed do Instagram exige uma imagem (imageUrl).");
    }
    const igId = connection.account_id;

    // Step 1: create media container (com opções do destino)
    const igOpts = this.igContainerOptions(input, { withUserTags: true });
    const container = await this.provider.graph<{ id: string }>(`/${igId}/media`, {
      accessToken: pageToken,
      method: "POST",
      query: {
        image_url: input.media.imageUrl,
        ...(input.caption ? { caption: input.caption } : {}),
        ...igOpts.query,
      },
    });


    // Step 2: aguardar processamento (imagens grandes também levam tempo) e publicar
    await this.waitForContainerReady(container.id, pageToken);
    const publish = await this.publishContainer(igId, container.id, pageToken);


    // Step 3: fetch permalink (best-effort)
    let permalink: string | null = null;
    try {
      const meta = await this.provider.graph<{ permalink?: string }>(`/${publish.id}`, {
        accessToken: pageToken,
        query: { fields: "permalink" },
      });
      permalink = meta.permalink ?? null;
    } catch {
      /* permalink is nice-to-have */
    }

    return {
      externalPostId: publish.id,
      externalPermalink: permalink,
      providerResponse: { container_id: container.id, media_id: publish.id },
      ...(igOpts.warnings.length ? { warnings: igOpts.warnings } : {}),
    };

  }

  // ------------------------------------------------------------- Facebook ---
  private async publishFacebookFeed(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    const pageId = connection.external_id;
    const caption = input.caption ?? "";

    // With image → /{page}/photos ; else → /{page}/feed
    if (input.media.imageUrl) {
      const res = await this.provider.graph<{ id: string; post_id?: string }>(`/${pageId}/photos`, {
        accessToken: pageToken,
        method: "POST",
        query: {
          url: input.media.imageUrl,
          ...(caption ? { caption } : {}),
          published: "true",
        },
      });
      const externalId = res.post_id ?? res.id;
      return {
        externalPostId: externalId,
        externalPermalink: `https://www.facebook.com/${externalId}`,
        providerResponse: res as unknown as Record<string, unknown>,
      };
    }

    const res = await this.provider.graph<{ id: string }>(`/${pageId}/feed`, {
      accessToken: pageToken,
      method: "POST",
      query: {
        ...(caption ? { message: caption } : {}),
        ...(input.media.link ? { link: input.media.link } : {}),
      },
    });
    return {
      externalPostId: res.id,
      externalPermalink: `https://www.facebook.com/${res.id}`,
      providerResponse: res as unknown as Record<string, unknown>,
    };
  }

  // ------------------------------------------------------------ IG Stories --
  // Direct Publishing de Stories: NUNCA envia caption (Meta ignora + pode
  // gerar erro). Aceita imagem OU vídeo — a origem decide via media_type.
  private async publishInstagramStory(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    if (!connection.account_id) {
      throw new Error("Esta Página do Facebook não tem conta Instagram Business vinculada.");
    }
    if (!input.media.imageUrl && !input.media.videoUrl) {
      throw new Error("Stories exige uma imagem ou um vídeo.");
    }
    const igId = connection.account_id;

    const container = await this.provider.graph<{ id: string }>(`/${igId}/media`, {
      accessToken: pageToken,
      method: "POST",
      query: {
        media_type: "STORIES",
        ...(input.media.videoUrl
          ? { video_url: input.media.videoUrl }
          : { image_url: input.media.imageUrl! }),
      },
    });

    // Stories também passa por processamento na Meta. Publicar antes de
    // `FINISHED` devolve "Media ID is not available (code 9007)".
    await this.waitForContainerReady(container.id, pageToken);
    const publish = await this.publishContainer(igId, container.id, pageToken);

    // Stories NÃO expõem permalink na Graph API — não consultamos.
    return {
      externalPostId: publish.id,
      externalPermalink: null,
      providerResponse: {
        container_id: container.id,
        media_id: publish.id,
        media_type: "STORIES",
      },
    };

  }

  // -------------------------------------------------------------- IG Reels ---
  // Reels exige VÍDEO e processamento assíncrono: criamos o container
  // (media_type=REELS), aguardamos `status_code = FINISHED` e só então
  // publicamos. Timeout explícito evita worker preso.
  private async publishInstagramReels(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    if (!connection.account_id) {
      throw new Error("Esta Página do Facebook não tem conta Instagram Business vinculada.");
    }
    if (!input.media.videoUrl) {
      throw new Error("Reels exige um vídeo (MP4) na peça. Anexe o vídeo antes de publicar.");
    }
    const igId = connection.account_id;

    const igOpts = this.igContainerOptions(input);
    const shareToFeed = input.shareToFeed ?? input.options?.shareToFeed;
    const container = await this.provider.graph<{ id: string }>(`/${igId}/media`, {
      accessToken: pageToken,
      method: "POST",
      query: {
        media_type: "REELS",
        video_url: input.media.videoUrl,
        share_to_feed: shareToFeed === false ? "false" : "true",
        ...(input.caption ? { caption: input.caption } : {}),
        ...(input.options?.audioName ? { audio_name: input.options.audioName } : {}),
        ...igOpts.query,
      },
    });

    await this.waitForContainerReady(container.id, pageToken);

    const publish = await this.publishContainer(igId, container.id, pageToken);

    let permalink: string | null = null;
    try {
      const meta = await this.provider.graph<{ permalink?: string }>(`/${publish.id}`, {
        accessToken: pageToken,
        query: { fields: "permalink" },
      });
      permalink = meta.permalink ?? null;
    } catch {
      /* permalink é opcional */
    }

    return {
      externalPostId: publish.id,
      externalPermalink: permalink,
      providerResponse: {
        container_id: container.id,
        media_id: publish.id,
        media_type: "REELS",
      },
      ...(igOpts.warnings.length ? { warnings: igOpts.warnings } : {}),
    };

  }

  // ---------------------------------------------------------- IG Carousel ---
  // Carrossel no Instagram: 1 container por item (`is_carousel_item=true`),
  // container-pai `media_type=CAROUSEL` com os filhos e a legenda, e publicação
  // do pai. Vídeos entre os itens exigem espera de processamento.
  private async publishInstagramCarousel(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    if (!connection.account_id) {
      throw new Error("Esta Página do Facebook não tem conta Instagram Business vinculada.");
    }
    const items = assertCarouselItems(input.media.items);
    const igId = connection.account_id;

    // Marcação de pessoas no carrossel vale por item: aplicamos no PRIMEIRO
    // slide (a Meta não aceita tags no container-pai).
    const tagOpts = this.igContainerOptions(input, { withUserTags: true });
    const firstChildTags = tagOpts.query.user_tags
      ? { user_tags: tagOpts.query.user_tags }
      : ({} as Record<string, string>);

    const childIds: string[] = [];
    for (const [i, item] of items.entries()) {
      const child = await this.provider.graph<{ id: string }>(`/${igId}/media`, {
        accessToken: pageToken,
        method: "POST",
        query: {
          is_carousel_item: "true",
          ...(item.videoUrl
            ? { media_type: "VIDEO", video_url: item.videoUrl }
            : { image_url: item.imageUrl! }),
          ...(i === 0 ? firstChildTags : {}),
        },
      });
      await this.waitForContainerReady(child.id, pageToken);
      childIds.push(child.id);
    }

    const parentOpts = this.igContainerOptions(input, { withUserTags: true });
    delete parentOpts.query.user_tags; // tags vivem no slide, não no pai

    const parent = await this.provider.graph<{ id: string }>(`/${igId}/media`, {
      accessToken: pageToken,
      method: "POST",
      query: {
        media_type: "CAROUSEL",
        children: childIds.join(","),
        ...(input.caption ? { caption: input.caption } : {}),
        ...parentOpts.query,
      },
    });
    await this.waitForContainerReady(parent.id, pageToken);

    const publish = await this.publishContainer(igId, parent.id, pageToken);

    let permalink: string | null = null;
    try {
      const meta = await this.provider.graph<{ permalink?: string }>(`/${publish.id}`, {
        accessToken: pageToken,
        query: { fields: "permalink" },
      });
      permalink = meta.permalink ?? null;
    } catch {
      /* permalink é opcional */
    }

    return {
      externalPostId: publish.id,
      externalPermalink: permalink,
      providerResponse: {
        container_id: parent.id,
        children: childIds,
        media_id: publish.id,
        media_type: "CAROUSEL",
      },
      ...(parentOpts.warnings.length ? { warnings: parentOpts.warnings } : {}),
    };

  }

  // ---------------------------------------------------------- FB Carousel ---
  // No Facebook o "carrossel" de página é um post com múltiplas fotos: cada
  // foto é enviada como não publicada (`published=false`) e depois anexada ao
  // post do feed via `attached_media`. Vídeo não é suportado nesse formato.
  private async publishFacebookCarousel(
    connection: MetaConnectionRow,
    pageToken: string,
    input: PublishInput,
  ): Promise<PublishResult> {
    const items = assertCarouselItems(input.media.items);
    if (items.some((i) => i.videoUrl)) {
      throw new Error(
        "Carrossel no Facebook aceita apenas imagens. Remova o vídeo ou publique o vídeo separadamente.",
      );
    }
    const pageId = connection.external_id;

    const photoIds: string[] = [];
    for (const item of items) {
      const photo = await this.provider.graph<{ id: string }>(`/${pageId}/photos`, {
        accessToken: pageToken,
        method: "POST",
        query: { url: item.imageUrl!, published: "false" },
      });
      photoIds.push(photo.id);
    }

    const query: Record<string, string> = {
      ...(input.caption ? { message: input.caption } : {}),
      ...(input.media.link ? { link: input.media.link } : {}),
    };
    photoIds.forEach((id, i) => {
      query[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
    });

    const res = await this.provider.graph<{ id: string }>(`/${pageId}/feed`, {
      accessToken: pageToken,
      method: "POST",
      query,
    });

    return {
      externalPostId: res.id,
      externalPermalink: `https://www.facebook.com/${res.id}`,
      providerResponse: { post_id: res.id, attached_media: photoIds },
    };
  }



  /**
   * Aguarda o processamento da mídia pela Meta (Stories, Reels e Feed).
   * Erros de estado são traduzidos para pt-BR; timeout falha explicitamente
   * (o item volta para retry da fila). Container sem `status_code` é tratado
   * como pronto — a Meta não expõe estado para toda mídia.
   */
  private async waitForContainerReady(
    containerId: string,
    pageToken: string,
    opts: { attempts?: number; intervalMs?: number } = {},
  ): Promise<void> {
    const attempts = opts.attempts ?? 20;
    const intervalMs = opts.intervalMs ?? 3000;
    for (let i = 0; i < attempts; i++) {
      let st: { status_code?: string; status?: string } = {};
      try {
        st = await this.provider.graph<{ status_code?: string; status?: string }>(
          `/${containerId}`,
          { accessToken: pageToken, query: { fields: "status_code,status" } },
        );
      } catch {
        // Consulta de estado é best-effort: seguimos para a publicação, que
        // devolve 9007 e é reprocessada com espera.
        return;
      }
      const code = (st.status_code ?? "").toUpperCase();
      if (!code || code === "FINISHED" || code === "PUBLISHED") return;
      if (code === "ERROR") {
        throw new Error(
          `A Meta recusou a mídia durante o processamento${st.status ? `: ${st.status}` : "."}`,
        );
      }
      if (code === "EXPIRED") {
        throw new Error("O envio da mídia expirou na Meta. Tente publicar novamente.");
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      "A mídia ainda está sendo processada pela Meta. A publicação será tentada novamente.",
    );
  }

  /**
   * Publica um container já criado. A Meta pode devolver
   * `Media ID is not available (code 9007)` quando o processamento acabou de
   * terminar; nesse caso repetimos com espera crescente antes de desistir.
   */
  private async publishContainer(
    igId: string,
    creationId: string,
    pageToken: string,
    opts: { attempts?: number } = {},
  ): Promise<{ id: string }> {
    const attempts = opts.attempts ?? 4;
    let lastErr: unknown = null;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.provider.graph<{ id: string }>(`/${igId}/media_publish`, {
          accessToken: pageToken,
          method: "POST",
          query: { creation_id: creationId },
        });
      } catch (err) {
        lastErr = err;
        if (!isMediaNotReady(err) || i === attempts - 1) throw err;
        await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
      }
    }
    throw lastErr as Error;
  }
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function assertSupported(placement: string): asserts placement is SupportedPlacement {
  if (!SUPPORTED_PLACEMENTS.includes(placement as SupportedPlacement)) {
    throw new Error(
      `Placement "${placement}" ainda não é suportado. Suportados: ${SUPPORTED_PLACEMENTS.join(", ")}.`,
    );
  }
}

/** Limites do carrossel na Meta. */
export const CAROUSEL_MIN_ITEMS = 2;
export const CAROUSEL_MAX_ITEMS = 10;

/** Valida a lista de itens do carrossel com mensagens em pt-BR. */
export function assertCarouselItems(items?: CarouselItem[]): CarouselItem[] {
  const valid = (items ?? []).filter((i) => i && (i.imageUrl || i.videoUrl));
  if (valid.length < CAROUSEL_MIN_ITEMS) {
    throw new Error(
      `Carrossel exige pelo menos ${CAROUSEL_MIN_ITEMS} mídias. Anexe mais mídias à peça antes de publicar.`,
    );
  }
  if (valid.length > CAROUSEL_MAX_ITEMS) {
    throw new Error(
      `Carrossel aceita no máximo ${CAROUSEL_MAX_ITEMS} mídias. Remova algumas antes de publicar.`,
    );
  }
  return valid;
}


/** Serialises Graph errors into a message safe to store in `last_error`. */
export function formatPublishError(err: unknown): string {
  if (isMediaNotReady(err)) {
    return "A Meta ainda está processando a mídia. Tentaremos publicar novamente em instantes.";
  }
  if (err instanceof MetaGraphError) {
    const code = err.graph?.code ? ` (code ${err.graph.code})` : "";
    return `Meta: ${err.message}${code}`;
  }

  if (err instanceof Error) return err.message;
  return "Erro desconhecido ao publicar";
}
