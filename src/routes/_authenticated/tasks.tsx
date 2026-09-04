import { useEffect, useMemo, useState } from "react";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  CalendarClock,
  User as UserIcon,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveContext } from "@/hooks/use-active-context";
import { usePageHeader } from "@/hooks/use-page-header";
import { Button } from "@/components/ui/button";
import { DashboardPageShell, DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { PageKpi, PageKpiGrid, type KpiStatus } from "@/components/ui/page-kpi";
import { listTasksFn, listProjectsFn } from "@/lib/tasks.functions";
import { listBrandAssigneesFn } from "@/lib/content.functions";
import { listClients } from "@/lib/workspace.functions";
import { supabase } from "@/integrations/supabase/client";
import { getCachedUser } from "@/lib/auth-cache";
import { CreateTaskDialog, TaskDrawer, isOverdue } from "@/components/tasks/shared";
import {
  DEFAULT_VISIBLE_COLUMNS,
  TaskTable,
  type GroupBy,
  type SortDir,
  type SortKey,
  type VisibleColumns,
} from "@/components/tasks/task-table";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { TaskCalendar } from "@/components/tasks/task-calendar";
import { TaskTimeline } from "@/components/tasks/task-timeline";
import { TaskViewSwitcher } from "@/components/tasks/view-switcher";
import {
  DEFAULT_FILTERS,
  TaskToolbar,
  applyFilters,
  type TaskFilters,
} from "@/components/tasks/task-toolbar";
import { Plus } from "lucide-react";

import { searchSchema, type View } from "@/components/tasks/task-views";

export { searchSchema };

export const Route = createFileRoute("/_authenticated/tasks")({
  beforeLoad: () => ensureFeatureEnabled("tasks"),
  component: TasksPage,
  validateSearch: searchSchema,
});

// ---------- Style maps ----------

// ---------- Page ----------

function TasksPage() {
  const { brandId, clientId } = useActiveContext();
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();

  const listTasks = useServerFn(listTasksFn);
  const listAssignees = useServerFn(listBrandAssigneesFn);
  const listClientsFn = useServerFn(listClients);
  const listProjects = useServerFn(listProjectsFn);

  const [createOpen, setCreateOpen] = useState(false);
  const [me, setMe] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [columns, setColumns] = useState<VisibleColumns>(DEFAULT_VISIBLE_COLUMNS);
  const [filters, setFilters] = useState<TaskFilters>({
    ...DEFAULT_FILTERS,
    search: search.q ?? "",
  });

  const view: View = search.view;
  const groupBy: GroupBy = search.groupBy;
  const sortKey: SortKey = search.sort;
  const sortDir: SortDir = search.dir;
  const openTaskId = search.taskId ?? null;

  type Search = z.infer<typeof searchSchema>;
  function setSearch(patch: Partial<Search>) {
    navigate({
      to: ".",
      search: (prev: Search) => ({ ...prev, ...patch }),
      replace: true,
    });
  }

  useEffect(() => {
    let cancelled = false;
    getCachedUser().then((user) => {
      if (!cancelled) setMe(user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const invalidateKey = ["tasks", brandId, clientId, filters.archive] as const;

  const tasksQ = useQuery({
    queryKey: invalidateKey,
    queryFn: () =>
      listTasks({
        data: { brandId: brandId!, clientId: clientId ?? null, archive: filters.archive },
      }),
    enabled: !!brandId,
  });

  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);

  const assigneesQ = useQuery({
    queryKey: ["brand-assignees", brandId],
    queryFn: () => listAssignees({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });
  const clientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => listClientsFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });
  const projectsQ = useQuery({
    queryKey: ["task-projects", brandId],
    queryFn: () => listProjects({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  // Effective filters: "mine" view forces assigneeId=me
  const effectiveFilters: TaskFilters = useMemo(
    () => (view === "mine" ? { ...filters, assigneeId: "me" } : filters),
    [filters, view],
  );

  const filtered = useMemo(
    () => applyFilters(tasks, effectiveFilters, me),
    [tasks, effectiveFilters, me],
  );

  const kpis = useMemo(() => {
    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const total = tasks.length;
    const inProgress = tasks.filter((t) => t.status === "in_progress").length;
    const done = tasks.filter((t) => t.status === "done").length;
    const overdue = tasks.filter((t) => isOverdue(t)).length;
    const mine = me ? tasks.filter((t) => t.assignee_id === me && t.status !== "done").length : 0;
    const dueToday = tasks.filter((t) => {
      if (!t.due_at || t.status === "done") return false;
      const time = new Date(t.due_at).getTime();
      return time >= startOfDay.getTime() && time <= endOfDay.getTime();
    }).length;
    const open = tasks.filter((t) => t.status !== "done").length;
    return { total, open, inProgress, done, overdue, mine, dueToday, now };
  }, [tasks, me]);

  // ---------- Filtros rápidos (faixa de indicadores) ----------
  type Quick = "open" | "in_progress" | "overdue" | "mine" | "today" | "done";

  const activeQuick: Quick | null = useMemo(() => {
    if (filters.due === "overdue") return "overdue";
    if (filters.due === "today") return "today";
    if (filters.status === "in_progress") return "in_progress";
    if (filters.status === "done") return "done";
    if (filters.assigneeId === "me" && view !== "mine") return "mine";
    if (filters.hideDone) return "open";
    return null;
  }, [filters, view]);

  function applyQuick(q: Quick) {
    const base: TaskFilters = {
      ...DEFAULT_FILTERS,
      search: filters.search,
      archive: filters.archive,
    };
    if (activeQuick === q) {
      setFilters(base);
      return;
    }
    switch (q) {
      case "open":
        setFilters({ ...base, hideDone: true });
        break;
      case "in_progress":
        setFilters({ ...base, status: "in_progress" });
        break;
      case "overdue":
        setFilters({ ...base, due: "overdue" });
        break;
      case "mine":
        setFilters({ ...base, assigneeId: "me" });
        break;
      case "today":
        setFilters({ ...base, due: "today" });
        break;
      case "done":
        setFilters({ ...base, status: "done" });
        break;
    }
  }

  usePageHeader(
    {
      title: "Tarefas",
      subtitle: "Organize o trabalho da equipe, acompanhe prazos e avance projetos.",
      actions: brandId ? (
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Nova tarefa
        </Button>
      ) : null,
    },
    [brandId],
  );

  if (!brandId) {
    return (
      <DashboardPageShell>
        <DashboardPanelSurface>
          <PanelEmptyState
            icon={<CheckCircle2 className="h-5 w-5" />}
            text="Selecione uma workspace no seletor lateral para carregar as tarefas."
          />
        </DashboardPanelSurface>
      </DashboardPageShell>
    );
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: invalidateKey });

  return (
    <DashboardPageShell>
      {/* Resumo operacional — indicadores no padrão único de KPI, que também filtram */}
      <PageKpiGrid columns={6}>
        {(
          [
            { key: "open", label: "Abertas", value: kpis.open, icon: Circle, status: "neutral" },
            {
              key: "in_progress",
              label: "Em andamento",
              value: kpis.inProgress,
              icon: Clock,
              status: "info",
            },
            {
              key: "overdue",
              label: "Atrasadas",
              value: kpis.overdue,
              icon: AlertTriangle,
              status: "danger",
            },
            { key: "mine", label: "Minhas", value: kpis.mine, icon: UserIcon, status: "neutral" },
            {
              key: "today",
              label: "Hoje",
              value: kpis.dueToday,
              icon: CalendarClock,
              status: "warning",
            },
            {
              key: "done",
              label: "Concluídas",
              value: kpis.done,
              icon: CheckCircle2,
              status: "success",
            },
          ] as Array<{
            key: Quick;
            label: string;
            value: number;
            icon: typeof Circle;
            status: KpiStatus;
          }>
        ).map((s) => (
          <PageKpi
            key={s.key}
            label={s.label}
            value={s.value}
            icon={<s.icon />}
            status={s.status === "neutral" || s.value > 0 ? s.status : "neutral"}
            onClick={() => applyQuick(s.key)}
            active={activeQuick === s.key}
          />
        ))}
      </PageKpiGrid>

      {/* Views */}
      <TaskViewSwitcher value={view} onChange={(v) => setSearch({ view: v })} />

      {/* Toolbar */}
      <TaskToolbar
        filters={filters}
        onFiltersChange={(next) => {
          setFilters(next);
          setSearch({ q: next.search || undefined });
        }}
        groupBy={groupBy}
        onGroupByChange={(g) => setSearch({ groupBy: g })}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={(k, d) => setSearch({ sort: k, dir: d })}
        columns={columns}
        onColumnsChange={setColumns}
        tasksToExport={filtered}
        assignees={assigneesQ.data ?? []}
        clients={clientsQ.data ?? []}
        projects={projectsQ.data ?? []}
      />

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
          <span className="font-semibold">{selectedIds.size}</span>
          <span className="text-muted-foreground">selecionada(s)</span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7"
            onClick={() => setSelectedIds(new Set())}
          >
            Limpar seleção
          </Button>
        </div>
      )}

      {/* Views body */}
      {tasksQ.isLoading ? (
        <DashboardPanelSurface className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando tarefas...
        </DashboardPanelSurface>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card px-6 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {tasks.length === 0
              ? "Comece criando a primeira tarefa."
              : activeQuick === "overdue"
                ? "Nenhuma tarefa atrasada."
                : "Você não tem tarefas neste filtro."}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            {tasks.length === 0 ? (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> Nova tarefa
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  setSearch({ q: undefined });
                }}
              >
                Limpar filtros
              </Button>
            )}
          </div>
        </div>
      ) : view === "kanban" || view === "board-assignee" ? (
        <TaskKanban
          tasks={filtered}
          groupMode={view === "board-assignee" ? "assignee" : "status"}
          onOpenTask={(id) => setSearch({ taskId: id })}
          onChanged={invalidate}
        />
      ) : view === "timeline" ? (
        <TaskTimeline tasks={filtered} onOpenTask={(id) => setSearch({ taskId: id })} />
      ) : view === "calendar" ? (
        <TaskCalendar tasks={filtered} onOpenTask={(id) => setSearch({ taskId: id })} />
      ) : (
        <TaskTable
          brandId={brandId}
          tasks={filtered}
          columns={columns}
          groupBy={groupBy}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(k) =>
            setSearch({ sort: k, dir: sortKey === k && sortDir === "asc" ? "desc" : "asc" })
          }
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onOpenTask={(id) => setSearch({ taskId: id })}
          onChanged={invalidate}
        />
      )}

      {!tasksQ.isLoading && tasks.length > 0 ? (
        <p className="text-center text-[11px] text-muted-foreground">
          Exibindo {filtered.length} de {tasks.length} tarefa{tasks.length === 1 ? "" : "s"}
        </p>
      ) : null}

      {createOpen ? (
        <CreateTaskDialog
          brandId={brandId}
          clientId={clientId ?? null}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(id) => {
            invalidate();
            setSearch({ taskId: id });
          }}
        />
      ) : null}

      {openTaskId ? (
        <TaskDrawer
          taskId={openTaskId}
          brandId={brandId}
          currentUserId={me}
          allTasks={filtered}
          onNavigate={(id) => setSearch({ taskId: id })}
          onClose={() => setSearch({ taskId: undefined })}
          onChanged={invalidate}
        />
      ) : null}
    </DashboardPageShell>
  );
}

// ---------- Row ----------
