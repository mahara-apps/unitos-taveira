/**
 * Próximos prazos do projeto — jobs, tarefas e itens de pauta com data,
 * ordenados do mais próximo para o mais distante. Apenas apresentação.
 */
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

export type DeadlineEntry = {
  key: string;
  title: string;
  kindLabel: string;
  date: string;
  onOpen?: () => void;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function UpcomingDeadlines({ entries }: { entries: DeadlineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="px-4 py-3 text-[11px] text-muted-foreground">
        Nenhum prazo definido neste projeto.
      </p>
    );
  }
  const today = new Date().setHours(0, 0, 0, 0);
  return (
    <ul className="divide-y divide-border/60">
      {entries.map((e) => {
        const late = new Date(e.date).setHours(0, 0, 0, 0) < today;
        return (
          <li key={e.key}>
            <button
              type="button"
              onClick={e.onOpen}
              disabled={!e.onOpen}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                e.onOpen && "hover:bg-muted/40",
              )}
            >
              <CalendarClock
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  late ? "text-destructive" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{e.title}</span>
                <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                  {e.kindLabel}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 text-[11px] tabular-nums",
                  late ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {fmt(e.date)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
