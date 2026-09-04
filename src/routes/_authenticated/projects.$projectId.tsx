import { contentFormatLabel } from "@/lib/content-formats";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { PlanStatusBadge } from "@/lib/monthly-plan-status";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import { listClients } from "@/lib/workspace.functions";
import { listBrandTeam } from "@/lib/team.functions";
import { archiveProject, deleteProject, getProject, updateProject } from "@/lib/projects.functions";
import { listPipelinesFn, ensureDefaultPipelineFn, loadBoardFn } from "@/lib/content.functions";
import { TaskDialog } from "@/components/content/task-dialog";
import { DashboardPageShell, DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { JobsPanel } from "@/components/projects/jobs-panel";
import { PautaDetailModal, type PautaDetailItem } from "@/components/projects/pauta-detail-modal";
import { InvolvedPeople } from "@/components/projects/involved-people";
import { StatusPicker } from "@/components/projects/status-picker";
import { AssigneePicker } from "@/components/projects/assignee-picker";
import { ProjectHeader } from "@/components/projects/project-header";
import { setProjectArchivedFn } from "@/lib/projects.functions";
import { useAccessRole } from "@/hooks/use-access-role";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: ProjectDetailPage,
});

const COLORS = [
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#10b981",
  "#3b82f6",
  "#6366f1",
  "#ef4444",
  "#14b8a6",
  "#f59e0b",
  "#06b6d4",
];

const STATUS_OPTIONS = [
  { value: "planning", label: "Planejamento" },
  { value: "active", label: "Ativa" },
  { value: "in_progress", label: "Em execução" },
  { value: "paused", label: "Pausada" },
  { value: "done", label: "Concluída" },
];

const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  threads: "Threads",
  youtube: "YouTube",
  facebook: "Facebook",
  blog: "Blog",
};

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Etapa legível de uma peça. */
function itemState(
  post: {
    stage: string | null;
    review_status: string | null;
    published_at: string | null;
  } | null,
): { label: string; tone: "muted" | "amber" | "emerald" | "primary" } {
  if (!post) return { label: "Pendente de produção", tone: "muted" };
  if (post.published_at || post.stage === "published")
    return { label: "Publicado", tone: "primary" };
  const review = (post.review_status ?? "").toLowerCase();
  if (review === "approved" || post.stage === "approved")
    return { label: "Aprovado", tone: "emerald" };
  // `posts.stage` é espelhado a partir da coluna do Kanban (stage_id).
  if (post.stage === "scheduled") return { label: "Agendado", tone: "primary" };
  if (post.stage === "review") return { label: "Em revisão", tone: "amber" };
  if (post.stage === "idea") return { label: "Ideia", tone: "muted" };
  if (post.stage === "production") return { label: "Em produção", tone: "amber" };
  if (review === "pending") return { label: "Em revisão", tone: "amber" };
  return { label: "Em produção", tone: "amber" };
}

const TONE_CLASS: Record<string, string> = {
  muted: "border-border/60 text-muted-foreground",
  amber: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  emerald: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  primary: "border-primary/40 text-primary",
};

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const { brandId } = useActiveContext();
  const navigate = useNavigate();
  const [openNewTask, setOpenNewTask] = useState(false);
  const [openSettings, setOpenSettings] = useState(false);
  const [openPautaKey, setOpenPautaKey] = useState<string | null>(null);
  const { userId, role } = useAccessRole();
  // `role` já colapsa admin/manager/super_admin no nível legado "admin".
  const canEditProject = role === "admin";

  const qc = useQueryClient();

  const get = useServerFn(getProject);
  const upd = useServerFn(updateProject);
  const arch = useServerFn(archiveProject);
  const del = useServerFn(deleteProject);
  const clientsFn = useServerFn(listClients);
  const teamFn = useServerFn(listBrandTeam);
  const listPipes = useServerFn(listPipelinesFn);
  const ensureDefault = useServerFn(ensureDefaultPipelineFn);
  const loadBoard = useServerFn(loadBoardFn);

  const projectQ = useQuery({
    queryKey: ["project", brandId, projectId],
    queryFn: () => get({ data: { brandId: brandId!, projectId } }),
    enabled: !!brandId,
  });
  const clientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => clientsFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });
  const teamQ = useQuery({
    queryKey: ["team", brandId],
    queryFn: () => teamFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const clients = (clientsQ.data ?? []) as Array<{
    id: string;
    name: string;
    color: string | null;
  }>;
  const team = (teamQ.data?.members ?? []) as Array<{
    user_id: string;
    full_name: string | null;
    avatar_url?: string | null;
  }>;

  const project = projectQ.data?.project;
  const posts = projectQ.data?.posts ?? [];
  const items = projectQ.data?.items ?? [];
  const stats = projectQ.data?.stats ?? { total: 0, approved: 0, published: 0, pending: 0 };

  // Peças criadas fora da pauta (sem tópico vinculado).
  const extraPosts = posts.filter(
    (p) => !(p as { monthly_plan_topic_id?: string | null }).monthly_plan_topic_id,
  );

  const pipelineQ = useQuery({
    queryKey: ["project-pipeline", brandId, project?.client_id],
    enabled: !!brandId && !!project?.client_id,
    queryFn: async () => {
      let list = await listPipes({ data: { brandId: brandId!, clientId: project!.client_id! } });
      if (list.length === 0) {
        await ensureDefault({ data: { brandId: brandId!, clientId: project!.client_id! } });
        list = await listPipes({ data: { brandId: brandId!, clientId: project!.client_id! } });
      }
      const pipe = list[0];
      if (!pipe) return null;
      const board = await loadBoard({
        data: { brandId: brandId!, clientId: project!.client_id!, pipelineId: pipe.id },
      });
      return { pipelineId: pipe.id, stages: board.stages };
    },
  });

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [goals, setGoals] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDesc(project.description ?? "");
    setStatus(project.status);
    setOwnerId(project.owner_id ?? null);
    setStartDate(project.start_date ?? null);
    setDueAt(project.due_at ?? null);
    setColor(project.color ?? COLORS[0]);
    setGoals(project.goals ?? "");
  }, [project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      upd({ data: { brandId: brandId!, projectId, patch } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", brandId, projectId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const archMut = useMutation({
    mutationFn: () => arch({ data: { brandId: brandId!, projectId } }),
    onSuccess: () => {
      toast.success("Projeto arquivado");
      qc.invalidateQueries({ queryKey: ["projects", brandId] });
      navigate({ to: "/projects" });
    },
  });

  const setArchived = useServerFn(setProjectArchivedFn);
  const restoreMut = useMutation({
    mutationFn: () => setArchived({ data: { brandId: brandId!, projectId, archived: false } }),
    onSuccess: () => {
      toast.success("Projeto restaurado");
      qc.invalidateQueries({ queryKey: ["project", brandId, projectId] });
      qc.invalidateQueries({ queryKey: ["projects", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: () => del({ data: { brandId: brandId!, projectId } }),
    onSuccess: () => {
      toast.success("Projeto excluído");
      qc.invalidateQueries({ queryKey: ["projects", brandId] });
      navigate({ to: "/projects" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  usePageHeader(
    {
      title: project?.name ?? "Projeto",
      subtitle: "Execução da pauta",
      actions: (
        <div className="flex items-center gap-2">
          {project?.plan ? (
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link to="/monthly-plan/$planId" params={{ planId: project.plan.id }}>
                <ExternalLink className="mr-2 h-4 w-4" /> Ver pauta
              </Link>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0" aria-label="Mais ações">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setOpenSettings(true)}>
                <Settings2 className="mr-2 h-4 w-4" /> Configurações do projeto
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => archMut.mutate()} disabled={archMut.isPending}>
                <Archive className="mr-2 h-4 w-4" /> Arquivar
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" /> Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
    [project?.id, project?.name, project?.plan?.id, archMut.isPending],
  );

  const totalItems = items.length > 0 ? items.length + extraPosts.length : stats.total;
  const doneItems = stats.approved + stats.published;
  const pct = totalItems > 0 ? Math.min(100, Math.round((doneItems / totalItems) * 100)) : 0;

  if (projectQ.isLoading) {
    return (
      <DashboardPageShell>
        <div className="h-8 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </DashboardPageShell>
    );
  }

  if (!project) {
    return (
      <DashboardPageShell>
        <DashboardPanelSurface className="px-4 py-3 text-sm text-muted-foreground">
          Projeto não encontrado.
        </DashboardPanelSurface>
        <Button
          variant="ghost"
          size="sm"
          className="h-9"
          onClick={() => navigate({ to: "/projects" })}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
        </Button>
      </DashboardPageShell>
    );
  }

  function saveField(patch: Record<string, unknown>) {
    patchMut.mutate(patch);
  }

  const clientName = clients.find((c) => c.id === project.client_id)?.name ?? "Sem cliente";
  const statusLabel =
    STATUS_OPTIONS.find((s) => s.value === project.status)?.label ?? project.status;

  // Itens da pauta normalizados para linha clicável + modal de resumo.
  const pautaDetails: PautaDetailItem[] = [
    ...items.map((it) => ({
      key: it.topic_id,
      title: it.title,
      coverUrl: it.post?.cover_url ?? null,
      channelLabel: it.channel ? (CHANNEL_LABELS[it.channel] ?? it.channel) : null,
      formatLabel: it.format ? contentFormatLabel(it.format) : null,
      stateLabel: itemState(it.post).label,
      stateClassName: TONE_CLASS[itemState(it.post).tone] ?? "",
      scheduledAt: it.post?.scheduled_at ?? it.tasks.due_at ?? null,
      postId: it.post?.id ?? null,
      topicId: it.topic_id,
      planId: project.plan?.id ?? null,
      tasksCount: it.tasks.count,
      assigneeName: it.tasks.assignee_name,
    })),
    ...extraPosts.map((p) => {
      const state = itemState({
        stage: (p.stage as string | null) ?? null,
        review_status: (p.review_status as string | null) ?? null,
        published_at: (p.published_at as string | null) ?? null,
      });
      return {
        key: p.id as string,
        title: (p.title as string) || "Sem título",
        coverUrl: (p.cover_url as string | null) ?? null,
        channelLabel: null,
        formatLabel: p.format ? contentFormatLabel(p.format as string) : null,
        stateLabel: state.label,
        stateClassName: TONE_CLASS[state.tone] ?? "",
        scheduledAt: (p.scheduled_at as string | null) ?? null,
        postId: p.id as string,
        topicId: null,
        outOfPlan: true,
        planId: null,
        tasksCount: 0,
        assigneeName: null,
      };
    }),
  ];

  // Conteúdo do job virtual "Pautas" (nível 2 da hierarquia).
  const pautasContent = (
    <DashboardPanelSurface>
      <div className="flex items-center justify-between border-b border-border/60 bg-background/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-foreground">
            {project.plan ? "Itens da pauta" : "Peças do projeto"}
          </h3>
          <span className="rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground">
            {pautaDetails.length}
          </span>
        </div>
      </div>

      {pautaDetails.length === 0 ? (
        <PanelEmptyState
          icon={<FileText className="h-4 w-4" />}
          text={
            project.plan
              ? "A pauta vinculada ainda não tem itens aprovados. Abra a pauta para aprovar e enviar para produção."
              : "Nenhuma peça vinculada a este projeto."
          }
        />
      ) : (
        <div className="divide-y divide-border/60">
          {pautaDetails.map((d) => (
            <div
              key={d.key}
              role="button"
              tabIndex={0}
              onClick={() => setOpenPautaKey(d.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpenPautaKey(d.key);
                }
              }}
              className="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-muted">
                {d.coverUrl ? (
                  <img src={d.coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.title}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>
                    {d.outOfPlan ? "Fora da pauta" : (d.channelLabel ?? "Canal não definido")}
                  </span>
                  <span>·</span>
                  <span>{d.formatLabel ?? "formato não definido"}</span>
                  {d.assigneeName ? (
                    <>
                      <span>·</span>
                      <span>{d.assigneeName}</span>
                    </>
                  ) : null}
                  {d.scheduledAt ? (
                    <>
                      <span>·</span>
                      <span>{fmtDate(d.scheduledAt)}</span>
                    </>
                  ) : null}
                  {(d.tasksCount ?? 0) > 0 ? (
                    <>
                      <span>·</span>
                      <span>
                        {d.tasksCount} {d.tasksCount === 1 ? "tarefa" : "tarefas"}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
              <Badge variant="outline" className={`text-[10px] ${d.stateClassName}`}>
                {d.stateLabel}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </DashboardPanelSurface>
  );

  return (
    <DashboardPageShell>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 h-9 w-fit"
        onClick={() => navigate({ to: "/projects" })}
      >
        <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
      </Button>

      {/* Cabeçalho do projeto — identidade, cliente, responsável, status, ações */}
      <ProjectHeader
        name={project.name}
        color={color}
        clientName={clientName}
        periodLabel={`${fmtDate(project.start_date)} — ${fmtDate(project.due_at)}`}
        done={doneItems}
        total={totalItems}
        planBadge={
          project.plan ? <PlanStatusBadge status={project.plan.status} prefix="Pauta:" /> : null
        }
        assignee={
          <AssigneePicker
            value={project.owner_id ?? null}
            options={team}
            disabled={!canEditProject}
            className="h-8 w-[170px]"
            onChange={(userId) => {
              setOwnerId(userId);
              saveField({ owner_id: userId });
            }}
          />
        }
        status={
          <>
            <StatusPicker
              brandId={brandId!}
              scope="project"
              value={project.status_id ?? null}
              onChange={(statusId) => saveField({ status_id: statusId })}
            />
            <Badge variant="outline" className="h-8 rounded-full px-3 text-[11px]">
              {statusLabel}
            </Badge>
          </>
        }
        actions={
          <div className="flex items-center gap-1.5">
            {project.plan ? (
              <Button asChild variant="outline" size="sm" className="h-8">
                <Link to="/monthly-plan/$planId" params={{ planId: project.plan.id }}>
                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Ver pauta
                </Link>
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Mais ações">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setOpenSettings(true)}>
                  <Settings2 className="mr-2 h-4 w-4" /> Configurações do projeto
                </DropdownMenuItem>
                {project.status === "archived" ? (
                  <DropdownMenuItem
                    onClick={() => restoreMut.mutate()}
                    disabled={restoreMut.isPending}
                  >
                    <ArchiveRestore className="mr-2 h-4 w-4" /> Restaurar
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onClick={() => archMut.mutate()} disabled={archMut.isPending}>
                    <Archive className="mr-2 h-4 w-4" /> Arquivar
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Níveis 2 e 3 — JOBS › TAREFAS, com comentários por nível e envolvidos no rodapé */}
      <JobsPanel
        brandId={brandId!}
        projectId={projectId}
        projectName={project.name}
        clientName={clientName}
        team={team}
        currentUserId={userId}
        pautasContent={
          <div className="overflow-hidden rounded-lg border border-border/60">{pautasContent}</div>
        }
        pautasCount={items.length + extraPosts.length}
        footer={
          <div className="space-y-3">
            <InvolvedPeople
              brandId={brandId!}
              projectId={projectId}
              team={team}
              canEdit={canEditProject}
              compact
            />
          </div>
        }
      />

      {/* Resumo da pauta em modal — evita sair da gestão do projeto */}
      <PautaDetailModal
        open={!!openPautaKey}
        onOpenChange={(o) => !o && setOpenPautaKey(null)}
        brandId={brandId!}
        projectId={projectId}
        clientId={project.client_id ?? null}
        item={pautaDetails.find((d) => d.key === openPautaKey) ?? null}
        team={team}
        currentUserId={userId}
        canEdit={canEditProject}
      />

      {/* Configurações do projeto */}
      <Dialog open={openSettings} onOpenChange={setOpenSettings}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configurações do projeto</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-1.5 md:col-span-2">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Nome
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== project.name && saveField({ name })}
              />
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Descrição
              </Label>
              <Textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                onBlur={() =>
                  (desc || null) !== (project.description || null) &&
                  saveField({ description: desc || null })
                }
                rows={2}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Status
              </Label>
              <Select
                value={status}
                onValueChange={(v) => {
                  setStatus(v);
                  saveField({ status: v });
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Responsável
              </Label>
              <Select
                value={ownerId ?? "none"}
                onValueChange={(v) => {
                  const next = v === "none" ? null : v;
                  setOwnerId(next);
                  saveField({ owner_id: next });
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {team.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name ?? "Sem nome"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DateEdit
              label="Data de início"
              value={startDate}
              onChange={(v) => {
                setStartDate(v);
                saveField({ start_date: v });
              }}
            />
            <DateEdit
              label="Data de término"
              value={dueAt}
              onChange={(v) => {
                setDueAt(v);
                saveField({ due_at: v });
              }}
            />
            <div className="grid gap-1.5 md:col-span-2">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Cor
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setColor(c);
                      saveField({ color: c });
                    }}
                    aria-label={`Cor ${c}`}
                    className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition ${
                      color === c ? "ring-2 ring-foreground" : ""
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-1.5 md:col-span-2">
              <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Objetivos / Metas
              </Label>
              <Textarea
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                onBlur={() =>
                  (goals || null) !== (project.goals || null) && saveField({ goals: goals || null })
                }
                placeholder="Ex.: Aumentar vendas em 30%, gerar 500 leads..."
                rows={2}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Os itens vinculados serão desassociados do projeto,
              mas não serão excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => delMut.mutate()}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {openNewTask && project?.client_id && pipelineQ.data && (
        <TaskDialog
          mode="create"
          open={openNewTask}
          onOpenChange={setOpenNewTask}
          brandId={brandId!}
          clientId={project.client_id}
          pipelineId={pipelineQ.data.pipelineId}
          stages={pipelineQ.data.stages}
          defaultStageId={pipelineQ.data.stages[0]?.id}
          defaultProjectId={projectId}
          invalidateKey={["project", brandId, projectId] as const}
        />
      )}
    </DashboardPageShell>
  );
}

function DateEdit(props: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const date = props.value ? new Date(props.value) : undefined;
  return (
    <div className="grid gap-1.5">
      <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
        {props.label}
      </Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 justify-start text-left font-normal">
            {date ? (
              fmtDate(props.value)
            ) : (
              <span className="text-muted-foreground">Selecionar</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => props.onChange(d ? d.toISOString() : null)}
            initialFocus
            className="pointer-events-auto p-3"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
