import { useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  MoreHorizontal,
  Trash2,
  Play,
  ChevronRight,
  ChevronLeft,
  Archive,
  ArchiveRestore,
  Search,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createJobFn,
  createJobTaskFn,
  deleteJobFn,
  listJobsFn,
  listProjectTasksFn,
  setJobArchivedFn,
  setJobDoneFn,
  updateJobFn,
  updateJobTaskFn,
  type JobTask,
  type ProjectJob,
} from "@/lib/project-jobs.functions";
import { deleteTaskFn, setTaskArchivedFn } from "@/lib/tasks.functions";
import { WorkLinks } from "@/components/ui/work-links";
import { formatMinutes } from "@/lib/timesheet.functions";
import { TaskTimesheetSheet } from "./task-timesheet-sheet";
import { CommentThread } from "./comment-thread";
import { ContextTabs } from "./context-tabs";
import { JobDetailModal } from "./job-detail-modal";
import { AssigneeAvatar, AssigneePicker, type TeamOption } from "./assignee-picker";
import { StatusPicker } from "./status-picker";
import { WorkItemRow, formatRange, formatShortDate, isOverdue } from "./work-item-row";

type Props = {
  brandId: string;
  projectId: string;
  projectName?: string;
  clientName?: string;
  /** Equipe da workspace — origem do responsável único de job/tarefa. */
  team?: TeamOption[];
  currentUserId?: string | null;
  /** Conteúdo do job virtual "Pautas" (renderizado pela tela do projeto). */
  pautasContent?: ReactNode;
  pautasCount?: number;
  /** Rodapé do card (envolvidos no projeto). */
  footer?: ReactNode;
};

export function JobsPanel({
  brandId,
  projectId,
  projectName = "Projeto",
  clientName,
  team = [],
  currentUserId,
  pautasContent,
  pautasCount = 0,
  footer,
}: Props) {
  const qc = useQueryClient();
  const listJobs = useServerFn(listJobsFn);
  const listTasks = useServerFn(listProjectTasksFn);
  const createJob = useServerFn(createJobFn);
  const updateJob = useServerFn(updateJobFn);
  const deleteJob = useServerFn(deleteJobFn);
  const setJobDone = useServerFn(setJobDoneFn);
  const setJobArchived = useServerFn(setJobArchivedFn);
  const setTaskArchived = useServerFn(setTaskArchivedFn);
  const deleteTask = useServerFn(deleteTaskFn);
  const createTask = useServerFn(createJobTaskFn);
  const updateTask = useServerFn(updateJobTaskFn);

  /** Concluídos ficam arquivados; este filtro permite revê-los. */
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState("");
  /** Nível 1 (visão geral) × nível 2 (lista de jobs). */
  const [mode, setMode] = useState<"overview" | "jobs">("overview");
  /** Job aberto em modal amplo. */
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [pautasOpen, setPautasOpen] = useState(false);

  const jobsQ = useQuery({
    queryKey: ["project-jobs", brandId, projectId, showDone ? "all" : "active"],
    queryFn: () => listJobs({ data: { brandId, projectId, archive: showDone ? "all" : "active" } }),
  });
  const tasksQ = useQuery({
    queryKey: ["job-tasks", brandId, projectId],
    queryFn: () => listTasks({ data: { brandId, projectId, archive: "all" } }),
  });

  const jobs: ProjectJob[] = jobsQ.data ?? [];
  const allTasks: JobTask[] = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const tasks = useMemo(
    () => (showDone ? allTasks : allTasks.filter((t) => !t.archived_at)),
    [allTasks, showDone],
  );

  const hasPautas = !!pautasContent;
  const effectiveJobId = openJobId;

  const tasksByJob = useMemo(() => {
    const map = new Map<string | null, JobTask[]>();
    for (const t of tasks) {
      const key = t.job_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tasks]);

  const jobCounts = useMemo(() => {
    const map = new Map<string | null, { total: number; done: number; minutes: number }>();
    for (const t of tasks) {
      const key = t.job_id ?? null;
      const cur = map.get(key) ?? { total: 0, done: 0, minutes: 0 };
      cur.total += 1;
      if (t.status === "done") cur.done += 1;
      cur.minutes += t.total_minutes ?? 0;
      map.set(key, cur);
    }
    return map;
  }, [tasks]);

  const doneJobs = jobs.filter((j) => !!j.done_at).length;

  const invalidateJobs = () =>
    qc.invalidateQueries({ queryKey: ["project-jobs", brandId, projectId] });

  const [newJobName, setNewJobName] = useState("");
  const [addingJob, setAddingJob] = useState(false);
  const createJobMut = useMutation({
    mutationFn: () => createJob({ data: { brandId, projectId, name: newJobName.trim() } }),
    onSuccess: () => {
      setNewJobName("");
      setAddingJob(false);
      invalidateJobs();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteJobMut = useMutation({
    mutationFn: (jobId: string) => deleteJob({ data: { brandId, jobId } }),
    onSuccess: invalidateJobs,
    onError: (e: Error) => toast.error(e.message),
  });
  const patchJobMut = useMutation({
    mutationFn: (v: { jobId: string; patch: Record<string, unknown> }) =>
      updateJob({ data: { brandId, jobId: v.jobId, patch: v.patch as never } }),
    onSuccess: invalidateJobs,
    onError: (e: Error) => toast.error(e.message),
  });
  const jobDoneMut = useMutation({
    mutationFn: (v: { jobId: string; done: boolean }) =>
      setJobDone({ data: { brandId, jobId: v.jobId, done: v.done } }),
    onSuccess: (_r, v) => {
      if (v.done) setOpenJobId(null);
      invalidateJobs();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [openTask, setOpenTask] = useState<JobTask | null>(null);

  const jobArchiveMut = useMutation({
    mutationFn: (v: { jobId: string; archived: boolean }) =>
      setJobArchived({ data: { brandId, jobId: v.jobId, archived: v.archived } }),
    onSuccess: (_r, v) => {
      if (v.archived) setOpenJobId(null);
      invalidateJobs();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const invalidateTasks = () =>
    qc.invalidateQueries({ queryKey: ["job-tasks", brandId, projectId] });

  const taskArchiveMut = useMutation({
    mutationFn: (v: { taskId: string; archived: boolean }) =>
      setTaskArchived({ data: { brandId, taskId: v.taskId, archived: v.archived } }),
    onSuccess: invalidateTasks,
    onError: (e: Error) => toast.error(e.message),
  });

  const taskDeleteMut = useMutation({
    mutationFn: (taskId: string) => deleteTask({ data: { brandId, taskId } }),
    onSuccess: () => {
      setOpenTask(null);
      invalidateTasks();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const createTaskMut = useMutation({
    mutationFn: () =>
      createTask({
        data: {
          brandId,
          projectId,
          jobId: effectiveJobId,
          title: newTaskTitle.trim(),
        },
      }),
    onSuccess: () => {
      setNewTaskTitle("");
      qc.invalidateQueries({ queryKey: ["job-tasks", brandId, projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchTaskMut = useMutation({
    mutationFn: (v: { taskId: string; patch: Record<string, unknown> }) =>
      updateTask({ data: { brandId, taskId: v.taskId, patch: v.patch as never } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-tasks", brandId, projectId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleDoneMut = useMutation({
    mutationFn: (t: JobTask) =>
      updateTask({
        data: {
          brandId,
          taskId: t.id,
          // done = true conclui e arquiva; false reabre.
          patch: { done: !t.done },
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-tasks", brandId, projectId] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const currentJob = jobs.find((j) => j.id === openJobId) ?? null;
  const currentTitle = currentJob?.name ?? "Tarefas";

  const currentJobTasks = useMemo(
    () => (openJobId ? (tasksByJob.get(openJobId) ?? []) : []),
    [tasksByJob, openJobId],
  );
  const openTasksCount = currentJobTasks.filter((t) => !t.done && t.status !== "done").length;

  /** Busca aplica-se à lista de jobs (nível 2). */
  const visibleJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? jobs.filter((j) => j.name.toLowerCase().includes(q)) : jobs;
  }, [jobs, search]);

  const taskTotals = useMemo(() => {
    let total = 0;
    let done = 0;
    for (const t of tasks) {
      total += 1;
      if (t.done || t.status === "done") done += 1;
    }
    return { total, done };
  }, [tasks]);

  const projectContext = (
    <ContextTabs
      tabs={[
        {
          value: "comments",
          label: "Comentários",
          content: (
            <CommentThread
              brandId={brandId}
              level="project"
              projectId={projectId}
              currentUserId={currentUserId}
              placeholder="Observação geral do projeto…"
            />
          ),
        },
        {
          value: "links",
          label: "Anexos e links",
          content: <WorkLinks target="project" targetId={projectId} title="Links do projeto" />,
        },
      ]}
      className="h-full"
      contentClassName="px-6 py-5"
    />
  );

  const renderTaskRow = (t: JobTask) => {
    const done = t.done || t.status === "done";
    return (
      <WorkItemRow
        key={t.id}
        className="px-5 py-3.5"
        title={t.title}
        done={done}
        onToggleDone={() => toggleDoneMut.mutate(t)}
        onOpen={() => setOpenTask(t)}
        meta={
          <>
            <span className="tabular-nums">
              {formatMinutes(t.total_minutes)}
              {t.estimated_minutes ? ` / ${formatMinutes(t.estimated_minutes)}` : ""}
            </span>
            {t.archived_at ? <span>· arquivada</span> : null}
          </>
        }
        assignee={
          <AssigneePicker
            value={t.assignee_id}
            options={team}
            className="h-8 w-[46px] justify-center px-1 [&>svg]:hidden sm:w-[150px] sm:justify-between sm:px-3 sm:[&>svg]:block"
            placeholder="—"
            onChange={(userId) =>
              patchTaskMut.mutate({ taskId: t.id, patch: { assignee_id: userId } })
            }
          />
        }
        dateLabel={formatRange(t.start_date, t.due_at)}
        overdue={isOverdue(t.due_at, done)}
        status={
          t.priority && t.priority !== "medium" ? (
            <Badge variant="outline" className="h-5 text-[10px]">
              {t.priority}
            </Badge>
          ) : null
        }
        actions={
          <div className="flex items-center gap-0.5">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Apontar tempo"
              onClick={() => setOpenTask(t)}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  aria-label="Ações da tarefa"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onSelect={() => taskArchiveMut.mutate({ taskId: t.id, archived: !t.archived_at })}
                >
                  {t.archived_at ? (
                    <>
                      <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restaurar
                    </>
                  ) : (
                    <>
                      <Archive className="mr-2 h-3.5 w-3.5" /> Arquivar
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => {
                    if (window.confirm(`Excluir a tarefa "${t.title}"?`)) {
                      taskDeleteMut.mutate(t.id);
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
    );
  };

  return (
    <>
      <DashboardPanelSurface className="overflow-hidden">
        {/* Trilha do nível atual */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-background/40 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {mode === "jobs" ? (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 gap-1.5 px-2 text-xs"
                onClick={() => setMode("overview")}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Visão geral
              </Button>
            ) : null}
            <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <span className="truncate">{projectName}</span>
              <ChevronRight className="h-3 w-3 shrink-0" />
              <span className="truncate text-foreground">
                {mode === "jobs" ? "Jobs" : "Visão geral"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {mode === "jobs" ? (
              <div className="relative hidden sm:block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Busca"
                  className="h-8 w-[170px] pl-7 text-xs"
                />
              </div>
            ) : null}
            <Button
              size="sm"
              variant={showDone ? "secondary" : "ghost"}
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => setShowDone((v) => !v)}
            >
              <Archive className="h-3 w-3" />
              {showDone ? "Ocultar concluídos" : "Ver concluídos"}
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => {
                setMode("jobs");
                setAddingJob(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> Novo job
            </Button>
          </div>

        </div>

        {mode === "overview" ? (
          /* Nível 1 — entradas de navegação + contexto do projeto */
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_min(600px,45vw)]">
            <div className="space-y-3 p-5 lg:border-r lg:border-border/60">
              <button
                type="button"
                onClick={() => setMode("jobs")}
                className="flex w-full items-center gap-4 rounded-lg border border-border/60 bg-background/40 px-5 py-4 text-left transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold">Jobs</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {doneJobs} / {jobs.length}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {taskTotals.done}/{taskTotals.total} tarefas concluídas
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>

              {hasPautas ? (
                <button
                  type="button"
                  onClick={() => setPautasOpen(true)}
                  className="flex w-full items-center gap-4 rounded-lg border border-border/60 bg-background/40 px-5 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <span className="text-base font-semibold">Pautas</span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pautasCount} {pautasCount === 1 ? "pauta" : "pautas"} de conteúdo
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ) : null}
            </div>

            <div className="min-h-[420px] border-t border-border/60 lg:border-t-0 lg:pl-8">
              {projectContext}
            </div>
          </div>
        ) : (
          /* Nível 2 — lista de jobs */
          <div className="grid gap-0 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="border-b border-border/60 md:border-b-0 md:border-r">
              <div className="flex items-center justify-between border-b border-border/60 bg-background/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-foreground">
                    Jobs
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {doneJobs} / {jobs.length}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  aria-label="Novo job"
                  onClick={() => setAddingJob((v) => !v)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1 p-4 text-[11px] text-muted-foreground">
                <p>
                  {taskTotals.done}/{taskTotals.total} tarefas concluídas
                </p>
                {hasPautas ? (
                  <button
                    type="button"
                    className="mt-2 flex items-center gap-1.5 text-primary hover:underline"
                    onClick={() => setPautasOpen(true)}
                  >
                    <Sparkles className="h-3 w-3" /> Ver pautas ({pautasCount})
                  </button>
                ) : null}
              </div>
            </div>

            <div className="min-w-0">
              {addingJob && (
                <div className="flex gap-2 border-b border-border/60 p-3">
                  <Input
                    autoFocus
                    value={newJobName}
                    onChange={(e) => setNewJobName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newJobName.trim()) createJobMut.mutate();
                      if (e.key === "Escape") setAddingJob(false);
                    }}
                    placeholder="Ex.: Fazer criativos"
                    className="h-9"
                  />
                  <Button
                    size="sm"
                    className="h-9"
                    onClick={() => createJobMut.mutate()}
                    disabled={!newJobName.trim() || createJobMut.isPending}
                  >
                    {createJobMut.isPending ? "Criando…" : "Ok"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9"
                    onClick={() => setAddingJob(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              )}

              {jobsQ.isLoading ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-4/5" />
                </div>
              ) : visibleJobs.length === 0 ? (
                <div className="flex flex-col items-center gap-3 p-10 text-center text-xs text-muted-foreground">
                  <p>
                    {jobs.length === 0
                      ? "Nenhum job ainda. Crie o primeiro (ex.: “Fazer criativos”)."
                      : "Nenhum job encontrado para esta busca."}
                  </p>
                  {jobs.length === 0 && !addingJob ? (
                    <Button size="sm" className="h-8 gap-1.5" onClick={() => setAddingJob(true)}>
                      <Plus className="h-3.5 w-3.5" /> Criar primeiro job
                    </Button>
                  ) : null}
                </div>

              ) : (
                <div className="divide-y divide-border/60">
                  {visibleJobs.map((j) => {
                    const c = jobCounts.get(j.id) ?? { total: 0, done: 0, minutes: 0 };
                    const done = !!j.done_at;
                    return (
                      <WorkItemRow
                        key={j.id}
                        className="px-5 py-4"
                        title={j.name}
                        color={j.color ?? "hsl(var(--primary))"}
                        done={done}
                        onToggleDone={() => jobDoneMut.mutate({ jobId: j.id, done: !done })}
                        onOpen={() => setOpenJobId(j.id)}
                        subCount={c.total}
                        progress={{ done: c.done, total: c.total }}
                        meta={
                          c.minutes > 0 ? (
                            <span className="tabular-nums">{formatMinutes(c.minutes)}</span>
                          ) : null
                        }
                        assignee={
                          <AssigneeAvatar
                            userId={j.assignee_id}
                            options={team}
                            className="h-7 w-7"
                          />
                        }
                        dateLabel={formatShortDate(j.due_at)}
                        overdue={isOverdue(j.due_at, done)}
                        status={
                          j.archived_at ? (
                            <Badge variant="outline" className="h-5 text-[10px]">
                              arquivado
                            </Badge>
                          ) : null
                        }
                        actions={
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                aria-label="Ações do job"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onSelect={() => setOpenJobId(j.id)}>
                                Abrir job
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  const name = window.prompt("Renomear job", j.name);
                                  if (name && name.trim())
                                    patchJobMut.mutate({
                                      jobId: j.id,
                                      patch: { name: name.trim() },
                                    });
                                }}
                              >
                                Renomear job
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  jobArchiveMut.mutate({ jobId: j.id, archived: !j.archived_at })
                                }
                              >
                                {j.archived_at ? (
                                  <>
                                    <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restaurar job
                                  </>
                                ) : (
                                  <>
                                    <Archive className="mr-2 h-3.5 w-3.5" /> Arquivar job
                                  </>
                                )}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => {
                                  if (
                                    window.confirm(
                                      `Excluir job "${j.name}"? As tarefas serão desvinculadas.`,
                                    )
                                  ) {
                                    deleteJobMut.mutate(j.id);
                                  }
                                }}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir job
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {footer ? (
          <div className="border-t border-border/60 bg-background/40 px-5 py-3">{footer}</div>
        ) : null}
      </DashboardPanelSurface>

      {/* Nível 2 aberto — job em modal amplo */}
      <JobDetailModal
        open={!!currentJob}
        onOpenChange={(o) => !o && setOpenJobId(null)}
        title={currentTitle}
        done={!!currentJob?.done_at}
        onToggleDone={
          currentJob
            ? () => jobDoneMut.mutate({ jobId: currentJob.id, done: !currentJob.done_at })
            : undefined
        }
        breadcrumb={
          <>
            {clientName ? <span className="truncate">{clientName}</span> : null}
            {clientName ? <ChevronRight className="h-3 w-3 shrink-0" /> : null}
            <span className="truncate font-medium text-foreground">{projectName}</span>
          </>
        }
        controls={
          currentJob ? (
            <>
              <AssigneePicker
                value={currentJob.assignee_id}
                options={team}
                className="h-9 w-[170px]"
                onChange={(userId) =>
                  patchJobMut.mutate({ jobId: currentJob.id, patch: { assignee_id: userId } })
                }
              />
              <StatusPicker
                brandId={brandId}
                scope="job"
                value={currentJob.status_id}
                onChange={(statusId) =>
                  patchJobMut.mutate({ jobId: currentJob.id, patch: { status_id: statusId } })
                }
              />
              <Input
                type="date"
                className="h-9 w-[135px] text-xs"
                aria-label="Início do job"
                defaultValue={currentJob.start_date ? currentJob.start_date.slice(0, 10) : ""}
                onBlur={(e) =>
                  patchJobMut.mutate({
                    jobId: currentJob.id,
                    patch: { start_date: e.target.value || null },
                  })
                }
              />
              <Input
                type="date"
                className="h-9 w-[135px] text-xs"
                aria-label="Prazo do job"
                defaultValue={currentJob.due_at ? currentJob.due_at.slice(0, 10) : ""}
                onBlur={(e) =>
                  patchJobMut.mutate({
                    jobId: currentJob.id,
                    patch: { due_at: e.target.value || null },
                  })
                }
              />
            </>
          ) : null
        }
        menu={
          currentJob ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Ações do job">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onSelect={() => {
                    const name = window.prompt("Renomear job", currentJob.name);
                    if (name && name.trim())
                      patchJobMut.mutate({ jobId: currentJob.id, patch: { name: name.trim() } });
                  }}
                >
                  Renomear job
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    jobArchiveMut.mutate({
                      jobId: currentJob.id,
                      archived: !currentJob.archived_at,
                    })
                  }
                >
                  {currentJob.archived_at ? (
                    <>
                      <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restaurar job
                    </>
                  ) : (
                    <>
                      <Archive className="mr-2 h-3.5 w-3.5" /> Arquivar job
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => {
                    if (
                      window.confirm(
                        `Excluir job "${currentJob.name}"? As tarefas serão desvinculadas.`,
                      )
                    ) {
                      deleteJobMut.mutate(currentJob.id);
                    }
                  }}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir job
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
        main={
          <div className="pb-6">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Tarefas
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                Abertas {openTasksCount}/{currentJobTasks.length}
              </span>
            </div>

            {tasksQ.isLoading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : currentJobTasks.length === 0 ? (
              <div className="p-10 text-center text-xs text-muted-foreground">
                Nenhuma tarefa neste job. Adicione a primeira abaixo.
              </div>
            ) : (
              <div className="divide-y divide-border/60">{currentJobTasks.map(renderTaskRow)}</div>
            )}

            <div className="flex items-center gap-2 border-t border-border/60 px-5 py-3">
              <Input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTaskTitle.trim()) createTaskMut.mutate();
                }}
                placeholder="Adicionar uma tarefa…"
                className="h-9"
              />
              <Button
                size="sm"
                className="h-9"
                onClick={() => createTaskMut.mutate()}
                disabled={!newTaskTitle.trim()}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </div>
        }
        aside={
          currentJob ? (
            <ContextTabs
              className="h-full"
              tabs={[
                {
                  value: "comments",
                  label: "Comentários",
                  content: (
                    <CommentThread
                      brandId={brandId}
                      level="job"
                      projectId={projectId}
                      jobId={currentJob.id}
                      currentUserId={currentUserId}
                      placeholder={`Observação sobre "${currentJob.name}"…`}
                    />
                  ),
                },
                {
                  value: "links",
                  label: "Anexos e links",
                  content: <WorkLinks target="job" targetId={currentJob.id} title="Links do job" />,
                },
              ]}
            />
          ) : null
        }
      />

      {/* Pautas em modal — evita trocar de tela */}
      <Dialog open={pautasOpen} onOpenChange={setPautasOpen}>
        <DialogContent className="flex h-[88vh] max-h-[88vh] w-[min(1100px,96vw)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
          <DialogHeader className="border-b border-border/60 px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-4 w-4 text-primary" /> Pautas
              <span className="text-sm font-normal text-muted-foreground">({pautasCount})</span>
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{pautasContent}</div>
        </DialogContent>
      </Dialog>

      <TaskTimesheetSheet
        open={!!openTask}
        onOpenChange={(v) => !v && setOpenTask(null)}
        brandId={brandId}
        breadcrumb={
          clientName
            ? `${clientName} › ${projectName} › ${currentTitle}`
            : `${projectName} › ${currentTitle}`
        }
        team={team}
        currentUserId={currentUserId}
        onToggleDone={
          openTask
            ? () => {
                toggleDoneMut.mutate(openTask);
                setOpenTask(null);
              }
            : undefined
        }
        taskDone={!!openTask && (openTask.done || openTask.status === "done")}
        task={
          openTask
            ? {
                id: openTask.id,
                title: openTask.title,
                estimated_minutes: openTask.estimated_minutes,
                total_minutes: openTask.total_minutes,
                assignee_id: openTask.assignee_id,
                status_id: openTask.status_id,
                start_date: openTask.start_date,
                due_at: openTask.due_at,
              }
            : null
        }
      />
    </>
  );
}
