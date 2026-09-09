/**
 * Fonte ÚNICA dos filtros de visibilidade (ativos / concluídos / arquivados / todos)
 * e de prazo (atrasadas / hoje / amanhã / 7 dias / sem prazo) usados na hierarquia
 * projeto → job → tarefa.
 *
 * As faixas de prazo respeitam o fuso oficial (America/Sao_Paulo) via
 * `src/lib/timezone.ts`; nenhuma tela deve redefinir "atrasada".
 */
import { addDaysInTz, endOfDayInTz, startOfDayInTz } from "./timezone";

export type VisibilityFilter = "active" | "done" | "archived" | "all";

export const VISIBILITY_FILTERS: VisibilityFilter[] = ["active", "done", "archived", "all"];

export const VISIBILITY_LABELS: Record<VisibilityFilter, string> = {
  active: "Ativos",
  done: "Concluídos",
  archived: "Arquivados",
  all: "Todos",
};

/** Precisa buscar itens arquivados no servidor? */
export function needsArchived(filter: VisibilityFilter): boolean {
  return filter !== "active";
}

export type WorkItemState = {
  done?: boolean | null;
  status?: string | null;
  archived_at?: string | null;
};

export function isItemDone(item: WorkItemState): boolean {
  return item.done === true || item.status === "done";
}

export function matchesVisibility(item: WorkItemState, filter: VisibilityFilter): boolean {
  const archived = !!item.archived_at;
  const done = isItemDone(item);
  switch (filter) {
    case "active":
      return !archived && !done;
    case "done":
      return done;
    case "archived":
      return archived;
    case "all":
      return true;
  }
}

/* --------------------------------- prazo ---------------------------------- */

export type DueFilter = "all" | "overdue" | "today" | "tomorrow" | "week" | "none";

export const DUE_FILTERS: DueFilter[] = ["all", "overdue", "today", "tomorrow", "week", "none"];

export const DUE_LABELS: Record<DueFilter, string> = {
  all: "Todos",
  overdue: "Atrasadas",
  today: "Hoje",
  tomorrow: "Amanhã",
  week: "Próximos 7 dias",
  none: "Sem prazo",
};

export function matchesDue(
  dueAt: string | null | undefined,
  done: boolean,
  filter: DueFilter,
  now: Date = new Date(),
): boolean {
  if (filter === "all") return true;
  if (!dueAt) return filter === "none";
  if (filter === "none") return false;

  const due = new Date(dueAt).getTime();
  if (Number.isNaN(due)) return false;

  switch (filter) {
    case "overdue":
      return !done && due < now.getTime();
    case "today":
      return due >= startOfDayInTz(now).getTime() && due <= endOfDayInTz(now).getTime();
    case "tomorrow": {
      const d = addDaysInTz(now, 1);
      return due >= startOfDayInTz(d).getTime() && due <= endOfDayInTz(d).getTime();
    }
    case "week":
      return (
        due >= startOfDayInTz(now).getTime() && due <= endOfDayInTz(addDaysInTz(now, 7)).getTime()
      );
    default:
      return true;
  }
}
