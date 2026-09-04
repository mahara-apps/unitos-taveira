import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  Loader2,
  MoreHorizontal,
  Trash2,
  MessageSquare,
  Paperclip,
  Folder,
  Users,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteTaskFn,
  listSubtasksFn,
  setTaskArchivedFn,
  updateTaskFn,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks.functions";
import { PRIORITY_META, STATUS_META, TaskAssignee, isOverdue, relativeDue } from "./shared";

export type GroupBy = "none" | "status" | "priority" | "project" | "client" | "assignee" | "due";
export type SortKey =
  | "title"
  | "assignee"
  | "project"
  | "client"
  | "priority"
  | "status"
  | "due"
  | "created"
  | "time";
export type SortDir = "asc" | "desc";

export type VisibleColumns = {
  assignee: boolean;
  project: boolean;
  client: boolean;
  priority: boolean;
  status: boolean;
  due: boolean;
  created: boolean;
  time: boolean;
  comments: boolean;
  attachments: boolean;
};

/**
 * Colunas padrão da nova lista enxuta:
 * TAREFA | PROJETO | RESPONSÁVEL | PRAZO | STATUS
 * Cliente, prioridade, tempo e comentários seguem disponíveis via "Colunas".
 */
export const DEFAULT_VISIBLE_COLUMNS: VisibleColumns = {
  assignee: true,
  project: true,
  client: false,
  priority: false,
  status: true,
  due: true,
  created: false,
  time: false,
  comments: false,
  attachments: false,
};

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER: Record<TaskStatus, number> = { todo: 0, in_progress: 1, review: 2, done: 3 };

function compare(a: TaskRow, b: TaskRow, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title);
    case "assignee":
      return (a.assignee_name ?? "").localeCompare(b.assignee_name ?? "");
    case "project":
      return (a.project_name ?? "").localeCompare(b.project_name ?? "");
    case "client":
      return (a.client_name ?? "").localeCompare(b.client_name ?? "");
    case "priority":
      return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    case "status":
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case "due":
      return (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");
    case "created":
      return b.created_at.localeCompare(a.created_at);
    case "time":
      return (a.time_spent_seconds ?? 0) - (b.time_spent_seconds ?? 0);
  }
}

function dueBucket(t: TaskRow): { key: string; label: string; order: number } {
  if (!t.due_at) return { key: "none", label: "Sem prazo", order: 4 };
  const d = new Date(t.due_at);
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(now);
  endToday.setHours(23, 59, 59, 999);
  if (d.getTime() < startToday.getTime() && t.status !== "done")
    return { key: "overdue", label: "Atrasadas", order: 0 };
  if (d.getTime() <= endToday.getTime()) return { key: "today", label: "Hoje", order: 1 };
  const week = new Date(endToday);
  week.setDate(week.getDate() + 7);
  if (d.getTime() <= week.getTime()) return { key: "week", label: "Próximos 7 dias", order: 2 };
  return { key: "later", label: "Mais adiante", order: 3 };
}

function groupTasks(
  tasks: TaskRow[],
  groupBy: GroupBy,
): Array<{ key: string; label: string; items: TaskRow[] }> {
  if (groupBy === "none") return [{ key: "all", label: "Todas as tarefas", items: tasks }];
  const map = new Map<string, { label: string; items: TaskRow[]; order: number }>();
  for (const t of tasks) {
    let key: string;
    let label: string;
    let order = 0;
    switch (groupBy) {
      case "status":
        key = t.status;
        label = STATUS_META[t.status].label;
        order = STATUS_ORDER[t.status];
        break;
      case "priority":
        key = t.priority;
        label = PRIORITY_META[t.priority].label;
        order = PRIORITY_ORDER[t.priority];
        break;
      case "project":
        key = t.project_id ?? "__none__";
        label = t.project_name ?? "Sem projeto";
        break;
      case "client":
        key = t.client_id ?? "__none__";
        label = t.client_name ?? "Sem cliente";
        break;
      case "assignee":
        key = t.assignee_id ?? "__none__";
        label = t.assignee_name ?? "Não atribuída";
        break;
      default:
        key = "all";
        label = "Todas as tarefas";
        break;
    }
    const bucket = map.get(key) ?? { label, items: [], order };
    bucket.items.push(t);
    map.set(key, bucket);
  }
  const ordered = Array.from(map.entries());
  if (groupBy === "status" || groupBy === "priority") {
    ordered.sort(([, a], [, b]) => a.order - b.order);
  } else {
    ordered.sort(([, a], [, b]) => a.label.localeCompare(b.label));
  }
  return ordered.map(([key, v]) => ({ key, label: v.label, items: v.items }));
}

function groupTasksByDue(tasks: TaskRow[]) {
  const map = new Map<string, { label: string; order: number; items: TaskRow[] }>();
  for (const t of tasks) {
    const b = dueBucket(t);
    const bucket = map.get(b.key) ?? { label: b.label, order: b.order, items: [] };
    bucket.items.push(t);
    map.set(b.key, bucket);
  }
  return Array.from(map.entries())
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([key, v]) => ({ key, label: v.label, items: v.items }));
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  if (dir === "asc") return <ArrowUp className="h-3 w-3" />;
  if (dir === "desc") return <ArrowDown className="h-3 w-3" />;
  return <ArrowUpDown className="h-3 w-3 opacity-30" />;
}

function Th({
  children,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  className,
  align = "left",
}: {
  children?: React.ReactNode;
  sortKey?: SortKey;
  currentKey?: SortKey;
  currentDir?: SortDir;
  onSort?: (k: SortKey) => void;
  className?: string;
  align?: "left" | "center" | "right";
}) {
  const isCurrent = sortKey && sortKey === currentKey;
  return (
    <th
      className={cn(
        "sticky top-0 z-10 border-b border-border/60 bg-background/95 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground backdrop-blur",
        align === "center" && "text-center",
        align === "right" && "text-right",
        className,
      )}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => onSort(sortKey)}
        >
          {children}
          <SortIcon dir={isCurrent ? (currentDir ?? "asc") : null} />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function TaskTable({
  brandId,
  tasks,
  columns,
  groupBy,
  sortKey,
  sortDir,
  onSort,
  selectedIds,
  onSelectionChange,
  onOpenTask,
  onChanged,
}: {
  brandId: string;
  tasks: TaskRow[];
  columns: VisibleColumns;
  groupBy: GroupBy;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  selectedIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  onOpenTask: (id: string) => void;
  onChanged: () => void;
}) {
  const sorted = useMemo(() => {
    const list = [...tasks];
    list.sort((a, b) => {
      const c = compare(a, b, sortKey);
      return sortDir === "asc" ? c : -c;
    });
    return list;
  }, [tasks, sortKey, sortDir]);

  const groups = useMemo(
    () => (groupBy === "due" ? groupTasksByDue(sorted) : groupTasks(sorted, groupBy)),
    [sorted, groupBy],
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  const allSelected = tasks.length > 0 && tasks.every((t) => selectedIds.has(t.id));
  const someSelected = !allSelected && tasks.some((t) => selectedIds.has(t.id));

  function toggleAll(checked: boolean) {
    if (checked) onSelectionChange(new Set(tasks.map((t) => t.id)));
    else onSelectionChange(new Set());
  }
  function toggleOne(id: string) {
    const n = new Set(selectedIds);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onSelectionChange(n);
  }

  const colCount = 3 + Object.values(columns).filter(Boolean).length; // checkbox + tarefa + ações

  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-9" />
          <col />
          {columns.project && <col className="w-[170px]" />}
          {columns.client && <col className="w-[150px]" />}
          {columns.assignee && <col className="w-[140px]" />}
          {columns.due && <col className="w-[128px]" />}
          {columns.status && <col className="w-[136px]" />}
          {columns.priority && <col className="w-[110px]" />}
          {columns.created && <col className="w-[110px]" />}
          {columns.time && <col className="w-[100px]" />}
          {columns.comments && <col className="w-[70px]" />}
          {columns.attachments && <col className="w-[70px]" />}
          <col className="w-10" />
        </colgroup>
        <thead>
          <tr>
            <Th align="center">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => toggleAll(Boolean(v))}
                aria-label="Selecionar todas"
              />
            </Th>
            <Th sortKey="title" currentKey={sortKey} currentDir={sortDir} onSort={onSort}>
              Tarefa
            </Th>
            {columns.project && (
              <Th
                sortKey="project"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={onSort}
                className="hidden md:table-cell"
              >
                Projeto
              </Th>
            )}
            {columns.client && (
              <Th
                sortKey="client"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={onSort}
                className="hidden xl:table-cell"
              >
                Cliente
              </Th>
            )}
            {columns.assignee && (
              <Th
                sortKey="assignee"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={onSort}
                className="hidden lg:table-cell"
              >
                Responsável
              </Th>
            )}
            {columns.due && (
              <Th sortKey="due" currentKey={sortKey} currentDir={sortDir} onSort={onSort}>
                Prazo
              </Th>
            )}
            {columns.status && (
              <Th sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={onSort}>
                Status
              </Th>
            )}
            {columns.priority && (
              <Th
                sortKey="priority"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={onSort}
                className="hidden xl:table-cell"
              >
                Prioridade
              </Th>
            )}
            {columns.created && (
              <Th
                sortKey="created"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={onSort}
                className="hidden xl:table-cell"
              >
                Criado
              </Th>
            )}
            {columns.time && (
              <Th
                sortKey="time"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={onSort}
                className="hidden xl:table-cell"
              >
                Tempo
              </Th>
            )}
            {columns.comments && (
              <Th align="center" className="hidden xl:table-cell">
                Coment.
              </Th>
            )}
            {columns.attachments && (
              <Th align="center" className="hidden xl:table-cell">
                Anexos
              </Th>
            )}
            <Th align="right" />
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <TaskGroup
              key={group.key}
              group={group}
              collapsed={collapsed.has(group.key)}
              toggle={() => toggle(group.key)}
              brandId={brandId}
              columns={columns}
              colCount={colCount}
              selectedIds={selectedIds}
              toggleOne={toggleOne}
              onOpenTask={onOpenTask}
              onChanged={onChanged}
              showHeader={groupBy !== "none"}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskGroup({
  group,
  collapsed,
  toggle,
  brandId,
  columns,
  colCount,
  selectedIds,
  toggleOne,
  onOpenTask,
  onChanged,
  showHeader,
}: {
  group: { key: string; label: string; items: TaskRow[] };
  collapsed: boolean;
  toggle: () => void;
  brandId: string;
  columns: VisibleColumns;
  colCount: number;
  selectedIds: Set<string>;
  toggleOne: (id: string) => void;
  onOpenTask: (id: string) => void;
  onChanged: () => void;
  showHeader: boolean;
}) {
  return (
    <>
      {showHeader && (
        <tr className="bg-muted/40">
          <td colSpan={colCount} className="border-y border-border/60 px-3 py-1.5">
            <button
              type="button"
              onClick={toggle}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {group.label}
              <span className="text-muted-foreground/70">· {group.items.length}</span>
            </button>
          </td>
        </tr>
      )}
      {!collapsed &&
        group.items.map((task) => (
          <TaskTableRow
            key={task.id}
            task={task}
            brandId={brandId}
            columns={columns}
            colCount={colCount}
            selected={selectedIds.has(task.id)}
            onToggleSelect={() => toggleOne(task.id)}
            onOpen={() => onOpenTask(task.id)}
            onChanged={onChanged}
          />
        ))}
    </>
  );
}

function DueCell({ task }: { task: TaskRow }) {
  const overdue = isOverdue(task);
  if (!task.due_at) return <span className="text-xs text-muted-foreground/70">Sem prazo</span>;
  const d = new Date(task.due_at);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const short = format(d, "d MMM", { locale: ptBR });
  return (
    <div className="leading-tight">
      <div
        className={cn(
          "text-xs font-medium",
          overdue
            ? "text-rose-600 dark:text-rose-400"
            : isToday
              ? "text-amber-600 dark:text-amber-400"
              : "text-foreground",
        )}
      >
        {overdue ? "Atrasada" : isToday ? "Hoje" : short}
      </div>
      {(overdue || isToday) && <div className="text-[10px] text-muted-foreground">{short}</div>}
    </div>
  );
}

function StatusCell({ task, onChange }: { task: TaskRow; onChange: (s: TaskStatus) => void }) {
  const meta = STATUS_META[task.status];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full items-center gap-1 truncate rounded-md border px-2 py-0.5 text-[11px] font-medium transition hover:brightness-105",
            meta.badge,
          )}
        >
          {meta.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs">Status</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={task.status}
          onValueChange={(v) => onChange(v as TaskStatus)}
        >
          {TASK_STATUSES.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {STATUS_META[s].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SubtaskRows({ taskId, colCount }: { taskId: string; colCount: number }) {
  const list = useServerFn(listSubtasksFn);
  const q = useQuery({
    queryKey: ["task-subtasks", taskId],
    queryFn: () => list({ data: { taskId } }),
  });
  return (
    <tr className="border-b border-border/40 bg-muted/20">
      <td />
      <td colSpan={colCount - 1} className="px-3 py-2">
        {q.isLoading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando subtarefas...
          </span>
        ) : (q.data ?? []).length === 0 ? (
          <span className="text-xs text-muted-foreground">Sem subtarefas.</span>
        ) : (
          <ul className="space-y-1">
            {(q.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-xs">
                {s.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
                )}
                <span className={cn("truncate", s.done && "text-muted-foreground line-through")}>
                  {s.title}
                </span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function TaskTableRow({
  task,
  brandId,
  columns,
  colCount,
  selected,
  onToggleSelect,
  onOpen,
  onChanged,
}: {
  task: TaskRow;
  brandId: string;
  columns: VisibleColumns;
  colCount: number;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const update = useServerFn(updateTaskFn);
  const remove = useServerFn(deleteTaskFn);
  const archive = useServerFn(setTaskArchivedFn);
  const [expanded, setExpanded] = useState(false);

  const patch = useMutation({
    mutationFn: (p: Record<string, unknown>) =>
      update({ data: { taskId: task.id, patch: p as never } }),
    onSuccess: onChanged,
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => remove({ data: { taskId: task.id } }),
    onSuccess: () => {
      toast.success("Tarefa excluída");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleArchive = useMutation({
    mutationFn: () => archive({ data: { taskId: task.id, archived: !task.archived_at } }),
    onSuccess: () => {
      toast.success(task.archived_at ? "Tarefa restaurada" : "Tarefa arquivada");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isDone = task.status === "done";
  const total = task.subtasks_total ?? 0;
  const doneCount = task.subtasks_done ?? 0;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const priority = PRIORITY_META[task.priority];

  return (
    <>
      <tr
        onClick={onOpen}
        className={cn(
          "group cursor-pointer border-b border-border/40 transition-colors hover:bg-muted/40",
          selected && "bg-primary/5",
        )}
      >
        <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 pt-0.5">
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelect}
              aria-label={`Selecionar ${task.title}`}
            />
          </div>
        </td>

        <td className="px-3 py-2 align-top">
          <div className="flex min-w-0 items-start gap-2">
            <button
              aria-label={isDone ? "Reabrir tarefa" : "Marcar como concluída"}
              onClick={(e) => {
                e.stopPropagation();
                patch.mutate({ done: !isDone, status: isDone ? "todo" : "done" });
              }}
              className="mt-0.5 shrink-0"
            >
              {isDone ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/60 hover:text-foreground" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={cn(
                    "truncate text-sm font-medium",
                    isDone && "text-muted-foreground line-through",
                  )}
                  title={task.title}
                >
                  {task.title}
                </span>
                {task.priority === "urgent" || task.priority === "high" ? (
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priority.dot)}
                    title={`Prioridade ${priority.label}`}
                  />
                ) : null}
                {task.archived_at ? (
                  <Badge variant="outline" className="shrink-0 text-[9px]">
                    Arquivada
                  </Badge>
                ) : null}
              </div>
              {total > 0 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((v) => !v);
                  }}
                  className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {expanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {total} subtarefa{total > 1 ? "s" : ""} · {pct}% concluído
                  <span className="ml-1 hidden h-1 w-16 overflow-hidden rounded-full bg-muted sm:inline-block">
                    <span
                      className="block h-full rounded-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </button>
              ) : null}
              {/* Contexto secundário em telas estreitas */}
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground md:hidden">
                {task.project_name ? (
                  <span className="inline-flex min-w-0 items-center gap-1 truncate">
                    <Folder className="h-3 w-3 shrink-0" /> {task.project_name}
                  </span>
                ) : null}
                {task.client_name ? (
                  <span className="inline-flex min-w-0 items-center gap-1 truncate">
                    <Users className="h-3 w-3 shrink-0" /> {task.client_name}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </td>

        {columns.project && (
          <td className="hidden px-3 py-2 align-top md:table-cell">
            {task.project_name ? (
              <div className="min-w-0 leading-tight">
                <span className="inline-flex min-w-0 max-w-full items-center gap-1 truncate text-xs text-foreground">
                  <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{task.project_name}</span>
                </span>
                {task.client_name && !columns.client ? (
                  <div className="truncate pl-4 text-[10px] text-muted-foreground">
                    {task.client_name}
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/70">—</span>
            )}
          </td>
        )}

        {columns.client && (
          <td className="hidden px-3 py-2 align-top xl:table-cell">
            {task.client_name ? (
              <span className="inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground">
                <Users className="h-3 w-3 shrink-0" /> {task.client_name}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/70">—</span>
            )}
          </td>
        )}

        {columns.assignee && (
          <td className="hidden px-3 py-2 align-top lg:table-cell">
            {task.assignee_id ? (
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <TaskAssignee
                  name={task.assignee_name}
                  avatarUrl={task.assignee_avatar}
                  size={20}
                />
                <span className="truncate">
                  {(task.assignee_name ?? "").split(/\s+/)[0] || "—"}
                </span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/70">Não atribuída</span>
            )}
          </td>
        )}

        {columns.due && (
          <td className="px-3 py-2 align-top">
            <DueCell task={task} />
          </td>
        )}

        {columns.status && (
          <td className="px-3 py-2 align-top" onClick={(e) => e.stopPropagation()}>
            <StatusCell
              task={task}
              onChange={(s) => patch.mutate({ status: s, done: s === "done" })}
            />
          </td>
        )}

        {columns.priority && (
          <td
            className="hidden px-3 py-2 align-top xl:table-cell"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                    priority.badge,
                  )}
                >
                  {priority.label}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuRadioGroup
                  value={task.priority}
                  onValueChange={(v) => patch.mutate({ priority: v as TaskPriority })}
                >
                  {TASK_PRIORITIES.map((p) => (
                    <DropdownMenuRadioItem key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </td>
        )}

        {columns.created && (
          <td className="hidden px-3 py-2 align-top text-xs text-muted-foreground xl:table-cell">
            {format(new Date(task.created_at), "d/MM/yyyy", { locale: ptBR })}
          </td>
        )}

        {columns.time && (
          <td className="hidden px-3 py-2 align-top xl:table-cell">
            {task.time_spent_seconds && task.time_spent_seconds > 0 ? (
              <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                <Timer className="h-3 w-3" /> {formatDuration(task.time_spent_seconds)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/70">—</span>
            )}
          </td>
        )}

        {columns.comments && (
          <td className="hidden px-3 py-2 align-top text-center xl:table-cell">
            {task.comments_count && task.comments_count > 0 ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <MessageSquare className="h-3 w-3" /> {task.comments_count}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/70">—</span>
            )}
          </td>
        )}

        {columns.attachments && (
          <td className="hidden px-3 py-2 align-top text-center xl:table-cell">
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Paperclip className="h-3 w-3" /> 0
            </span>
          </td>
        )}

        <td className="px-2 py-2 align-top text-right" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}>Abrir detalhes</DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleArchive.mutate()}>
                {task.archived_at ? (
                  <>
                    <ArchiveRestore className="mr-2 h-4 w-4" /> Restaurar
                  </>
                ) : (
                  <>
                    <Archive className="mr-2 h-4 w-4" /> Arquivar
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  if (confirm("Excluir esta tarefa?")) del.mutate();
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </tr>
      {expanded && total > 0 ? <SubtaskRows taskId={task.id} colCount={colCount} /> : null}
    </>
  );
}
