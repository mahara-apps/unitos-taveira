/**
 * Linha densa compartilhada por JOB e TAREFA — mesma anatomia nos dois níveis
 * para leitura previsível:
 *   ○  Nome            ☰ 5   0/5   [avatar]   30/10   (Status)   ⋮
 * Componente apenas de apresentação: nenhuma query própria.
 */
import type { ReactNode } from "react";
import { Check, ListTree } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_TIMEZONE } from "@/lib/timezone";

export function formatShortDate(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      timeZone: APP_TIMEZONE,
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return null;
  }
}

/** `01/10 – 30/10`, ou só uma das pontas quando a outra não existe. */
export function formatRange(start?: string | null, end?: string | null) {
  const a = formatShortDate(start);
  const b = formatShortDate(end);
  if (a && b) return `${a} – ${b}`;
  return b ?? a ?? null;
}

export function isOverdue(due?: string | null, done?: boolean) {
  if (!due || done) return false;
  return new Date(due).getTime() < Date.now();
}

export type WorkItemRowProps = {
  title: string;
  done?: boolean;
  onToggleDone?: () => void;
  onOpen?: () => void;
  selected?: boolean;
  /** Ponto de cor à esquerda do nome (job). */
  color?: string | null;
  /** Contagem de subitens (☰ 5). */
  subCount?: number | null;
  /** Progresso `feitas/total`. */
  progress?: { done: number; total: number } | null;
  /** Texto auxiliar discreto (tempo apontado, canal, etc.). */
  meta?: ReactNode;
  assignee?: ReactNode;
  dateLabel?: string | null;
  overdue?: boolean;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function WorkItemRow({
  title,
  done = false,
  onToggleDone,
  onOpen,
  selected = false,
  color,
  subCount,
  progress,
  meta,
  assignee,
  dateLabel,
  overdue = false,
  status,
  actions,
  className,
}: WorkItemRowProps) {
  return (
    <div
      className={cn(
        "group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-l-2 px-3 py-2.5 transition-colors sm:flex",
        selected ? "border-l-primary bg-muted/50" : "border-l-transparent hover:bg-muted/40",
        className,
      )}
    >
      {onToggleDone ? (
        <button
          type="button"
          onClick={onToggleDone}
          aria-label={done ? "Reabrir" : "Concluir"}
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors",
            done
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border text-transparent hover:border-primary hover:text-primary/60",
          )}
        >
          <Check className="h-3 w-3" />
        </button>
      ) : (
        <span className="h-5 w-5 shrink-0" aria-hidden />
      )}

      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="col-start-2 min-w-0 flex-1 text-left disabled:cursor-default"
      >
        <span className="flex min-w-0 items-center gap-2">
          {color ? (
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: color }}
            />
          ) : null}
          <span
            className={cn(
              "truncate text-sm font-medium",
              done && "text-muted-foreground line-through",
            )}
          >
            {title}
          </span>
        </span>
        {meta ? (
          <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            {meta}
          </span>
        ) : null}
      </button>

      <div className="col-span-3 col-start-1 flex shrink-0 items-center justify-end gap-3 sm:col-auto">
        {typeof subCount === "number" && subCount > 0 ? (
          <span className="hidden items-center gap-1 text-[11px] tabular-nums text-muted-foreground sm:flex">
            <ListTree className="h-3 w-3" />
            {subCount}
          </span>
        ) : null}
        {progress ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            <span className={progress.done > 0 ? "text-emerald-600 dark:text-emerald-400" : ""}>
              {progress.done}
            </span>
            /{progress.total}
          </span>
        ) : null}
        {assignee}
        {dateLabel ? (
          <span
            className={cn(
              "text-[11px] font-medium tabular-nums",
              overdue ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {dateLabel}
          </span>
        ) : null}
        {status}
        {actions}
      </div>
    </div>
  );
}
