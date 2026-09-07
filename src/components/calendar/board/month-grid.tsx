import { CalendarDays, Loader2, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { cn } from "@/lib/utils";
import type { PublicationItem } from "@/lib/calendar-board.functions";
import type { CalendarEvent } from "@/lib/calendar-events.functions";
import { EventChip } from "@/components/calendar/event-chip";
import { PublicationCard, type CardDensity } from "./publication-card";
import { dayKey, type DayMap } from "./day-map";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Visão Mês: 7 colunas, dias de outros meses esmaecidos, até 2 cards + "+N mais". */
export function MonthGrid({
  days,
  anchorMonth,
  byDay,
  loading,
  empty,
  density,
  onOpen,
  onOpenEvent,
  onNewOnDay,
}: {
  days: Date[];
  anchorMonth: number;
  byDay: DayMap;
  loading: boolean;
  empty: boolean;
  density: CardDensity;
  onOpen: (i: PublicationItem) => void;
  onOpenEvent: (e: CalendarEvent) => void;
  onNewOnDay?: (d: Date) => void;
}) {
  const todayKey = dayKey(new Date());
  const maxVisible = density === "compact" ? 2 : 3;
  return (
    <DashboardPanelSurface>
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/40 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando publicações…
        </div>
      ) : (
        <>
          <div
            className={cn(
              "grid grid-cols-7",
              density === "compact"
                ? "auto-rows-[minmax(104px,1fr)]"
                : "auto-rows-[minmax(150px,1fr)]",
            )}
          >
            {days.map((d, i) => {
              const key = dayKey(d);
              const items = byDay.get(key) ?? [];
              const inMonth = d.getMonth() === anchorMonth;
              const isToday = key === todayKey;
              return (
                <div
                  key={i}
                  className={cn(
                    "group/day flex flex-col border-b border-r border-border/60 pb-1.5",
                    inMonth ? "bg-background" : "bg-muted/25 text-muted-foreground",
                    isToday && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                  )}
                >
                  <div className="flex items-center justify-between px-2 pt-2">
                    <span
                      className={cn(
                        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums",
                        isToday
                          ? "bg-primary text-primary-foreground"
                          : inMonth
                            ? "text-foreground/80"
                            : "text-muted-foreground/70",
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {items.length > 0 ? (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {items.length}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex-1 space-y-1 px-1.5 pt-1">
                    {items.slice(0, maxVisible).map((it) =>
                      it.kind === "post" ? (
                        <PublicationCard
                          key={it.data.postId}
                          item={it.data}
                          onOpen={onOpen}
                          density={density}
                        />
                      ) : (
                        <EventChip
                          key={"e" + it.data.id}
                          item={{ kind: "event", data: it.data }}
                          onOpen={(x) => x.kind === "event" && onOpenEvent(x.data)}
                        />
                      ),
                    )}
                    {items.length > maxVisible ? (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="block w-full rounded-md px-1 py-0.5 text-left text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            +{items.length - maxVisible} mais
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-80 p-2">
                          <div className="mb-2 px-1 text-xs font-semibold">
                            {d.toLocaleDateString("pt-BR", {
                              weekday: "short",
                              day: "2-digit",
                              month: "short",
                            })}
                          </div>
                          <div className="max-h-72 space-y-1 overflow-y-auto">
                            {items.map((it) =>
                              it.kind === "post" ? (
                                <PublicationCard
                                  key={it.data.postId}
                                  item={it.data}
                                  onOpen={onOpen}
                                />
                              ) : (
                                <EventChip
                                  key={"e" + it.data.id}
                                  item={{ kind: "event", data: it.data }}
                                  onOpen={(x) => x.kind === "event" && onOpenEvent(x.data)}
                                />
                              ),
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                    {items.length === 0 && inMonth && onNewOnDay ? (
                      <button
                        type="button"
                        onClick={() => onNewOnDay(d)}
                        className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border/60 py-1 text-[10px] text-muted-foreground/70 opacity-0 transition-all hover:border-border hover:text-foreground group-hover/day:opacity-100"
                      >
                        <Plus className="h-3 w-3" /> Publicação
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {empty ? (
            <div className="border-t border-border/60">
              <PanelEmptyState
                icon={<CalendarDays className="h-5 w-5" />}
                text="Nenhuma publicação neste período. Crie um conteúdo ou altere o período selecionado."
              />
            </div>
          ) : null}
        </>
      )}
    </DashboardPanelSurface>
  );
}
