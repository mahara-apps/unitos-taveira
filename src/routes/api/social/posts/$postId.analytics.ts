// Endpoint HTTP unificado — GET /api/social/posts/:postId/analytics
//
// Camada HTTP fina. Toda a mecânica de providers e cache passa pelo
// SocialAnalyticsService — este handler apenas casa o social_post ao
// connection_id e delega a chamada do post.
import { createFileRoute } from "@tanstack/react-router";
import type { Metric, SocialPost } from "@/lib/social/types";
import {
  SocialAnalyticsService,
  SOCIAL_CACHE_TTL_MS,
  SocialServiceError,
} from "@/lib/social-analytics/service.server";

function metricValue(list: Metric[], key: string): number | null {
  const m = list.find((x) => x.key === key);
  return m ? m.value : null;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeEngagementRate(post: SocialPost): number | null {
  const explicit = metricValue(post.metrics, "engagement_rate");
  if (explicit != null) return round2(explicit);
  const engagement = metricValue(post.metrics, "engagement");
  const reach = metricValue(post.metrics, "reach");
  const impressions = metricValue(post.metrics, "impressions");
  const base = reach ?? impressions ?? null;
  if (engagement != null && base && base > 0) return round2((engagement / base) * 100);
  const likes = metricValue(post.metrics, "likes") ?? 0;
  const comments = metricValue(post.metrics, "comments") ?? 0;
  const shares = metricValue(post.metrics, "shares") ?? 0;
  const saves = metricValue(post.metrics, "saves") ?? 0;
  const interactions = likes + comments + shares + saves;
  if (!interactions || !base || base <= 0) return null;
  return round2((interactions / base) * 100);
}

export const Route = createFileRoute("/api/social/posts/$postId/analytics")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const token = SocialAnalyticsService.requireBearer(request);
          const postId = params.postId;
          if (!/^[0-9a-f-]{36}$/i.test(postId))
            return new Response("Invalid postId", { status: 400 });

          const supabase = SocialAnalyticsService.supabaseForUser(token);

          const { data: post, error: postErr } = await supabase
            .from("social_posts")
            .select(
              "id, brand_id, connection_id, external_post_id, external_permalink, published_at, placement, provider, status",
            )
            .eq("id", postId)
            .maybeSingle();
          if (postErr) throw new SocialServiceError("db_error", postErr.message, 500);
          if (!post) throw new SocialServiceError("not_found", "Post não encontrado", 404);
          if (!post.external_post_id)
            throw new SocialServiceError(
              "connection_missing_token",
              "Post ainda não publicado",
              409,
              { status: post.status },
            );

          const conn = await SocialAnalyticsService.resolveConnection(
            supabase,
            post.connection_id,
            token,
          );

          const p = await SocialAnalyticsService.getPost(conn, {
            postId: post.external_post_id,
          });

          return Response.json(
            {
              provider: conn.network,
              postId: post.id,
              externalPostId: p.externalPostId,
              permalink: p.permalink ?? post.external_permalink ?? null,
              publishedAt: p.publishedAt ?? post.published_at ?? null,
              mediaType: p.mediaType,
              likes: metricValue(p.metrics, "likes"),
              comments: metricValue(p.metrics, "comments"),
              shares: metricValue(p.metrics, "shares"),
              saves: metricValue(p.metrics, "saves"),
              reach: metricValue(p.metrics, "reach"),
              impressions: metricValue(p.metrics, "impressions"),
              views: metricValue(p.metrics, "video_views") ?? metricValue(p.metrics, "views"),
              engagementRate: computeEngagementRate(p),
              warnings: p.warnings,
            },
            {
              headers: {
                "cache-control": `private, max-age=${SOCIAL_CACHE_TTL_MS / 1000}, stale-while-revalidate=120`,
              },
            },
          );
        } catch (err) {
          return SocialAnalyticsService.errorResponse(err);
        }
      },
    },
  },
});
