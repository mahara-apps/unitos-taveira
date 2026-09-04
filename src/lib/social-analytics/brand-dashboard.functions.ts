import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SocialNetwork } from "./types";

/**
 * Social Analytics — brand-level unified dashboard.
 *
 * Consolida em UM único payload as métricas de TODAS as redes sociais
 * conectadas a uma marca. O frontend nunca lê APIs específicas: apenas
 * chama `getBrandSocialDashboardFn({ brandId, period })` e renderiza o
 * modelo canônico abaixo.
 *
 * Arquitetura:
 *   Dashboard → getBrandSocialDashboardFn → SocialAnalyticsService
 *   → SocialProvider → Meta / (LinkedIn / TikTok / …)
 */

// ---------------------------------------------------------------------------
// Modelo canônico exposto ao frontend
// ---------------------------------------------------------------------------

export type SocialKpi = {
  key: "followers" | "reach" | "impressions" | "engagement" | "posts" | "growth";
  label: string;
  value: number;
  /** Delta relativo (0-100) para o período anterior — null quando indisponível. */
  deltaPct: number | null;
};

export type ChannelPerformance = {
  network: SocialNetwork;
  connectionId: string;
  accountLabel: string;
  avatarUrl: string | null;
  followers: number | null;
  reach: number;
  impressions: number;
  engagement: number;
  posts: number;
  engagementRate: number | null;
  warnings: string[];
};

export type FormatPerformance = {
  format: "image" | "video" | "carousel" | "text" | "other";
  posts: number;
  engagement: number;
  reach: number;
  avgEngagement: number;
};

export type SocialTimePoint = {
  date: string; // YYYY-MM-DD
  reach: number;
  impressions: number;
  engagement: number;
  followers: number | null;
};

export type UnifiedTopPost = {
  network: SocialNetwork;
  connectionId: string;
  externalPostId: string;
  permalink: string | null;
  publishedAt: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  mediaType: "image" | "video" | "carousel" | "text" | "other" | null;
  score: number;
  engagement: number;
  reach: number;
  channelLabel: string;
};

export type BestSlot = {
  weekday: number; // 0=Sun … 6=Sat
  hour: number; // 0-23
  score: number;
  posts: number;
};

export type BrainSocialInsight = {
  id: string;
  type: string;
  description: string;
  confidence: number;
};

export type BrandSocialDashboard = {
  brandId: string;
  period: string;
  generatedAt: string;
  connectionsTotal: number;
  connectionsActive: number;
  networks: SocialNetwork[];
  summary: SocialKpi[];
  channels: ChannelPerformance[];
  formats: FormatPerformance[];
  series: SocialTimePoint[];
  topPosts: UnifiedTopPost[];
  bestHours: BestSlot[]; // top 5 hours
  bestDays: BestSlot[]; // 7 weekdays
  insights: BrainSocialInsight[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const Input = z.object({
  brandId: z.string().uuid(),
  /** Ex.: "7d", "30d", "90d". */
  period: z
    .string()
    .regex(/^\d{1,3}d$/)
    .default("30d"),
  /** Início explícito (ISO). Sobrepõe o cálculo por `period`. */
  since: z.string().datetime().optional(),
  /** Fim explícito (ISO). Sobrepõe o cálculo por `period`. */
  until: z.string().datetime().optional(),
  /** Escopo por cliente ativo — restringe conexões via client_social_accounts. */
  clientId: z.string().uuid().nullish(),
});

// Input separado para o payload pesado de top posts / formatos / timing.
const TopInput = Input;

export type BrandSocialTopPayload = {
  brandId: string;
  period: string;
  generatedAt: string;
  formats: FormatPerformance[];
  topPosts: UnifiedTopPost[];
  bestHours: BestSlot[];
  bestDays: BestSlot[];
  insights: BrainSocialInsight[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

export const getBrandSocialDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<BrandSocialDashboard> => {
    const range = resolveRange(data);

    // 0) Se houver cliente ativo, descobre as conexões vinculadas a ele.
    let allowedConnIds: Set<string> | null = null;
    if (data.clientId) {
      const { data: links, error: linkErr } = await context.supabase
        .from("client_social_accounts")
        .select("connection_id")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId);
      if (linkErr) throw new Error(linkErr.message);
      allowedConnIds = new Set((links ?? []).map((r: any) => r.connection_id));
    }

    // 1) Descobre TODAS as conexões da marca
    let connQ = context.supabase
      .from("social_connections")
      .select("id, provider, external_name, account_id, account_username, status, metadata")
      .eq("brand_id", data.brandId);
    if (allowedConnIds) {
      if (allowedConnIds.size === 0) {
        // Cliente sem canais vinculados — devolve dashboard vazio.
        return {
          brandId: data.brandId,
          period: data.period,
          generatedAt: new Date().toISOString(),
          connectionsTotal: 0,
          connectionsActive: 0,
          networks: [],
          summary: [
            { key: "followers", label: "Seguidores", value: 0, deltaPct: null },
            { key: "reach", label: "Alcance", value: 0, deltaPct: null },
            { key: "impressions", label: "Impressões", value: 0, deltaPct: null },
            { key: "engagement", label: "Engajamento", value: 0, deltaPct: null },
            { key: "posts", label: "Publicações", value: 0, deltaPct: null },
            { key: "growth", label: "Crescimento", value: 0, deltaPct: null },
          ],
          channels: [],
          formats: [],
          series: [],
          topPosts: [],
          bestHours: [],
          bestDays: [],
          insights: [],
          warnings: [],
        };
      }
      connQ = connQ.in("id", Array.from(allowedConnIds));
    }
    const { data: conns, error: connErr } = await connQ;
    if (connErr) throw new Error(connErr.message);

    // Expand cada linha para as networks publicáveis (Meta → FB + IG)
    const targets = expandConnections(conns ?? []);

    // 2) Carrega SocialAnalyticsService uma vez e itera em paralelo
    const svc = await import("./service.server");
    const prevRange = resolvePrevRange(range);
    const results = await Promise.allSettled(
      targets.map(async (t) => {
        const resolved = await svc.resolveConnection(
          context.supabase as any,
          t.connectionId,
          `${context.userId}:${t.connectionId}`,
        );
        (resolved as any).network = t.network;
        const [dashboard, prevDashboard] = await Promise.all([
          svc.getDashboard(resolved, { period: data.period, range }),
          svc.getDashboard(resolved, { period: data.period, range: prevRange }).catch(() => null),
        ]);
        return { target: t, dashboard, prevDashboard };
      }),
    );

    // 3) Consolida
    const warnings: string[] = [];
    const channels: ChannelPerformance[] = [];
    const seriesAgg = new Map<string, SocialTimePoint>();
    const networks = new Set<SocialNetwork>();

    let totalFollowers = 0;
    let totalReach = 0;
    let totalImpressions = 0;
    let totalEngagement = 0;
    let totalPosts = 0;
    let totalGained = 0;
    let totalLost = 0;
    let activeCount = 0;

    let prevFollowers = 0;
    let prevReach = 0;
    let prevImpressions = 0;
    let prevEngagement = 0;
    let prevPosts = 0;
    let prevGained = 0;
    let prevLost = 0;

    for (const r of results) {
      if (r.status === "rejected") {
        warnings.push(String((r.reason as Error)?.message ?? "provider error"));
        continue;
      }
      activeCount++;
      const { target, dashboard, prevDashboard } = r.value;
      const totals = dashboard.totals ?? [];
      const profile = dashboard.profile;
      networks.add(target.network);

      const reach = mv(totals, "reach") ?? 0;
      const impressions = mv(totals, "impressions") ?? 0;
      const engagement = mv(totals, "engagement") ?? 0;
      const followers = profile?.followers ?? null;
      const gained = mv(totals, "followers_gained") ?? 0;
      const lost = mv(totals, "followers_lost") ?? 0;
      const posts =
        mv(totals, "posts") ?? mv(totals, "posts_count") ?? dashboard.series?.length ?? 0;

      totalReach += reach;
      totalImpressions += impressions;
      totalEngagement += engagement;
      totalGained += gained;
      totalLost += lost;
      totalPosts += posts;
      if (followers) totalFollowers += followers;

      if (prevDashboard) {
        const pt = prevDashboard.totals ?? [];
        prevReach += mv(pt, "reach") ?? 0;
        prevImpressions += mv(pt, "impressions") ?? 0;
        prevEngagement += mv(pt, "engagement") ?? 0;
        prevGained += mv(pt, "followers_gained") ?? 0;
        prevLost += mv(pt, "followers_lost") ?? 0;
        prevPosts += mv(pt, "posts") ?? mv(pt, "posts_count") ?? prevDashboard.series?.length ?? 0;
        const pf = prevDashboard.profile?.followers;
        if (pf) prevFollowers += pf;
      }

      const engagementRate =
        followers && followers > 0
          ? round2((engagement / followers) * 100)
          : reach > 0
            ? round2((engagement / reach) * 100)
            : impressions > 0
              ? round2((engagement / impressions) * 100)
              : null;

      channels.push({
        network: target.network,
        connectionId: target.connectionId,
        accountLabel: target.label,
        avatarUrl: target.avatarUrl,
        followers,
        reach,
        impressions,
        engagement,
        posts,
        engagementRate,
        warnings: dashboard.warnings ?? [],
      });

      // Séries diárias
      for (const p of dashboard.series ?? []) {
        const bucket = seriesAgg.get(p.date) ?? {
          date: p.date,
          reach: 0,
          impressions: 0,
          engagement: 0,
          followers: null,
        };
        bucket.reach += mv(p.metrics, "reach") ?? 0;
        bucket.impressions += mv(p.metrics, "impressions") ?? 0;
        bucket.engagement += mv(p.metrics, "engagement") ?? 0;
        const f = mv(p.metrics, "followers");
        // Snapshot: mantém o maior valor por dia entre as redes em vez de somar,
        // para não estourar a escala do gráfico de evolução.
        if (f != null) bucket.followers = Math.max(bucket.followers ?? 0, f);
        seriesAgg.set(p.date, bucket);
      }
    }

    // Séries: ordena por data
    const series = Array.from(seriesAgg.values()).sort((a, b) => a.date.localeCompare(b.date));

    const growthPct =
      totalFollowers > 0 ? round2(((totalGained - totalLost) / totalFollowers) * 100) : null;

    const summary: SocialKpi[] = [
      {
        key: "followers",
        label: "Seguidores",
        value: totalFollowers,
        deltaPct: delta(totalFollowers, prevFollowers),
      },
      { key: "reach", label: "Alcance", value: totalReach, deltaPct: delta(totalReach, prevReach) },
      {
        key: "impressions",
        label: "Impressões",
        value: totalImpressions,
        deltaPct: delta(totalImpressions, prevImpressions),
      },
      {
        key: "engagement",
        label: "Engajamento",
        value: totalEngagement,
        deltaPct: delta(totalEngagement, prevEngagement),
      },
      {
        key: "posts",
        label: "Publicações",
        value: totalPosts,
        deltaPct: delta(totalPosts, prevPosts),
      },
      {
        key: "growth",
        label: "Crescimento",
        value: totalGained - totalLost,
        deltaPct: growthPct ?? delta(totalGained - totalLost, prevGained - prevLost),
      },
    ];

    return {
      brandId: data.brandId,
      period: data.period,
      generatedAt: new Date().toISOString(),
      connectionsTotal: targets.length,
      connectionsActive: activeCount,
      networks: Array.from(networks),
      summary,
      channels: channels.sort((a, b) => b.engagement - a.engagement),
      formats: [],
      series,
      topPosts: [],
      bestHours: [],
      bestDays: [],
      insights: [],
      warnings,
    };
  });

// ---------------------------------------------------------------------------
// Payload pesado — top posts, formatos, timing, insights do Brain.
// Split para não bloquear o render de KPIs / séries.
// ---------------------------------------------------------------------------

export const getBrandSocialTopPayloadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TopInput.parse(i))
  .handler(async ({ data, context }): Promise<BrandSocialTopPayload> => {
    const range = resolveRange(data);
    let allowedConnIds: Set<string> | null = null;
    if (data.clientId) {
      const { data: links, error: linkErr } = await context.supabase
        .from("client_social_accounts")
        .select("connection_id")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId);
      if (linkErr) throw new Error(linkErr.message);
      allowedConnIds = new Set((links ?? []).map((r: any) => r.connection_id));
      if (allowedConnIds.size === 0) {
        return {
          brandId: data.brandId,
          period: data.period,
          generatedAt: new Date().toISOString(),
          formats: [],
          topPosts: [],
          bestHours: [],
          bestDays: [],
          insights: [],
          warnings: [],
        };
      }
    }

    let connQ = context.supabase
      .from("social_connections")
      .select("id, provider, external_name, account_id, account_username, status, metadata")
      .eq("brand_id", data.brandId);
    if (allowedConnIds) connQ = connQ.in("id", Array.from(allowedConnIds));
    const { data: conns, error: connErr } = await connQ;
    if (connErr) throw new Error(connErr.message);

    const targets = expandConnections(conns ?? []);
    const svc = await import("./service.server");

    const results = await Promise.allSettled(
      targets.map(async (t) => {
        const resolved = await svc.resolveConnection(
          context.supabase as any,
          t.connectionId,
          `${context.userId}:${t.connectionId}`,
        );
        (resolved as any).network = t.network;
        // Coletamos até 30 posts para melhorar as agregações de formato/timing,
        // mas exibimos apenas os 12 melhores no grid.
        const topWarnings: string[] = [];
        const top = await svc.getTopPosts(resolved, { limit: 30, range }).catch((err: Error) => {
          topWarnings.push(`[${t.network}] top-posts: ${err.message}`);
          return [] as any[];
        });
        // Filtro por publishedAt dentro do range (garantia caso o provider ignore).
        const sinceMs = new Date(range.since).getTime();
        const untilMs = new Date(range.until).getTime();
        const filtered = top.filter((p: any) => {
          if (!p.publishedAt) return false;
          const t = new Date(p.publishedAt).getTime();
          return t >= sinceMs && t <= untilMs;
        });
        return { target: t, top: filtered, warnings: topWarnings };
      }),
    );

    const warnings: string[] = [];
    const formatAgg = new Map<string, FormatPerformance>();
    const topPostsAll: UnifiedTopPost[] = [];
    const slotAgg = new Map<string, BestSlot>();
    const weekdayAgg = new Map<number, BestSlot>();

    for (const r of results) {
      if (r.status === "rejected") {
        warnings.push(String((r.reason as Error)?.message ?? "provider error"));
        continue;
      }
      const { target, top, warnings: tw } = r.value;
      if (tw?.length) warnings.push(...tw);
      for (const post of top) {
        const eng =
          mv(post.metrics, "engagement") ??
          (mv(post.metrics, "likes") ?? 0) * 1 +
            (mv(post.metrics, "comments") ?? 0) * 2 +
            (mv(post.metrics, "shares") ?? 0) * 3 +
            (mv(post.metrics, "saves") ?? 0) * 3;
        const postReach = mv(post.metrics, "reach") ?? 0;
        const score = eng + postReach * 0.1;
        topPostsAll.push({
          network: target.network,
          connectionId: target.connectionId,
          externalPostId: post.externalPostId,
          permalink: post.permalink ?? null,
          publishedAt: post.publishedAt ?? null,
          caption: post.caption ?? null,
          thumbnailUrl: post.thumbnailUrl ?? null,
          mediaType: post.mediaType ?? null,
          score,
          engagement: eng,
          reach: postReach,
          channelLabel: target.label,
        });

        const fmt = (post.mediaType ?? "other") as FormatPerformance["format"];
        const bucket = formatAgg.get(fmt) ?? {
          format: fmt,
          posts: 0,
          engagement: 0,
          reach: 0,
          avgEngagement: 0,
        };
        bucket.posts += 1;
        bucket.engagement += eng;
        bucket.reach += postReach;
        formatAgg.set(fmt, bucket);

        if (post.publishedAt) {
          const d = new Date(post.publishedAt);
          const weekday = d.getUTCDay();
          const hour = d.getUTCHours();
          const key = `${weekday}-${hour}`;
          const slot = slotAgg.get(key) ?? { weekday, hour, score: 0, posts: 0 };
          slot.score += eng;
          slot.posts += 1;
          slotAgg.set(key, slot);

          const w = weekdayAgg.get(weekday) ?? { weekday, hour: 0, score: 0, posts: 0 };
          w.score += eng;
          w.posts += 1;
          weekdayAgg.set(weekday, w);
        }
      }
    }

    const formats = Array.from(formatAgg.values())
      .map((f) => ({ ...f, avgEngagement: f.posts ? round2(f.engagement / f.posts) : 0 }))
      .sort((a, b) => b.engagement - a.engagement);

    const topPosts = topPostsAll.sort((a, b) => b.score - a.score).slice(0, 10);
    const bestHours = Array.from(slotAgg.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    const bestDays = Array.from(weekdayAgg.values()).sort((a, b) => b.score - a.score);

    let insights: BrainSocialInsight[] = [];
    try {
      const { brain } = await import("@/lib/brain/api");
      const rows = await brain.insights.list(
        { supabase: context.supabase as any, brandId: data.brandId } as any,
        { limit: 20 },
      );
      insights = (rows ?? [])
        .filter((r: any) =>
          /(social|post|instagram|facebook|meta|content|reach|engagement|audience|schedule)/i.test(
            String(r.insight_type ?? "") + " " + String(r.description ?? ""),
          ),
        )
        .slice(0, 8)
        .map((r: any, i: number) => ({
          id: r.id ?? `${i}`,
          type: r.insight_type ?? "insight",
          description: r.description ?? "",
          confidence: Number(r.confidence ?? 0.5),
        }));
    } catch (e) {
      warnings.push(`brain_unavailable: ${(e as Error).message}`);
    }

    return {
      brandId: data.brandId,
      period: data.period,
      generatedAt: new Date().toISOString(),
      formats,
      topPosts,
      bestHours,
      bestDays,
      insights,
      warnings,
    };
  });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function parseDays(period: string): number {
  return Math.min(Math.max(Number.parseInt(period, 10) || 30, 1), 365);
}

function resolveRange(input: { period: string; since?: string; until?: string }): {
  since: string;
  until: string;
} {
  if (input.since && input.until) {
    return { since: input.since, until: input.until };
  }
  const days = parseDays(input.period);
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: until.toISOString() };
}

function resolvePrevRange(range: { since: string; until: string }): {
  since: string;
  until: string;
} {
  const s = new Date(range.since).getTime();
  const u = new Date(range.until).getTime();
  const span = Math.max(u - s, 24 * 60 * 60 * 1000);
  return {
    since: new Date(s - span).toISOString(),
    until: new Date(s).toISOString(),
  };
}

function delta(curr: number, prev: number): number | null {
  if (!prev || prev === 0) return null;
  return round2(((curr - prev) / prev) * 100);
}

function mv(list: { key: string; value: number }[] | undefined, key: string) {
  if (!list) return null;
  const m = list.find((x) => x.key === key);
  return m ? m.value : null;
}

function sumInteractions(posts: Array<{ metrics: any[] }>): number {
  let n = 0;
  for (const p of posts) {
    n +=
      (mv(p.metrics, "likes") ?? 0) +
      (mv(p.metrics, "comments") ?? 0) +
      (mv(p.metrics, "shares") ?? 0) +
      (mv(p.metrics, "saves") ?? 0);
  }
  return n;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type Target = {
  connectionId: string;
  network: SocialNetwork;
  label: string;
  avatarUrl: string | null;
};

function expandConnections(rows: any[]): Target[] {
  const out: Target[] = [];
  for (const r of rows) {
    const meta = (r.metadata ?? {}) as Record<string, any>;
    const prov = String(r.provider ?? "").toLowerCase();
    if (prov === "meta" || prov.startsWith("meta")) {
      out.push({
        connectionId: r.id,
        network: "facebook",
        label: r.external_name ?? "Facebook",
        avatarUrl: meta.page_picture_url ?? null,
      });
      if (r.account_id) {
        out.push({
          connectionId: r.id,
          network: "instagram",
          label: r.account_username ? `@${r.account_username}` : "Instagram",
          avatarUrl: meta.instagram_picture_url ?? meta.page_picture_url ?? null,
        });
      }
      continue;
    }
    // Redes single-account (linkedin, tiktok, youtube, x, threads)
    const single = ["linkedin", "tiktok", "youtube", "x", "threads"].find((k) => prov === k);
    if (single) {
      out.push({
        connectionId: r.id,
        network: single as SocialNetwork,
        label: r.external_name ?? single,
        avatarUrl: meta.picture_url ?? null,
      });
    }
  }
  return out;
}
