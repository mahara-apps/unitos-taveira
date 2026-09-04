// Central operacional da conta do cliente (ClientMode do Dashboard).
// Regra: todo número exibido vem de `clientDashboardFn` (dados reais escopados
// por brand_id + client_id). Nada é mockado; sem dados usamos empty states.
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { PageKpi, PageKpiGrid, type KpiStatus } from "@/components/ui/page-kpi";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Send,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataErrorState, SlowLoadingNotice } from "@/components/ui/query-state";
import { useSessionUser } from "@/hooks/use-session-user";
import { withQueryTimeout } from "@/lib/query-timeout";
import { isNonRetriableQueryError, resolveScreenQueryState } from "@/lib/screen-query-state";
import { clientDashboardInput, clientDashboardQueryKey } from "@/lib/client-dashboard.query";
import { clientDashboardFn } from "@/lib/client-dashboard.functions";
import { channelLabel } from "@/lib/client-dashboard.labels";
import { CHANNEL_ICON_SIZE, channelDef } from "@/components/connections/channel-meta";
import type {
  ClientActivityItem,
  ClientAttentionItem,
  ClientDashboard,
  ClientStageStat,
  ClientUpcomingItem,
} from "@/lib/client-dashboard.types";

export function ClientAccountDashboard({
  brandId,
  clientId,
  range,
}: {
  brandId: string;
  clientId: string;
  range: DateRange | undefined;
}) {
  const fn = useServerFn(clientDashboardFn);
  const session = useSessionUser();
  const q = useQuery({
    // Chave isolada por sessão + workspace + cliente + período (precisão de dia,
    // para que o cache seja realmente reaproveitável em X → Y → X).
    queryKey: clientDashboardQueryKey(session.userId, brandId, clientId, range),
    queryFn: () =>
      // Timeout obrigatório: server function pendurada não pode manter o painel
      // em skeleton — vira erro terminal com retry.
      withQueryTimeout(
        fn({ data: clientDashboardInput(brandId, clientId, range) }),
        "O painel da conta",
      ),
    staleTime: 60_000,
    gcTime: 30 * 60_000,
    // Watchdog da identidade garante que este gate sempre abre.
    enabled: session.ready,
    // Sem retry duplicando a espera: 1 tentativa e estado terminal com retry manual.
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

  // Único caminho de skeleton — e sempre com saída (aviso + retry).
  if (state === "loading") {
    return (
      <>
        <div className="px-4 pt-5 sm:px-6 lg:px-8">
          <SlowLoadingNotice active onRetry={() => void q.refetch()} ms={8000} />
        </div>
        <DashboardSkeleton />
      </>
    );
  }

  if (state === "error" || state === "empty" || !d) {
    const message =
      state === "empty"
        ? "Nenhum dado disponível para esta conta no período selecionado."
        : q.error instanceof Error && q.error.message
          ? q.error.message
          : "Houve uma falha ao buscar os dados desta conta.";
    return (
      <Shell>
        <Panel
          title={
            state === "empty" ? "Sem dados para exibir" : "Não foi possível carregar o painel"
          }
        >
          <div className="flex flex-col items-start gap-3 px-4 py-6">
            <p className="text-sm text-muted-foreground">{message}</p>
            <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </Panel>
      </Shell>
    );
  }

  const attentionCount = d.attention.length;

  return (
    <Shell>
      {/* Atualização falhou, mas os dados em cache continuam na tela. */}
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
      ) : null}

      {/* ── Linha de contexto ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">

        <span className="font-medium text-muted-foreground">Visão operacional da conta</span>
        <span className="text-border">•</span>
        <span className="text-muted-foreground/80">Últimos {d.rangeDays} dias</span>
        {attentionCount > 0 && (
          <>
            <span className="text-border">•</span>
            <span className="inline-flex items-center gap-1.5 font-medium text-severity-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
              {attentionCount === 1
                ? "1 item precisa da sua atenção"
                : `${attentionCount} itens precisam da sua atenção`}
            </span>
          </>
        )}
      </div>

      {/* ── 1. Resumo executivo ───────────────────────────── */}
      <PageKpiGrid columns={4}>
        <MetricCell
          icon={<Send className="h-3.5 w-3.5" />}
          label="Publicações"
          value={d.publishedInRange}
          hint={
            d.publishedPreviousRange != null ? (
              <DeltaHint current={d.publishedInRange} previous={d.publishedPreviousRange} />
            ) : (
              <span className="text-muted-foreground/70">no período selecionado</span>
            )
          }
          to="/calendar"
          cta="Ver publicações"
        />
        <MetricCell
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="Próximas"
          value={d.upcomingTotal}
          hint={
            d.upcoming[0] ? (
              <span className="text-muted-foreground/80">
                próxima{" "}
                {format(parseISO(d.upcoming[0].scheduledAt), "dd MMM · HH:mm", { locale: ptBR })}
              </span>
            ) : (
              <span className="text-muted-foreground/70">nada agendado</span>
            )
          }
          to="/calendar"
          cta="Ver agenda"
        />
        <MetricCell
          icon={<BadgeCheck className="h-3.5 w-3.5" />}
          label="Aprovações"
          value={d.approvalsPending}
          tone={d.approvalsPending > 0 ? "warning" : "neutral"}
          hint={
            d.approvalsPending > 0 ? (
              <span className="text-severity-warning">aguardando decisão</span>
            ) : (
              <span className="text-muted-foreground/70">
                {d.approvalsDecided > 0 ? `${d.approvalsDecided} já decididas` : "sem pendências"}
              </span>
            )
          }
          to="/content"
          cta="Ver aprovações"
        />
        <MetricCell
          icon={
            attentionCount ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )
          }
          label="Atenção"
          value={attentionCount}
          tone={d.failedCount > 0 ? "critical" : attentionCount > 0 ? "warning" : "positive"}
          hint={
            attentionCount === 0 ? (
              <span className="text-health-good">tudo em dia</span>
            ) : (
              <span className="text-muted-foreground/80">
                {[
                  d.failedCount > 0 && `${d.failedCount} falha${d.failedCount > 1 ? "s" : ""}`,
                  d.connectionsNeedingAttention > 0 &&
                    `${d.connectionsNeedingAttention} conexão${d.connectionsNeedingAttention > 1 ? "es" : ""}`,
                  d.stalled && `${d.stalled.count} parado${d.stalled.count > 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )
          }
          to={d.failedCount > 0 ? "/calendar" : attentionCount > 0 ? "/content" : "/connections"}
          cta={attentionCount > 0 ? "Resolver" : "Ver conexões"}
        />
      </PageKpiGrid>

      {/* ── 2. Saúde da operação ──────────────────────────── */}
      <OperationHealth data={d} clientId={clientId} />

      {/* ── 3. Publicações + canais ───────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <PublishRhythm data={d} />
        <ChannelsPanel data={d} />
      </div>

      {/* ── 4. Atenção + próximas publicações ─────────────── */}
      <div className="grid gap-4 xl:grid-cols-2">
        <AttentionPanel items={d.attention} />
        <UpcomingPanel items={d.upcoming} />
      </div>

      {/* ── 5. Atividade recente ──────────────────────────── */}
      <ActivityPanel items={d.activity} clientId={clientId} />

      {/* ── 6. Performance social (estado informativo) ────── */}
      {!d.hasPerformanceData && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border/60 px-3.5 py-2.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          <span className="font-medium text-foreground/80">Performance social</span>
          <span>A coleta de alcance e engajamento ainda não está disponível para esta conta.</span>
        </div>
      )}
    </Shell>
  );
}

// ══ Blocos ═══════════════════════════════════════════════════

function OperationHealth({ data, clientId }: { data: ClientDashboard; clientId: string }) {
  const stages = data.stages;
  return (
    <Panel
      title="Saúde da operação"
      subtitle="Fluxo editorial → aprovação → agendamento → publicação"
      action={
        <div className="flex items-center gap-3">
          {data.bottleneck && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />
              Gargalo: {data.bottleneck.label}
            </span>
          )}
          <Link
            to="/customers/$customerId/pauta"
            params={{ customerId: clientId }}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Pauta →
          </Link>
        </div>
      }
    >
      {data.pipelineTotal === 0 ? (
        <PanelEmpty
          title="Nenhum conteúdo no fluxo"
          text="Assim que a pauta for aprovada, os conteúdos aparecem aqui."
          cta={{
            label: "Abrir pauta",
            to: "/customers/$customerId/pauta",
            params: { customerId: clientId },
          }}
        />
      ) : (
        <div className="flex flex-wrap items-stretch gap-1 px-3 py-3">
          {stages.map((s, i) => (
            <React.Fragment key={s.id}>
              {i > 0 && (
                <ChevronRight className="mt-4 hidden h-3.5 w-3.5 shrink-0 self-start text-border sm:block" />
              )}
              <StageChip
                stage={s}
                total={data.pipelineTotal}
                isBottleneck={data.bottleneck?.label === s.label}
              />
            </React.Fragment>
          ))}
        </div>
      )}
    </Panel>
  );
}

function StageChip({
  stage,
  total,
  isBottleneck,
}: {
  stage: ClientStageStat;
  total: number;
  isBottleneck: boolean;
}) {
  const pct = total ? Math.round(stage.share * 100) : 0;
  return (
    <Link
      to="/content"
      className={cn(
        "group min-w-[104px] flex-1 rounded-lg border px-3 py-2 transition-all",
        isBottleneck
          ? "border-amber-500/50 bg-amber-500/[0.07]"
          : "border-transparent bg-muted/40 hover:border-border/70 hover:bg-muted/70",
        stage.count === 0 && "opacity-55",
      )}
    >
      <div className="truncate text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {stage.label}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold leading-none tabular-nums">{stage.count}</span>
        <span className="text-[10.5px] text-muted-foreground/70">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border/60">
        <div
          className={cn("h-full rounded-full", isBottleneck ? "bg-amber-500" : "bg-primary/70")}
          style={{ width: `${Math.max(stage.count > 0 ? 6 : 0, pct)}%` }}
        />
      </div>
    </Link>
  );
}

function PublishRhythm({ data }: { data: ClientDashboard }) {
  const hasPrevious = data.publishTrend.some((p) => p.previous != null);
  return (
    <Panel
      title="Publicações no período"
      subtitle="Ritmo de publicação por dia"
    >
      {data.publishedInRange === 0 ? (
        <PanelEmpty
          title="Nenhuma publicação no período"
          text="O ritmo de publicação aparece aqui após a primeira publicação efetivada."
          cta={{ label: "Ir para calendário", to: "/calendar" }}
        />
      ) : (
        <div className="space-y-3 px-2 pb-3 pt-4">
          <ResponsiveContainer width="100%" height={196}>
            <BarChart data={data.publishTrend} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} />
              <XAxis
                dataKey="day"
                tickFormatter={shortDay}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                stroke="var(--muted-foreground)"
                interval="preserveStartEnd"
                minTickGap={26}
                height={18}
              />
              <YAxis
                allowDecimals={false}
                width={24}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                stroke="var(--muted-foreground)"
              />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  fontSize: 12,
                  boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.35)",
                }}
                labelFormatter={(v) => longDay(String(v))}
                formatter={(value: number, key) => [
                  `${value} ${value === 1 ? "publicação" : "publicações"}`,
                  key === "previous" ? "Período anterior" : "Período atual",
                ]}
              />
              {hasPrevious && (
                <Line
                  type="monotone"
                  dataKey="previous"
                  stroke="var(--muted-foreground)"
                  strokeOpacity={0.55}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              )}
              <Bar dataKey="count" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
          {/* Legenda SEMPRE abaixo do gráfico, nunca sobreposta. */}
          <div className="flex flex-wrap items-center gap-3 px-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px] bg-primary" /> publicações por dia
            </span>
            {hasPrevious ? (
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-3 rounded-full bg-muted-foreground/50" /> período anterior
              </span>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-2 px-2 sm:grid-cols-4">
            <MiniStat label="Publicado" value={String(data.publishedInRange)} />
            <MiniStat
              label="Média / semana"
              value={data.avgPerWeek != null ? data.avgPerWeek.toFixed(1) : "—"}
            />
            <MiniStat
              label="Melhor dia"
              value={data.bestDay ? `${shortDay(data.bestDay.day)} · ${data.bestDay.count}` : "—"}
            />
            <MiniStat
              label="Canal líder"
              value={
                data.channelBreakdown[0]
                  ? (data.channelBreakdown[0].label ?? channelLabel(data.channelBreakdown[0].channel))
                  : "—"
              }
            />
          </div>
        </div>
      )}
    </Panel>
  );
}

function ChannelsPanel({ data }: { data: ClientDashboard }) {
  const max = data.channelBreakdown[0]?.count ?? 0;
  return (
    <Panel
      title="Canais"
      subtitle="Publicações efetivamente realizadas"
      action={
        <Link
          to="/connections"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Conexões →
        </Link>
      }
    >
      {data.channelBreakdown.length === 0 ? (
        <PanelEmpty
          title="Nenhuma publicação por canal"
          text="Os canais aparecem aqui quando houver publicação confirmada no período."
          cta={{ label: "Ver conexões", to: "/connections" }}
        />
      ) : (
        <ul className="space-y-3 px-4 py-4">
          {data.channelBreakdown.map((c, i) => (
            <li key={`${c.label ?? c.channel}-${i}`}>
              <Link to="/connections" className="group block">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium transition-colors group-hover:text-primary">
                    {(() => {
                      const def = channelDef(c.channel);
                      return <def.icon className={cn(CHANNEL_ICON_SIZE, "shrink-0", def.tone)} />;
                    })()}
                    <span className="truncate">{c.label ?? channelLabel(c.channel)}</span>
                    {c.handle ? (
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {c.handle}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {c.count} · {Math.round(c.share * 100)}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500/80"
                    style={{ width: `${max ? Math.max(4, (c.count / max) * 100) : 0}%` }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AttentionPanel({ items }: { items: ClientAttentionItem[] }) {
  const critical = items.some((i) => i.severity === "critical");
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border bg-card",
        critical
          ? "border-destructive/45"
          : items.length
            ? "border-amber-500/40"
            : "border-border/60",
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2.5">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            Atenção necessária
            {items.length > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  critical
                    ? "bg-destructive/15 text-destructive"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                )}
              >
                {items.length}
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            {items.length ? "Itens que exigem ação agora" : "Nenhuma pendência no momento"}
          </p>
        </div>
      </header>
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-7">
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-health-good">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-medium">Tudo em dia</div>
            <p className="text-xs text-muted-foreground">Nenhuma ação necessária neste momento.</p>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={cn(
                  "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
                  a.severity === "critical" ? "bg-destructive" : "bg-amber-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium leading-snug">{a.title}</div>
                <p className="truncate text-xs text-muted-foreground">{a.description}</p>
                {a.detail && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground/75">
                    {a.detail}
                  </p>
                )}
              </div>
              {a.action && (
                <Button
                  asChild
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                >
                  <Link to={a.action.to as never}>
                    {a.action.label}
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const UPCOMING_STATUS: Record<
  ClientUpcomingItem["status"],
  { label: string; dot: string; text: string }
> = {
  scheduled: { label: "Agendado", dot: "bg-emerald-500", text: "text-health-good" },
  awaiting_approval: {
    label: "Aguardando aprovação",
    dot: "bg-amber-500",
    text: "text-severity-warning",
  },
  failed: { label: "Falha", dot: "bg-destructive", text: "text-destructive" },
  published: { label: "Publicado", dot: "bg-emerald-500", text: "text-health-good" },
};

function UpcomingPanel({ items }: { items: ClientUpcomingItem[] }) {
  return (
    <Panel
      title="Próximas publicações"
      subtitle="Agenda dos próximos 7 dias"
      action={
        <Link
          to="/calendar"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Calendário →
        </Link>
      }
    >
      {items.length === 0 ? (
        <PanelEmpty
          title="Nenhuma publicação agendada"
          text="Sua próxima publicação aparecerá aqui."
          cta={{ label: "Ir para calendário", to: "/calendar" }}
        />
      ) : (
        <ul className="divide-y divide-border/40">
          {items.map((item) => {
            const status = UPCOMING_STATUS[item.status];
            return (
              <li key={item.id}>
                <Link
                  to={"/content" as never}
                  search={{ post: item.id } as never}
                  className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                >
                  <div className="w-[62px] shrink-0">
                    <div className="text-[11px] font-semibold uppercase tabular-nums leading-tight">
                      {format(parseISO(item.scheduledAt), "dd MMM", { locale: ptBR })}
                    </div>
                    <div className="text-[11px] tabular-nums text-muted-foreground">
                      {format(parseISO(item.scheduledAt), "HH:mm")}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[item.channels.join(" + ") || null, item.format]
                        .filter(Boolean)
                        .join(" · ") || "Sem canal definido"}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 text-[11px] font-medium",
                      status.text,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} />
                    {status.label}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ActivityPanel({ items, clientId }: { items: ClientActivityItem[]; clientId: string }) {
  const visible = items.slice(0, 8);
  return (
    <Panel
      title="Atividade recente"
      subtitle="O que aconteceu nesta conta"
      action={
        items.length > 0 ? (
          <Link
            to="/customers/$customerId"
            params={{ customerId: clientId }}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Ver tudo →
          </Link>
        ) : null
      }
    >
      {visible.length === 0 ? (
        <PanelEmpty
          title="Nenhuma atividade registrada"
          text="As movimentações de conteúdo desta conta aparecem aqui."
        />
      ) : (
        <ul className="grid gap-x-6 px-4 py-2 md:grid-cols-2">
          {visible.map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 py-2">
              <span
                className={cn(
                  "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
                  a.tone === "positive"
                    ? "bg-emerald-500"
                    : a.tone === "attention"
                      ? "bg-amber-500"
                      : "bg-violet-500/70",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium leading-snug">{a.description}</div>
                <div className="truncate text-[11px] text-muted-foreground">{a.title}</div>
              </div>
              <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground/80">
                {format(parseISO(a.at), "dd MMM · HH:mm", { locale: ptBR })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ══ Primitivas locais ════════════════════════════════════════

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="w-full space-y-4 px-4 py-5 sm:px-6 lg:px-8">{children}</div>;
}

function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function PanelEmpty({
  title,
  text,
  cta,
}: {
  title: string;
  text: string;
  cta?: { label: string; to: string; params?: Record<string, string> };
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-9 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{text}</p>
      {cta && (
        <Button asChild size="sm" variant="outline" className="mt-2 h-7 text-xs">
          {cta.params ? (
            <Link to={cta.to as never} params={cta.params as never}>
              {cta.label}
            </Link>
          ) : (
            <Link to={cta.to as never}>{cta.label}</Link>
          )}
        </Button>
      )}
    </div>
  );
}

/** Adaptador do padrão canônico `PageKpi` — preserva navegação e dados. */
function MetricCell({
  icon,
  label,
  value,
  hint,
  tone = "neutral",
  to,
  cta,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: React.ReactNode;
  tone?: "neutral" | "warning" | "critical" | "positive";
  to: string;
  cta: string;
}) {
  const status: KpiStatus =
    tone === "critical"
      ? "danger"
      : tone === "warning"
        ? "warning"
        : tone === "positive"
          ? "success"
          : "neutral";
  return (
    <Link to={to as never} aria-label={cta} className="block h-full">
      <PageKpi
        icon={icon}
        label={label}
        value={value}
        status={status}
        description={hint}
        className="h-full transition-colors hover:border-foreground/25 hover:bg-accent/30"
      />
    </Link>
  );
}

function DeltaHint({ current, previous }: { current: number; previous: number }) {
  const delta = current - previous;
  if (delta === 0)
    return <span className="text-muted-foreground/80">estável vs. período anterior</span>;
  const up = delta > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1",
        up ? "text-health-good" : "text-severity-warning",
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {delta} vs. anterior ({previous})
    </span>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-[13px] font-semibold">{value}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <Shell>
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-[104px] rounded-xl" />
      <Skeleton className="h-[116px] rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Skeleton className="h-[300px] rounded-xl" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </Shell>
  );
}

function shortDay(iso: string): string {
  return format(parseISO(`${iso}T12:00:00`), "dd/MM", { locale: ptBR });
}
function longDay(iso: string): string {
  return format(parseISO(`${iso}T12:00:00`), "dd 'de' MMMM", { locale: ptBR });
}
