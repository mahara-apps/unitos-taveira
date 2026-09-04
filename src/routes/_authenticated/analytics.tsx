import { createFileRoute } from "@tanstack/react-router";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Filter as FilterIcon,
  Sparkles,
  TrendingUp,
  Users,
  AlertTriangle,
  Layers,
  Instagram,
  Youtube,
  Facebook,
  Linkedin,
  Music2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SocialAnalyticsDashboard } from "@/components/analytics/social-analytics-dashboard";
import {
  DateRangePicker,
  daysToDateRange,
  dateRangeToPeriod,
} from "@/components/ui/date-range-picker";
import type { DateRange } from "react-day-picker";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription,
} from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KpiCard as CanonicalKpiCard, type KpiTone } from "@/components/ui/kpi-card";
import { DashboardPageShell } from "@/components/ui/dashboard-primitives";
import { FunnelStages } from "@/components/ui/funnel-stages";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import { getAnalytics, type AnalyticsResult } from "@/lib/analytics.functions";
import { listClients } from "@/lib/workspace.functions";
import { listBrandTeam } from "@/lib/team.functions";
import { listProjects } from "@/lib/projects.functions";
import { slaSnapshotFn, type SlaSnapshot } from "@/lib/content.functions";
import { AlarmClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrainWidget } from "@/components/brain/brain-widget";
import { useFeatureAccess } from "@/hooks/use-feature-access";

export const Route = createFileRoute("/_authenticated/analytics")({
  beforeLoad: () => ensureFeatureEnabled("analytics"),
  component: AnalyticsPage,
});

// Design System: canais mapeados aos 7 tons semânticos (sem cores off-palette).
const CHANNEL_META: Record<string, { label: string; color: string; Icon: typeof Instagram }> = {
  instagram: { label: "Instagram", color: "#ec4899", Icon: Instagram }, // pink-500
  tiktok: { label: "TikTok", color: "#71717a", Icon: Music2 }, // neutral-500
  youtube: { label: "YouTube", color: "#f43f5e", Icon: Youtube }, // rose-500
  linkedin: { label: "LinkedIn", color: "#0ea5e9", Icon: Linkedin }, // sky-500
  facebook: { label: "Facebook", color: "#0ea5e9", Icon: Facebook }, // sky-500
  x: { label: "X", color: "#71717a", Icon: TrendingUp }, // neutral-500
  threads: { label: "Threads", color: "#71717a", Icon: TrendingUp }, // neutral-500
};

const FORMAT_LABEL: Record<string, string> = {
  feed: "Feed",
  reels: "Reels",
  story: "Story",
  carrossel: "Carrossel",
  video: "Vídeo",
  post: "Post",
};

const STAGE_LABEL: Record<string, string> = {
  idea: "Ideia",
  production: "Produção",
  review: "Revisão",
  approved: "Aprovado",
  scheduled: "Agendado",
  published: "Publicado",
};

function AnalyticsPage() {
  const { brandId, clientId } = useActiveContext();
  const [range, setRange] = useState<DateRange | undefined>(() => daysToDateRange(30));
  const [filters, setFilters] = useState<{
    client_ids: string[];
    assignee_ids: string[];
    project_ids: string[];
    channels: string[];
    tags: string[];
  }>({ client_ids: [], assignee_ids: [], project_ids: [], channels: [], tags: [] });

  const { start, end, period } = useMemo(() => {
    const to = range?.to ?? new Date();
    const from = range?.from ?? to;
    return {
      start: from.toISOString(),
      end: to.toISOString(),
      period: dateRangeToPeriod(range),
    };
  }, [range]);

  const analyticsFn = useServerFn(getAnalytics);
  const clientsFn = useServerFn(listClients);
  const teamFn = useServerFn(listBrandTeam);
  const projectsFn = useServerFn(listProjects);

  const analyticsQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["analytics", brandId, clientId ?? "all", period, filters],
    queryFn: () =>
      analyticsFn({
        data: {
          brand_id: brandId!,
          start,
          end,
          client_id: clientId ?? undefined,
          client_ids: clientId ? [clientId] : filters.client_ids,
          assignee_ids: filters.assignee_ids,
          project_ids: filters.project_ids,
          tags: filters.tags,
          channels: filters.channels,
        },
      }),
  });

  const clientsQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["analytics-clients", brandId],
    queryFn: () => clientsFn({ data: { brandId: brandId! } }),
  });
  const teamQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["analytics-team", brandId],
    queryFn: () => teamFn({ data: { brandId: brandId! } }),
  });
  const projectsQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["analytics-projects", brandId],
    queryFn: () => projectsFn({ data: { brandId: brandId! } }),
  });
  const slaFn = useServerFn(slaSnapshotFn);
  const slaQuery = useQuery({
    enabled: !!brandId,
    queryKey: ["analytics-sla", brandId, clientId ?? "all", filters],
    queryFn: () =>
      slaFn({
        data: {
          brandId: brandId!,
          clientId: clientId ?? null,
          clientIds: clientId ? [clientId] : filters.client_ids,
          assigneeIds: filters.assignee_ids,
          projectIds: filters.project_ids,
          channels: filters.channels,
          tags: filters.tags,
        },
      }),
  });

  usePageHeader(
    {
      title: "Análises",
      subtitle: clientId
        ? "Visão do cliente ativo — canais e métricas do escopo"
        : "Visão executiva da agência — produção, social, equipe e clientes",
      actions: (
        <div className="flex items-center gap-2">
          <DateRangePicker
            value={range}
            onChange={(r: DateRange | undefined) => r && setRange(r)}
            maxDate={new Date()}
          />
          <FiltersSheet
            filters={filters}
            setFilters={setFilters}
            clients={clientId ? [] : (clientsQuery.data ?? [])}
            team={teamQuery.data?.members ?? []}
            projects={projectsQuery.data?.projects ?? []}
          />
        </div>
      ),
    },
    [range, filters, clientId, clientsQuery.data, teamQuery.data, projectsQuery.data],
  );

  if (!brandId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 py-24 text-center">
        <Sparkles className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Selecione um workspace na barra lateral para ver as análises.
        </p>
      </div>
    );
  }

  const data = analyticsQuery.data;

  return (
    <DashboardPageShell>
      <Tabs defaultValue="social" className="space-y-6">
        <TabsList>
          <TabsTrigger value="social">Social</TabsTrigger>
          <TabsTrigger value="production">Produção</TabsTrigger>
          <TabsTrigger value="team">Equipe</TabsTrigger>
          {!clientId && <TabsTrigger value="clients">Clientes</TabsTrigger>}
        </TabsList>

        <TabsContent value="social" className="space-y-6">
          <SocialAnalyticsDashboard
            brandId={brandId}
            period={period}
            since={start}
            until={end}
            clientId={clientId}
          />
        </TabsContent>
        <TabsContent value="production" className="space-y-6">
          <ProductionTab loading={analyticsQuery.isLoading} data={data?.production} />
        </TabsContent>
        <TabsContent value="team" className="space-y-6">
          <TeamTab loading={analyticsQuery.isLoading} data={data?.team} />
          <SlaPanel data={slaQuery.data} />
        </TabsContent>
        {!clientId && (
          <TabsContent value="clients" className="space-y-6">
            <ClientsTab loading={analyticsQuery.isLoading} data={data?.clients} />
          </TabsContent>
        )}
      </Tabs>
    </DashboardPageShell>
  );
}

// ---------- Reusable pieces ----------

function SlaPanel({ data }: { data: SlaSnapshot | undefined }) {
  if (!data) return null;
  if (data.activeOverdue === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">SLA de produção</CardTitle>
          <CardDescription>Nenhuma tarefa em atraso no momento.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlarmClock className="h-4 w-4 text-rose-500" /> Atrasos ativos por responsável
          </CardTitle>
          <CardDescription>
            Snapshot atual · {data.activeOverdue} tarefa(s) atrasada(s)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {data.byUser.map((u) => (
              <div key={u.user_id} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="h-7 w-7">
                    {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                    <AvatarFallback>{u.full_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm">{u.full_name}</span>
                </div>
                <Badge
                  variant="outline"
                  className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                >
                  {u.overdue}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlarmClock className="h-4 w-4 text-rose-500" /> Atrasos por coluna
          </CardTitle>
          <CardDescription>Colunas com SLA configurado</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {data.byStage.map((s) => (
              <div key={s.stage_id} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate">
                  {s.label}{" "}
                  <span className="text-muted-foreground">
                    · SLA{" "}
                    {s.sla_hours < 24 ? `${s.sla_hours}h` : `${Math.round(s.sla_hours / 24)}d`}
                  </span>
                </span>
                <Badge
                  variant="outline"
                  className="border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                >
                  {s.overdue}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Adapter para manter as call sites existentes usando o KpiCard canônico do Design System.
function KpiCard({
  label,
  value,
  hint,
  Icon,
  accent = "neutral",
  delta,
}: {
  label: string;
  value: string | number;
  hint?: string;
  Icon: typeof Sparkles;
  accent?: "primary" | KpiTone;
  delta?: number;
}) {
  const tone: KpiTone = accent === "primary" ? "neutral" : accent;
  const sub =
    typeof delta === "number" ? (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium tabular-nums",
          delta >= 0 ? "text-emerald-500" : "text-rose-500",
        )}
      >
        {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {Math.abs(delta)}%
        {hint ? <span className="ml-1 text-muted-foreground">· {hint}</span> : null}
      </span>
    ) : (
      hint
    );
  return (
    <CanonicalKpiCard
      label={label}
      value={value}
      tone={tone}
      icon={<Icon className="h-4 w-4" />}
      sub={sub}
    />
  );
}

function LoadingGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}

// ---------- SOCIAL ----------

function SocialTab({
  loading,
  data,
}: {
  loading: boolean;
  data: AnalyticsResult["social"] | undefined;
}) {
  const brainEnabled = useFeatureAccess("brain").enabled;
  if (loading || !data) return <LoadingGrid count={4} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Posts no período"
          value={data.totalPosts}
          hint="Somando todas as marcas selecionadas"
          Icon={Layers}
          accent="primary"
        />
        <KpiCard
          label="Publicados"
          value={data.publishedPosts}
          hint="Efetivamente publicados"
          Icon={CheckCircle2}
          accent="emerald"
        />
        <KpiCard
          label="Agendados"
          value={data.scheduledPosts}
          hint="Aguardando publicação"
          Icon={Clock}
          accent="sky"
        />
        <KpiCard
          label="Canais ativos"
          value={data.byChannel.length}
          hint={
            data.byChannel.map((c) => CHANNEL_META[c.channel]?.label ?? c.channel).join(" · ") ||
            "—"
          }
          Icon={TrendingUp}
          accent="violet"
        />
      </div>

      {brainEnabled && <BrainWidget preset="analytics" />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evolução semanal de publicações</CardTitle>
          <CardDescription>Posts publicados por semana no período</CardDescription>
        </CardHeader>
        <CardContent className="h-72">
          {data.weekly.length === 0 ? (
            <EmptyState message="Sem publicações no período" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.weekly}>
                <defs>
                  <linearGradient id="social-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="week" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(var(--primary))"
                  fill="url(#social-fill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por canal</CardTitle>
            <CardDescription>Distribuição de posts</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionList
              items={data.byChannel.map((c) => ({
                key: c.channel,
                label: CHANNEL_META[c.channel]?.label ?? c.channel,
                color: CHANNEL_META[c.channel]?.color ?? "#71717a",
                value: c.count,
              }))}
              total={data.totalPosts}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por formato</CardTitle>
            <CardDescription>Feed / Reels / Story / Carrossel</CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionList
              items={data.byFormat.map((c) => ({
                key: c.format,
                label: FORMAT_LABEL[c.format] ?? c.format,
                color: "#0ea5e9",
                value: c.count,
              }))}
              total={data.totalPosts}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DistributionList({
  items,
  total,
}: {
  items: Array<{ key: string; label: string; color: string; value: number }>;
  total: number;
}) {
  if (items.length === 0) return <EmptyState message="Sem dados" />;
  return (
    <div className="space-y-3">
      {items.map((it) => {
        const pct = total > 0 ? (it.value / total) * 100 : 0;
        return (
          <div key={it.key} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
                <span className="font-medium">{it.label}</span>
              </div>
              <span className="text-muted-foreground">
                {it.value} · {pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: it.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- PRODUCTION ----------

function ProductionTab({
  loading,
  data,
}: {
  loading: boolean;
  data: AnalyticsResult["production"] | undefined;
}) {
  if (loading || !data) return <LoadingGrid count={4} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="No prazo" value={data.onTime} Icon={CheckCircle2} accent="emerald" />
        <KpiCard label="Atrasados" value={data.delayed} Icon={AlertTriangle} accent="rose" />
        <KpiCard label="Pendentes" value={data.pending} Icon={Clock} accent="amber" />
        <KpiCard label="Publicados" value={data.published} Icon={Sparkles} accent="violet" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Produção diária</CardTitle>
            <CardDescription>Criações vs publicações no período</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {data.dailySeries.length === 0 ? (
              <EmptyState message="Sem produção no período" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.dailySeries}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    fontSize={11}
                    stroke="hsl(var(--muted-foreground))"
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="created"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    name="Criados"
                  />
                  <Line
                    type="monotone"
                    dataKey="published"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    name="Publicados"
                  />
                  {/* emerald-500 */}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Funil de estágios</CardTitle>
            <CardDescription>Distribuição por pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            {data.funnel.length === 0 ? (
              <EmptyState message="Sem dados" />
            ) : (
              <FunnelStages
                stages={data.funnel.map((f) => ({
                  key: f.stage,
                  label: STAGE_LABEL[f.stage] ?? f.stage,
                  count: f.count,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por canal</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            {data.byChannel.length === 0 ? (
              <EmptyState message="Sem canais" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byChannel}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="channel" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    fontSize={11}
                    stroke="hsl(var(--muted-foreground))"
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por formato</CardTitle>
          </CardHeader>
          <CardContent>
            <DistributionList
              items={data.byFormat.map((c) => ({
                key: c.format,
                label: FORMAT_LABEL[c.format] ?? c.format,
                color: "#0ea5e9",
                value: c.count,
              }))}
              total={data.total}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------- TEAM ----------

function TeamTab({
  loading,
  data,
}: {
  loading: boolean;
  data: AnalyticsResult["team"] | undefined;
}) {
  if (loading || !data) return <LoadingGrid count={3} />;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Tarefas abertas" value={data.totalOpen} Icon={Layers} accent="amber" />
        <KpiCard
          label="Tarefas concluídas"
          value={data.totalDone}
          Icon={CheckCircle2}
          accent="emerald"
        />
        <KpiCard
          label="Pontualidade média"
          value={`${data.avgPunctuality}%`}
          Icon={TrendingUp}
          accent="violet"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Carga da equipe</CardTitle>
          <CardDescription>Distribuição de trabalho por membro</CardDescription>
        </CardHeader>
        <CardContent>
          {data.members.length === 0 ? (
            <EmptyState message="Nenhum membro encontrado" />
          ) : (
            <div className="divide-y divide-border">
              {data.members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-4 py-3">
                  <Avatar className="h-9 w-9">
                    {m.avatar_url && <AvatarImage src={m.avatar_url} />}
                    <AvatarFallback>{m.full_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{m.full_name}</p>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {m.role}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{m.openTasks} abertas</span>
                      <span>{m.doneTasks} concluídas</span>
                      <span>{m.posts} posts</span>
                    </div>
                  </div>
                  <div className="w-40">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-muted-foreground">Pontualidade</span>
                      <span className="font-medium">{m.punctuality}%</span>
                    </div>
                    <Progress value={m.punctuality} className="h-1.5" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- CLIENTS ----------

function ClientsTab({
  loading,
  data,
}: {
  loading: boolean;
  data: AnalyticsResult["clients"] | undefined;
}) {
  if (loading || !data) return <LoadingGrid count={3} />;
  return (
    <div className="space-y-6">
      {data.items.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState message="Nenhuma conta encontrada no período" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((c) => (
            <Card key={c.client_id} className="relative overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full w-1"
                style={{ background: c.color ?? "#71717a" }}
              />
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <HealthBadge score={c.health} />
                </div>
                <CardDescription>
                  {c.posts} posts · {c.published} publicados
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Saúde da conta</span>
                    <span className="font-medium">{c.health}%</span>
                  </div>
                  <Progress value={c.health} className="h-1.5" />
                </div>
                {c.alerts.length > 0 && (
                  <div className="space-y-1">
                    {c.alerts.map((a) => (
                      <div
                        key={a}
                        className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-xs text-amber-700 dark:text-amber-400"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {a}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function HealthBadge({ score }: { score: number }) {
  const tone =
    score >= 80
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400"
      : score >= 60
        ? "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400"
        : "bg-rose-500/10 text-rose-600 border-rose-500/30 dark:text-rose-400";
  const label = score >= 80 ? "Saudável" : score >= 60 ? "Atenção" : "Crítico";
  return (
    <Badge variant="outline" className={tone}>
      {label}
    </Badge>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[10rem] items-center justify-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

// ---------- Filters Sheet ----------

type FiltersState = {
  client_ids: string[];
  assignee_ids: string[];
  project_ids: string[];
  channels: string[];
  tags: string[];
};

function FiltersSheet({
  filters,
  setFilters,
  clients,
  team,
  projects,
}: {
  filters: FiltersState;
  setFilters: (f: FiltersState) => void;
  clients: Array<{ id: string; name: string }>;
  team: Array<{ user_id: string; full_name: string | null }>;
  projects: Array<{ id: string; name: string }>;
}) {
  const [draft, setDraft] = useState<FiltersState>(filters);
  const active =
    filters.client_ids.length +
    filters.assignee_ids.length +
    filters.project_ids.length +
    filters.channels.length +
    filters.tags.length;

  const toggle = (key: keyof FiltersState, value: string) => {
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(value) ? d[key].filter((v) => v !== value) : [...d[key], value],
    }));
  };

  return (
    <Sheet
      onOpenChange={(o) => {
        if (o) setDraft(filters);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FilterIcon className="h-4 w-4" />
          Filtros
          {active > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
              {active}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filtros</SheetTitle>
          <SheetDescription>
            Refine a análise por conta, pessoa, projeto, canal e tag.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="mt-4 h-[calc(100vh-14rem)] pr-4">
          <div className="space-y-6">
            <FilterGroup
              title="Contas"
              icon={Users}
              items={clients.map((c) => ({ id: c.id, label: c.name }))}
              selected={draft.client_ids}
              onToggle={(id) => toggle("client_ids", id)}
            />
            <FilterGroup
              title="Responsáveis"
              icon={Users}
              items={team.map((t) => ({
                id: t.user_id,
                label: t.full_name ?? "Sem nome",
              }))}
              selected={draft.assignee_ids}
              onToggle={(id) => toggle("assignee_ids", id)}
            />
            <FilterGroup
              title="Projetos"
              icon={Layers}
              items={projects.map((p) => ({ id: p.id, label: p.name }))}
              selected={draft.project_ids}
              onToggle={(id) => toggle("project_ids", id)}
            />
            <FilterGroup
              title="Canais"
              icon={TrendingUp}
              items={Object.entries(CHANNEL_META).map(([id, m]) => ({ id, label: m.label }))}
              selected={draft.channels}
              onToggle={(id) => toggle("channels", id)}
            />
          </div>
        </ScrollArea>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              const empty = {
                client_ids: [],
                assignee_ids: [],
                project_ids: [],
                channels: [],
                tags: [],
              };
              setDraft(empty);
              setFilters(empty);
            }}
          >
            Limpar
          </Button>
          <Button onClick={() => setFilters(draft)}>Aplicar filtros</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterGroup({
  title,
  icon: Icon,
  items,
  selected,
  onToggle,
}: {
  title: string;
  icon: typeof Users;
  items: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
        <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum item disponível.</p>
      ) : (
        <div className="space-y-1">
          {items.map((it) => (
            <Label
              key={it.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <Checkbox
                checked={selected.includes(it.id)}
                onCheckedChange={() => onToggle(it.id)}
              />
              <span className="truncate">{it.label}</span>
            </Label>
          ))}
        </div>
      )}
    </div>
  );
}
