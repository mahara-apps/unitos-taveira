import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PanelCard } from "@/components/ui/panel-card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getTimesheetReportFn } from "@/lib/timesheet-report.functions";
import {
  aggregateTimesheet,
  formatCurrencyBRL,
  formatHours,
  timesheetTotals,
} from "@/lib/timesheet-report";
import { addDaysInTz } from "@/lib/timezone";

/**
 * Resumo compacto das horas de UM projeto: total, por pessoa e
 * realizado vs. previsto. O relatório completo vive em Análises → Timesheet.
 */
export function ProjectHoursCard({
  brandId,
  projectId,
  days = 180,
}: {
  brandId: string;
  projectId: string;
  days?: number;
}) {
  const { start, end } = useMemo(() => {
    const to = new Date();
    return { start: addDaysInTz(to, -days).toISOString(), end: to.toISOString() };
  }, [days]);

  const reportFn = useServerFn(getTimesheetReportFn);
  const query = useQuery({
    enabled: !!brandId && !!projectId,
    queryKey: ["timesheet-project", brandId, projectId, start, end],
    queryFn: () =>
      reportFn({
        data: {
          brandId,
          from: start,
          to: end,
          projectIds: [projectId],
          clientIds: [],
          userIds: [],
          source: "all" as const,
          onlyRework: false,
        },
      }),
  });

  const entries = query.data?.entries ?? [];
  const totals = useMemo(() => timesheetTotals(entries), [entries]);
  const byUser = useMemo(() => aggregateTimesheet(entries, "user"), [entries]);
  const estSeconds = totals.estimatedMinutes * 60;
  const ratio = estSeconds > 0 ? totals.seconds / estSeconds : null;

  return (
    <PanelCard
      title="Horas do projeto"
      subtitle={`Tempo apontado nos últimos ${days} dias`}
      icon={<Clock className="h-4 w-4" />}
      action={
        <Button asChild size="sm" variant="ghost" className="h-7 text-[11px]">
          <Link to="/analytics">
            Relatório completo <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      }
    >
      {query.isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Nenhuma hora apontada nas tarefas deste projeto.
        </p>
      ) : (
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-2xl font-semibold tabular-nums leading-none">
              {formatHours(totals.seconds)}
            </span>
            {query.data?.canViewCost && totals.costCents > 0 ? (
              <span className="text-sm tabular-nums text-muted-foreground">
                {formatCurrencyBRL(totals.costCents)}
              </span>
            ) : null}
            {ratio != null ? (
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  ratio > 1.1
                    ? "text-severity-critical"
                    : ratio > 0.9
                      ? "text-severity-warning"
                      : "text-health-good",
                )}
              >
                {Math.round(ratio * 100)}% do previsto ({formatHours(estSeconds)})
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">sem estimativa nas tarefas</span>
            )}
          </div>
          <div className="space-y-2">
            {byUser.slice(0, 6).map((u) => (
              <div key={u.key} className="flex items-center gap-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={u.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {u.label.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-xs">{u.label}</span>
                <Progress
                  value={totals.seconds ? (u.seconds / totals.seconds) * 100 : 0}
                  className="h-1.5 w-20"
                />
                <span className="w-16 text-right text-[11px] tabular-nums text-muted-foreground">
                  {formatHours(u.seconds)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </PanelCard>
  );
}
