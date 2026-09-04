import { MetaProvider as MetaGraphClient, MetaGraphError } from "@/lib/meta/provider.server";
import { MetaAnalyticsProvider } from "@/lib/social-analytics/providers/meta.server";
import type { ProviderContext as AnalyticsProviderContext } from "@/lib/social-analytics/provider";
import type {
  AudienceBreakdown,
  ConnectOptions,
  DisconnectOptions,
  GetAudienceOptions,
  GetDashboardOptions,
  GetPostOptions,
  GetPostsOptions,
  GetProfileOptions,
  GetTopPostsOptions,
  Metric,
  ProviderResult,
  PublishOptions,
  RefreshTokenOptions,
  ScheduleOptions,
  SocialConnectStart,
  SocialAudience,
  SocialDashboard,
  SocialMediaType,
  SocialNetwork,
  SocialPost,
  SocialProfile,
  SocialPublishResult,
  SocialScheduleResult,
  SocialTokenInfo,
  TimeSeriesPoint,
} from "../types";
import type { SocialProvider, SocialProviderContext } from "../provider";

/**
 * Meta Social Provider — high-level facade over Facebook Pages + Instagram
 * Business via the Graph API. Delegates the analytics-shaped calls to
 * `MetaAnalyticsProvider` and adds profile / audience / top-posts semantics.
 */
export class MetaProvider implements SocialProvider {
  readonly networks = ["facebook", "instagram"] as const;
  readonly label = "Meta";

  constructor(
    private graph: MetaGraphClient = new MetaGraphClient(),
    private analytics: MetaAnalyticsProvider = new MetaAnalyticsProvider(graph),
  ) {}

  // ================================ Lifecycle ================================
  async connect(opts: ConnectOptions): Promise<ProviderResult<SocialConnectStart>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    try {
      // Signed state: brandId + userId + optional returnUrl.
      const { signOAuthState } = await import("@/lib/meta/provider.server");
      const state = await signOAuthState({
        brandId: opts.brandId,
        userId: opts.userId,
        redirectTo: opts.returnUrl ?? null,
      });
      const authorizeUrl = await this.graph.buildAuthorizeUrl({
        state,
        display: "popup",
        authType: "rerequest",
      });
      return { ok: true, data: { network: opts.network, authorizeUrl, state } };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async disconnect(
    ctx: SocialProviderContext,
    opts: DisconnectOptions,
  ): Promise<ProviderResult<{ revoked: boolean }>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    try {
      // Meta revoke targets the Meta USER id, not the page id. If we don't
      // have it stored we still return ok:true so the caller can mark the
      // row disconnected — Meta will eventually invalidate the token.
      const metaUserId = ctx.externalId; // page id is fine for /permissions on page tokens
      await this.graph.revoke(ctx.accessToken, metaUserId).catch(() => {});
      return { ok: true, data: { revoked: true } };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async refreshToken(
    ctx: SocialProviderContext,
    opts: RefreshTokenOptions,
  ): Promise<ProviderResult<SocialTokenInfo & { accessToken: string }>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    try {
      const info = await this.graph.refreshLongLivedUserToken(ctx.accessToken);
      const expiresAt =
        info.expiresIn && info.expiresIn > 0
          ? new Date(Date.now() + info.expiresIn * 1000).toISOString()
          : null;
      return {
        ok: true,
        data: {
          network: opts.network,
          connectionId: ctx.connectionId,
          accessToken: info.accessToken,
          expiresAt,
          refreshedAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ================================ Publish ================================
  async publish(
    ctx: SocialProviderContext,
    opts: PublishOptions,
  ): Promise<ProviderResult<SocialPublishResult>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    if (opts.placement !== "feed") {
      return {
        ok: false,
        error: `Placement "${opts.placement}" ainda não suportado para Meta`,
        code: "unsupported_placement",
      };
    }
    try {
      const { MetaPublishingService } = await import("@/lib/meta/publishing.server");
      const svc = new MetaPublishingService(this.graph);
      // The publishing service reads the access_token_ciphertext from the
      // row. Providers only have the decrypted token — we adapt by passing
      // a lightweight row-like object whose decrypt step is bypassed via a
      // pre-decrypted shortcut.
      const result = await svc.publishWithDecryptedToken(
        {
          id: ctx.connectionId,
          provider: ctx.provider,
          external_id: ctx.externalId,
          account_id: ctx.accountId,
        },
        ctx.accessToken,
        {
          placement: opts.network === "instagram" ? "instagram_feed" : "facebook_feed",
          caption: buildCaption(opts.caption, opts.hashtags, opts.mentions),
          media: {
            imageUrl: opts.media.imageUrl,
            link: opts.media.link,
          },
        },
      );
      return {
        ok: true,
        data: {
          network: opts.network,
          externalPostId: result.externalPostId,
          externalPermalink: result.externalPermalink,
          providerResponse: result.providerResponse,
        },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async schedule(
    ctx: SocialProviderContext,
    opts: ScheduleOptions,
  ): Promise<ProviderResult<SocialScheduleResult>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    // Scheduling for Meta is persisted through `social_posts` and executed
    // by the cron worker — the provider only validates the request here.
    // The service layer is responsible for insert; providers stay stateless.
    if (opts.placement !== "feed") {
      return { ok: false, error: `Placement "${opts.placement}" não suportado` };
    }
    return {
      ok: true,
      data: {
        network: opts.network,
        scheduledAt: opts.scheduledAt,
        reference: `pending:${ctx.connectionId}`,
      },
    };
  }

  // -------------------------------------------------------- getDashboard ---
  async getDashboard(
    ctx: SocialProviderContext,
    opts: GetDashboardOptions,
  ): Promise<ProviderResult<SocialDashboard>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);

    const [accountRes, profileRes, topRes] = await Promise.all([
      this.analytics.fetchAccountAnalytics(this.toAnalyticsCtx(ctx), {
        network: opts.network,
        range: opts.range,
      }),
      this.getProfile(ctx, { network: opts.network }),
      this.getTopPosts(ctx, { network: opts.network, limit: 5 }),
    ]);

    if (!accountRes.ok) return { ok: false, error: accountRes.error, code: accountRes.code };

    const warnings = [...accountRes.data.warnings];
    if (!profileRes.ok) warnings.push(`profile: ${profileRes.error}`);
    if (!topRes.ok) warnings.push(`top_posts: ${topRes.error}`);

    return {
      ok: true,
      data: {
        network: opts.network,
        connectionId: ctx.connectionId,
        range: opts.range,
        profile: profileRes.ok ? profileRes.data : null,
        totals: accountRes.data.metrics,
        series: accountRes.data.series,
        topPosts: topRes.ok ? topRes.data : [],
        warnings,
      },
    };
  }

  // ------------------------------------------------------------ getPosts ---
  async getPosts(
    ctx: SocialProviderContext,
    opts: GetPostsOptions,
  ): Promise<ProviderResult<SocialPost[]>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    const res = await this.analytics.listRecentPosts(this.toAnalyticsCtx(ctx), {
      network: opts.network,
      limit: opts.limit,
    });
    if (!res.ok) return res;
    const enriched = await Promise.all(
      res.data.map((p) => this.enrichThumbnail(ctx, opts.network, p)),
    );
    return { ok: true, data: enriched };
  }

  // ------------------------------------------------------------- getPost ---
  async getPost(
    ctx: SocialProviderContext,
    opts: GetPostOptions,
  ): Promise<ProviderResult<SocialPost>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    const res = await this.analytics.fetchPostAnalytics(this.toAnalyticsCtx(ctx), {
      network: opts.network,
      externalPostId: opts.postId,
    });
    if (!res.ok) return res;
    const enriched = await this.enrichThumbnail(ctx, opts.network, res.data);
    return { ok: true, data: enriched };
  }

  // --------------------------------------------------------- getTopPosts ---
  async getTopPosts(
    ctx: SocialProviderContext,
    opts: GetTopPostsOptions,
  ): Promise<ProviderResult<SocialPost[]>> {
    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 25);
    const sortBy = opts.sortBy ?? "engagement";
    const list = await this.getPosts(ctx, {
      network: opts.network,
      limit: Math.max(limit * 2, 10),
    });
    if (!list.ok) return list;
    const scored = list.data
      .map((p) => ({ p, score: scoreOf(p, sortBy) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ p }) => p);
    return { ok: true, data: scored };
  }

  // ---------------------------------------------------------- getAudience ---
  async getAudience(
    ctx: SocialProviderContext,
    opts: GetAudienceOptions,
  ): Promise<ProviderResult<SocialAudience>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    if (opts.network === "instagram") return this.getInstagramAudience(ctx, opts);
    return this.getFacebookAudience(ctx, opts);
  }

  // ----------------------------------------------------------- getProfile ---
  async getProfile(
    ctx: SocialProviderContext,
    opts: GetProfileOptions,
  ): Promise<ProviderResult<SocialProfile>> {
    if (!this.supports(opts.network)) return this.unsupported(opts.network);
    if (opts.network === "instagram") return this.getInstagramProfile(ctx);
    return this.getFacebookProfile(ctx);
  }

  // -------------------------------------------------------- IG internals ---
  private async getInstagramProfile(
    ctx: SocialProviderContext,
  ): Promise<ProviderResult<SocialProfile>> {
    if (!ctx.accountId) {
      return { ok: false, error: "Página sem Instagram Business vinculado" };
    }
    const warnings: string[] = [];
    const data = await this.safe(
      () =>
        this.graph.graph<IgProfile>(`/${ctx.accountId}`, {
          accessToken: ctx.accessToken,
          query: {
            fields:
              "id,username,name,biography,profile_picture_url,followers_count,follows_count,media_count,website",
          },
        }),
      warnings,
      "ig_profile",
    );
    return {
      ok: true,
      data: {
        network: "instagram",
        connectionId: ctx.connectionId,
        externalId: ctx.accountId,
        name: data?.name ?? ctx.externalName,
        handle: data?.username ?? ctx.accountUsername,
        avatarUrl: data?.profile_picture_url ?? null,
        bio: data?.biography ?? null,
        website: data?.website ?? null,
        verified: null,
        followers: data?.followers_count ?? null,
        following: data?.follows_count ?? null,
        postsCount: data?.media_count ?? null,
        warnings,
      },
    };
  }

  private async getInstagramAudience(
    ctx: SocialProviderContext,
    opts: GetAudienceOptions,
  ): Promise<ProviderResult<SocialAudience>> {
    if (!ctx.accountId) {
      return { ok: false, error: "Página sem Instagram Business vinculado" };
    }
    const warnings: string[] = [];
    const { since, until } = toEpochRange(opts.range);

    const followers = await this.safe(
      async () => {
        const r = await this.graph.graph<{ followers_count?: number }>(`/${ctx.accountId}`, {
          accessToken: ctx.accessToken,
          query: { fields: "followers_count" },
        });
        return r.followers_count ?? null;
      },
      warnings,
      "followers_count",
    );

    const growth = await this.safe(
      () =>
        this.graph.graph<InsightsResponse>(`/${ctx.accountId}/insights`, {
          accessToken: ctx.accessToken,
          query: {
            metric: "follower_count",
            period: "day",
            since: String(since),
            until: String(until),
          },
        }),
      warnings,
      "ig_follower_series",
    );

    const growthSeries = toSeries(growth?.data ?? [], { follower_count: "followers_gained" });
    const gained = sumSeries(growthSeries).find((m) => m.key === "followers_gained")?.value ?? null;

    const breakdowns: AudienceBreakdown[] = [];
    for (const metric of ["audience_gender_age", "audience_country", "audience_city"] as const) {
      const res = await this.safe(
        () =>
          this.graph.graph<InsightsResponse>(`/${ctx.accountId}/insights`, {
            accessToken: ctx.accessToken,
            query: { metric, period: "lifetime" },
          }),
        warnings,
        `ig_${metric}`,
      );
      const raw = res?.data?.[0]?.values?.[0]?.value;
      if (raw && typeof raw === "object") {
        breakdowns.push({
          key: metric,
          segments: Object.entries(raw as Record<string, number>)
            .map(([label, value]) => ({ label, value: Number(value) || 0 }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 25),
        });
      }
    }

    return {
      ok: true,
      data: {
        network: "instagram",
        connectionId: ctx.connectionId,
        range: opts.range,
        totalFollowers: followers ?? null,
        followersGained: gained,
        followersLost: null,
        growthSeries,
        breakdowns,
        warnings,
      },
    };
  }

  // -------------------------------------------------------- FB internals ---
  private async getFacebookProfile(
    ctx: SocialProviderContext,
  ): Promise<ProviderResult<SocialProfile>> {
    const warnings: string[] = [];
    const data = await this.safe(
      () =>
        this.graph.graph<FbProfile>(`/${ctx.externalId}`, {
          accessToken: ctx.accessToken,
          query: {
            fields:
              "id,name,username,about,link,fan_count,followers_count,verification_status,picture.type(large){url}",
          },
        }),
      warnings,
      "fb_profile",
    );
    return {
      ok: true,
      data: {
        network: "facebook",
        connectionId: ctx.connectionId,
        externalId: ctx.externalId,
        name: data?.name ?? ctx.externalName,
        handle: data?.username ?? null,
        avatarUrl: data?.picture?.data?.url ?? null,
        bio: data?.about ?? null,
        website: data?.link ?? null,
        verified: data?.verification_status ? data.verification_status !== "not_verified" : null,
        followers: data?.followers_count ?? data?.fan_count ?? null,
        following: null,
        postsCount: null,
        warnings,
      },
    };
  }

  private async getFacebookAudience(
    ctx: SocialProviderContext,
    opts: GetAudienceOptions,
  ): Promise<ProviderResult<SocialAudience>> {
    const warnings: string[] = [];
    const { since, until } = toEpochRange(opts.range);

    const totalFollowers = await this.safe(
      async () => {
        const r = await this.graph.graph<{ fan_count?: number; followers_count?: number }>(
          `/${ctx.externalId}`,
          { accessToken: ctx.accessToken, query: { fields: "fan_count,followers_count" } },
        );
        return r.followers_count ?? r.fan_count ?? null;
      },
      warnings,
      "fb_followers",
    );

    const growth = await this.safe(
      () =>
        this.graph.graph<InsightsResponse>(`/${ctx.externalId}/insights`, {
          accessToken: ctx.accessToken,
          query: {
            metric: "page_fan_adds,page_fan_removes",
            period: "day",
            since: String(since),
            until: String(until),
          },
        }),
      warnings,
      "fb_follower_series",
    );

    const growthSeries = toSeries(growth?.data ?? [], {
      page_fan_adds: "followers_gained",
      page_fan_removes: "followers_lost",
    });
    const totals = sumSeries(growthSeries);
    const gained = totals.find((m) => m.key === "followers_gained")?.value ?? null;
    const lost = totals.find((m) => m.key === "followers_lost")?.value ?? null;

    const breakdowns: AudienceBreakdown[] = [];
    for (const metric of ["page_fans_country", "page_fans_gender_age", "page_fans_city"] as const) {
      const res = await this.safe(
        () =>
          this.graph.graph<InsightsResponse>(`/${ctx.externalId}/insights`, {
            accessToken: ctx.accessToken,
            query: { metric, period: "lifetime" },
          }),
        warnings,
        `fb_${metric}`,
      );
      const raw = res?.data?.[0]?.values?.[0]?.value;
      if (raw && typeof raw === "object") {
        breakdowns.push({
          key: metric,
          segments: Object.entries(raw as Record<string, number>)
            .map(([label, value]) => ({ label, value: Number(value) || 0 }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 25),
        });
      }
    }

    return {
      ok: true,
      data: {
        network: "facebook",
        connectionId: ctx.connectionId,
        range: opts.range,
        totalFollowers: totalFollowers ?? null,
        followersGained: gained,
        followersLost: lost,
        growthSeries,
        breakdowns,
        warnings,
      },
    };
  }

  // ------------------------------------------------------------- Helpers ---
  private supports(network: SocialNetwork): boolean {
    return (this.networks as readonly SocialNetwork[]).includes(network);
  }

  private unsupported(network: SocialNetwork): ProviderResult<never> {
    return { ok: false, error: `Meta não suporta network=${network}`, code: "unsupported_network" };
  }

  private toAnalyticsCtx(ctx: SocialProviderContext): AnalyticsProviderContext {
    return {
      connectionId: ctx.connectionId,
      brandId: ctx.brandId,
      provider: ctx.provider,
      externalId: ctx.externalId,
      externalName: ctx.externalName,
      accountId: ctx.accountId,
      accountUsername: ctx.accountUsername,
      accessToken: ctx.accessToken,
    };
  }

  private async enrichThumbnail(
    ctx: SocialProviderContext,
    network: SocialNetwork,
    post: {
      externalPostId: string;
      permalink: string | null;
      publishedAt: string | null;
      caption: string | null;
      mediaType: SocialMediaType;
      metrics: Metric[];
      warnings: string[];
      connectionId: string;
      network: SocialNetwork;
    },
  ): Promise<SocialPost> {
    const warnings = [...post.warnings];
    let thumbnailUrl: string | null = null;
    try {
      if (network === "instagram") {
        const r = await this.graph.graph<{ thumbnail_url?: string; media_url?: string }>(
          `/${post.externalPostId}`,
          { accessToken: ctx.accessToken, query: { fields: "thumbnail_url,media_url" } },
        );
        thumbnailUrl = r.thumbnail_url ?? r.media_url ?? null;
      } else if (network === "facebook") {
        const r = await this.graph.graph<{ full_picture?: string }>(`/${post.externalPostId}`, {
          accessToken: ctx.accessToken,
          query: { fields: "full_picture" },
        });
        thumbnailUrl = r.full_picture ?? null;
      }
    } catch (err) {
      warnings.push(`thumbnail: ${err instanceof Error ? err.message : "erro"}`);
    }
    return { ...post, thumbnailUrl, warnings };
  }

  private async safe<T>(
    fn: () => Promise<T>,
    warnings: string[],
    label: string,
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const msg =
        err instanceof MetaGraphError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Erro desconhecido";
      warnings.push(`${label}: ${msg}`);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Wire helpers (Graph JSON → canonical model)
// ---------------------------------------------------------------------------

type InsightValue = { value: number | Record<string, number>; end_time?: string };
type InsightsResponse = { data: Array<{ name: string; values?: InsightValue[] }> };

function buildCaption(
  base?: string,
  hashtags: string[] = [],
  mentions: string[] = [],
): string | undefined {
  const parts: string[] = [];
  if (base) parts.push(base);
  const ats = mentions.filter(Boolean).map((m) => (m.startsWith("@") ? m : `@${m}`));
  const tags = hashtags.filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  if (ats.length) parts.push(ats.join(" "));
  if (tags.length) parts.push(tags.join(" "));
  const out = parts.join("\n\n").trim();
  return out.length ? out : undefined;
}

type IgProfile = {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
  website?: string;
};

type FbProfile = {
  id?: string;
  name?: string;
  username?: string;
  about?: string;
  link?: string;
  fan_count?: number;
  followers_count?: number;
  verification_status?: string;
  picture?: { data?: { url?: string } };
};

function toEpochRange(range: { since: string; until: string }) {
  return {
    since: Math.floor(new Date(range.since).getTime() / 1000),
    until: Math.floor(new Date(range.until).getTime() / 1000),
  };
}

function toSeries(rows: InsightsResponse["data"], map: Record<string, string>): TimeSeriesPoint[] {
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

function scoreOf(post: SocialPost, sortBy: string): number {
  const direct = post.metrics.find((m) => m.key === sortBy)?.value;
  if (typeof direct === "number") return direct;
  if (sortBy === "engagement") {
    const pick = (k: string) => post.metrics.find((m) => m.key === k)?.value ?? 0;
    return pick("likes") + pick("comments") + pick("shares") + pick("saves");
  }
  return 0;
}
