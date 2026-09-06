import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Repeat2,
  Timer,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/components/ui/panel-card";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TimesheetHeatmap } from "@/components/analytics/timesheet/timesheet-heatmap";
import {
  getTimesheetReportFn,
  type TimesheetReport,
} from "@/lib/timesheet-report.functions";
import {
  aggregateTimesheet,
  downloadCsv,
  formatCurrencyBRL,
  formatHours,
  monthlyClosing,
  timesheetEntriesCsv,
  timesheetGroupsCsv,
  timesheetTotals,
  TIMESHEET_GROUP_LABEL,
  type TimesheetEntry,
  type TimesheetGroup,
  type TimesheetGroupBy,
} from "@/lib/timesheet-report";
import { formatDateTimeBr, isoDateInTz } from "@/lib/timezone";

const GROUP_ORDER: TimesheetGroupBy[] = ["user", "client", "project", "task"];

export type TimesheetPanelProps = {
  brandId: string;
  /** ISO do início do período. */
  start: string;
  /** ISO do fim do período. */
  end: string;
  clientIds?: string[];
  projectIds?: string[];
  userIds?: string[];
  /** Esconde o fechamento mensal (usado em visões compactas). */
  hideClosing?: boolean;
  defaultGroupBy?: TimesheetGroupBy;
};

function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function EstimateBar({ group }: { group: TimesheetGroup }) {
  if (group.tasksWithEstimate === 0) {
    return <span className="text-[11px] text-muted-foreground">sem estimativa</span>;
  }
  const estSeconds = group.estimatedMinutes * 60;
  const ratio = estSeconds > 0 ? group.seconds / estSeconds : 0;
  const tone =
    ratio <= 0.9 ? "bg-health-good" : ratio <= 1.1 ? "bg-severity-warning" : "bg-severity-critical";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full", tone)} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {Math.round(ratio * 100)}%
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="text-xs">
          Realizado {formatHours(group.seconds)} · Previsto {formatHours(estSeconds)}
          {group.tasksWithoutEstimate > 0 ? (
            <div className="text-muted-foreground">
              {group.tasksWithoutEstimate} tarefa(s) sem estimativa
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function GroupRows({
  entries,
  levels,
  levelIndex,
  totalSeconds,
  showCost,
  depth = 0,
}: {
  entries: TimesheetEntry[];
  levels: TimesheetGroupBy[];
  levelIndex: number;
  totalSeconds: number;
  showCost: boolean;
  depth?: number;
}) {
  const by = levels[levelIndex];
  const groups = useMemo(() => aggregateTimesheet(entries, by), [entries, by]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isLast = levelIndex >= levels.length - 1;

  return (
    <>
      {groups.map((g) => {
        const expanded = !!open[g.key];
        const subset = entries.filter((e) => {
          switch (by) {
            case "user":
              return e.user_id === g.key;
            case "client":
              return (e.client_id ?? "__none__") === g.key;
            case "project":
              return (e.project_id ?? "__none__") === g.key;
            default:
              return e.task_id === g.key;
          }
        });
        return (
          <Fragment key={`${by}-${g.key}`}>
            <tr className="border-t border-border/60 hover:bg-accent/30">
              <td className="py-2 pr-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left"
                  style={{ paddingLeft: depth * 16 }}
                  onClick={() => setOpen((s) => ({ ...s, [g.key]: !s[g.key] }))}
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {by === "user" ? (
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={g.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-[10px]">
                        {g.label.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{g.label}</span>
                    {g.sublabel ? (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {g.sublabel}
                      </span>
                    ) : null}
                  </span>
                </button>
              </td>
              <td className="py-2 text-right text-sm font-medium tabular-nums">
                {formatHours(g.seconds)}
              </td>
              <td className="py-2 pl-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <Progress
                    value={totalSeconds ? (g.seconds / totalSeconds) * 100 : 0}
                    className="h-1.5 w-16"
                  />
                  <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                    {totalSeconds ? Math.round((g.seconds / totalSeconds) * 100) : 0}%
                  </span>
                </div>
              </td>
              <td className="py-2 pl-3 text-right text-[11px] tabular-nums text-muted-foreground">
                {g.entries}
              </td>
              <td className="py-2 pl-3 text-right text-[11px] tabular-nums">
                {g.reworkSeconds > 0 ? (
                  <span className="text-severity-warning">{formatHours(g.reworkSeconds)}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-2 pl-3">
                <div className="flex justify-end">
                  <EstimateBar group={g} />
                </div>
              </td>
              {showCost ? (
                <td className="py-2 pl-3 text-right text-sm tabular-nums">
                  {g.costCents > 0 ? (
                    formatCurrencyBRL(g.costCents)
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-muted-foreground">—</span>
                      </TooltipTrigger>
                      <TooltipContent>Sem valor/hora definido</TooltipContent>
                    </Tooltip>
                  )}
                </td>
              ) : null}
            </tr>
            {expanded ? (
              isLast ? (
                <tr className="bg-muted/20">
                  <td colSpan={showCost ? 7 : 6} className="px-3 py-2">
                    <div
                      className="space-y-1.5"
                      style={{ paddingLeft: (depth + 1) * 16 }}
                    >
                      {subset
                        .slice()
                        .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
                        .map((e) => (
                          <div
                            key={e.entry_id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
                          >
                            <span className="tabular-nums text-muted-foreground">
                              {formatDateTimeBr(e.started_at)}
                            </span>
                            <span className="font-medium tabular-nums">
                              {formatHours(e.seconds)}
                            </span>
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              {e.source === "manual" ? "Manual" : "Cronômetro"}
                            </Badge>
                            {e.is_rework ? (
                              <Badge className="h-4 bg-severity-warning/15 px-1 text-[9px] text-severity-warning">
                                Retrabalho
                              </Badge>
                            ) : null}
                            <span className="truncate text-muted-foreground">
                              {e.user_name?.trim() || e.user_email}
                              {e.description ? ` · ${e.description}` : ""}
                            </span>
                          </div>
                        ))}
                    </div>
                  </td>
                </tr>
              ) : (
                <GroupRows
                  entries={subset}
                  levels={levels}
                  levelIndex={levelIndex + 1}
                  totalSeconds={g.seconds}
                  showCost={showCost}
                  depth={depth + 1}
                />
              )
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}

export function TimesheetPanel({
  brandId,
  start,
  end,
  clientIds = [],
  projectIds = [],
  userIds = [],
  hideClosing,
  defaultGroupBy = "user",
}: TimesheetPanelProps) {
  const [groupBy, setGroupBy] = useState<TimesheetGroupBy>(defaultGroupBy);
  const [source, setSource] = useState<"all" | "timer" | "manual">("all");
  const [onlyRework, setOnlyRework] = useState(false);
  const [heat, setHeat] = useState<"day" | "week">("day");

  const reportFn = useServerFn(getTimesheetReportFn);
  const query = useQuery<TimesheetReport>({
    enabled: !!brandId,
    queryKey: [
      "timesheet-report",
      brandId,
      start,
      end,
      clientIds,
      projectIds,
      userIds,
      source,
      onlyRework,
    ],
    queryFn: () =>
      reportFn({
        data: {
          brandId,
          from: start,
          to: end,
          clientIds,
          projectIds,
          userIds,
          source,
          onlyRework,
        },
      }),
  });

  const entries = query.data?.entries ?? [];
  const showCost = !!query.data?.canViewCost;
  const totals = useMemo(() => timesheetTotals(entries), [entries]);
  const closing = useMemo(() => (hideClosing ? [] : monthlyClosing(entries)), [entries, hideClosing]);
  const levels = useMemo(() => {
    const rest = GROUP_ORDER.filter((l) => l !== groupBy);
    return [groupBy, ...rest];
  }, [groupBy]);
  const groups = useMemo(() => aggregateTimesheet(entries, groupBy), [entries, groupBy]);

  const hoursPerPersonDay =
    totals.people > 0 && totals.activeDays > 0
      ? totals.seconds / totals.people / totals.activeDays
      : 0;
  const reworkPct = totals.seconds > 0 ? Math.round((totals.reworkSeconds / totals.seconds) * 100) : 0;
  const estSeconds = totals.estimatedMinutes * 60;
  const estRatio = estSeconds > 0 ? Math.round((totals.seconds / estSeconds) * 100) : null;
  const hoursTrend = pctChange(totals.seconds, query.data?.previous.seconds ?? 0);

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <PageKpiGrid columns={5}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-xl" />
          ))}
        </PageKpiGrid>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <PanelCard title="Timesheet" subtitle="Não foi possível carregar os apontamentos">
        <p className="px-4 py-6 text-sm text-muted-foreground">
          {(query.error as Error)?.message ?? "Erro ao carregar o relatório."}
        </p>
      </PanelCard>
    );
  }

  const scopeNote =
    query.data?.scope === "self"
      ? "Você está vendo apenas os seus apontamentos."
      : query.data?.scope === "clients"
        ? "Você está vendo apontamentos dos clientes atribuídos a você."
        : null;

  const filenameBase = `timesheet-${isoDateInTz(new Date(start))}-a-${isoDateInTz(new Date(end))}`;

  return (
    <div className="space-y-4">
      <PageKpiGrid columns={5}>
        <PageKpi
          label="Horas no período"
          value={formatHours(totals.seconds)}
          icon={<Clock />}
          status="info"
          trend={hoursTrend != null ? { value: hoursTrend, label: "vs. período anterior" } : undefined}
          description={`${totals.entries} apontamento(s)`}
        />
        {showCost ? (
          <PageKpi
            label="Custo das horas"
            value={formatCurrencyBRL(totals.costCents)}
            icon={<Wallet />}
            status="neutral"
            description={
              query.data?.membersWithoutRate.length
                ? `${query.data.membersWithoutRate.length} pessoa(s) sem valor/hora`
                : "valor/hora × horas apontadas"
            }
          />
        ) : (
          <PageKpi
            label="Pessoas"
            value={totals.people}
            icon={<Users />}
            status="neutral"
            description={`${totals.clients} cliente(s)`}
          />
        )}
        <PageKpi
          label="Média por pessoa/dia"
          value={formatHours(hoursPerPersonDay)}
          icon={<TrendingUp />}
          status="neutral"
          description={`${totals.activeDays} dia(s) com apontamento`}
        />
        <PageKpi
          label="Retrabalho"
          value={`${reworkPct}%`}
          icon={<Repeat2 />}
          status={reworkPct >= 20 ? "warning" : "neutral"}
          description={formatHours(totals.reworkSeconds)}
        />
        <PageKpi
          label="Realizado vs. previsto"
          value={estRatio != null ? `${estRatio}%` : "—"}
          icon={<AlertTriangle />}
          status={estRatio == null ? "neutral" : estRatio > 110 ? "danger" : estRatio > 90 ? "warning" : "success"}
          description={
            estRatio != null
              ? `previsto ${formatHours(estSeconds)} · ${totals.tasksWithoutEstimate} sem estimativa`
              : "nenhuma tarefa com estimativa"
          }
        />
      </PageKpiGrid>

      {scopeNote || query.data?.running.length || query.data?.truncated ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {scopeNote ? <span>{scopeNote}</span> : null}
          {query.data?.running.length ? (
            <Badge variant="outline" className="gap-1">
              <Timer className="h-3 w-3" />
              {query.data.running.length} cronômetro(s) em aberto — ainda não contabilizado
            </Badge>
          ) : null}
          {query.data?.truncated ? (
            <Badge variant="outline" className="text-severity-warning">
              Período muito grande: mostrando os primeiros 20.000 apontamentos
            </Badge>
          ) : null}
        </div>
      ) : null}

      <PanelCard
        title="Mapa de calor"
        subtitle="Horas por pessoa ao longo do período"
        icon={<Clock className="h-4 w-4" />}
        action={
          <ToggleGroup
            type="single"
            size="sm"
            value={heat}
            onValueChange={(v) => v && setHeat(v as "day" | "week")}
          >
            <ToggleGroupItem value="day" className="text-[11px]">
              Dia
            </ToggleGroupItem>
            <ToggleGroupItem value="week" className="text-[11px]">
              Semana
            </ToggleGroupItem>
          </ToggleGroup>
        }
      >
        <TimesheetHeatmap entries={entries} granularity={heat} />
      </PanelCard>

      <PanelCard
        title="Explorador de horas"
        subtitle={`Agrupado por ${TIMESHEET_GROUP_LABEL[groupBy].toLowerCase()} — clique para abrir os níveis`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              value={groupBy}
              onValueChange={(v) => v && setGroupBy(v as TimesheetGroupBy)}
            >
              {GROUP_ORDER.map((g) => (
                <ToggleGroupItem key={g} value={g} className="text-[11px]">
                  {TIMESHEET_GROUP_LABEL[g]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="single"
              size="sm"
              value={source}
              onValueChange={(v) => v && setSource(v as typeof source)}
            >
              <ToggleGroupItem value="all" className="text-[11px]">
                Tudo
              </ToggleGroupItem>
              <ToggleGroupItem value="timer" className="text-[11px]">
                Cronômetro
              </ToggleGroupItem>
              <ToggleGroupItem value="manual" className="text-[11px]">
                Manual
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              size="sm"
              variant={onlyRework ? "default" : "outline"}
              className="h-8 text-[11px]"
              onClick={() => setOnlyRework((v) => !v)}
            >
              <Repeat2 className="mr-1 h-3.5 w-3.5" /> Só retrabalho
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 text-[11px]">
                  <Download className="mr-1 h-3.5 w-3.5" /> Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    downloadCsv(
                      `${filenameBase}-detalhado.csv`,
                      timesheetEntriesCsv(entries, showCost),
                    )
                  }
                >
                  Detalhado (um apontamento por linha)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    downloadCsv(
                      `${filenameBase}-resumo.csv`,
                      timesheetGroupsCsv(groups, groupBy, showCost),
                    )
                  }
                >
                  Resumo (por {TIMESHEET_GROUP_LABEL[groupBy].toLowerCase()})
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      >
        {entries.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground">
            Nenhum apontamento de tempo no período e filtros selecionados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] px-4 text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="py-2 font-medium">{TIMESHEET_GROUP_LABEL[groupBy]}</th>
                  <th className="py-2 text-right font-medium">Horas</th>
                  <th className="py-2 pl-3 text-right font-medium">Participação</th>
                  <th className="py-2 pl-3 text-right font-medium">Apont.</th>
                  <th className="py-2 pl-3 text-right font-medium">Retrabalho</th>
                  <th className="py-2 pl-3 text-right font-medium">Previsto</th>
                  {showCost ? <th className="py-2 pl-3 text-right font-medium">Custo</th> : null}
                </tr>
              </thead>
              <tbody>
                <GroupRows
                  entries={entries}
                  levels={levels}
                  levelIndex={0}
                  totalSeconds={totals.seconds}
                  showCost={showCost}
                />
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      {!hideClosing && closing.length > 0 ? (
        <PanelCard
          title="Fechamento mensal por cliente"
          subtitle="Horas e custo por mês, com comparativo do mês anterior"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Mês</th>
                  <th className="py-2 font-medium">Cliente</th>
                  <th className="py-2 text-right font-medium">Horas</th>
                  <th className="py-2 pl-3 text-right font-medium">vs. mês anterior</th>
                  <th className="py-2 pl-3 text-right font-medium">Pessoas</th>
                  {showCost ? <th className="px-4 py-2 text-right font-medium">Custo</th> : null}
                </tr>
              </thead>
              <tbody>
                {closing.map((r) => {
                  const delta = pctChange(r.seconds, r.prevSeconds);
                  return (
                    <tr
                      key={`${r.month}-${r.clientId}`}
                      className="border-t border-border/60 hover:bg-accent/30"
                    >
                      <td className="px-4 py-2 text-sm">{r.monthLabel}</td>
                      <td className="py-2 text-sm font-medium">{r.clientName}</td>
                      <td className="py-2 text-right text-sm tabular-nums">
                        {formatHours(r.seconds)}
                      </td>
                      <td className="py-2 pl-3 text-right text-[11px] tabular-nums">
                        {delta == null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={
                              delta > 0
                                ? "text-health-good"
                                : delta < 0
                                  ? "text-severity-critical"
                                  : "text-muted-foreground"
                            }
                          >
                            {delta > 0 ? "+" : ""}
                            {delta}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 pl-3 text-right text-[11px] tabular-nums text-muted-foreground">
                        {r.people}
                      </td>
                      {showCost ? (
                        <td className="px-4 py-2 text-right text-sm tabular-nums">
                          {formatCurrencyBRL(r.costCents)}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PanelCard>
      ) : null}
    </div>
  );
}
