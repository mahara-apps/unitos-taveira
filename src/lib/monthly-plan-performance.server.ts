import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { PLAN_CHANNEL_LABEL, type PlanChannel } from "@/lib/monthly-plan-fields";

/**
 * Contexto de DESEMPENHO REAL por canal para a geração de Pauta.
 *
 * Fonte primária: contas conectadas do cliente (`social_connections`) lidas via
 * `SocialAnalyticsService` — jamais chamando providers/Graph API diretamente.
 * Fonte de apoio: histórico interno (`social_posts`) quando a API não responder.
 *
 * Blindagem obrigatória: cada canal roda em paralelo, com timeout curto e
 * try/catch. Falha nunca interrompe a geração — vira "métricas indisponíveis".
 */

const PER_CHANNEL_TIMEOUT_MS = 7000;
const LOOKBACK_DAYS = 30;

export type ChannelPerformance = {
  channel: PlanChannel;
  connected: boolean;
  /** Métricas obtidas da API do provedor. */
  hasMetrics: boolean;
  note: string | null;
  followers: number | null;
  avgEngagement: number | null;
  topFormats: string[];
  topPosts: Array<{ caption: string; mediaType: string | null; engagement: number | null }>;
  weakFormats: string[];
};

export type PerformanceContext = {
  markdown: string;
  channels: ChannelPerformance[];
  /** Canais com métricas reais disponíveis. */
  channelsWithMetrics: PlanChannel[];
  /** Canais solicitados sem conta conectada. */
  channelsWithoutAccount: PlanChannel[];
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function metricValue(metrics: Array<{ key: string; value: number }> | undefined, keys: string[]) {
  if (!metrics) return null;
  for (const k of keys) {
    const found = metrics.find((m) => m.key === k);
    if (found && Number.isFinite(found.value)) return found.value;
  }
  return null;
}

export async function loadPerformanceContext(
  supabase: SupabaseClient<Database>,
  args: {
    brandId: string;
    clientId: string;
    channels: PlanChannel[];
    /** Token do usuário — usado apenas para escopar o cache do serviço. */
    cacheScopeToken: string;
  },
): Promise<PerformanceContext> {
  const channels = [...new Set(args.channels)];
  if (channels.length === 0) {
    return { markdown: "", channels: [], channelsWithMetrics: [], channelsWithoutAccount: [] };
  }

  // Conexões ativas VINCULADAS ao cliente (client_social_accounts é a fonte de
  // verdade; o campo legado social_connections.client_id não é consultado).
  let connectionByChannel = new Map<string, string>();
  try {
    const { data: links } = await supabase
      .from("client_social_accounts")
      .select("connection_id")
      .eq("brand_id", args.brandId)
      .eq("client_id", args.clientId);
    const linkedIds = (links ?? []).map((l: any) => l.connection_id as string);
    const { data } = linkedIds.length
      ? await supabase
          .from("social_connections")
          .select("id, channel, status")
          .eq("brand_id", args.brandId)
          .in("id", linkedIds)
          .in("status", ["active", "attention"])
      : { data: [] as Array<{ id: string; channel: string | null; status?: string }> };
    for (const row of data ?? []) {
      const ch = (row.channel as string | null) ?? "";
      if (ch && !connectionByChannel.has(ch)) connectionByChannel.set(ch, row.id as string);
    }
  } catch (err) {
    console.warn("[monthly-plan performance] connections lookup failed", err);
    connectionByChannel = new Map();
  }

  // Histórico interno como apoio (formatos já publicados por canal).
  const internalFormats = new Map<string, Record<string, number>>();
  try {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const { data } = await supabase
      .from("social_posts")
      .select("provider, placement, status, created_at")
      .eq("brand_id", args.brandId)
      .eq("client_id", args.clientId)
      .gte("created_at", since)
      .limit(500);
    for (const row of data ?? []) {
      const ch = ((row.provider as string | null) ?? "").toLowerCase();
      const fmt = (row.placement as string | null) ?? "";
      if (!ch || !fmt) continue;
      const bucket = internalFormats.get(ch) ?? {};
      bucket[fmt] = (bucket[fmt] ?? 0) + 1;
      internalFormats.set(ch, bucket);
    }
  } catch (err) {
    console.warn("[monthly-plan performance] social_posts lookup failed", err);
  }

  const service = await import("@/lib/social-analytics/service.server");
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const until = new Date().toISOString();

  const results = await Promise.all(
    channels.map(async (channel): Promise<ChannelPerformance> => {
      const base: ChannelPerformance = {
        channel,
        connected: connectionByChannel.has(channel),
        hasMetrics: false,
        note: null,
        followers: null,
        avgEngagement: null,
        topFormats: [],
        topPosts: [],
        weakFormats: [],
      };

      const internal = internalFormats.get(channel);
      if (internal) {
        base.topFormats = Object.entries(internal)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k]) => k);
      }

      const connectionId = connectionByChannel.get(channel);
      if (!connectionId) {
        base.note = "sem conta conectada — use apenas briefing e estratégia";
        return base;
      }

      try {
        const conn = await withTimeout(
          service.resolveConnection(supabase, connectionId, args.cacheScopeToken),
          PER_CHANNEL_TIMEOUT_MS,
        );
        const dash = await withTimeout(
          service.getDashboard(conn, { period: `${LOOKBACK_DAYS}d`, range: { since, until } }),
          PER_CHANNEL_TIMEOUT_MS,
        );

        base.hasMetrics = true;
        base.followers = dash.profile?.followers ?? null;
        const totals = dash.totals as Array<{ key: string; value: number }>;
        const engagement = metricValue(totals, ["engagement", "engagements", "total_interactions"]);
        const posts = dash.topPosts ?? [];
        if (engagement != null) {
          base.avgEngagement = posts.length ? Math.round(engagement / posts.length) : engagement;
        }

        const byType = new Map<string, { sum: number; n: number }>();
        for (const p of posts.slice(0, 10)) {
          const eng = metricValue(p.metrics as Array<{ key: string; value: number }>, [
            "engagement",
            "engagements",
            "total_interactions",
            "likes",
          ]);
          const type = p.mediaType ?? "other";
          const b = byType.get(type) ?? { sum: 0, n: 0 };
          b.sum += eng ?? 0;
          b.n += 1;
          byType.set(type, b);
          base.topPosts.push({
            caption: (p.caption ?? "").replace(/\s+/g, " ").slice(0, 140),
            mediaType: p.mediaType ?? null,
            engagement: eng,
          });
        }
        base.topPosts.sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));
        base.topPosts = base.topPosts.slice(0, 5);

        const ranked = [...byType.entries()]
          .map(([type, b]) => ({ type, avg: b.n ? b.sum / b.n : 0 }))
          .sort((a, b) => b.avg - a.avg);
        if (ranked.length) {
          base.topFormats = ranked.slice(0, 2).map((r) => r.type);
          base.weakFormats = ranked.length > 2 ? ranked.slice(-1).map((r) => r.type) : [];
        }
      } catch (err) {
        base.note = "métricas indisponíveis no momento (API do canal não respondeu)";
        console.warn(`[monthly-plan performance] ${channel} metrics failed`, err);
      }

      return base;
    }),
  );

  const lines: string[] = [];
  for (const r of results) {
    const label = PLAN_CHANNEL_LABEL[r.channel] ?? r.channel;
    if (!r.connected) {
      lines.push(`- ${label}: ${r.note}`);
      continue;
    }
    if (!r.hasMetrics) {
      const fallback = r.topFormats.length
        ? ` Histórico interno de formatos publicados: ${r.topFormats.join(", ")}.`
        : "";
      lines.push(`- ${label}: ${r.note ?? "sem métricas"}.${fallback}`);
      continue;
    }
    const bits: string[] = [];
    if (r.followers != null) bits.push(`${r.followers} seguidores`);
    if (r.avgEngagement != null) bits.push(`engajamento médio ~${r.avgEngagement}/post`);
    if (r.topFormats.length) bits.push(`melhor desempenho: ${r.topFormats.join(", ")}`);
    if (r.weakFormats.length) bits.push(`pior desempenho: ${r.weakFormats.join(", ")}`);
    lines.push(`- ${label} (últimos ${LOOKBACK_DAYS} dias): ${bits.join(" · ")}`);
    for (const p of r.topPosts.slice(0, 3)) {
      if (!p.caption) continue;
      lines.push(
        `  * Top post (${p.mediaType ?? "n/a"}${p.engagement != null ? `, eng ${p.engagement}` : ""}): "${p.caption}"`,
      );
    }
  }

  const markdown = lines.length
    ? `## Desempenho real das contas conectadas (por canal)\nUse estes dados para decidir formatos, temas e ganchos: reforce o que performou, evite o que não performou.\n${lines.join("\n")}`.slice(
        0,
        2500,
      )
    : "";

  return {
    markdown,
    channels: results,
    channelsWithMetrics: results.filter((r) => r.hasMetrics).map((r) => r.channel),
    channelsWithoutAccount: results.filter((r) => !r.connected).map((r) => r.channel),
  };
}
