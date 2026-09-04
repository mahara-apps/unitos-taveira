import { useMemo, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isToday,
  startOfMonth,
  subMonths,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { TaskRow } from "@/lib/tasks.functions";
import { STATUS_META, TaskAssignee } from "./shared";

type Lane = {
  key: string;
  name: string | null;
  avatar: string | null;
  tasks: TaskRow[];
};

const CELL = 40;

function dayIndex(days: Date[], date: Date) {
  return days.findIndex((d) => isSameDay(d, date));
}

/** Barra de uma tarefa dentro da faixa do mês, do início ao prazo. */
function taskSpan(task: TaskRow, days: Date[]) {
  const start = task.start_date ? new Date(task.start_date) : null;
  const end = task.due_at ? new Date(task.due_at) : null;
  if (!start && !end) return null;
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const rawStart = start ?? end!;
  const rawEnd = end ?? start!;
  if (rawEnd < first || rawStart > last) return null;
  const from = rawStart < first ? 0 : dayIndex(days, rawStart);
  const to = rawEnd > last ? days.length - 1 : dayIndex(days, rawEnd);
  if (from < 0 || to < 0) return null;
  return { from, span: Math.max(1, to - from + 1) };
}

export function TaskTimeline({
  tasks,
  onOpenTask,
}: {
  tasks: TaskRow[];
  onOpenTask: (id: string) => void;
}) {
  const [cursor, setCursor] = useState(() => new Date());

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(cursor), end: endOfMonth(cursor) }),
    [cursor],
  );

  const lanes = useMemo<Lane[]>(() => {
    const map = new Map<string, Lane>();
    for (const t of tasks) {
      if (!taskSpan(t, days)) continue;
      const key = t.assignee_id ?? "none";
      const lane =
        map.get(key) ??
        ({
          key,
          name: t.assignee_id ? (t.assignee_name ?? "Sem nome") : null,
          avatar: t.assignee_avatar ?? null,
          tasks: [],
        } satisfies Lane);
      lane.tasks.push(t);
      map.set(key, lane);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === "none") return -1;
      if (b.key === "none") return 1;
      return (a.name ?? "").localeCompare(b.name ?? "", "pt-BR");
    });
  }, [tasks, days]);

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <header className="flex items-center justify-center gap-3 border-b border-border/60 px-4 py-3">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setCursor((c) => subMonths(c, 1))}
          aria-label="Mês anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xs font-mono uppercase tracking-widest">
          {format(cursor, "MMMM yyyy", { locale: ptBR })}
        </h2>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setCursor((c) => addMonths(c, 1))}
          aria-label="Próximo mês"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </header>

      {lanes.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma tarefa com datas neste mês.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max">
            {/* Cabeçalho de dias */}
            <div className="flex border-b border-border/60 bg-muted/20">
              <div className="sticky left-0 z-10 w-44 shrink-0 border-r border-border/60 bg-card px-3 py-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Responsável
              </div>
              {days.map((d) => {
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div
                    key={d.toISOString()}
                    style={{ width: CELL }}
                    className={cn(
                      "shrink-0 border-r border-border/40 py-1 text-center",
                      weekend && "bg-muted/40",
                      isToday(d) && "bg-primary/10",
                    )}
                  >
                    <div className="text-[11px] font-medium leading-tight">{format(d, "d")}</div>
                    <div className="text-[9px] uppercase text-muted-foreground">
                      {format(d, "EEEEE", { locale: ptBR })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Faixas por responsável */}
            {lanes.map((lane) => (
              <div key={lane.key} className="flex border-b border-border/60 last:border-b-0">
                <div className="sticky left-0 z-10 flex w-44 shrink-0 items-center gap-2 border-r border-border/60 bg-card px-3 py-2">
                  {lane.key === "none" ? (
                    <span className="h-6 w-6 rounded-full border border-dashed border-border/60" />
                  ) : (
                    <TaskAssignee name={lane.name} avatarUrl={lane.avatar} size={24} />
                  )}
                  <span className="truncate text-xs">
                    {lane.key === "none" ? "Sem responsável" : (lane.name ?? "Sem nome")}
                  </span>
                </div>

                <div className="relative flex-1">
                  {/* grade de fundo */}
                  <div className="absolute inset-0 flex">
                    {days.map((d) => {
                      const weekend = d.getDay() === 0 || d.getDay() === 6;
                      return (
                        <div
                          key={d.toISOString()}
                          style={{ width: CELL }}
                          className={cn(
                            "shrink-0 border-r border-border/30",
                            weekend && "bg-muted/30",
                            isToday(d) && "bg-primary/5",
                          )}
                        />
                      );
                    })}
                  </div>

                  <div className="relative space-y-1 py-2">
                    {lane.tasks.map((t) => {
                      const span = taskSpan(t, days)!;
                      const meta = STATUS_META[t.status];
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => onOpenTask(t.id)}
                          title={t.title}
                          style={{
                            marginLeft: span.from * CELL + 2,
                            width: span.span * CELL - 4,
                          }}
                          className={cn(
                            "block truncate rounded-md px-2 py-1 text-left text-[11px] font-medium text-white transition hover:opacity-90",
                            meta.dot,
                          )}
                        >
                          {t.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
