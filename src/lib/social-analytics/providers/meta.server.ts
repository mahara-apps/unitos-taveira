import { MetaProvider, MetaGraphError } from "@/lib/meta/provider.server";
import type {
  AccountAnalytics,
  Metric,
  PostAnalytics,
  ProviderResult,
  TimeSeriesPoint,
} from "../types";
import { metricMapFor } from "../metric-mapping";
import type {
  AccountAnalyticsOptions,
  PostAnalyticsOptions,
  ProviderContext,
  RecentPostsOptions,
  SocialAnalyticsProvider,
} from "../provider";
import { ANALYTICS_CONCURRENCY, mapLimit } from "@/lib/meta/graph-budget";

/**
 * Meta Analytics Provider — covers Instagram Business + Facebook Pages via
 * the Graph API. Native metric names are mapped into the canonical vocabulary
 * declared in `../types.ts`. Partial failures return warnings rather than
 * throwing so a single deprecated metric never kills the whole dashboard.
 */
export class MetaAnalyticsProvider implements SocialAnalyticsProvider {
  readonly networks = ["facebook", "instagram"] as const;
  readonly label = "Meta";

  constructor(private meta: MetaProvider = new MetaProvider()) {}

  // ------------------------------------------------------------ Account ---
  async fetchAccountAnalytics(
    ctx: ProviderContext,
    opts: AccountAnalyticsOptions,
  ): Promise<ProviderResult<AccountAnalytics>> {
    if (opts.network === "instagram") return this.fetchInstagramAccount(ctx, opts);
    if (opts.network === "facebook") return this.fetchFacebookAccount(ctx, opts);
    return { ok: false, error: `Meta não suporta network=${opts.network}` };
  }

  private async fetchInstagramAccount(
    ctx: ProviderContext,
    opts: AccountAnalyticsOptions,
  ): Promise<ProviderResult<AccountAnalytics>> {
    if (!ctx.accountId) {
      return { ok: false, error: "Página sem Instagram Business vinculado" };
    }
    const warnings: string[] = [];
    const { since, until } = toEpochRange(opts.range);

    const followers = await this.safe(
      async () => {
        const r = await this.meta.graph<{ followers_count?: number }>(`/${ctx.accountId}`, {
          accessToken: ctx.accessToken,
          query: { fields: "followers_count,username,name" },
        });
        return r.followers_count ?? null;
      },
      warnings,
      "followers_count",
    );

    const IG_ACCOUNT_MAP = metricMapFor("instagram", "account");

    // v22+: Instagram Business account insights are split into two families.
    // Only `follower_count` still supports the classic period=day time series.
    // Everything else (reach, views, profile_views, website_clicks,
    // accounts_engaged, total_interactions) MUST use metric_type=total_value.
    const series = await this.safe(
      async () => {
        const r = await this.meta.graph<InsightsResponse>(`/${ctx.accountId}/insights`, {
          accessToken: ctx.accessToken,
          query: {
            metric: "follower_count",
            period: "day",
            since: String(since),
            until: String(until),
          },
        });
        return toSeries(r.data ?? [], IG_ACCOUNT_MAP);
      },
      warnings,
      "instagram_series",
    );

    // total_value endpoint — one value per metric across the window.
    const totalsMetrics = [
      "reach",
      "views",
      "profile_views",
      "website_clicks",
      "accounts_engaged",
      "total_interactions",
    ];
    const totalsRes = await this.safe(
      () =>
        this.meta.graph<InsightsResponse>(`/${ctx.accountId}/insights`, {
          accessToken: ctx.accessToken,
          query: {
            metric: totalsMetrics.join(","),
            metric_type: "total_value",
            period: "day",
            since: String(since),
            until: String(until),
          },
        }),
      warnings,
      "instagram_totals",
    );

    const totalsFromEndpoint: Metric[] = [];
    for (const row of totalsRes?.data ?? []) {
      const key = IG_ACCOUNT_MAP[row.name];
      if (!key) continue;
      // total_value shape: values[0].value OR total_value.value
      const anyRow = row as unknown as {
        values?: InsightValue[];
        total_value?: { value?: number };
      };
      const v =
        (typeof anyRow.total_value?.value === "number" ? anyRow.total_value.value : null) ??
        (typeof anyRow.values?.[0]?.value === "number"
          ? (anyRow.values![0].value as number)
          : null);
      if (typeof v === "number") totalsFromEndpoint.push({ key, value: v });
    }

    // Merge: sum-per-key so `follower_count` growth also lives in totals.
    const totals = mergeMetrics(sumSeries(series ?? []), totalsFromEndpoint);

    return {
      ok: true,
      data: {
        network: "instagram",
        connectionId: ctx.connectionId,
        accountId: ctx.accountId,
        accountName: ctx.externalName,
        accountHandle: ctx.accountUsername,
        range: opts.range,
        followers: followers ?? null,
        metrics: totals,
        series: series ?? [],
        warnings,
      },
    };
  }

  private async fetchFacebookAccount(
    ctx: ProviderContext,
    opts: AccountAnalyticsOptions,
  ): Promise<ProviderResult<AccountAnalytics>> {
    const warnings: string[] = [];
    const { since, until } = toEpochRange(opts.range);

    const fans = await this.safe(
      async () => {
        const r = await this.meta.graph<{ fan_count?: number; followers_count?: number }>(
          `/${ctx.externalId}`,
          { accessToken: ctx.accessToken, query: { fields: "fan_count,followers_count,name" } },
        );
        return r.followers_count ?? r.fan_count ?? null;
      },
      warnings,
      "page_followers",
    );

    const FB_ACCOUNT_MAP = metricMapFor("facebook", "account");
    // Only page-level native metrics that Graph v22 still returns as a
    // day-series. Deprecated: page_engaged_users, page_post_engagements at
    // page level, page_fan_adds/page_fan_removes (non-unique).
    const FB_METRICS = [
      "page_impressions",
      "page_impressions_unique",
      "page_actions_post_reactions_total",
      "page_fan_adds_unique",
      "page_fan_removes_unique",
      "page_views_total",
    ];
    const points = await this.safe(
      () =>
        this.meta.graph<InsightsResponse>(`/${ctx.externalId}/insights`, {
          accessToken: ctx.accessToken,
          query: {
            metric: FB_METRICS.join(","),
            period: "day",
            since: String(since),
            until: String(until),
          },
        }),
      warnings,
      "page_insights",
    );

    const series = toSeries(points?.data ?? [], FB_ACCOUNT_MAP);
    const totals = sumSeries(series);

    return {
      ok: true,
      data: {
        network: "facebook",
        connectionId: ctx.connectionId,
        accountId: ctx.externalId,
        accountName: ctx.externalName,
        accountHandle: null,
        range: opts.range,
        followers: fans ?? null,
        metrics: totals,
        series,
        warnings,
      },
    };
  }

  // --------------------------------------------------------------- Post ---
  async fetchPostAnalytics(
    ctx: ProviderContext,
    opts: PostAnalyticsOptions,
  ): Promise<ProviderResult<PostAnalytics>> {
    if (opts.network === "instagram") return this.fetchInstagramPost(ctx, opts);
    if (opts.network === "facebook") return this.fetchFacebookPost(ctx, opts);
    return { ok: false, error: `Meta não suporta network=${opts.network}` };
  }

  private async fetchInstagramPost(
    ctx: ProviderContext,
    opts: PostAnalyticsOptions,
  ): Promise<ProviderResult<PostAnalytics>> {
    const warnings: string[] = [];
    const meta = await this.safe(
      () =>
        this.meta.graph<IgMediaMeta>(`/${opts.externalPostId}`, {
          accessToken: ctx.accessToken,
          query: { fields: "media_type,permalink,caption,timestamp" },
        }),
      warnings,
      "media_meta",
    );

    const IG_POST_MAP = metricMapFor("instagram", "post");
    // v22+: media `impressions` is gone — `views` covers image/carousel/reel.
    const IG_POST_METRICS = [
      "views",
      "reach",
      "likes",
      "comments",
      "saved",
      "shares",
      "total_interactions",
    ];

    const insights = await this.safe(
      () =>
        this.meta.graph<InsightsResponse>(`/${opts.externalPostId}/insights`, {
          accessToken: ctx.accessToken,
          query: { metric: IG_POST_METRICS.join(",") },
        }),
      warnings,
      "media_insights",
    );

    const metrics = toPostMetrics(insights?.data ?? [], IG_POST_MAP);

    return {
      ok: true,
      data: {
        network: "instagram",
        connectionId: ctx.connectionId,
        externalPostId: opts.externalPostId,
        permalink: meta?.permalink ?? null,
        publishedAt: meta?.timestamp ?? null,
        placement: "instagram_feed",
        caption: meta?.caption ?? null,
        mediaType: mapIgMediaType(meta?.media_type ?? null),
        metrics,
        warnings,
      },
    };
  }

  private async fetchFacebookPost(
    ctx: ProviderContext,
    opts: PostAnalyticsOptions,
  ): Promise<ProviderResult<PostAnalytics>> {
    const warnings: string[] = [];
    const meta = await this.safe(
      () =>
        this.meta.graph<FbPostMeta>(`/${opts.externalPostId}`, {
          accessToken: ctx.accessToken,
          query: { fields: "message,permalink_url,created_time,type,attachments" },
        }),
      warnings,
      "post_meta",
    );

    const FB_POST_METRICS = [
      "post_impressions",
      "post_impressions_unique",
      "post_engaged_users",
      "post_clicks",
      "post_reactions_by_type_total",
    ];
    const insights = await this.safe(
      () =>
        this.meta.graph<InsightsResponse>(`/${opts.externalPostId}/insights`, {
          accessToken: ctx.accessToken,
          query: { metric: FB_POST_METRICS.join(",") },
        }),
      warnings,
      "post_insights",
    );

    const rows = insights?.data ?? [];
    const metrics: Metric[] = [];
    for (const row of rows) {
      const v = row.values?.[0]?.value;
      if (row.name === "post_reactions_by_type_total" && v && typeof v === "object") {
        const map = v as Record<string, number>;
        const likes = (map.like ?? 0) + (map.love ?? 0) + (map.wow ?? 0) + (map.haha ?? 0);
        metrics.push({ key: "likes", value: likes });
        continue;
      }
      const num = typeof v === "number" ? v : 0;
      const key = FB_POST_MAP[row.name];
      if (key) metrics.push({ key, value: num });
    }

    return {
      ok: true,
      data: {
        network: "facebook",
        connectionId: ctx.connectionId,
        externalPostId: opts.externalPostId,
        permalink: meta?.permalink_url ?? null,
        publishedAt: meta?.created_time ?? null,
        placement: "facebook_feed",
        caption: meta?.message ?? null,
        mediaType: mapFbType(meta?.type ?? null),
        metrics,
        warnings,
      },
    };
  }

  // --------------------------------------------------------- Recent posts ---
  async listRecentPosts(
    ctx: ProviderContext,
    opts: RecentPostsOptions,
  ): Promise<ProviderResult<PostAnalytics[]>> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);

    if (opts.network === "instagram") {
      if (!ctx.accountId) return { ok: false, error: "Sem Instagram Business vinculado" };
      const res = await this.safe(
        () =>
          this.meta.graph<{ data: Array<{ id: string }> }>(`/${ctx.accountId}/media`, {
            accessToken: ctx.accessToken,
            query: { fields: "id", limit: String(limit) },
          }),
        [],
        "ig_media_list",
      );
      const ids = (res?.data ?? []).map((m) => m.id);
      // Fan-out com concorrência limitada: 25 detalhes em paralelo era um
      // pico instantâneo de requisições que ajudava a estourar o limite do app.
      const all = await mapLimit(ids, ANALYTICS_CONCURRENCY, (id) =>
        this.fetchInstagramPost(ctx, { network: "instagram", externalPostId: id }),
      );
      return { ok: true, data: all.filter((r) => r.ok).map((r) => (r as any).data) };
    }

    if (opts.network === "facebook") {
      const res = await this.safe(
        () =>
          this.meta.graph<{ data: Array<{ id: string }> }>(`/${ctx.externalId}/posts`, {
            accessToken: ctx.accessToken,
            query: { fields: "id", limit: String(limit) },
          }),
        [],
        "fb_post_list",
      );
      const ids = (res?.data ?? []).map((m) => m.id);
      const all = await mapLimit(ids, ANALYTICS_CONCURRENCY, (id) =>
        this.fetchFacebookPost(ctx, { network: "facebook", externalPostId: id }),
      );
      return { ok: true, data: all.filter((r) => r.ok).map((r) => (r as any).data) };
    }

    return { ok: false, error: `Meta não suporta network=${opts.network}` };
  }

  // ----------------------------------------------------------- Utilities ---
  private async safe<T>(
    fn: () => Promise<T>,
    warnings: string[],
    label: string,
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      let msg = "Erro desconhecido";
      let code: number | undefined;
      let sub: number | undefined;
      if (err instanceof MetaGraphError) {
        msg = err.message;
        code = err.graph?.code;
        sub = err.graph?.error_subcode;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      const suffix = code != null ? ` (#${code}${sub ? `/${sub}` : ""})` : "";
      warnings.push(`${label}: ${msg}${suffix}`);
      console.warn("[meta-analytics]", label, { msg, code, sub });
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Wire helpers (Graph JSON → canonical model)
// ---------------------------------------------------------------------------

type InsightValue = { value: number | Record<string, number>; end_time?: string };
type InsightsResponse = { data: Array<{ name: string; values?: InsightValue[] }> };

type IgMediaMeta = {
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REELS";
  permalink?: string;
  caption?: string;
  timestamp?: string;
};

type FbPostMeta = {
  message?: string;
  permalink_url?: string;
  created_time?: string;
  type?: string;
};

const FB_POST_MAP: Record<string, Metric["key"]> = metricMapFor("facebook", "post");

function toEpochRange(range: { since: string; until: string }) {
  return {
    since: Math.floor(new Date(range.since).getTime() / 1000),
    until: Math.floor(new Date(range.until).getTime() / 1000),
  };
}

function toSeries(
  rows: InsightsResponse["data"],
  map: Record<string, Metric["key"]>,
): TimeSeriesPoint[] {
  const byDate = new Map<string, Metric[]>();
  for (const row of rows) {
    const key = map[row.name];
    if (!key) continue;
    for (const v of row.values ?? []) {
      if (typeof v.value !== "number" || !v.end_time) continue;
      const date = v.end_time.slice(0, 10);
      const bucket = byDate.get(date) ?? [];
      bucket.push({ key, value: v.value });
      byDate.set(date, bucket);
    }
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, metrics]) => ({ date, metrics }));
}

function sumSeries(series: TimeSeriesPoint[]): Metric[] {
  const totals = new Map<string, number>();
  for (const point of series) {
    for (const m of point.metrics) {
      totals.set(m.key, (totals.get(m.key) ?? 0) + m.value);
    }
  }
  return Array.from(totals.entries()).map(([key, value]) => ({ key, value }));
}

function mergeMetrics(...groups: Metric[][]): Metric[] {
  const totals = new Map<string, number>();
  for (const g of groups) {
    for (const m of g) totals.set(m.key, (totals.get(m.key) ?? 0) + m.value);
  }
  return Array.from(totals.entries()).map(([key, value]) => ({ key, value }));
}

function toPostMetrics(
  rows: InsightsResponse["data"],
  map: Record<string, Metric["key"]>,
): Metric[] {
  const out: Metric[] = [];
  for (const row of rows) {
    const key = map[row.name];
    if (!key) continue;
    const v = row.values?.[0]?.value;
    if (typeof v === "number") out.push({ key, value: v });
  }
  return out;
}

function mapIgMediaType(t: string | null): PostAnalytics["mediaType"] {
  switch (t) {
    case "IMAGE":
      return "image";
    case "VIDEO":
    case "REELS":
      return "video";
    case "CAROUSEL_ALBUM":
      return "carousel";
    default:
      return t ? "other" : null;
  }
}

function mapFbType(t: string | null): PostAnalytics["mediaType"] {
  if (!t) return null;
  if (t === "photo") return "image";
  if (t === "video") return "video";
  if (t === "status") return "text";
  return "other";
}
