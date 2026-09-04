import { createFileRoute } from "@tanstack/react-router";
import { assertCronRequest } from "@/lib/cron-auth.server";
import { isMetaRateLimit, nextRateLimitRetryAt, rateLimitMessage } from "@/lib/meta/rate-limit";


/**
 * Erro determinístico de autorização/vínculo: NUNCA deve consumir retries.
 * O destino é marcado como `blocked` (placement `connection_required` /
 * `authorization_required`) com mensagem acionável.
 */
class DeterministicBlock extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "DeterministicBlock";
    this.code = code;
  }
}

/**
 * Drena `social_posts` agendados. pg_cron chama a cada minuto.
 *
 * Concorrência: usa `claim_scheduled_social_posts` (SECURITY DEFINER + FOR UPDATE
 * SKIP LOCKED + lock de 10min) para reservar linhas sem risco de duplicar
 * publicação quando duas execuções do cron rodam em paralelo.
 *
 * Isolamento: a RPC revalida que `social_connections.brand_id` bate com o
 * post e que existe vínculo em `client_social_accounts` (connection_id +
 * client_id + brand_id) — o campo legado `social_connections.client_id` não é
 * mais consultado. Nunca escolher "a primeira conexão da marca": a conexão vem
 * do próprio `social_posts.connection_id` reservado.
 *
 * Retry: sucesso -> `mark_social_post_published`; erro -> `mark_social_post_failed`
 * (incrementa `publish_attempts`, muda para `failed` após 5 tentativas).
 *
 * Sincronização (Fase 4/C1): ao virar `published`, o trigger
 * `trg_social_posts_sync_publication` chama `sync_post_publication_state`, que
 * marca o `post_placements` do destino real (connection_id + família de formato)
 * e, quando não resta destino pendente, marca a peça (`posts.stage`,
 * `published_at`) e move o `stage_id` para a coluna "Publicado" do Kanban.
 * Idempotente: nunca reescreve histórico já publicado.
 *
 * Auth: bypass no edge via /api/public/*; exige `x-cron-secret` = CRON_SECRET.

 */
export const Route = createFileRoute("/api/public/meta/publish-scheduled")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronDenied = assertCronRequest(request);
        if (cronDenied) return cronDenied;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { MetaPublishingService, formatPublishError } =
          await import("@/lib/meta/publishing.server");

        // Sweep fail-closed (1ª barreira): itens vencidos cujo destino já não é
        // utilizável (conexão removida/inativa, sem token, ou conta desvinculada
        // do cliente) NUNCA são reclamados pelo claim — sem este sweep ficariam
        // "scheduled" para sempre. Aqui viram `blocked`/`connection_required`,
        // sem chamar a Meta e sem consumir tentativa.
        const { data: swept } = await (supabaseAdmin as any).rpc(
          "block_unusable_scheduled_social_posts",
        );
        for (const s of (swept ?? []) as Array<{ id: string; reason: string }>) {
          // Observabilidade sem credenciais: nunca logar token.
          console.warn("[publish-scheduled] connection_required", {
            social_post_id: s.id,
            reason: s.reason,
          });
        }

        // Claim atômico via RPC (FOR UPDATE SKIP LOCKED + lock de 10min).
        const { data: claimed, error: claimErr } = await (supabaseAdmin as any).rpc(
          "claim_scheduled_social_posts",
          { p_limit: 25 },
        );
        if (claimErr) {
          return Response.json({ ok: false, error: claimErr.message }, { status: 500 });
        }
        if (!claimed || claimed.length === 0) {
          return Response.json({ ok: true, processed: 0 });
        }

        const svc = new MetaPublishingService();
        const results: Array<{ id: string; ok: boolean; error?: string }> = [];
        const seenConnections = new Map<string, number>();


        for (const post of claimed as Array<{
          id: string;
          brand_id: string;
          client_id: string | null;
          connection_id: string;
          placement: string;
          caption: string | null;
          hashtags: string[] | null;
          mentions: string[] | null;
          media: any;
        }>) {
          // Espaçamento por conexão: Instagram gasta várias chamadas por
          // publicação (contêiner + status + publish). Publicar Instagram e
          // Facebook da mesma conta em rajada é o que estoura o limite do app.
          const seenBefore = seenConnections.get(post.connection_id) ?? 0;
          if (seenBefore > 0) await sleep(Math.min(seenBefore, 3) * 1500);
          seenConnections.set(post.connection_id, seenBefore + 1);

          try {

            // ---- PRÉ-FLIGHT (2ª barreira, fail closed) ----------------------
            // A autorização pode ter mudado depois do agendamento: revalidamos
            // toda a cadeia (marca → cliente → vínculo → conexão → canal →
            // target → token → granular scope do target) ANTES de chamar a
            // Meta. Erro determinístico (autorização/vínculo) NÃO consome
            // retries: o destino vira `blocked`/`connection_required`.
            const { resolvePublishTarget } = await import("@/lib/meta/publish-capability.server");
            const { capability, connection: conn } = await resolvePublishTarget(supabaseAdmin, {
              brandId: post.brand_id,
              clientId: post.client_id,
              connectionId: post.connection_id,
              format:
                post.placement === "story"
                  ? "stories"
                  : post.placement === "reel"
                    ? "reels"
                    : post.placement === "carousel"
                      ? "carrossel"
                      : "feed",

              force: true,
            });
            if (!capability.publishReady) {
              if (capability.deterministic) {
                throw new DeterministicBlock(capability.message, capability.code);
              }
              throw new Error(capability.message);
            }
            if (!conn) {
              throw new DeterministicBlock(
                "Este canal não está mais conectado a este cliente. Reconecte a conta para continuar.",
                "wrong_brand",
              );
            }

            const caption = buildCaption(
              post.caption ?? undefined,
              (post.hashtags as string[] | null) ?? [],
              (post.mentions as string[] | null) ?? [],
            );
            // Signed URL discipline: se a mídia guarda apenas o path do bucket
            // privado (`storagePath`), assinamos AGORA (TTL curto) em vez de
            // usar uma URL previamente persistida que já pode ter expirado.
            const media = await resolveMediaForPublish(
              supabaseAdmin,
              post.brand_id,
              (post.media as any) ?? {},
            );
            // Mapeamento placement (DB) → providerPlacement:
            //   feed     → instagram_feed | facebook_feed (por canal)
            //   story    → instagram_story (Stories NUNCA carrega caption)
            //   reel     → instagram_reels (exige vídeo; processamento assíncrono)
            //   carousel → instagram_carousel | facebook_carousel (2 a 10 mídias)
            const channel = (conn as any).channel as string | undefined;
            const providerPlacement:
              | "instagram_feed"
              | "facebook_feed"
              | "instagram_story"
              | "instagram_reels"
              | "instagram_carousel"
              | "facebook_carousel" =
              post.placement === "story"
                ? "instagram_story"
                : post.placement === "reel"
                  ? "instagram_reels"
                  : post.placement === "carousel"
                    ? channel === "facebook"
                      ? "facebook_carousel"
                      : "instagram_carousel"
                    : channel === "facebook"
                      ? "facebook_feed"
                      : "instagram_feed";
            if (providerPlacement === "instagram_reels" && !media.videoUrl) {
              throw new DeterministicBlock(
                "Reels exige um vídeo (MP4) na peça. Anexe o vídeo e reagende a publicação.",
                "media_required",
              );
            }
            if (
              (providerPlacement === "instagram_carousel" ||
                providerPlacement === "facebook_carousel") &&
              (media.items?.length ?? 0) < 2
            ) {
              throw new DeterministicBlock(
                "Carrossel exige pelo menos 2 mídias na peça. Anexe as mídias e reagende a publicação.",
                "media_required",
              );
            }
            // Opções avançadas do destino, gravadas no jsonb `media.options`
            // no momento do agendamento. Nunca bloqueiam a publicação.
            const rawOptions = (post.media as any)?.options;
            const result = await svc.publish(conn as any, {
              placement: providerPlacement,
              caption: providerPlacement === "instagram_story" ? undefined : caption,
              media,
              ...(rawOptions && typeof rawOptions === "object" ? { options: rawOptions } : {}),
            });
            if (result.warnings?.length) {
              console.warn("[publish-scheduled] option warnings", {
                social_post_id: post.id,
                warnings: result.warnings,
              });
            }

            const { error: okErr } = await (supabaseAdmin as any).rpc(
              "mark_social_post_published",
              {
                p_post_id: post.id,
                p_external_id: result.externalPostId,
                p_permalink: result.externalPermalink,
              },
            );
            if (okErr) throw new Error(okErr.message);
            // provider_response é metadado — atualização direta é OK, não altera lock/retry.
            await supabaseAdmin
              .from("social_posts")
              .update({ provider_response: result.providerResponse as any })
              .eq("id", post.id);
            // Reflete a publicação na peça editorial (posts/post_placements),
            // que é o que Calendário, Projeto e Conteúdo leem.
            await syncEditorialPublished(
              supabaseAdmin,
              post.id,
              post.placement,
              post.connection_id,
            );
            results.push({ id: post.id, ok: true });
          } catch (err) {
            // Classificação de erro:
            //  - determinístico (autorização/vínculo) → `blocked`, sem retry;
            //  - transitório (timeout/5xx/rate limit) → política de retry atual.
            if (err instanceof DeterministicBlock) {
              // Observabilidade: diagnóstico completo do bloqueio, sem token.
              console.warn("[publish-scheduled] deterministic block", {
                social_post_id: post.id,
                client_id: post.client_id,
                connection_id: post.connection_id,
                placement: post.placement,
                reason: err.code,
              });
              await (supabaseAdmin as any).rpc("mark_social_post_blocked", {
                p_post_id: post.id,
                p_error: err.message,
                p_reason:
                  err.code === "not_linked_to_client" || err.code === "wrong_brand"
                    ? "connection_required"
                    : "authorization_required",
              });
              results.push({ id: post.id, ok: false, error: err.message });
              continue;
            }
            const msg = formatPublishError(err);

            // Limite temporário da Meta (code 4/17/32/613 e afins) NÃO é falha:
            // o destino volta para a fila com espera progressiva e sem consumir
            // tentativa. Sem isso, o cron de 1 minuto queima as 5 tentativas em
            // poucos minutos e a peça vira `failed` sem motivo real.
            if (isMetaRateLimit(err)) {
              const { data: cur } = await supabaseAdmin
                .from("social_posts")
                .select("rate_limit_retries")
                .eq("id", post.id)
                .maybeSingle();
              const retries = Number((cur as any)?.rate_limit_retries ?? 0);
              const retryAt = nextRateLimitRetryAt(retries);
              console.warn("[publish-scheduled] rate limited", {
                social_post_id: post.id,
                connection_id: post.connection_id,
                placement: post.placement,
                retries,
                retry_at: retryAt.toISOString(),
              });
              await (supabaseAdmin as any).rpc("mark_social_post_deferred", {
                p_post_id: post.id,
                p_error: rateLimitMessage(retryAt, msg, err),
                p_retry_at: retryAt.toISOString(),
              });
              results.push({ id: post.id, ok: false, error: rateLimitMessage(retryAt, undefined, err) });

              continue;
            }

            await (supabaseAdmin as any).rpc("mark_social_post_failed", {
              p_post_id: post.id,
              p_error: msg,
            });
            results.push({ id: post.id, ok: false, error: msg });

          }
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});

/**
 * Fallback idempotente. O caminho canônico é o trigger
 * `trg_social_posts_sync_publication` -> `sync_post_publication_state`.
 * Aqui só reforçamos o estado por DESTINO REAL (post + canal + formato),
 * nunca por formato solto (isso marcaria o canal de outro destino).
 */
async function syncEditorialPublished(
  supabaseAdmin: any,
  socialPostId: string,
  placement: string,
  connectionId?: string | null,
): Promise<void> {
  try {
    const { data: sp } = await supabaseAdmin
      .from("social_posts")
      .select("post_id")
      .eq("id", socialPostId)
      .maybeSingle();
    const postId = (sp?.post_id as string | null) ?? null;
    if (!postId) return;
    const nowIso = new Date().toISOString();
    const format = placement === "story" ? "stories" : "feed";
    let q = supabaseAdmin
      .from("post_placements")
      .update({ status: "published", published_at: nowIso })
      .eq("post_id", postId)
      .eq("format", format)
      .neq("status", "published");
    // Sem connection_id não há como identificar o destino: não escreve nada
    // (o trigger no banco já cuidou da sincronização).
    if (!connectionId) return;
    q = q.eq("connection_id", connectionId);
    await q;

    const { data: pending } = await supabaseAdmin
      .from("post_placements")
      .select("id")
      .eq("post_id", postId)
      .neq("status", "published")
      .limit(1);
    // Só marca a peça como publicada quando não há mais destino pendente.
    if (!pending || pending.length === 0) {
      await supabaseAdmin
        .from("posts")
        .update({ stage: "published", published_at: nowIso })
        .eq("id", postId);
    }
  } catch (err) {
    console.error("[publish-scheduled] editorial sync failed", err);
  }
}

function buildCaption(
  base?: string,
  hashtags: string[] = [],
  mentions: string[] = [],
): string | undefined {
  const parts: string[] = [];
  if (base) parts.push(base);
  const tags = hashtags.filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  const ats = mentions.filter(Boolean).map((m) => (m.startsWith("@") ? m : `@${m}`));
  if (ats.length) parts.push(ats.join(" "));
  if (tags.length) parts.push(tags.join(" "));
  const out = parts.join("\n\n").trim();
  return out.length ? out : undefined;
}

/**
 * Resolve a mídia a ser enviada ao provider.
 *
 * Regra: se o post gravou `storagePath` (bucket privado `brand-media`, sob o
 * prefixo `<brand_id>/`), o worker gera uma signed URL fresca (TTL 3600s)
 * antes de chamar o Meta. Signed URLs NUNCA são persistidas no banco.
 *
 * Compat: se o post foi criado antes desta mudança e só tem `imageUrl`,
 * usamos como estava. Novos composers devem preferir `storagePath`.
 */
async function resolveMediaForPublish(
  supabaseAdmin: any,
  brandId: string,
  media: {
    imageUrl?: string;
    videoUrl?: string;
    storagePath?: string;
    storagePaths?: string[];
    link?: string;
  },
): Promise<{
  imageUrl?: string;
  videoUrl?: string;
  link?: string;
  items?: Array<{ imageUrl?: string; videoUrl?: string }>;
}> {
  const out: {
    imageUrl?: string;
    videoUrl?: string;
    link?: string;
    items?: Array<{ imageUrl?: string; videoUrl?: string }>;
  } = {};
  if (media?.link) out.link = media.link;

  const signPath = async (path: string) => {
    if (!path.startsWith(`${brandId}/`)) {
      throw new Error("storagePath fora do escopo da marca");
    }
    const { data, error } = await supabaseAdmin.storage
      .from("brand-media")
      .createSignedUrl(path, 3600);
    if (error) throw new Error(`Falha ao assinar mídia: ${error.message}`);
    return data.signedUrl as string;
  };

  // Carrossel: todas as mídias, na ordem gravada pela peça.
  if (Array.isArray(media?.storagePaths) && media.storagePaths.length > 0) {
    const items: Array<{ imageUrl?: string; videoUrl?: string }> = [];
    for (const path of media.storagePaths.slice(0, 10)) {
      const url = await signPath(path);
      items.push(isVideoPath(path) ? { videoUrl: url } : { imageUrl: url });
    }
    out.items = items;
    if (items[0]?.imageUrl) out.imageUrl = items[0].imageUrl;
    return out;
  }

  if (media?.storagePath) {
    const url = await signPath(media.storagePath);
    if (isVideoPath(media.storagePath)) out.videoUrl = url;
    else out.imageUrl = url;
    return out;
  }

  if (media?.videoUrl) out.videoUrl = media.videoUrl;
  if (media?.imageUrl) out.imageUrl = media.imageUrl;
  return out;
}


function isVideoPath(path: string): boolean {
  return /\.(mp4|mov|m4v|webm|3gp)$/i.test(path);
}

/** Pausa curta entre destinos da mesma conexão (anti-throttling). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
