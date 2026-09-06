import { useMemo } from "react";
import { useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRefreshCooldown } from "@/hooks/use-refresh-cooldown";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  Legend,
  Cell,
} from "recharts";
import {
  Activity,
  BarChart3,
  Clock,
  ExternalLink,
  Layers,
  Loader2,
  Sparkles,
  TrendingUp,
  Users,
  Eye,
  Zap,
  CalendarDays,
  Trophy,
  BrainCircuit,
  Instagram,
  Facebook,
  Linkedin,
  Music2,
  Youtube,
  AlertTriangle,
  Play,
  Heart,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiCard } from "@/components/ui/kpi-card";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { cn } from "@/lib/utils";
import {
  getBrandSocialDashboardFn,
  getBrandSocialTopPayloadFn,
  type BrandSocialDashboard,
  type BrandSocialTopPayload,
  type ChannelPerformance,
  type FormatPerformance,
  type UnifiedTopPost,
  type SocialTimePoint,
} from "@/lib/social-analytics/brand-dashboard.functions";

const NETWORK_META: Record<string, { label: string; Icon: typeof Instagram; tone: string }> = {
  instagram: { label: "Instagram", Icon: Instagram, tone: "text-pink-500" },
  facebook: { label: "Facebook", Icon: Facebook, tone: "text-sky-500" },
  linkedin: { label: "LinkedIn", Icon: Linkedin, tone: "text-sky-600" },
  tiktok: { label: "TikTok", Icon: Music2, tone: "text-zinc-500" },
  youtube: { label: "YouTube", Icon: Youtube, tone: "text-rose-500" },
  x: { label: "X", Icon: TrendingUp, tone: "text-zinc-500" },
  threads: { label: "Threads", Icon: TrendingUp, tone: "text-zinc-500" },
};

const FORMAT_LABEL: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  carousel: "Carrossel",
  text: "Texto",
  other: "Outros",
};

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const FORMAT_COLOR: Record<string, string> = {
  image: "hsl(var(--primary))",
  video: "#ef4444",
  carousel: "#8b5cf6",
  text: "#10b981",
  other: "hsl(var(--muted-foreground))",
};

const DATE_AXIS_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
});
const DATE_TOOLTIP_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});
function formatDateAxis(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return DATE_AXIS_FMT.format(d).replace(".", "");
}
function formatDateTooltip(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return DATE_TOOLTIP_FMT.format(d);
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Mesmo TTL do cache de provider no servidor (10 min). */
const SOCIAL_STALE_TIME_MS = 10 * 60_000;
/** Mantém o snapshot em memória por 24h para casar com o cache persistido. */
const SOCIAL_GC_TIME_MS = 24 * 60 * 60_000;

const TIME_FMT = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
});

function FreshnessBar({
  generatedAt,
  refreshing,
  onRefresh,
  error,
  cooldownSeconds,
}: {
  generatedAt: string;
  refreshing: boolean;
  onRefresh: () => void;
  error: string | null;
  cooldownSeconds: number;
}) {
  const when = new Date(generatedAt);
  const label = Number.isNaN(when.getTime()) ? null : TIME_FMT.format(when);
  const blocked = cooldownSeconds > 0;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-2">
        {refreshing ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Atualizando métricas…
          </>
        ) : error ? (
          <span className="text-rose-500">Falha ao atualizar — exibindo últimos dados salvos</span>
        ) : (
          <>
            <Activity className="h-3.5 w-3.5" />
            Métricas em cache
          </>
        )}
        {label ? <span>· dados de {label}</span> : null}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={onRefresh}
        disabled={refreshing || blocked}
        title={
          blocked
            ? `Aguarde ${cooldownSeconds}s para atualizar novamente (limite de segurança)`
            : "Atualizar métricas agora"
        }
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        {blocked ? `Aguarde ${cooldownSeconds}s` : "Atualizar"}
      </Button>
    </div>
  );
}

export function SocialAnalyticsDashboard({
  brandId,
  period,
  since,
  until,
  clientId,
}: {
  brandId: string;
  period: string;
  since?: string;
  until?: string;
  clientId?: string | null;
}) {
  const fetchFn = useServerFn(getBrandSocialDashboardFn);
  const fetchTopFn = useServerFn(getBrandSocialTopPayloadFn);
  const queryClient = useQueryClient();
  const baseKey = [brandId, clientId ?? "all", period, since ?? "", until ?? ""] as const;
  const q = useQuery({
    queryKey: ["social-analytics", ...baseKey],
    queryFn: () =>
      fetchFn({ data: { brandId, period, since, until, clientId: clientId ?? undefined } }),
    // Mesmo TTL do cache de provider no servidor — evita chamadas redundantes
    // à API do Meta ao navegar entre telas.
    staleTime: SOCIAL_STALE_TIME_MS,
    gcTime: SOCIAL_GC_TIME_MS,
    placeholderData: keepPreviousData,
  });
  const qTop = useQuery({
    queryKey: ["social-analytics-top", ...baseKey],
    queryFn: () =>
      fetchTopFn({ data: { brandId, period, since, until, clientId: clientId ?? undefined } }),
    staleTime: SOCIAL_STALE_TIME_MS,
    gcTime: SOCIAL_GC_TIME_MS,
    placeholderData: keepPreviousData,
    enabled: !!q.data && q.data.connectionsTotal > 0,
  });

  const data = q.data;
  const refreshing = q.isFetching || qTop.isFetching;
  const cooldown = useRefreshCooldown(`social-analytics:${baseKey.join(":")}`, 60_000);

  function handleRefresh() {
    if (cooldown.blocked || refreshing) return;
    cooldown.start();
    void queryClient.invalidateQueries({ queryKey: ["social-analytics", ...baseKey] });
    void queryClient.invalidateQueries({ queryKey: ["social-analytics-top", ...baseKey] });
  }

  // Skeleton apenas no primeiro acesso real (sem snapshot em cache).
  if (!data && q.isPending) return <LoadingSkeleton />;
  if (!data && q.error)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-rose-500">
          {(q.error as Error).message}
        </CardContent>
      </Card>
    );
  if (!data) return <PanelEmptyState icon={<BarChart3 className="h-5 w-5" />} text="Sem dados." />;

  if (data.connectionsTotal === 0) {
    return <NoChannelsEmpty clientId={clientId ?? null} />;
  }

  const top = qTop.data;
  const topLoading = qTop.isPending || qTop.isFetching;
  const merged: BrandSocialDashboard = top
    ? {
        ...data,
        formats: top.formats,
        topPosts: top.topPosts,
        bestHours: top.bestHours,
        bestDays: top.bestDays,
        insights: top.insights,
        warnings: [...data.warnings, ...top.warnings],
        summary: data.summary.map((k) =>
          k.key === "posts" ? { ...k, value: top.topPosts.length } : k,
        ),
      }
    : data;

  return (
    <div className="space-y-6">
      <FreshnessBar
        generatedAt={merged.generatedAt}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        error={q.error ? (q.error as Error).message : null}
        cooldownSeconds={cooldown.remainingSeconds}
      />
      <WarningsBanner warnings={merged.warnings} />
      <ResumoSection data={merged} />
      <PerformanceSection data={merged} loadingTop={topLoading && !top} />
      {topLoading && !top ? (
        <SectionSkeleton title="Top publicações" height={220} />
      ) : (
        <TopPostsSection posts={merged.topPosts} />
      )}
      {topLoading && !top ? (
        <SectionSkeleton title="Timing" height={220} />
      ) : (
        <TimingSection data={merged} />
      )}
      {topLoading && !top ? (
        <SectionSkeleton title="Insights do Brain" height={120} />
      ) : (
        <InsightsSection data={merged} />
      )}
    </div>
  );
}

function WarningsBanner({ warnings }: { warnings: string[] }) {
  return _WarningsBanner({ warnings });
}

function NoChannelsEmpty({ clientId }: { clientId: string | null }) {
  if (clientId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <div className="max-w-md space-y-1.5">
            <p className="text-sm font-medium">Nenhum canal atribuído a este cliente</p>
            <p className="text-sm text-muted-foreground">
              As contas conectadas à marca ainda não foram vinculadas a este cliente. Abra{" "}
              <b>Perfil → Canais</b> para atribuir Instagram, Facebook e outras redes já
              autorizadas.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="sm">
              <Link
                to="/customers/$customerId"
                params={{ customerId: clientId }}
                search={{ tab: "publicacoes" } as never}
              >
                Ir para Canais
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/connections">Conectar nova conta</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Sparkles className="h-8 w-8 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">
          Esta marca ainda não tem canais sociais conectados. Vá em <b>Integrações</b> para conectar
          Instagram, Facebook e outras redes.
        </p>
        <Button asChild size="sm">
          <Link to="/connections">Abrir Integrações</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Avisos de token ilegível não são "erro de métrica": pedem reconexão. */
function needsReconnect(warning: string): boolean {
  return /reconect/i.test(warning) || /decriptar/i.test(warning);
}

function _WarningsBanner({ warnings }: { warnings: string[] }) {
  if (!warnings?.length) return null;
  const reconnect = Array.from(new Set(warnings.filter(needsReconnect)));
  const others = warnings.filter((w) => !needsReconnect(w));
  return (
    <div className="space-y-2">
      {reconnect.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-3 text-sm text-amber-700 dark:text-amber-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {reconnect.length === 1
              ? "1 conta precisa ser reconectada"
              : `${reconnect.length} contas precisam ser reconectadas`}
          </div>
          <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
            O acesso salvo dessas contas não pode mais ser lido. Reconecte em Integrações para as
            métricas voltarem — nenhum dado histórico é perdido.
          </p>
          <ul className="mt-2 space-y-1 pl-4 text-xs text-amber-800/80 dark:text-amber-200/80">
            {reconnect.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to="/connections">Abrir Integrações</Link>
          </Button>
        </div>
      ) : null}
      {others.length > 0 ? (
        <details className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <summary className="flex cursor-pointer items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {others.length === 1
              ? "1 métrica não pôde ser carregada"
              : `${others.length} métricas não puderam ser carregadas`}
            <span className="ml-auto text-xs opacity-70">clique para detalhes</span>
          </summary>
          <ul className="mt-2 space-y-1 pl-6 text-xs font-mono text-amber-800/80 dark:text-amber-200/80">
            {others.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function ResumoSection({ data }: { data: BrandSocialDashboard }) {
  const iconFor = (key: string) => {
    switch (key) {
      case "followers":
        return Users;
      case "reach":
        return Eye;
      case "impressions":
        return Activity;
      case "engagement":
        return Zap;
      case "posts":
        return Layers;
      case "growth":
        return TrendingUp;
      default:
        return Sparkles;
    }
  };
  const tones: Record<string, "neutral" | "emerald" | "sky" | "violet" | "amber" | "rose"> = {
    followers: "sky",
    reach: "violet",
    impressions: "neutral",
    engagement: "amber",
    posts: "neutral",
    growth: "emerald",
  };
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<BarChart3 className="h-4 w-4" />}
        title="Resumo"
        subtitle={`${data.connectionsActive}/${data.connectionsTotal} contas · ${data.networks.length} rede(s)`}
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {data.summary.map((k) => {
          const Icon = iconFor(k.key);
          const sub =
            k.deltaPct != null ? (
              <span
                className={cn(
                  "text-xs font-medium",
                  k.deltaPct >= 0 ? "text-emerald-500" : "text-rose-500",
                )}
              >
                {k.deltaPct >= 0 ? "+" : ""}
                {k.deltaPct}%
              </span>
            ) : undefined;
          return (
            <KpiCard
              key={k.key}
              label={k.label}
              value={fmt(k.value)}
              tone={tones[k.key] ?? "neutral"}
              icon={<Icon className="h-4 w-4" />}
              sub={sub}
            />
          );
        })}
      </div>
    </section>
  );
}

function PerformanceSection({ data }: { data: BrandSocialDashboard; loadingTop?: boolean }) {
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Trophy className="h-4 w-4" />}
        title="Performance"
        subtitle="Por canal, por formato e evolução temporal"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChannelPerformanceCard channels={data.channels} />
        <FormatPerformanceCard formats={data.formats} />
      </div>
      <TimeSeriesCard series={data.series} />
    </section>
  );
}

function ChannelPerformanceCard({ channels }: { channels: ChannelPerformance[] }) {
  const max = Math.max(...channels.map((c) => c.engagement), 1);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Performance por canal</CardTitle>
        <CardDescription>Engajamento consolidado por conta</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {channels.length === 0 ? (
          <PanelEmptyState icon={<Layers className="h-4 w-4" />} text="Sem dados de canais." />
        ) : (
          channels.map((c) => {
            const meta = NETWORK_META[c.network];
            const Icon = meta?.Icon ?? Layers;
            return (
              <div key={`${c.connectionId}:${c.network}`} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    {c.avatarUrl ? <AvatarImage src={c.avatarUrl} /> : null}
                    <AvatarFallback className="text-[10px]">
                      <Icon className={cn("h-3.5 w-3.5", meta?.tone)} />
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate text-xs font-medium">{c.accountLabel}</span>
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    {meta?.label ?? c.network}
                  </Badge>
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {fmt(c.engagement)}
                  </span>
                </div>
                <Progress value={(c.engagement / max) * 100} className="h-1.5" />
                <div className="flex gap-3 text-[10px] text-muted-foreground">
                  <span>{fmt(c.followers ?? 0)} seguidores</span>
                  <span>{fmt(c.reach)} alcance</span>
                  {c.engagementRate != null ? <span>{c.engagementRate}% eng.</span> : null}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function FormatPerformanceCard({ formats }: { formats: FormatPerformance[] }) {
  const rows = formats.map((f) => ({
    key: f.format,
    label: FORMAT_LABEL[f.format] ?? f.format,
    posts: f.posts,
    engagement: f.engagement,
    avg: f.avgEngagement,
    color: FORMAT_COLOR[f.format] ?? FORMAT_COLOR.other,
  }));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Performance por formato</CardTitle>
        <CardDescription>Engajamento médio por publicação</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="h-52 flex items-center justify-center">
            <PanelEmptyState icon={<Layers className="h-4 w-4" />} text="Sem posts no período." />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={rows}
                  layout="vertical"
                  margin={{ left: 8, right: 16, top: 4, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
                  <XAxis
                    type="number"
                    fontSize={11}
                    stroke="hsl(var(--muted-foreground))"
                    tickFormatter={(v) => fmt(v as number)}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    fontSize={11}
                    stroke="hsl(var(--muted-foreground))"
                    width={78}
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [fmt(v), "Engaj. médio"]}
                    labelFormatter={(l) => `Formato: ${l}`}
                  />
                  <Bar dataKey="avg" radius={[0, 6, 6, 0]}>
                    {rows.map((r) => (
                      <Cell key={r.key} fill={r.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="grid content-start gap-1.5 self-center text-xs">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
                  <span className="min-w-16 font-medium">{r.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {r.posts} post{r.posts === 1 ? "" : "s"} · {fmt(r.engagement)} eng
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TimeSeriesCard({ series }: { series: SocialTimePoint[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Evolução temporal</CardTitle>
        <CardDescription>Alcance, impressões e engajamento por dia</CardDescription>
      </CardHeader>
      <CardContent className="h-72">
        {series.length === 0 ? (
          <PanelEmptyState
            icon={<Activity className="h-4 w-4" />}
            text="Sem série temporal disponível para o período."
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis
                dataKey="date"
                fontSize={11}
                stroke="hsl(var(--muted-foreground))"
                tickFormatter={formatDateAxis}
                minTickGap={24}
              />
              <YAxis
                fontSize={11}
                stroke="hsl(var(--muted-foreground))"
                allowDecimals={false}
                tickFormatter={(v) => fmt(v as number)}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(l) => formatDateTooltip(String(l))}
                formatter={(v: number, name: string) => [fmt(v), name]}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="reach"
                name="Alcance"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="impressions"
                name="Impressões"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="engagement"
                name="Engajamento"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function TopPostsSection({ posts }: { posts: UnifiedTopPost[] }) {
  const networks = useMemo(() => Array.from(new Set(posts.map((p) => p.network))), [posts]);
  const [network, setNetwork] = useState<string>("all");
  const [sort, setSort] = useState<"engagement" | "reach" | "recent">("engagement");

  const filtered = useMemo(() => {
    let arr = network === "all" ? posts : posts.filter((p) => p.network === network);
    arr = [...arr].sort((a, b) => {
      if (sort === "engagement") return b.engagement - a.engagement;
      if (sort === "reach") return b.reach - a.reach;
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return tb - ta;
    });
    return arr;
  }, [posts, network, sort]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle
          icon={<Trophy className="h-4 w-4" />}
          title="Top publicações"
          subtitle={
            filtered.length ? `${filtered.length} post(s) no período` : "Ranqueadas por engajamento"
          }
        />
        {posts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {networks.length > 1 && (
              <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 p-0.5">
                <FeedChip
                  active={network === "all"}
                  onClick={() => setNetwork("all")}
                  label="Todas"
                />
                {networks.map((n) => {
                  const meta = NETWORK_META[n];
                  const Icon = meta?.Icon ?? Layers;
                  return (
                    <FeedChip
                      key={n}
                      active={network === n}
                      onClick={() => setNetwork(n)}
                      label={
                        <span className="inline-flex items-center gap-1">
                          <Icon className={cn("h-3 w-3", meta?.tone)} />
                          {meta?.label ?? n}
                        </span>
                      }
                    />
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 p-0.5">
              <FeedChip
                active={sort === "engagement"}
                onClick={() => setSort("engagement")}
                label="Engajamento"
              />
              <FeedChip
                active={sort === "reach"}
                onClick={() => setSort("reach")}
                label="Alcance"
              />
              <FeedChip
                active={sort === "recent"}
                onClick={() => setSort("recent")}
                label="Recentes"
              />
            </div>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10">
            <PanelEmptyState
              icon={<Trophy className="h-4 w-4" />}
              text="Sem publicações no período."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((p) => (
            <FeedTile key={`${p.connectionId}:${p.externalPostId}`} post={p} />
          ))}
        </div>
      )}
    </section>
  );
}

function FeedChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

const DATE_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
});

function FeedTile({ post: p }: { post: UnifiedTopPost }) {
  const meta = NETWORK_META[p.network];
  const Icon = meta?.Icon ?? Layers;
  const isVideo = p.mediaType === "video";
  const date = p.publishedAt ? DATE_FMT.format(new Date(p.publishedAt)) : null;
  const content = (
    <div className="group relative block aspect-square overflow-hidden rounded-lg border border-border/60 bg-muted">
      {p.thumbnailUrl ? (
        <img
          src={p.thumbnailUrl}
          alt={p.caption ?? ""}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-muted-foreground">
          <Icon className={cn("h-8 w-8 opacity-40", meta?.tone)} />
        </div>
      )}

      {/* Badge de rede */}
      <div className="absolute right-2 top-2 rounded-md bg-black/55 p-1 backdrop-blur-sm">
        <Icon className="h-3.5 w-3.5 text-white" />
      </div>

      {/* Play para vídeo */}
      {isVideo && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-full bg-black/45 p-2.5 backdrop-blur-sm">
            <Play className="h-5 w-5 fill-white text-white" />
          </div>
        </div>
      )}

      {/* Métricas sempre visíveis, com overlay que reforça no hover */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-2.5 text-white">
        <div className="flex items-center gap-3 text-[11px] font-semibold tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Heart className="h-3 w-3" /> {fmt(p.engagement)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3 w-3" /> {fmt(p.reach)}
          </span>
          {date && <span className="ml-auto text-[10px] opacity-80">{date}</span>}
        </div>
        {p.caption && (
          <p className="mt-1 line-clamp-2 text-[10px] leading-tight opacity-0 transition-opacity duration-300 group-hover:opacity-100">
            {p.caption}
          </p>
        )}
      </div>
    </div>
  );

  if (p.permalink) {
    return (
      <a
        href={p.permalink}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Abrir publicação de ${p.channelLabel}`}
      >
        {content}
      </a>
    );
  }
  return content;
}

function TimingSection({ data }: { data: BrandSocialDashboard }) {
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Clock className="h-4 w-4" />}
        title="Timing"
        subtitle="Melhor horário e melhor dia para publicar"
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <BestHoursCard data={data} />
        <BestDaysCard data={data} />
      </div>
    </section>
  );
}

function BestHoursCard({ data }: { data: BrandSocialDashboard }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4" /> Melhor horário
        </CardTitle>
        <CardDescription>Top 5 janelas por engajamento</CardDescription>
      </CardHeader>
      <CardContent>
        {data.bestHours.length === 0 ? (
          <PanelEmptyState icon={<Clock className="h-4 w-4" />} text="Sem histórico suficiente." />
        ) : (
          <ul className="divide-y divide-border/60">
            {data.bestHours.map((s, i) => (
              <li key={`${s.weekday}-${s.hour}`} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="h-5 w-5 justify-center p-0 text-[10px]">
                    {i + 1}
                  </Badge>
                  <span className="text-sm">
                    {WEEKDAY_LABELS[s.weekday]} · {String(s.hour).padStart(2, "0")}h
                  </span>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {fmt(s.score)} eng · {s.posts} post(s)
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BestDaysCard({ data }: { data: BrandSocialDashboard }) {
  const max = Math.max(...data.bestDays.map((d) => d.score), 1);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarDays className="h-4 w-4" /> Melhor dia
        </CardTitle>
        <CardDescription>Engajamento por dia da semana</CardDescription>
      </CardHeader>
      <CardContent>
        {data.bestDays.length === 0 ? (
          <PanelEmptyState
            icon={<CalendarDays className="h-4 w-4" />}
            text="Sem histórico suficiente."
          />
        ) : (
          <div className="space-y-2">
            {WEEKDAY_LABELS.map((label, weekday) => {
              const slot = data.bestDays.find((d) => d.weekday === weekday);
              const value = slot?.score ?? 0;
              return (
                <div key={weekday} className="flex items-center gap-3">
                  <span className="w-10 text-xs text-muted-foreground">{label}</span>
                  <Progress value={(value / max) * 100} className="h-2 flex-1" />
                  <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                    {fmt(value)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InsightsSection({ data }: { data: BrandSocialDashboard }) {
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<BrainCircuit className="h-4 w-4" />}
        title="Insights do Brain"
        subtitle="Análises automáticas de padrão, horário, formato e crescimento"
      />
      {data.insights.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <PanelEmptyState
              icon={<BrainCircuit className="h-4 w-4" />}
              text="O Brain ainda não gerou insights sociais. Publique mais para alimentar a análise."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.insights.map((i) => (
            <Card key={i.id} className="border-l-4 border-l-primary/70">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-[10px]">
                    {i.type}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    Confiança {(i.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm leading-snug">{i.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-md bg-muted p-1.5 text-muted-foreground">{icon}</div>
      <div>
        <div className="text-sm font-semibold tracking-tight">{title}</div>
        {subtitle ? <div className="text-[11px] text-muted-foreground">{subtitle}</div> : null}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function SectionSkeleton({ title, height }: { title: string; height: number }) {
  return (
    <section className="space-y-3">
      <SectionTitle
        icon={<Loader2 className="h-4 w-4 animate-spin" />}
        title={title}
        subtitle="Carregando…"
      />
      <Skeleton className="w-full" style={{ height }} />
    </section>
  );
}
