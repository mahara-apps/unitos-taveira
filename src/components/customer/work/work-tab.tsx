/**
 * Aba "Trabalho" do Painel do Cliente.
 *
 * Reúso puro: nenhuma query, server function ou regra de negócio nova.
 *  - projetos  → `listProjects` (mesma fn de /projects)
 *  - tarefas   → `listTasksFn` (mesma fn de /tasks) + `TaskDrawer`/badges de
 *                `@/components/tasks/shared`
 *  - produção  → `ProductionTab` (volumetria/relatório/excedentes já existentes)
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, ExternalLink, FolderKanban, ListTodo } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { Skeleton } from "@/components/ui/skeleton";
import { listProjects } from "@/lib/projects.functions";
import { listTasksFn } from "@/lib/tasks.functions";
import {
  TaskDrawer,
  TaskPriorityBadge,
  TaskStatusBadge,
  isOverdue,
  relativeDue,
} from "@/components/tasks/shared";
import { ProductionTab } from "@/components/customer/production/production-tab";
import { PanelError, PanelSection } from "@/components/customer/ui/panel-section";

export function WorkTab({ brandId, clientId }: { brandId: string; clientId: string }) {
  const qc = useQueryClient();
  const loadProjects = useServerFn(listProjects);
  const loadTasks = useServerFn(listTasksFn);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const projectsQ = useQuery({
    queryKey: ["projects", brandId, clientId],
    queryFn: () => loadProjects({ data: { brandId, clientId } }),
    staleTime: 30_000,
  });

  const tasksKey = ["tasks", brandId, clientId, "active"] as const;
  const tasksQ = useQuery({
    queryKey: tasksKey,
    queryFn: () => loadTasks({ data: { brandId, clientId, archive: "active" } }),
    staleTime: 30_000,
  });

  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const projects = useMemo(() => projectsQ.data?.projects ?? [], [projectsQ.data]);
  const stats = projectsQ.data?.stats ?? {};

  const counters = useMemo(() => {
    const open = tasks.filter((t) => !t.done);
    return {
      open: open.length,
      overdue: open.filter((t) => isOverdue(t)).length,
      done: tasks.length - open.length,
      projects: projects.length,
    };
  }, [tasks, projects]);

  const openTasks = useMemo(
    () =>
      [...tasks]
        .filter((t) => !t.done)
        .sort((a, b) => {
          const av = a.due_at ? Date.parse(a.due_at) : Number.MAX_SAFE_INTEGER;
          const bv = b.due_at ? Date.parse(b.due_at) : Number.MAX_SAFE_INTEGER;
          return av - bv;
        })
        .slice(0, 12),
    [tasks],
  );

  return (
    <div className="space-y-6">
      <PageKpiGrid columns={4}>
        <PageKpi
          icon={<FolderKanban />}
          label="Projetos"
          value={projectsQ.isPending ? "—" : counters.projects}
          description="Entregas deste cliente"
        />
        <PageKpi
          icon={<ListTodo />}
          label="Tarefas abertas"
          value={tasksQ.isPending ? "—" : counters.open}
          status="info"
          description="Ainda em andamento"
        />
        <PageKpi
          icon={<AlertTriangle />}
          label="Atrasadas"
          value={tasksQ.isPending ? "—" : counters.overdue}
          status={counters.overdue > 0 ? "danger" : "neutral"}
          description="Passaram do prazo"
        />
        <PageKpi
          icon={<CheckCircle2 />}
          label="Concluídas"
          value={tasksQ.isPending ? "—" : counters.done}
          status="success"
          description="Já finalizadas"
        />
      </PageKpiGrid>

      <PanelSection
        padded={false}
        icon={<FolderKanban />}
        title="Projetos do cliente"
        description="Entregas em andamento, com progresso de publicação."
        action={
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
            <Link to="/projects" search={{} as never}>
              Ver todos
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      >
        {projectsQ.isError ? (
          <PanelError
            message="Não foi possível carregar os projetos deste cliente."
            onRetry={() => projectsQ.refetch()}
          />
        ) : projectsQ.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-12 w-full rounded-lg" />
            <Skeleton className="h-12 w-full rounded-lg" />
          </div>
        ) : projects.length === 0 ? (
          <PanelEmptyState
            icon={<FolderKanban className="h-4 w-4" />}
            text="Nenhum projeto ainda. Aprove uma pauta para gerar as entregas automaticamente."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {projects.slice(0, 8).map((p) => {
              const s = stats[p.id];
              return (
                <li key={p.id}>
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: p.id }}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="capitalize">{p.status}</span>
                        {s ? (
                          <>
                            <span aria-hidden>·</span>
                            <span className="tabular-nums">
                              {s.published}/{s.total} publicadas
                            </span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <span className="hidden w-32 shrink-0 sm:block">
                      <Progress value={Number(p.progress ?? 0)} className="h-1.5" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PanelSection>

      <PanelSection
        padded={false}
        icon={<ListTodo />}
        title="Tarefas em aberto"
        description="Prazos, responsáveis e subtarefas. Clique para abrir a tarefa."
        action={
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
            <Link to="/tasks" search={{ view: "list", groupBy: "status" } as never}>
              Ver todas
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        }
      >
        {tasksQ.isError ? (
          <PanelError
            message="Não foi possível carregar as tarefas deste cliente."
            onRetry={() => tasksQ.refetch()}
          />
        ) : tasksQ.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : openTasks.length === 0 ? (
          <PanelEmptyState
            icon={<ListTodo className="h-4 w-4" />}
            text="Nenhuma tarefa em aberto. Tudo o que estava previsto já foi concluído."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {openTasks.map((t) => {
              const due = relativeDue(t.due_at);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setOpenTaskId(t.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {t.project_name ? <span className="truncate">{t.project_name}</span> : null}
                        {due ? (
                          <span className={due.tone}>{due.label}</span>
                        ) : (
                          <span>Sem prazo</span>
                        )}
                        {t.subtasks_total ? (
                          <span className="tabular-nums">
                            {t.subtasks_done ?? 0}/{t.subtasks_total} subtarefas
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
                      <TaskPriorityBadge priority={t.priority} />
                      <TaskStatusBadge status={t.status} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PanelSection>

      {/* Produção/volumetria: componente já existente, sem duplicação. */}
      <ProductionTab brandId={brandId} clientId={clientId} />

      {openTaskId ? (
        <TaskDrawer
          taskId={openTaskId}
          brandId={brandId}
          currentUserId={null}
          allTasks={tasks}
          onNavigate={(id) => setOpenTaskId(id)}
          onClose={() => setOpenTaskId(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: tasksKey })}
        />
      ) : null}
    </div>
  );
}
