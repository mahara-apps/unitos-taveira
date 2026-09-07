import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRefreshCooldown } from "@/hooks/use-refresh-cooldown";
import {
  getBrandSocialDashboardFn,
  getBrandSocialTopPayloadFn,
  type BrandSocialDashboard,
} from "@/lib/social-analytics/brand-dashboard.functions";

/** Mesmo TTL do cache de provider no servidor (10 min). */
const SOCIAL_STALE_TIME_MS = 10 * 60_000;
/** Mantém o snapshot em memória por 24h para casar com o cache persistido. */
const SOCIAL_GC_TIME_MS = 24 * 60 * 60_000;

export type SocialDashboardState = {
  merged: BrandSocialDashboard | null;
  previous: BrandSocialDashboard | null;
  pending: boolean;
  topPending: boolean;
  error: string | null;
  generatedAt: string | null;
  refreshing: boolean;
  refresh: () => void;
  cooldownSeconds: number;
};

/** Intervalo imediatamente anterior, de mesma duração. */
export function previousRange(since?: string, until?: string): { since?: string; until?: string } {
  if (!since || !until) return {};
  const a = new Date(since).getTime();
  const b = new Date(until).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return {};
  const span = b - a;
  return { since: new Date(a - span).toISOString(), until: new Date(a).toISOString() };
}

export function useSocialDashboard({
  brandId,
  period,
  since,
  until,
  clientId,
  compare,
}: {
  brandId: string | null;
  period: string;
  since?: string;
  until?: string;
  clientId?: string | null;
  compare: boolean;
}): SocialDashboardState {
  const fetchFn = useServerFn(getBrandSocialDashboardFn);
  const fetchTopFn = useServerFn(getBrandSocialTopPayloadFn);
  const queryClient = useQueryClient();

  const baseKey = [brandId ?? "", clientId ?? "all", period, since ?? "", until ?? ""] as const;
  const enabled = !!brandId;

  const q = useQuery({
    enabled,
    queryKey: ["social-analytics", ...baseKey],
    queryFn: () =>
      fetchFn({
        data: { brandId: brandId!, period, since, until, clientId: clientId ?? undefined },
      }),
    staleTime: SOCIAL_STALE_TIME_MS,
    gcTime: SOCIAL_GC_TIME_MS,
    placeholderData: keepPreviousData,
  });

  const qTop = useQuery({
    queryKey: ["social-analytics-top", ...baseKey],
    queryFn: () =>
      fetchTopFn({
        data: { brandId: brandId!, period, since, until, clientId: clientId ?? undefined },
      }),
    staleTime: SOCIAL_STALE_TIME_MS,
    gcTime: SOCIAL_GC_TIME_MS,
    placeholderData: keepPreviousData,
    enabled: enabled && !!q.data && q.data.connectionsTotal > 0,
  });

  const prev = previousRange(since, until);
  const qPrev = useQuery({
    queryKey: ["social-analytics-prev", ...baseKey],
    queryFn: () =>
      fetchFn({
        data: {
          brandId: brandId!,
          period,
          since: prev.since,
          until: prev.until,
          clientId: clientId ?? undefined,
        },
      }),
    staleTime: SOCIAL_STALE_TIME_MS,
    gcTime: SOCIAL_GC_TIME_MS,
    placeholderData: keepPreviousData,
    enabled: enabled && compare && !!prev.since && !!prev.until,
  });

  const cooldown = useRefreshCooldown(`social-analytics:${baseKey.join(":")}`, 60_000);
  const refreshing = q.isFetching || qTop.isFetching || qPrev.isFetching;

  function refresh() {
    if (cooldown.blocked || refreshing) return;
    cooldown.start();
    void queryClient.invalidateQueries({ queryKey: ["social-analytics", ...baseKey] });
    void queryClient.invalidateQueries({ queryKey: ["social-analytics-top", ...baseKey] });
    void queryClient.invalidateQueries({ queryKey: ["social-analytics-prev", ...baseKey] });
  }

  const data = q.data ?? null;
  const top = qTop.data ?? null;
  const merged: BrandSocialDashboard | null =
    data && top
      ? {
          ...data,
          formats: top.formats,
          topPosts: top.topPosts,
          bestHours: top.bestHours,
          bestDays: top.bestDays,
          bestSlotsMatrix: top.bestSlotsMatrix,
          insights: top.insights,
          warnings: [...data.warnings, ...top.warnings],
          summary: data.summary.map((k) =>
            k.key === "posts" ? { ...k, value: top.topPosts.length } : k,
          ),
        }
      : data;

  return {
    merged,
    previous: qPrev.data ?? null,
    pending: !data && q.isPending,
    topPending: !top && (qTop.isPending || qTop.isFetching),
    error: q.error ? (q.error as Error).message : null,
    generatedAt: merged?.generatedAt ?? null,
    refreshing,
    refresh,
    cooldownSeconds: cooldown.remainingSeconds,
  };
}
