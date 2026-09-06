import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildHeatmap, formatHours, type TimesheetEntry } from "@/lib/timesheet-report";
import { APP_TIMEZONE } from "@/lib/timezone";

function bucketLabel(bucket: string, granularity: "day" | "week"): string {
  const [y, m, d] = bucket.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (granularity === "week") {
    return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  }
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", timeZone: "UTC" });
}

function isWeekend(bucket: string): boolean {
  const [y, m, d] = bucket.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/** Mapa de calor pessoa × dia (ou semana). Intensidade = horas apontadas. */
export function TimesheetHeatmap({
  entries,
  granularity,
}: {
  entries: TimesheetEntry[];
  granularity: "day" | "week";
}) {
  const map = useMemo(() => buildHeatmap(entries, granularity), [entries, granularity]);

  if (map.rows.length === 0 || map.buckets.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Nenhum apontamento no período selecionado.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto px-4 pb-4 pt-3">
      <div className="min-w-max">
        <div className="mb-1 flex items-end gap-1 pl-[184px]">
          {map.buckets.map((b) => (
            <div
              key={b}
              className={cn(
                "w-7 text-center text-[10px] tabular-nums",
                isWeekend(b) ? "text-muted-foreground/50" : "text-muted-foreground",
              )}
            >
              {bucketLabel(b, granularity)}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          {map.rows.map((row) => (
            <div key={row.userId} className="flex items-center gap-1">
              <div className="flex w-[184px] shrink-0 items-center gap-2 pr-2">
                <Avatar className="h-6 w-6">
                  <AvatarImage src={row.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {row.label.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{row.label}</div>
                  <div className="text-[10px] tabular-nums text-muted-foreground">
                    {formatHours(row.seconds)}
                  </div>
                </div>
              </div>
              {map.buckets.map((b) => {
                const secs = map.cells.get(`${row.userId}|${b}`) ?? 0;
                const ratio = map.max > 0 ? secs / map.max : 0;
                return (
                  <Tooltip key={b}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "h-7 w-7 rounded-[4px] border border-border/40",
                          secs === 0 && "bg-muted/40",
                        )}
                        style={
                          secs > 0
                            ? {
                                backgroundColor: `color-mix(in oklab, var(--color-primary) ${Math.round(
                                  20 + ratio * 80,
                                )}%, transparent)`,
                              }
                            : undefined
                        }
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        <div className="font-medium">{row.label}</div>
                        <div className="text-muted-foreground">
                          {new Date(`${b}T12:00:00Z`).toLocaleDateString("pt-BR", {
                            timeZone: APP_TIMEZONE,
                          })}
                          {granularity === "week" ? " (semana)" : ""}
                        </div>
                        <div className="tabular-nums">{formatHours(secs)}</div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
