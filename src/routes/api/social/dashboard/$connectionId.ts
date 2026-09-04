// Endpoint HTTP unificado — GET /api/social/dashboard/:connectionId
//
// Camada HTTP fina. Toda lógica (resolver conexão, decriptar token,
// inferir rede, chamar provider, cache) vive no SocialAnalyticsService.
// Este handler apenas: (1) autentica, (2) valida query, (3) chama o
// service, (4) formata a resposta canônica.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import type { DateRange, Metric, SocialPost } from "@/lib/social/types";
import { SocialAnalyticsService, SOCIAL_CACHE_TTL_MS } from "@/lib/social-analytics/service.server";

const QuerySchema = z.object({
  period: z
    .string()
    .regex(/^\d{1,3}d$/)
    .default("30d"),
});

function periodToRange(period: string): DateRange {
  const days = Math.min(Math.max(Number.parseInt(period, 10) || 30, 1), 365);
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: until.toISOString() };
}

function metricValue(list: Metric[], key: string): number | null {
  const m = list.find((x) => x.key === key);
  return m ? m.value : null;
}

function sumPostMetric(posts: SocialPost[], key: string): number {
  return posts.reduce((acc, p) => acc + (metricValue(p.metrics, key) ?? 0), 0);
}

function computeEngagementRate(
  totals: Metric[],
  posts: SocialPost[],
  followers: number | null,
): number | null {
  const direct = metricValue(totals, "engagement");
  const denom = followers ?? metricValue(totals, "reach") ?? null;
  if (direct != null && denom && denom > 0) return round2((direct / denom) * 100);
  const interactions =
    sumPostMetric(posts, "likes") +
    sumPostMetric(posts, "comments") +
    sumPostMetric(posts, "shares") +
    sumPostMetric(posts, "saves");
  if (!interactions) return null;
  const base = followers ?? metricValue(totals, "reach") ?? null;
  if (!base || base <= 0) return null;
  return round2((interactions / base) * 100);
}

function computeGrowth(totals: Metric[], followers: number | null): number | null {
  const gained = metricValue(totals, "followers_gained") ?? 0;
  const lost = metricValue(totals, "followers_lost") ?? 0;
  if (!followers || followers <= 0) return null;
  return round2(((gained - lost) / followers) * 100);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const Route = createFileRoute("/api/social/dashboard/$connectionId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const token = SocialAnalyticsService.requireBearer(request);
          const parsed = QuerySchema.safeParse({
            period: new URL(request.url).searchParams.get("period") ?? undefined,
          });
          if (!parsed.success)
            return Response.json(
              { error: "invalid_query", details: parsed.error.flatten() },
              { status: 400 },
            );
          const period = parsed.data.period;
          const range = periodToRange(period);

          const supabase = SocialAnalyticsService.supabaseForUser(token);
          const conn = await SocialAnalyticsService.resolveConnection(
            supabase,
            params.connectionId,
            token,
          );

          const [dashboard, posts] = await Promise.all([
            SocialAnalyticsService.getDashboard(conn, { range, period }),
            SocialAnalyticsService.getPosts(conn, { limit: 25 }).catch(() => [] as SocialPost[]),
          ]);

          const followers = dashboard.profile?.followers ?? null;
          const handle = dashboard.profile?.handle ?? null;
          const account = handle
            ? handle.startsWith("@")
              ? handle
              : `@${handle}`
            : (dashboard.profile?.name ?? conn.externalName ?? null);

          return Response.json(
            {
              provider: conn.network,
              account,
              period,
              range,
              metrics: {
                followers,
                reach: metricValue(dashboard.totals, "reach"),
                impressions: metricValue(dashboard.totals, "impressions"),
                engagement: computeEngagementRate(dashboard.totals, posts, followers),
                profileVisits: metricValue(dashboard.totals, "profile_visits"),
                linkClicks: metricValue(dashboard.totals, "link_clicks"),
                posts: posts.length,
                videos: posts.filter((p) => p.mediaType === "video").length,
                growth: computeGrowth(dashboard.totals, followers),
              },
              warnings: dashboard.warnings,
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
