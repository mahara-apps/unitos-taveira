import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  BrainCircuit,
  ImageIcon,
  Layers,
  Loader2,
  Play,
  Sparkles,
  Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { cn } from "@/lib/utils";
import {
  BestTimeHeatmap,
  EvolutionChart,
  HorizontalBarBreakdown,
  KpiSparklineTile,
  ReconnectNotice,
  SEQUENTIAL_HUE,
  formatCompact,
  type EvolutionPoint,
} from "./analytics-viz";
import type { SocialDashboardState } from "./use-social-dashboard";
import type {
  BrandSocialDashboard,
  UnifiedTopPost,
} from "@/lib/social-analytics/brand-dashboard.functions";

const NETWORK_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  threads: "Threads",
};

const FORMAT_LABEL: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  carousel: "Carrossel",
  text: "Texto",
  other: "Outros",
};

const METRICS = [
  { key: "reach", label: "Alcance" },
  { key: "impressions", label: "Impressões" },
  { key: "engagement", label: "Engajamento" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

/** Avisos de token ilegível não são "erro de métrica": pedem reconexão. */
function needsReconnect(warning: string): boolean {
  return /reconect/i.test(warning) || /decriptar/i.test(warning);
}

export function SocialAnalyticsDashboard({
  state,
  clientId,
  compare,
}: {
  state: SocialDashboardState;
  clientId?: string | null;
  compare: boolean;
}) {
  const [metric, setMetric] = useState<MetricKey>("reach");
  const data = state.merged;

  if (!data && state.pending) return <LoadingSkeleton />;
  if (!data && state.error)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-rose-500">{state.error}</CardContent>
      </Card>
    );
  if (!data) return <PanelEmptyState icon={<BarChart3 className="h-5 w-5" />} text="Sem dados." />;
  if (data.connectionsTotal === 0) return <NoChannelsEmpty clientId={clientId ?? null} />;

  const reconnect = Array.from(new Set(data.warnings.filter(needsReconnect)));
  const others = data.warnings.filter((w) => !needsReconnect(w));

  return (
    <div className="space-y-4">
      <ReconnectNotice accounts={reconnect} />

      <KpiRow data={data} />

      <Panel
        title="Evolução"
        subtitle={`· por dia${compare ? " · vs. período anterior" : ""}`}
        action={
          <div className="flex rounded-lg border bg-muted p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setMetric(m.key)}
                aria-pressed={metric === m.key}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11.5px] font-bold transition-colors",
                  metric === m.key
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        }
      >
        <EvolutionSection data={data} previous={state.previous} metric={metric} compare={compare} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Engajamento por canal" subtitle="· contas conectadas">
          {data.channels.length === 0 ? (
            <PanelEmptyState icon={<Layers className="h-4 w-4" />} text="Sem dados de canais." />
          ) : (
            <HorizontalBarBreakdown
              rows={data.channels.slice(0, 8).map((c) => ({
                key: `${c.connectionId}:${c.network}`,
                label: c.accountLabel || (NETWORK_LABEL[c.network] ?? c.network),
                value: c.engagement,
                hint: `${formatCompact(c.reach)} alcance · ${c.posts} post(s)`,
              }))}
            />
          )}
        </Panel>
        <Panel title="Engajamento por formato" subtitle="· no período">
          {state.topPending ? (
            <Skeleton className="h-40 w-full" />
          ) : data.formats.length === 0 ? (
            <PanelEmptyState icon={<Layers className="h-4 w-4" />} text="Sem posts no período." />
          ) : (
            <HorizontalBarBreakdown
              rows={data.formats.slice(0, 8).map((f) => ({
                key: f.format,
                label: FORMAT_LABEL[f.format] ?? f.format,
                value: f.engagement,
                hint: `${f.posts} post(s) · média ${formatCompact(f.avgEngagement)}`,
              }))}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Top publicações" subtitle="· por engajamento" bodyClassName="px-0 pb-2">
          {state.topPending ? (
            <Skeleton className="mx-4 h-48" />
          ) : (
            <TopPostsList posts={data.topPosts} />
          )}
        </Panel>
        <Panel title="Melhor horário" subtitle="· engajamento por faixa">
          {state.topPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <BestTimeHeatmap cells={data.bestSlotsMatrix ?? []} />
          )}
        </Panel>
      </div>

      {data.insights.length > 0 ? (
        <Panel title="Insights do Brain" subtitle="· padrões automáticos">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.insights.map((i) => (
              <div key={i.id} className="rounded-lg border border-l-4 border-l-primary/70 p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    <BrainCircuit className="mr-1 h-3 w-3" />
                    {i.type}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    Confiança {(i.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-2 text-sm leading-snug">{i.description}</p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {others.length > 0 ? (
        <details className="rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-semibold">
            {others.length === 1
              ? "1 métrica não pôde ser carregada"
              : `${others.length} métricas não puderam ser carregadas`}
          </summary>
          <ul className="mt-2 space-y-1 pl-4 font-mono">
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
// Blocos
// ---------------------------------------------------------------------------

function Panel({
  title,
  subtitle,
  action,
  children,
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
        <h2 className="text-sm font-extrabold tracking-tight">{title}</h2>
        {subtitle ? (
          <span className="text-[11.5px] font-semibold text-muted-foreground">{subtitle}</span>
        ) : null}
        {action ? <div className="ml-auto">{action}</div> : null}
      </header>
      <div className={cn("px-4 pb-4", bodyClassName)}>{children}</div>
    </section>
  );
}

function KpiRow({ data }: { data: BrandSocialDashboard }) {
  const seriesFor = (key: string): number[] => {
    switch (key) {
      case "followers":
        return data.series.map((p) => p.followers ?? 0);
      case "reach":
        return data.series.map((p) => p.reach);
      case "impressions":
        return data.series.map((p) => p.impressions);
      case "engagement":
      case "growth":
        return data.series.map((p) => p.engagement);
      default:
        return data.series.map((p) => p.reach);
    }
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {data.summary.map((k) => (
        <KpiSparklineTile
          key={k.key}
          label={k.label}
          value={formatCompact(k.value)}
          deltaPct={k.deltaPct}
          series={seriesFor(k.key)}
        />
      ))}
    </div>
  );
}

function EvolutionSection({
  data,
  previous,
  metric,
  compare,
}: {
  data: BrandSocialDashboard;
  previous: BrandSocialDashboard | null;
  metric: MetricKey;
  compare: boolean;
}) {
  const points = useMemo<EvolutionPoint[]>(() => {
    const prevSeries = previous?.series ?? [];
    return data.series.map((p, i) => ({
      date: p.date,
      current: p[metric],
      previous: compare ? (prevSeries[i]?.[metric] ?? null) : null,
    }));
  }, [data.series, previous, metric, compare]);

  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? "";

  if (points.length === 0)
    return (
      <PanelEmptyState
        icon={<BarChart3 className="h-4 w-4" />}
        text="Sem série temporal para o período."
      />
    );

  return (
    <div className="space-y-2">
      {compare ? (
        <div className="flex gap-4 text-[11.5px] font-semibold text-muted-foreground">
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-0 w-4 border-t-2"
              style={{ borderColor: SEQUENTIAL_HUE }}
            />
            Período atual
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-0 w-4 border-t-2 border-dashed border-muted-foreground/60" />
            Período anterior
          </span>
        </div>
      ) : null}
      <EvolutionChart points={points} showPrevious={compare} metricLabel={metricLabel} />
    </div>
  );
}

function TopPostsList({ posts }: { posts: UnifiedTopPost[] }) {
  if (posts.length === 0)
    return (
      <div className="px-4">
        <PanelEmptyState icon={<Trophy className="h-4 w-4" />} text="Sem publicações no período." />
      </div>
    );
  return (
    <ol className="divide-y">
      {posts.slice(0, 8).map((p, i) => {
        const row = (
          <div className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-4 text-center text-[13px] font-extrabold text-muted-foreground">
              {i + 1}
            </span>
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
              {p.thumbnailUrl ? (
                <img
                  src={p.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              ) : p.mediaType === "video" ? (
                <Play className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold">
                {p.caption?.trim() || "Publicação sem legenda"}
              </div>
              <div className="mt-0.5 truncate text-[11.5px] font-medium text-muted-foreground">
                {p.channelLabel || (NETWORK_LABEL[p.network] ?? p.network)}
                {p.mediaType ? ` · ${FORMAT_LABEL[p.mediaType] ?? p.mediaType}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-extrabold tabular-nums text-foreground">
                {formatCompact(p.engagement)}
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Engaj.
              </div>
            </div>
          </div>
        );
        const key = `${p.connectionId}:${p.externalPostId}`;
        return (
          <li key={key}>
            {p.permalink ? (
              <a
                href={p.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="block hover:bg-muted/50"
              >
                {row}
              </a>
            ) : (
              row
            )}
          </li>
        );
      })}
    </ol>
  );
}

function NoChannelsEmpty({ clientId }: { clientId: string | null }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Sparkles className="h-6 w-6 text-muted-foreground" />
        <p className="max-w-md text-sm text-muted-foreground">
          {clientId
            ? "As contas conectadas ainda não foram vinculadas a este cliente. Abra Canais para atribuir as redes já autorizadas."
            : "Esta marca ainda não tem canais sociais conectados. Vá em Integrações para conectar Instagram, Facebook e outras redes."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {clientId ? (
            <Button asChild size="sm">
              <Link
                to="/customers/$customerId"
                params={{ customerId: clientId }}
                search={{ tab: "publicacoes" } as never}
              >
                Ir para Canais
              </Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant={clientId ? "outline" : "default"}>
            <Link to="/connections">Abrir Integrações</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full" />
        ))}
      </div>
      <Skeleton className="h-80 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando métricas sociais…
      </div>
    </div>
  );
}
