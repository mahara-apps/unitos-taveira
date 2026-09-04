import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Flame,
  Gauge,
  Layers,
  ListChecks,
  PieChart as PieIcon,
  Plus,
  Radar,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";

import { useActiveContext, useWorkspaceStatus } from "@/hooks/use-active-context";
import { useRetryWorkspace } from "@/components/workspace-resolver";
import { usePageHeader } from "@/hooks/use-page-header";
import { supabase } from "@/integrations/supabase/client";
import { getCachedUser } from "@/lib/auth-cache";
import { useSessionUser } from "@/hooks/use-session-user";
import { withQueryTimeout } from "@/lib/query-timeout";
import { isNonRetriableQueryError, resolveScreenQueryState } from "@/lib/screen-query-state";

import { DataErrorState, SlowLoadingNotice } from "@/components/ui/query-state";
import { cn } from "@/lib/utils";
import { CHANNEL_ICON_SIZE, channelDef } from "@/components/connections/channel-meta";
import {
  getAgencyDashboardFn,
  getDashboardStats,
  type AgencyDashboard,
  type AiUsageSummary,
  type ClientHealth,
  type DashboardStats,
} from "@/lib/dashboard.functions";
import { useClientIdentity } from "@/hooks/use-client-identity";
import { Sparkline } from "@/components/dashboard/sparkline";
const PublishBarsChart = React.lazy(() => import("@/components/dashboard/publish-bars-chart"));
import { AgencyOpsSection } from "@/components/dashboard/agency-ops-section";
import { ClientAccountDashboard } from "@/components/dashboard/client-account-dashboard";

import { KpiCard } from "@/components/ui/kpi-card";
import { PanelCard as Card } from "@/components/ui/panel-card";
import { PanelEmptyState as EmptyState } from "@/components/ui/panel-empty";
import { PanelSkeletonList as SkeletonList } from "@/components/ui/panel-skeleton";
import { AlertBanner } from "@/components/ui/alert-banner";
import { ScoreListRow } from "@/components/ui/score-list-row";
import { FunnelStages, funnelColorFor } from "@/components/ui/funnel-stages";
import { AgentUsageBar } from "@/components/ui/agent-usage-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { DateRangePicker, dateRangeToDays } from "@/components/ui/date-range-picker";
import type { DateRange } from "react-day-picker";
import { lastNDays } from "@/lib/date-range";

/** Saudação do usuário — cacheada globalmente (evita auth+profile por tela). */
function useGreeting(): string {
  const q = useQuery({
    queryKey: ["dashboard-greeting"],
    queryFn: async () => {
      const user = await getCachedUser();
      if (!user) return "Olá!";
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const name =
        profile?.full_name ||
        (meta.full_name as string) ||
        (meta.name as string) ||
        (user.email ? user.email.split("@")[0] : "");
      if (!name) return "Olá!";
      const first = name.trim().split(/\s+/)[0] ?? "";
      return `Olá, ${first.charAt(0).toUpperCase()}${first.slice(1)}!`;
    },
    staleTime: 10 * 60_000,
  });
  return q.data ?? "Olá!";
}

function useDefaultRange(): [DateRange | undefined, (r: DateRange | undefined) => void] {
  // Mesmo preset "Últimos 30 dias" do filtro (inclusivo, limites do dia).
  const [range, setRange] = React.useState<DateRange | undefined>(() => lastNDays(30));
  return [range, setRange];
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  validateSearch: (s: Record<string, unknown>): { blocked?: string; reason?: string } => ({
    blocked: typeof s.blocked === "string" ? s.blocked : undefined,
    reason: typeof s.reason === "string" ? s.reason : undefined,
  }),

  component: DashboardPage,
});

function DashboardPage() {
  const { brandId, clientId } = useActiveContext();
  const workspaceStatus = useWorkspaceStatus();
  const retryWorkspace = useRetryWorkspace();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  React.useEffect(() => {
    if (!search.blocked) return;
    const labels: Record<string, string> = {
      brain: "Brain",
      chat: "Chat",
      midia_paga: "Mídia Paga",
      blog_post: "Conteúdo",
    };
    const label = labels[search.blocked] ?? search.blocked;
    // Classificação obrigatória: sem workspace resolvido NÃO é ausência de plano.
    if (search.reason === "no_workspace") {
      toast.info("Selecione uma workspace para abrir este módulo");
    } else if (search.reason === "entitlement_error") {
      toast.error(`Não foi possível verificar o acesso ao módulo "${label}". Tente novamente.`);
    } else {
      toast.error(`Módulo "${label}" não disponível no seu plano`);
    }
    navigate({ search: {}, replace: true });
  }, [search.blocked, search.reason, navigate]);
  if (!brandId) {
    // Três estados distintos — nunca skeleton indefinido:
    // resolvendo (skeleton + aviso/retry), falha (erro real) e sem workspace.
    if (workspaceStatus === "error") {
      return (
        <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
          <DataErrorState
            message="Não foi possível carregar seus workspaces."
            onRetry={retryWorkspace}
          />
        </div>
      );
    }
    if (workspaceStatus === "resolving") {
      return (
        <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <SlowLoadingNotice active onRetry={retryWorkspace} ms={8000} />
          <SkeletonList rows={6} />
        </div>
      );
    }
    return (
      <div className="w-full px-6 py-10">
        <div className="rounded-2xl border border-border/60 bg-card px-6 py-8 text-sm text-muted-foreground">
          Selecione uma workspace na barra lateral para carregar o painel.
        </div>
      </div>
    );
  }

  return clientId ? (
    <ClientMode brandId={brandId} clientId={clientId} />
  ) : (
    <AgencyMode brandId={brandId} />
  );
}

// ============================================================================
// AGENCY MODE
// ============================================================================

function AgencyMode({ brandId }: { brandId: string }) {
  const fn = useServerFn(getAgencyDashboardFn);
  const session = useSessionUser();
  const [range, setRange] = useDefaultRange();
  const days = dateRangeToDays(range);
  const greeting = useGreeting();

  const q = useQuery({
    queryKey: ["dashboard-agency", session.userId ?? "anon", brandId, days],
    queryFn: () =>
      withQueryTimeout(
        fn({
          data: {
            brandId,
            range:
              range?.from && range?.to
                ? { from: range.from.toISOString(), to: range.to.toISOString() }
                : undefined,
          },
        }),
        "O painel da agência",
      ),
    staleTime: 30_000,
    enabled: session.ready,
    retry: (failureCount, err) => (isNonRetriableQueryError(err) ? false : failureCount < 1),
  });

  const d = q.data;
  const state = resolveScreenQueryState({
    sessionReady: session.ready,
    isFetching: q.isFetching,
    isError: q.isError,
    hasData: Boolean(d),
    isSuccess: q.isSuccess,
  });
  const criticalAlerts = (d?.alerts ?? []).filter((a) => a.severity !== "info").length;
  const avgHealth = d?.healths.length
    ? Math.round(d.healths.reduce((s, h) => s + h.score, 0) / d.healths.length)
    : 0;

  usePageHeader(
    {
      title: greeting,
      subtitle: `Visão consolidada · ${d?.counts.clients ?? 0} contas ativas · saúde média ${avgHealth}%`,
      actions: <DateRangePicker value={range} onChange={setRange} />,
    },
    [greeting, d?.counts.clients, avgHealth, range?.from?.getTime(), range?.to?.getTime()],
  );

  // Sem dados e com falha (timeout, 500, permissão): estado terminal acionável.
  if (state === "error") {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <DataErrorState
          message={q.error instanceof Error ? q.error.message : null}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {state === "stale-error" ? (
        <DataErrorState
          compact
          message={
            q.error instanceof Error && q.error.message
              ? `Dados podem estar desatualizados: ${q.error.message}`
              : "Não foi possível atualizar estes dados."
          }
          onRetry={() => void q.refetch()}
        />
      ) : (
        <SlowLoadingNotice active={state === "loading"} onRetry={() => void q.refetch()} />
      )}


      <StatusBanner
        avgHealth={avgHealth}
        criticalAlerts={criticalAlerts}
        approvals={d?.counts.approvals_pending ?? 0}
        overdue={d?.counts.tasks_overdue ?? 0}
      />

      {/* KPI Grid with sparklines */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Publicações aprovadas"
          value={d?.counts.posts_approved_30d ?? 0}
          sub={`${d?.counts.posts_total ?? 0} no pipeline · ${d?.rangeDays ?? 30}d`}
          tone="emerald"
          spark={d?.publishTrend14d}
        />
        <KpiCard
          icon={<BadgeCheck className="h-4 w-4" />}
          label="Aprovações pendentes"
          value={d?.counts.approvals_pending ?? 0}
          sub={
            d?.approvalsQueue[0]?.client_name
              ? `Mais antiga: ${d.approvalsQueue[0].client_name}`
              : "Sem fila"
          }
          tone="amber"
        />
        <KpiCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Tarefas atrasadas"
          value={d?.counts.tasks_overdue ?? 0}
          sub={`${d?.counts.tasks_open ?? 0} abertas · ${d?.counts.tasks_done_7d ?? 0} concluídas no período`}
          tone="rose"
        />
        <KpiCard
          icon={<Bot className="h-4 w-4" />}
          label="Custo IA no período"
          value={`$${(d?.aiUsage.cost ?? 0).toFixed(2)}`}
          sub={`${d?.aiUsage.jobs ?? 0} execuções · ${((d?.aiUsage.tokens ?? 0) / 1000).toFixed(1)}k tokens`}
          tone="violet"
          spark={d?.aiUsage.spark.map((v: number) => Math.round(v * 100))}
        />
      </div>

      {/* Alerts strip */}
      {(d?.alerts.length ?? 0) > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {d!.alerts.slice(0, 4).map((a) => (
            <AlertChip key={a.id} alert={a} />
          ))}
        </div>
      )}

      {/* Grid rígido 2-col com alturas fixas e scroll interno por widget. */}
      <AgencyOpsSection brandId={brandId} range={range} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[520px]">
          <ClientHealthRanking healths={d?.healths ?? []} loading={q.isLoading} />
        </div>
        <div className="h-[520px]">
          <AiUsageCard usage={d?.aiUsage} />
        </div>
        <div className="h-[420px]">
          <FunnelCard
            stages={d?.pipelineStages ?? []}
            postsByStage={d?.postsByStage ?? {}}
            avgLead={d?.avgLeadTimeDays ?? null}
          />
        </div>
        <div className="h-[420px]">
          <ApprovalsQueueCard items={d?.approvalsQueue ?? []} loading={q.isLoading} />
        </div>
        <div className="h-[420px]">
          <PublishTrendCard
            trend={d?.publishTrend14d ?? []}
            trendDays={d?.publishTrendDays ?? []}
            channels={d?.topChannels ?? []}
            rangeDays={d?.rangeDays ?? 30}
          />
        </div>
        <div className="h-[420px]">
          <ApprovalsByClientCard rows={d?.approvalsByClient ?? []} loading={q.isLoading} />
        </div>
        <div className="h-[340px]">
          <TaskDistributionCard buckets={d?.tasksByBucket} loading={q.isLoading} />
        </div>
        <div className="h-[340px]">
          <UpcomingCard items={d?.upcoming ?? []} loading={q.isLoading} />
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/40 pb-1.5 pt-2">
      <h2 className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-foreground/80">
        {title}
      </h2>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function StatusBanner({
  avgHealth,
  criticalAlerts,
  approvals,
  overdue,
}: {
  avgHealth: number;
  criticalAlerts: number;
  approvals: number;
  overdue: number;
}) {
  const isCalm = criticalAlerts === 0 && overdue === 0 && approvals < 3;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/8 via-card to-card p-5">
      <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "grid h-11 w-11 place-items-center rounded-xl border",
              isCalm
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-amber-500/30 bg-amber-500/10 text-amber-500",
            )}
          >
            {isCalm ? <CheckCircle2 className="h-5 w-5" /> : <Flame className="h-5 w-5" />}
          </div>
          <div>
            <div className="text-sm font-semibold">
              {isCalm ? "Operação sob controle" : "Requer atenção"}
            </div>
            <div className="text-xs text-muted-foreground">
              Saúde média da carteira ·{" "}
              <span className="font-medium text-foreground">{avgHealth}%</span>
            </div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <StatusPill
            icon={<AlertTriangle className="h-3 w-3" />}
            label="Alertas críticos"
            value={criticalAlerts}
            tone={criticalAlerts ? "rose" : "muted"}
          />
          <StatusPill
            icon={<BadgeCheck className="h-3 w-3" />}
            label="Aprovações"
            value={approvals}
            tone={approvals > 5 ? "amber" : "muted"}
          />
          <StatusPill
            icon={<Clock className="h-3 w-3" />}
            label="Tarefas atrasadas"
            value={overdue}
            tone={overdue ? "rose" : "muted"}
          />
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "rose" | "amber" | "muted";
}) {
  const cls = {
    rose: "border-rose-500/30 bg-rose-500/10 text-rose-500",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    muted: "border-border/60 bg-muted/40 text-muted-foreground",
  }[tone];
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs", cls)}
    >
      {icon}
      <span>{label}</span>
      <span className="font-mono font-semibold tabular-nums">{value}</span>
    </span>
  );
}

// KpiCard/KPI_TONES agora vivem em @/components/ui/kpi-card (canonical primitive).

function AlertChip({ alert }: { alert: AgencyDashboard["alerts"][number] }) {
  const content = (
    <AlertBanner
      severity={alert.severity}
      title={alert.title}
      description={alert.description}
      trailing={alert.count}
    />
  );
  return alert.href ? (
    <Link to={alert.href} className="block">
      {content}
    </Link>
  ) : (
    content
  );
}

function ClientHealthRanking({ healths, loading }: { healths: ClientHealth[]; loading: boolean }) {
  const sorted = [...healths].sort((a, b) => a.score - b.score);
  return (
    <Card
      title="Saúde dos clientes"
      subtitle="Score ponderado por pontualidade, aprovações, briefing e agenda"
      icon={<Gauge className="h-4 w-4" />}
      action={
        <Link to="/customers" className="text-xs text-muted-foreground hover:text-foreground">
          Ver todos →
        </Link>
      }
    >
      {loading ? (
        <SkeletonList />
      ) : sorted.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} text="Nenhum cliente cadastrado." />
      ) : (
        <ul className="divide-y divide-border/40">
          {sorted.slice(0, 8).map((h) => (
            <li key={h.id}>
              <ScoreListRow
                avatarLabel={h.name.slice(0, 2).toUpperCase()}
                avatarColor={h.color}
                score={h.score}
                name={
                  <Link
                    to="/customers/$customerId"
                    params={{ customerId: h.id }}
                    className="truncate text-sm font-medium hover:text-primary"
                  >
                    {h.name}
                  </Link>
                }
                meta={
                  <>
                    <span>{h.openTasks} tarefas abertas</span>
                    {h.overdueTasks > 0 && (
                      <>
                        {" · "}
                        <span className="text-rose-500">{h.overdueTasks} atrasadas</span>
                      </>
                    )}
                    {h.approvalsPending > 0 && (
                      <>
                        {" · "}
                        <span className="text-amber-500">{h.approvalsPending} aprovações</span>
                      </>
                    )}
                    {" · "}
                    <span>
                      {h.lastPostAt
                        ? `último ${formatDistanceToNow(new Date(h.lastPostAt), { locale: ptBR, addSuffix: true })}`
                        : "sem posts"}
                    </span>
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const FUNNEL_FALLBACK: Array<{
  key: string;
  label: string;
  color: string | null;
  position: number;
  count: number;
}> = [
  { key: "idea", label: "Ideia", color: "#0ea5e9", position: 0, count: 0 },
  { key: "production", label: "Produção", color: "#f59e0b", position: 1, count: 0 },
  { key: "review", label: "Revisão", color: "#f97316", position: 2, count: 0 },
  { key: "approved", label: "Aprovado", color: "#10b981", position: 3, count: 0 },
  { key: "scheduled", label: "Agendado", color: "#8b5cf6", position: 4, count: 0 },
  { key: "published", label: "Publicado", color: "#ec4899", position: 5, count: 0 },
];

type FunnelStage = {
  key: string;
  label: string;
  color: string | null;
  position: number;
  count: number;
};

function FunnelCard({
  stages,
  postsByStage,
  avgLead,
}: {
  stages?: FunnelStage[];
  postsByStage: Record<string, number>;
  avgLead: number | null;
}) {
  const list: FunnelStage[] =
    stages && stages.length > 0
      ? stages.map((s) => ({ ...s, count: postsByStage[s.key.toLowerCase()] ?? s.count }))
      : FUNNEL_FALLBACK.map((s) => ({ ...s, count: postsByStage[s.key] ?? 0 }));
  const total = list.reduce((s, x) => s + x.count, 0);
  const published = list.find((s) => s.key.toLowerCase() === "published")?.count ?? 0;
  const conv = total ? Math.round((published / total) * 100) : 0;
  return (
    <Card
      title="Funil editorial"
      subtitle={`${total} peças no pipeline · conversão ${conv}%`}
      icon={<Layers className="h-4 w-4" />}
      action={
        <Link to="/content" className="text-xs text-muted-foreground hover:text-foreground">
          Kanban →
        </Link>
      }
    >
      <FunnelStages
        stages={list.map((s) => ({
          key: s.key,
          label: s.label,
          count: s.count,
          // preserva a cor vinda do backend, com fallback à paleta canônica
          color: funnelColorFor(s.key, s.color),
        }))}
      />
      <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60 text-xs">
        <div className="px-4 py-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Backlog
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
            {(postsByStage["idea"] ?? 0) + (postsByStage["production"] ?? 0)}
          </div>
        </div>
        <div className="px-4 py-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Conversão
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">{conv}%</div>
        </div>
        <div className="px-4 py-2">
          <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Lead time
          </div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
            {avgLead !== null ? `${avgLead.toFixed(1)}d` : "—"}
          </div>
        </div>
      </div>
    </Card>
  );
}

function AiUsageCard({ usage }: { usage: AiUsageSummary | undefined }) {
  const rows = usage?.byAgent ?? [];
  const max = Math.max(0.01, ...rows.map((r) => r.cost));
  const byClient = usage?.byClient ?? [];
  const maxClient = Math.max(0.01, ...byClient.map((r) => r.cost));
  return (
    <Card
      title="IA & performance"
      subtitle="Consumo por agente e cliente no período"
      icon={<Bot className="h-4 w-4" />}
      action={
        <Link to="/connections" className="text-xs text-muted-foreground hover:text-foreground">
          Conexões →
        </Link>
      }
    >
      <div className="px-4 py-3">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="font-mono text-2xl font-semibold tabular-nums">
              ${(usage?.cost ?? 0).toFixed(2)}
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Custo no período · {usage?.jobs ?? 0} execuções ·{" "}
              {((usage?.tokens ?? 0) / 1000).toFixed(1)}k tokens
            </div>
          </div>
          {usage && usage.spark.some((v: number) => v > 0) && (
            <Sparkline
              data={usage.spark.map((v: number) => Math.round(v * 1000))}
              className="h-8 w-24 text-violet-500"
            />
          )}
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<Zap className="h-5 w-5" />} text="Nenhum agente executado ainda." />
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Por agente
              </div>
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.agent}>
                    <AgentUsageBar agent={r.agent} cost={r.cost} jobs={r.jobs} max={max} />
                  </li>
                ))}
              </ul>
            </div>
            {byClient.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                  Por cliente
                </div>
                <ul className="space-y-2">
                  {byClient.map((r) => (
                    <li key={r.client_id ?? "global"}>
                      <AgentUsageBar
                        agent={r.client_name}
                        cost={r.cost}
                        jobs={r.jobs}
                        max={maxClient}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  blog: "Blog",
  x: "X / Twitter",
  threads: "Threads",
};

function PublishTrendCard({
  trend,
  trendDays,
  channels,
  rangeDays,
}: {
  trend: number[];
  trendDays?: string[];
  channels: Array<{ channel: string; count: number; label?: string; handle?: string | null }>;
  rangeDays?: number;
}) {
  const days = rangeDays ?? trend.length;
  const chartData = trend.map((v, i) => {
    const iso = trendDays?.[i];
    const d = iso ? new Date(`${iso}T12:00:00`) : new Date(Date.now() - (trend.length - 1 - i) * 86400000);
    return { day: format(d, "dd/MM/yyyy"), label: format(d, "dd/MM"), posts: v };
  });
  const total = trend.reduce((a, b) => a + b, 0);
  return (
    <Card
      title={`Publicações · ${days} dias`}
      subtitle="Ritmo de publicações e canais mais usados"
      icon={<TrendingUp className="h-4 w-4" />}
    >
      <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-3">
        <div className="h-44 min-h-0 w-full">
          <React.Suspense
            fallback={<div className="h-full w-full animate-pulse rounded-md bg-muted/40" />}
          >
            <PublishBarsChart data={chartData} />
          </React.Suspense>
        </div>
        <div className="flex items-center gap-2 border-t border-border/60 pt-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-[2px] bg-primary" aria-hidden />
          Publicações por dia
          <span className="ml-auto tabular-nums normal-case tracking-normal">{total} no período</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mb-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
            Top canais
          </div>
          {channels.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem publicações.</div>
          ) : (
            <ul className="space-y-1.5">
              {channels.slice(0, 5).map((c, i) => {
                const def = channelDef(c.channel);
                return (
                  <li
                    key={`${c.channel}-${c.handle ?? i}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <def.icon className={cn(CHANNEL_ICON_SIZE, "shrink-0", def.tone)} />
                      <span className="truncate">
                        {c.label ?? CHANNEL_LABELS[c.channel] ?? c.channel}
                      </span>
                      {c.handle ? (
                        <span className="truncate text-muted-foreground">{c.handle}</span>
                      ) : null}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">{c.count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}

function ApprovalsQueueCard({
  items,
  loading,
}: {
  items: AgencyDashboard["approvalsQueue"];
  loading: boolean;
}) {
  return (
    <Card
      title="Fila de aprovações"
      subtitle="Publicações aguardando decisão do cliente"
      icon={<BadgeCheck className="h-4 w-4" />}
      action={
        <Link to="/content" className="text-xs text-muted-foreground hover:text-foreground">
          Ver Kanban →
        </Link>
      }
    >
      {loading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          text="Nenhuma aprovação pendente."
        />
      ) : (
        <ul className="divide-y divide-border/40">
          {items.slice(0, 6).map((it) => (
            <li key={it.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {it.client_name} · aguardando{" "}
                  {formatDistanceToNow(new Date(it.waiting_since), { locale: ptBR })}
                </div>
              </div>
              <Link
                to="/customers/$customerId"
                params={{ customerId: it.client_id }}
                className="shrink-0 rounded-md border border-border/60 bg-background/60 p-1.5 text-muted-foreground transition hover:text-foreground"
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function UpcomingCard({
  items,
  loading,
}: {
  items: AgencyDashboard["upcoming"];
  loading: boolean;
}) {
  return (
    <Card
      title="Próximos 7 dias"
      subtitle="Publicações agendadas e tarefas com prazo"
      icon={<CalendarClock className="h-4 w-4" />}
      action={
        <Link to="/calendar" className="text-xs text-muted-foreground hover:text-foreground">
          Calendário →
        </Link>
      }
    >
      {loading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          text="Nenhuma entrega nos próximos 7 dias."
        />
      ) : (
        <ul className="divide-y divide-border/40">
          {items.slice(0, 6).map((it) => (
            <li key={`${it.kind}-${it.id}`} className="flex items-center gap-3 px-4 py-2.5">
              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-md border",
                  it.kind === "post"
                    ? "border-pink-500/30 bg-pink-500/10 text-pink-500"
                    : "border-sky-500/30 bg-sky-500/10 text-sky-500",
                )}
              >
                {it.kind === "post" ? (
                  <Sparkles className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{it.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {it.client_name ?? "—"} ·{" "}
                  {format(new Date(it.when), "EEE dd/MM · HH:mm", { locale: ptBR })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function HeatmapCard({ heatmap, rangeDays }: { heatmap: number[]; rangeDays?: number }) {
  const max = Math.max(1, ...heatmap);
  const days = rangeDays ?? heatmap.length;
  return (
    <Card
      title={`Ritmo de publicações · ${days} dias`}
      subtitle="Cada quadrado representa um dia"
      icon={<Radar className="h-4 w-4" />}
    >
      <div className="flex flex-wrap gap-1 px-4 py-4">
        {heatmap.map((n, i) => {
          const intensity = n === 0 ? 0 : 0.15 + (n / max) * 0.85;
          return (
            <span
              key={i}
              title={`${n} publicação(ões)`}
              className="h-4 w-4 rounded-sm border border-border/40"
              style={{
                background: `color-mix(in oklab, hsl(var(--primary)) ${Math.round(intensity * 100)}%, transparent)`,
              }}
            />
          );
        })}
      </div>
    </Card>
  );
}

function TaskDistributionCard({
  buckets,
  loading,
}: {
  buckets: AgencyDashboard["tasksByBucket"] | undefined;
  loading: boolean;
}) {
  const b = buckets ?? { open: 0, in_progress: 0, review: 0, done: 0, overdue: 0 };
  const total = b.open + b.in_progress + b.review + b.done + b.overdue;
  const segments: Array<{ label: string; value: number; color: string }> = [
    { label: "Abertas", value: b.open, color: "#0ea5e9" },
    { label: "Em andamento", value: b.in_progress, color: "#f59e0b" },
    { label: "Em revisão", value: b.review, color: "#8b5cf6" },
    { label: "Concluídas no período", value: b.done, color: "#10b981" },
    { label: "Atrasadas", value: b.overdue, color: "#e11d48" },
  ];
  return (
    <Card
      title="Distribuição de tarefas"
      subtitle={`${total} tarefas no funil de execução`}
      icon={<ListChecks className="h-4 w-4" />}
      action={
        <Link to="/content" className="text-xs text-muted-foreground hover:text-foreground">
          Ver tarefas →
        </Link>
      }
    >
      {loading ? (
        <SkeletonList />
      ) : total === 0 ? (
        <EmptyState icon={<ListChecks className="h-5 w-5" />} text="Nenhuma tarefa registrada." />
      ) : (
        <div className="space-y-3 px-4 py-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full border border-border/40 bg-muted/30">
            {segments.map(
              (s) =>
                s.value > 0 && (
                  <div
                    key={s.label}
                    title={`${s.label}: ${s.value}`}
                    style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                  />
                ),
            )}
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-2 truncate">
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                  <span className="truncate text-muted-foreground">{s.label}</span>
                </span>
                <span className="font-mono tabular-nums">{s.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

const CHANNEL_COLORS: Record<string, string> = {
  instagram: "#e1306c",
  facebook: "#1877f2",
  tiktok: "#000000",
  linkedin: "#0a66c2",
  youtube: "#ff0000",
  x: "#111827",
  threads: "#4b5563",
  blog: "#0ea5e9",
};

function ChannelMixCard({ channels }: { channels: Array<{ channel: string; count: number }> }) {
  const total = channels.reduce((s, c) => s + c.count, 0);
  const max = Math.max(1, ...channels.map((c) => c.count));
  return (
    <Card
      title="Mix de canais"
      subtitle={`${total} publicações distribuídas por canal`}
      icon={<PieIcon className="h-4 w-4" />}
    >
      {channels.length === 0 ? (
        <EmptyState
          icon={<PieIcon className="h-5 w-5" />}
          text="Sem canais publicados no período."
        />
      ) : (
        <ul className="space-y-2 px-4 py-3">
          {channels.slice(0, 6).map((c) => {
            const label = CHANNEL_LABELS[c.channel] ?? c.channel;
            const color = CHANNEL_COLORS[c.channel] ?? "hsl(var(--primary))";
            const pct = (c.count / max) * 100;
            return (
              <li key={c.channel} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate font-medium">{label}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {c.count}
                    {total > 0 && (
                      <span className="ml-1 text-[10px]">
                        · {Math.round((c.count / total) * 100)}%
                      </span>
                    )}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ApprovalsByClientCard({
  rows,
  loading,
}: {
  rows: AgencyDashboard["approvalsByClient"];
  loading: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.pending + r.approved));
  return (
    <Card
      title="Aprovações por cliente"
      subtitle="Pendentes vs. aprovadas no período"
      icon={<BadgeCheck className="h-4 w-4" />}
    >
      {loading ? (
        <SkeletonList />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<BadgeCheck className="h-5 w-5" />}
          text="Nenhuma aprovação registrada."
        />
      ) : (
        <ul className="space-y-2.5 px-4 py-3">
          {rows.map((r) => {
            const totalR = r.pending + r.approved;
            const pctPending = (r.pending / max) * 100;
            const pctApproved = (r.approved / max) * 100;
            return (
              <li key={r.client_id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <Link
                    to="/customers/$customerId"
                    params={{ customerId: r.client_id }}
                    className="truncate font-medium hover:text-primary"
                  >
                    {r.client_name}
                  </Link>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    <span className="text-amber-500">{r.pending}</span>
                    <span className="mx-1">/</span>
                    <span className="text-emerald-500">{r.approved}</span>
                  </span>
                </div>
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                  <div style={{ width: `${pctApproved}%`, background: "#10b981" }} />
                  <div style={{ width: `${pctPending}%`, background: "#f59e0b" }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ============================================================================
// CLIENT MODE
// ============================================================================

function ClientMode({ brandId, clientId }: { brandId: string; clientId: string }) {
  const [range, setRange] = useDefaultRange();

  // Identidade do cliente vem da lista do workspace (mesma query do seletor, já
  // em cache) e é REATIVA: o cabeçalho troca no mesmo frame da seleção. Nenhuma
  // server function no caminho crítico da troca — antes o painel do cliente
  // disparava DUAS agregações pesadas (cabeçalho + painel) por troca.
  const client = useClientIdentity(brandId, clientId);

  usePageHeader(
    {
      title: client?.name ?? "Cliente",
      subtitle: client?.niche ?? "Acompanhamento da operação desta conta",
      actions: <DateRangePicker value={range} onChange={setRange} />,
    },
    [client?.name, client?.niche, range?.from?.getTime(), range?.to?.getTime()],
  );

  return <ClientAccountDashboard brandId={brandId} clientId={clientId} range={range} />;
}

function UpcomingClientCard({
  posts,
  loading,
}: {
  posts: DashboardStats["upcomingPosts"];
  loading: boolean;
}) {
  return (
    <Card
      title="Próximas publicações"
      subtitle="Agenda dos próximos 7 dias"
      icon={<CalendarClock className="h-4 w-4" />}
      action={
        <Link to="/calendar" className="text-xs text-muted-foreground hover:text-foreground">
          Calendário →
        </Link>
      }
    >
      {loading ? (
        <SkeletonList />
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          text="Sem publicações agendadas."
        />
      ) : (
        <ul className="divide-y divide-border/40">
          {posts.slice(0, 6).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="truncate">{p.title}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {p.scheduled_at
                  ? format(new Date(p.scheduled_at), "dd MMM · HH:mm", { locale: ptBR })
                  : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentActivityCard({
  activity,
  loading,
}: {
  activity: DashboardStats["recentActivity"];
  loading: boolean;
}) {
  return (
    <Card
      title="Atividade recente"
      subtitle="Eventos no período selecionado"
      icon={<Sparkles className="h-4 w-4" />}
      action={
        <Link to="/notifications" className="text-xs text-muted-foreground hover:text-foreground">
          Ver tudo →
        </Link>
      }
    >
      {loading ? (
        <SkeletonList />
      ) : activity.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-5 w-5" />} text="Nenhuma atividade ainda." />
      ) : (
        <ul className="divide-y divide-border/40">
          {activity.slice(0, 10).map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="truncate">
                <span className="font-medium capitalize">{a.entity_type}</span>{" "}
                <span className="text-muted-foreground">{a.verb}</span>
                {a.payload?.title ? (
                  <span className="ml-1 text-muted-foreground">· {a.payload.title}</span>
                ) : null}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {format(new Date(a.created_at), "dd MMM · HH:mm", { locale: ptBR })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ============================================================================
// Shared primitives
// ============================================================================
// Shared primitives now live in `@/components/ui/panel-card`,
// `@/components/ui/panel-empty`, and `@/components/ui/panel-skeleton`
// so every module can reuse the exact Dashboard shell.
