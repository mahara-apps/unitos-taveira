import { CalendarDays, Loader2, Plus } from "lucide-react";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { cn } from "@/lib/utils";
import type { PublicationItem } from "@/lib/calendar-board.functions";
import type { CalendarEvent } from "@/lib/calendar-events.functions";
import { EventChip } from "@/components/calendar/event-chip";
import { PublicationCard, type CardDensity } from "./publication-card";
import { dayKey, type DayMap } from "./day-map";

/** Visão Semana: planner de 7 colunas com cards empilhados por dia. */
export function WeekPlanner({
  days,
  byDay,
  loading,
  empty,
  density,
  onOpen,
  onOpenEvent,
  onNewOnDay,
}: {
  days: Date[];
  byDay: DayMap;
  loading: boolean;
  empty: boolean;
  density: CardDensity;
  onOpen: (i: PublicationItem) => void;
  onOpenEvent: (e: CalendarEvent) => void;
  onNewOnDay?: (d: Date) => void;
}) {
  const todayKey = dayKey(new Date());
  return (
    <DashboardPanelSurface>
      {loading ? (
        <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando publicações…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-7 sm:divide-x sm:divide-y-0">
            {days.map((d) => {
              const key = dayKey(d);
              const items = byDay.get(key) ?? [];
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex min-h-[420px] flex-col bg-background",
                    isToday && "bg-primary/5",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-between gap-1 border-b border-border/60 px-2 py-2",
                      isToday && "border-primary/30",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold tabular-nums",
                          isToday ? "bg-primary text-primary-foreground" : "text-foreground/80",
                        )}
                      >
                        {d.getDate()}
                      </span>
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {items.length}
                    </span>
                  </div>
                  <div className="flex-1 space-y-1 p-1.5">
                    {items.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 pt-6 text-center">
                        <span className="text-[11px] text-muted-foreground">Nada agendado</span>
                        {onNewOnDay ? (
                          <button
                            type="button"
                            onClick={() => onNewOnDay(d)}
                            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/70 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                          >
                            <Plus className="h-3 w-3" /> Agendar
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        {items.map((it) =>
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
                        {onNewOnDay ? (
                          <button
                            type="button"
                            onClick={() => onNewOnDay(d)}
                            className="mt-1 flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border/60 py-1 text-[10px] text-muted-foreground/70 transition-all hover:border-border hover:text-foreground"
                          >
                            <Plus className="h-3 w-3" /> Publicação
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {empty ? (
            <div className="border-t border-border/60">
              <PanelEmptyState
                icon={<CalendarDays className="h-5 w-5" />}
                text="Nenhuma publicação nesta semana. Crie um conteúdo ou altere o período selecionado."
              />
            </div>
          ) : null}
        </>
      )}
    </DashboardPanelSurface>
  );
}
