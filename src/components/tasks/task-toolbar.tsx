import {
  ArrowUpDown,
  Columns3,
  Download,
  Filter,
  Group,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from "@/lib/tasks.functions";
import { PRIORITY_META, STATUS_META } from "./shared";
import type { GroupBy, SortDir, SortKey, VisibleColumns } from "./task-table";

export type TaskFilters = {
  search: string;
  status: TaskStatus | "all";
  priority: TaskPriority | "all";
  assigneeId: string | "all" | "me";
  clientId: string | "all";
  projectId: string | "all";
  hideDone: boolean;
  /** Filtro de prazo: hoje, atrasadas, próximos 7 dias ou sem prazo. */
  due: "all" | "overdue" | "today" | "week" | "none";
  /** Visão de arquivamento (arquivar nunca exclui a tarefa). */
  archive: "active" | "archived" | "all";
};

export const DEFAULT_FILTERS: TaskFilters = {
  search: "",
  status: "all",
  priority: "all",
  assigneeId: "all",
  clientId: "all",
  projectId: "all",
  hideDone: false,
  due: "all",
  archive: "active",
};

export function applyFilters(
  tasks: TaskRow[],
  filters: TaskFilters,
  myId: string | null,
): TaskRow[] {
  const q = filters.search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (filters.hideDone && t.status === "done") return false;
    if (filters.status !== "all" && t.status !== filters.status) return false;
    if (filters.priority !== "all" && t.priority !== filters.priority) return false;
    if (filters.assigneeId === "me" && t.assignee_id !== myId) return false;
    if (
      filters.assigneeId !== "all" &&
      filters.assigneeId !== "me" &&
      t.assignee_id !== filters.assigneeId
    )
      return false;
    if (filters.clientId !== "all" && t.client_id !== filters.clientId) return false;
    if (filters.projectId !== "all" && t.project_id !== filters.projectId) return false;
    if (filters.due !== "all") {
      const now = new Date();
      const due = t.due_at ? new Date(t.due_at) : null;
      if (filters.due === "none" && due) return false;
      if (filters.due !== "none") {
        if (!due) return false;
        if (filters.due === "overdue" && !(due.getTime() < now.getTime() && t.status !== "done"))
          return false;
        if (filters.due === "today" && due.toDateString() !== now.toDateString()) return false;
        if (filters.due === "week") {
          const limit = new Date(now);
          limit.setDate(limit.getDate() + 7);
          if (due.getTime() > limit.getTime() || due.getTime() < now.setHours(0, 0, 0, 0))
            return false;
        }
      }
    }
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      (t.description ?? "").toLowerCase().includes(q) ||
      (t.assignee_name ?? "").toLowerCase().includes(q) ||
      (t.project_name ?? "").toLowerCase().includes(q) ||
      (t.client_name ?? "").toLowerCase().includes(q)
    );
  });
}

function countActive(filters: TaskFilters): number {
  let n = 0;
  if (filters.status !== "all") n++;
  if (filters.priority !== "all") n++;
  if (filters.assigneeId !== "all") n++;
  if (filters.clientId !== "all") n++;
  if (filters.projectId !== "all") n++;
  if (filters.hideDone) n++;
  if (filters.due !== "all") n++;
  if (filters.archive !== "active") n++;
  return n;
}

export function TaskToolbar({
  filters,
  onFiltersChange,
  groupBy,
  onGroupByChange,
  sortKey,
  sortDir,
  onSortChange,
  columns,
  onColumnsChange,
  tasksToExport,
  assignees,
  clients,
  projects,
}: {
  filters: TaskFilters;
  onFiltersChange: (next: TaskFilters) => void;
  groupBy: GroupBy;
  onGroupByChange: (g: GroupBy) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSortChange: (k: SortKey, d: SortDir) => void;
  columns: VisibleColumns;
  onColumnsChange: (c: VisibleColumns) => void;
  tasksToExport: TaskRow[];
  assignees: Array<{ id: string; name: string; avatar_url: string | null }>;
  clients: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; client_id: string | null }>;
}) {
  const activeCount = countActive(filters);

  function exportCsv() {
    const rows = [
      ["Título", "Status", "Prioridade", "Responsável", "Projeto", "Cliente", "Prazo", "Criado em"],
      ...tasksToExport.map((t) => [
        t.title,
        STATUS_META[t.status].label,
        PRIORITY_META[t.priority].label,
        t.assignee_name ?? "",
        t.project_name ?? "",
        t.client_name ?? "",
        t.due_at ? format(new Date(t.due_at), "yyyy-MM-dd HH:mm") : "",
        format(new Date(t.created_at), "yyyy-MM-dd"),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tarefas-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exportadas ${tasksToExport.length} tarefas`);
  }

  const dueLabel: Record<TaskFilters["due"], string> = {
    all: "Todos",
    overdue: "Atrasadas",
    today: "Hoje",
    week: "Próximos 7 dias",
    none: "Sem prazo",
  };

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {/* Filtros */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant={activeCount > 0 ? "secondary" : "outline"}
              className="h-8 gap-1.5"
            >
              <Filter className="h-3.5 w-3.5" />
              Filtrar
              {activeCount > 0 ? (
                <span className="text-muted-foreground">· {activeCount}</span>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[22rem] space-y-3 p-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Status
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {(["all", ...TASK_STATUSES] as Array<TaskStatus | "all">).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onFiltersChange({ ...filters, status: s })}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] transition",
                      filters.status === s
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s === "all" ? "Todos" : STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Prazo
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(dueLabel) as Array<TaskFilters["due"]>).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onFiltersChange({ ...filters, due: d })}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] transition",
                      filters.due === d
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {dueLabel[d]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Responsável
              </Label>
              <Select
                value={filters.assigneeId}
                onValueChange={(v) => onFiltersChange({ ...filters, assigneeId: v })}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="me">Apenas minhas</SelectItem>
                  {assignees.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Cliente
                </Label>
                <Select
                  value={filters.clientId}
                  onValueChange={(v) =>
                    onFiltersChange({ ...filters, clientId: v, projectId: "all" })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Projeto
                </Label>
                <Select
                  value={filters.projectId}
                  onValueChange={(v) => onFiltersChange({ ...filters, projectId: v })}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {projects
                      .filter(
                        (p) =>
                          filters.clientId === "all" ||
                          p.client_id === filters.clientId ||
                          p.client_id === null,
                      )
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Prioridade
                </Label>
                <Select
                  value={filters.priority}
                  onValueChange={(v) =>
                    onFiltersChange({ ...filters, priority: v as TaskPriority | "all" })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_META[p].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Arquivamento
                </Label>
                <Select
                  value={filters.archive}
                  onValueChange={(v) =>
                    onFiltersChange({ ...filters, archive: v as TaskFilters["archive"] })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativas</SelectItem>
                    <SelectItem value="archived">Arquivadas</SelectItem>
                    <SelectItem value="all">Todas</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={filters.hideDone}
                  onCheckedChange={(v) => onFiltersChange({ ...filters, hideDone: Boolean(v) })}
                />
                Ocultar concluídas
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => onFiltersChange({ ...DEFAULT_FILTERS, search: filters.search })}
                disabled={activeCount === 0}
              >
                <X className="mr-1 h-3 w-3" /> Limpar
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Ordenar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5">
              <ArrowUpDown className="h-3.5 w-3.5" /> Ordenar
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Campo</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortKey}
              onValueChange={(v) => onSortChange(v as SortKey, sortDir)}
            >
              <DropdownMenuRadioItem value="due">Prazo</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="title">Nome</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="priority">Prioridade</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="assignee">Responsável</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="project">Projeto</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="created">Criado em</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Ordem</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={sortDir}
              onValueChange={(v) => onSortChange(sortKey, v as SortDir)}
            >
              <DropdownMenuRadioItem value="asc">Crescente</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">Decrescente</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Agrupar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5">
              <Group className="h-3.5 w-3.5" /> Agrupar
              {groupBy !== "none" ? (
                <span className="text-muted-foreground">· {GROUP_LABEL[groupBy]}</span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={groupBy}
              onValueChange={(v) => onGroupByChange(v as GroupBy)}
            >
              <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="project">Projeto</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="assignee">Responsável</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="client">Cliente</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="due">Prazo</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="priority">Prioridade</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="none">Nenhum</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
            placeholder="Pesquisar tarefas..."
            className="h-8 pl-9"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Mais opções">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <Columns3 className="h-3.5 w-3.5" /> Colunas
            </DropdownMenuLabel>
            {(Object.keys(columns) as Array<keyof VisibleColumns>).map((k) => (
              <DropdownMenuItem key={k} onSelect={(e) => e.preventDefault()}>
                <label className="flex w-full items-center gap-2 text-sm">
                  <Checkbox
                    checked={columns[k]}
                    onCheckedChange={(v) => onColumnsChange({ ...columns, [k]: Boolean(v) })}
                  />
                  {COLUMN_LABEL[k]}
                </label>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={exportCsv}>
              <Download className="mr-2 h-4 w-4" /> Exportar CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

const GROUP_LABEL: Record<GroupBy, string> = {
  none: "Nenhum",
  status: "Status",
  priority: "Prioridade",
  project: "Projeto",
  client: "Cliente",
  assignee: "Responsável",
  due: "Prazo",
};

const COLUMN_LABEL: Record<keyof VisibleColumns, string> = {
  assignee: "Responsável",
  project: "Projeto",
  client: "Cliente",
  priority: "Prioridade",
  status: "Status",
  due: "Prazo",
  created: "Criado em",
  time: "Tempo",
  comments: "Comentários",
  attachments: "Anexos",
};
