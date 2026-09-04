// Endpoint HTTP unificado — GET /api/social/top-posts/:connectionId
//
// Camada HTTP fina. Ordenação e formatação canônica ficam aqui; toda a
// integração com providers passa pelo SocialAnalyticsService.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { Metric, SocialPost } from "@/lib/social/types";
import { SocialAnalyticsService, SOCIAL_CACHE_TTL_MS } from "@/lib/social-analytics/service.server";

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  sortBy: z
    .enum(["engagement", "reach", "impressions", "likes", "comments", "shares", "saves"])
    .default("engagement"),
});

function metricValue(list: Metric[], key: string): number | null {
  const m = list.find((x) => x.key === key);
  return m ? m.value : null;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function engagementRate(post: SocialPost): number | null {
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

function performanceScore(post: SocialPost): number {
  const likes = metricValue(post.metrics, "likes") ?? 0;
  const comments = metricValue(post.metrics, "comments") ?? 0;
  const shares = metricValue(post.metrics, "shares") ?? 0;
  const saves = metricValue(post.metrics, "saves") ?? 0;
  const reach = metricValue(post.metrics, "reach") ?? metricValue(post.metrics, "impressions") ?? 0;
  const interactions = likes * 1 + comments * 2 + shares * 3 + saves * 3;
  const reachBoost = reach > 0 ? Math.log10(reach + 1) : 0;
  return interactions * (1 + reachBoost / 10);
}

function scoreFor(post: SocialPost, sortBy: string): number {
  if (sortBy === "engagement") return performanceScore(post);
  return metricValue(post.metrics, sortBy) ?? 0;
}

export const Route = createFileRoute("/api/social/top-posts/$connectionId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const token = SocialAnalyticsService.requireBearer(request);
          const url = new URL(request.url);
          const parsed = QuerySchema.safeParse({
            limit: url.searchParams.get("limit") ?? undefined,
            sortBy: url.searchParams.get("sortBy") ?? undefined,
          });
          if (!parsed.success)
            return Response.json(
              { error: "invalid_query", details: parsed.error.flatten() },
              { status: 400 },
            );
          const { limit, sortBy } = parsed.data;

          const supabase = SocialAnalyticsService.supabaseForUser(token);
          const conn = await SocialAnalyticsService.resolveConnection(
            supabase,
            params.connectionId,
            token,
          );

          const pool = Math.min(Math.max(limit * 3, 15), 50);
          const posts = await SocialAnalyticsService.getPosts(conn, { limit: pool });

          const ranked = posts
            .map((p) => ({ p, score: scoreFor(p, sortBy) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

          const body = ranked.map(({ p, score }) => ({
            id: p.externalPostId,
            provider: conn.network,
            permalink: p.permalink,
            thumbnail: p.thumbnailUrl,
            caption: p.caption,
            publishedAt: p.publishedAt,
            mediaType: p.mediaType,
            score: round2(score),
            metrics: {
              reach: metricValue(p.metrics, "reach"),
              impressions: metricValue(p.metrics, "impressions"),
              engagement: engagementRate(p),
              likes: metricValue(p.metrics, "likes"),
              comments: metricValue(p.metrics, "comments"),
              shares: metricValue(p.metrics, "shares"),
              saves: metricValue(p.metrics, "saves"),
              views: metricValue(p.metrics, "video_views") ?? metricValue(p.metrics, "views"),
            },
          }));

          return Response.json(body, {
            headers: {
              "cache-control": `private, max-age=${SOCIAL_CACHE_TTL_MS / 1000}, stale-while-revalidate=120`,
            },
          });
        } catch (err) {
          return SocialAnalyticsService.errorResponse(err);
        }
      },
    },
  },
});
