import { useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { TaskRow } from "@/lib/tasks.functions";
import { PRIORITY_META, STATUS_META, isOverdue } from "./shared";

export function TaskCalendar({
  tasks,
  onOpenTask,
}: {
  tasks: TaskRow[];
  onOpenTask: (id: string) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      if (!t.due_at) continue;
      const key = format(new Date(t.due_at), "yyyy-MM-dd");
      const bucket = map.get(key) ?? [];
      bucket.push(t);
      map.set(key, bucket);
    }
    return map;
  }, [tasks]);

  const weekdays = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 0 });
    return Array.from({ length: 7 }, (_, i) => format(addDays(base, i), "EEE", { locale: ptBR }));
  }, []);

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold capitalize">
          {format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            Hoje
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCursor((c) => subMonths(c, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCursor((c) => addMonths(c, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/20 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {weekdays.map((d) => (
          <div key={d} className="px-2 py-2 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const list = byDay.get(key) ?? [];
          const inMonth = isSameMonth(day, cursor);
          const today = isToday(day);
          return (
            <div
              key={key}
              className={cn(
                "min-h-[100px] border-b border-r border-border/40 p-2 last:border-r-0",
                !inMonth && "bg-muted/30",
              )}
            >
              <div
                className={cn(
                  "mb-1 flex items-center justify-between text-[11px]",
                  !inMonth && "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded",
                    today && "bg-primary text-primary-foreground font-semibold",
                  )}
                >
                  {format(day, "d")}
                </span>
                {list.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{list.length}</span>
                )}
              </div>
              <div className="space-y-1">
                {list.slice(0, 3).map((t) => {
                  const p = PRIORITY_META[t.priority];
                  const overdue = isOverdue(t);
                  return (
                    <button
                      key={t.id}
                      onClick={() => onOpenTask(t.id)}
                      className={cn(
                        "flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[10px]",
                        p.badge,
                        overdue && "ring-1 ring-rose-500/40",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          STATUS_META[t.status].dot,
                        )}
                      />
                      <span className="truncate">{t.title}</span>
                    </button>
                  );
                })}
                {list.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{list.length - 3} tarefas
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
