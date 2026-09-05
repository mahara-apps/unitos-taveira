import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// Format a Date as the local `YYYY-MM-DDTHH:mm` string a
// <input type="datetime-local"> expects. Using .toISOString() here would
// show the UTC hour and, on re-save, drift the value by the timezone offset.
function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
import {
  CalendarIcon,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Flame,
  ArrowDown,
  ArrowUp,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  User as UserIcon,
  Folder,
  X,
  PauseCircle,
  MoreHorizontal,
  CalendarClock,
  ListChecks,
  Plus,
  FileText,
  Archive,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MentionTextarea, resolveMentions } from "@/components/ui/mention-textarea";
import { MentionText } from "@/components/ui/mention-text";
import { displayName } from "@/lib/identity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExpandedModal } from "@/components/ui/expanded-modal";

import { Separator } from "@/components/ui/separator";
import { TaskTimerWidget } from "@/components/tasks/task-timer-widget";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addSubtaskFn,
  addTaskCommentFn,
  createTaskFn,
  deleteSubtaskFn,
  deleteTaskCommentFn,
  deleteTaskFn,
  listProjectsFn,
  listSubtasksFn,
  listTaskCommentsFn,
  listTasksFn,
  updateSubtaskFn,
  updateTaskFn,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
  setTaskArchivedFn,
} from "@/lib/tasks.functions";
import { createProject } from "@/lib/projects.functions";
import { listBrandAssigneesFn } from "@/lib/content.functions";
import { listClients } from "@/lib/workspace.functions";

// ---------- Style meta ----------

export const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: typeof Circle; badge: string; dot: string; hex: string }
> = {
  todo: {
    label: "A fazer",
    icon: Circle,
    badge: "border-border/60 bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
    hex: "text-muted-foreground",
  },
  in_progress: {
    label: "Em andamento",
    icon: Clock,
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
    hex: "text-sky-500",
  },
  review: {
    label: "Revisão",
    icon: AlertTriangle,
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
    hex: "text-amber-500",
  },
  done: {
    label: "Concluída",
    icon: CheckCircle2,
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
    hex: "text-emerald-500",
  },
};

// UI-only "waiting" bucket for the Kanban board (persisted status stays `review`).
// For Phase 3 we can add a real status.
export const KANBAN_COLUMNS: TaskStatus[] = ["todo", "in_progress", "review", "done"];

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; icon: typeof ArrowDown; badge: string; dot: string }
> = {
  low: {
    label: "Baixa",
    icon: ArrowDown,
    badge: "border-border/60 bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
  medium: {
    label: "Média",
    icon: ArrowUp,
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  high: {
    label: "Alta",
    icon: ArrowUp,
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  urgent: {
    label: "Urgente",
    icon: Flame,
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500",
  },
};

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function relativeDue(
  iso: string | null,
): { label: string; tone: string; overdue: boolean } | null {
  if (!iso) return null;
  const now = new Date();
  const d = new Date(iso);
  const diffMs = d.getTime() - now.getTime();
  const days = Math.round(diffMs / 86_400_000);
  const label = format(d, "d 'de' MMM", { locale: ptBR });
  if (days < 0) return { label, tone: "text-rose-600 dark:text-rose-400", overdue: true };
  if (days === 0)
    return { label: `${label} · hoje`, tone: "text-amber-600 dark:text-amber-400", overdue: false };
  if (days <= 3) return { label, tone: "text-amber-600 dark:text-amber-400", overdue: false };
  return { label, tone: "text-muted-foreground", overdue: false };
}

export function isOverdue(task: TaskRow): boolean {
  if (!task.due_at || task.status === "done") return false;
  return new Date(task.due_at).getTime() < Date.now();
}

// ---------- TaskStatus / TaskPriority chip components (reusable) ----------

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", m.badge)}>
      <Icon className="h-3 w-3" /> {m.label}
    </Badge>
  );
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const m = PRIORITY_META[priority];
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", m.badge)}>
      <Icon className="h-3 w-3" /> {m.label}
    </Badge>
  );
}

export function TaskAssignee({
  name,
  avatarUrl,
  size = 24,
}: {
  name: string | null | undefined;
  avatarUrl: string | null | undefined;
  size?: number;
}) {
  return (
    <Avatar className="shrink-0" style={{ height: size, width: size }}>
      {avatarUrl ? <AvatarImage src={avatarUrl} /> : null}
      <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

// ---------- Pickers ----------

export function AssigneePicker({
  brandId,
  value,
  onChange,
  compact = false,
}: {
  brandId: string;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  compact?: boolean;
}) {
  const listMembers = useServerFn(listBrandAssigneesFn);
  const { data } = useQuery({
    queryKey: ["brand-assignees", brandId],
    queryFn: () => listMembers({ data: { brandId } }),
    staleTime: 60_000,
  });
  const members = data ?? [];
  const selected = members.find((m) => m.id === value);
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("justify-start gap-2", compact ? "h-7 text-xs" : "w-full")}
        >
          {selected ? (
            <>
              <TaskAssignee name={selected.name} avatarUrl={selected.avatar_url} size={20} />
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <>
              <UserIcon className="h-3.5 w-3.5" />
              <span>Sem responsável</span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Buscar membro..." />
          <CommandList>
            <CommandEmpty>Nenhum membro</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <UserIcon className="mr-2 h-4 w-4" /> Sem responsável
              </CommandItem>
              {members.map((m) => (
                <CommandItem
                  key={m.id}
                  value={m.name}
                  onSelect={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  <TaskAssignee name={m.name} avatarUrl={m.avatar_url} size={20} />
                  <span className="ml-2">{m.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function ClientPicker({
  brandId,
  value,
  onChange,
  compact = false,
}: {
  brandId: string;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  compact?: boolean;
}) {
  const list = useServerFn(listClients);
  const { data } = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => list({ data: { brandId } }),
    staleTime: 60_000,
  });
  const items = data ?? [];
  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? null : v)}
    >
      <SelectTrigger className={compact ? "h-7 text-xs" : undefined}>
        <SelectValue placeholder="Nenhuma" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Nenhuma</SelectItem>
        {items.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ProjectPicker({
  brandId,
  clientId,
  value,
  onChange,
  compact = false,
}: {
  brandId: string;
  clientId: string | null | undefined;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listProjectsFn);
  const createProj = useServerFn(createProject);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const { data } = useQuery({
    queryKey: ["task-projects", brandId],
    queryFn: () => list({ data: { brandId } }),
    staleTime: 60_000,
  });

  // Hierarquia: um projeto só aparece se for do mesmo cliente (ou interno, sem cliente).
  const items = (data ?? []).filter(
    (p) => !clientId || p.client_id === clientId || p.client_id === null,
  );

  const createMutation = useMutation({
    mutationFn: () =>
      createProj({
        data: {
          brandId,
          values: { name: newName.trim(), client_id: clientId ?? null, status: "active" },
        } as never,
      }),
    onSuccess: async (res: { id: string }) => {
      setCreating(false);
      setNewName("");
      await qc.invalidateQueries({ queryKey: ["task-projects", brandId] });
      onChange(res.id);
      toast.success("Projeto criado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!clientId) {
    return (
      <p className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
        Selecione uma conta primeiro
      </p>
    );
  }

  if (creating) {
    return (
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newName.trim()) createMutation.mutate();
            if (e.key === "Escape") setCreating(false);
          }}
          placeholder="Nome do projeto"
          className={compact ? "h-7 text-xs" : "h-8"}
        />
        <Button
          size="sm"
          className="h-7"
          disabled={!newName.trim() || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Criar"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7" onClick={() => setCreating(false)}>
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(v) => {
        if (v === "__new__") {
          setCreating(true);
          return;
        }
        onChange(v === "__none__" ? null : v);
      }}
    >
      <SelectTrigger className={compact ? "h-7 text-xs" : undefined}>
        <SelectValue placeholder="Nenhum projeto" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Nenhum projeto</SelectItem>
        {items.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
        <SelectItem value="__new__">+ Novo projeto</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ---------- Create Dialog ----------

export function CreateTaskDialog({
  brandId,
  clientId,
  open,
  onOpenChange,
  onCreated,
}: {
  brandId: string;
  clientId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const create = useServerFn(createTaskFn);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [taskClientId, setTaskClientId] = useState<string | null>(clientId);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [dueAt, setDueAt] = useState<string>("");

  const m = useMutation({
    mutationFn: () =>
      create({
        data: {
          brandId,
          title: title.trim(),
          description: description.trim() || null,
          priority,
          assignee_id: assigneeId,
          client_id: taskClientId,
          project_id: projectId,
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
        },
      }),
    onSuccess: (res) => {
      toast.success("Tarefa criada");
      onOpenChange(false);
      onCreated(res.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Nova tarefa"
      description="Crie uma tarefa e atribua para alguém do time."
      bodyClassName="space-y-4"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => m.mutate()} disabled={!title.trim() || m.isPending}>
            {m.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Criar tarefa
          </Button>
        </>
      }
    >
      <>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Título</label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Aprovar copy do post de sexta"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Descrição</label>
          <Textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Contexto, checklist rápido, links..."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Prioridade</label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Prazo</label>
            <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Responsável</label>
            <AssigneePicker brandId={brandId} value={assigneeId} onChange={setAssigneeId} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Conta / Cliente</label>
            <ClientPicker
              brandId={brandId}
              value={taskClientId}
              onChange={(id) => {
                setTaskClientId(id);
                setProjectId(null);
              }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Projeto</label>
          <ProjectPicker
            brandId={brandId}
            clientId={taskClientId}
            value={projectId}
            onChange={setProjectId}
          />
        </div>
      </>
    </ExpandedModal>
  );
}

// ---------- Detail Drawer (persistent side panel) ----------

export function TaskDrawer({
  taskId,
  brandId,
  currentUserId,
  allTasks,
  onNavigate,
  onClose,
  onChanged,
}: {
  taskId: string;
  brandId: string;
  currentUserId: string | null;
  allTasks: TaskRow[];
  onNavigate: (id: string) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const listComments = useServerFn(listTaskCommentsFn);
  const addComment = useServerFn(addTaskCommentFn);
  const deleteComment = useServerFn(deleteTaskCommentFn);
  const update = useServerFn(updateTaskFn);
  const del = useServerFn(deleteTaskFn);
  const setArchived = useServerFn(setTaskArchivedFn);
  const listAssignees = useServerFn(listBrandAssigneesFn);

  const task = allTasks.find((t) => t.id === taskId) ?? null;
  const idx = allTasks.findIndex((t) => t.id === taskId);
  const prev = idx > 0 ? allTasks[idx - 1] : null;
  const next = idx >= 0 && idx < allTasks.length - 1 ? allTasks[idx + 1] : null;

  const commentsQ = useQuery({
    queryKey: ["task-comments", taskId],
    queryFn: () => listComments({ data: { taskId } }),
  });
  const membersQ = useQuery({
    queryKey: ["brand-assignees", brandId],
    queryFn: () => listAssignees({ data: { brandId } }),
    staleTime: 60_000,
  });

  const [draft, setDraft] = useState<{ title?: string; description?: string | null }>({});
  useEffect(() => {
    if (task) setDraft({ title: task.title, description: task.description });
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [comment, setComment] = useState("");

  const patchMutation = useMutation({
    mutationFn: (payload: { taskId: string; patch: Record<string, unknown> }) =>
      update({ data: payload as never }),
    onSuccess: () => onChanged(),
    onError: (e: Error) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: () =>
      addComment({
        data: { taskId, body: comment.trim(), mentions: resolveMentions(comment, members) },
      }),
    onSuccess: () => {
      setComment("");
      qc.invalidateQueries({ queryKey: ["task-comments", taskId] });
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeComment = useMutation({
    mutationFn: (commentId: string) => deleteComment({ data: { commentId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-comments", taskId] }),
  });

  const archiveMutation = useMutation({
    mutationFn: (archived: boolean) => setArchived({ data: { taskId, archived } }),
    onSuccess: (_r, archived) => {
      toast.success(archived ? "Tarefa arquivada" : "Tarefa restaurada");
      onChanged();
      if (archived) onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeTask = useMutation({
    mutationFn: () => del({ data: { taskId } }),
    onSuccess: () => {
      toast.success("Tarefa excluída");
      onChanged();
      onClose();
    },
  });

  // J/K navigation
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.target as HTMLElement | null)?.matches("input, textarea, [contenteditable]")) return;
      if (e.key === "j" && next) onNavigate(next.id);
      else if (e.key === "k" && prev) onNavigate(prev.id);
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev?.id, next?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const members = membersQ.data ?? [];

  const isDone = task?.status === "done";
  const statusMeta = task ? STATUS_META[task.status] : null;
  const priorityMeta = task ? PRIORITY_META[task.priority] : null;

  return (
    <ExpandedModal
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      size="md"
      title={task?.title ?? "Tarefa"}
      hideTitle
      headerClassName="items-center px-4 py-2.5"
      bodyClassName="p-0"
      footerClassName="block border-t bg-background px-4 py-3"
      headerExtra={
        task ? (
          <>
            {task.post_id ? (
              <Button asChild size="sm" variant="outline" className="h-8">
                <Link to="/content" search={{ post: task.post_id }} onClick={onClose}>
                  <FileText className="mr-1.5 h-4 w-4" />
                  Ver peça
                </Link>
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={isDone ? "secondary" : "default"}
              className="h-8"
              onClick={() =>
                patchMutation.mutate({
                  taskId,
                  patch: { done: !isDone, status: isDone ? "todo" : "done" },
                })
              }
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              {isDone ? "Concluída" : "Concluir"}
            </Button>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!prev}
                onClick={() => prev && onNavigate(prev.id)}
                title="Anterior (K)"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!next}
                onClick={() => next && onNavigate(next.id)}
                title="Próxima (J)"
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => archiveMutation.mutate(!task.archived_at)}>
                    <Archive className="mr-2 h-4 w-4" />
                    {task.archived_at ? "Restaurar tarefa" : "Arquivar tarefa"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      if (confirm("Excluir esta tarefa?")) removeTask.mutate();
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Excluir tarefa
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        ) : null
      }
      footer={
        task ? (
          <>
            <div className="relative">
              <MentionTextarea
                rows={2}
                value={comment}
                onChange={setComment}
                people={members}
                onSubmit={() => {
                  if (comment.trim()) send.mutate();
                }}
                placeholder="Escreva um comentário. Use @ para mencionar. Cmd/Ctrl+Enter para enviar."
                className="min-h-[60px] pr-12"
              />
              <Button
                size="icon"
                className="absolute bottom-2 right-2 h-8 w-8 rounded-full"
                onClick={() => send.mutate()}
                disabled={!comment.trim() || send.isPending}
                aria-label="Enviar comentário"
              >
                {send.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                Criada em {format(new Date(task.created_at), "d 'de' MMM yyyy", { locale: ptBR })}
              </span>
              <span className="font-mono opacity-70">J/K para navegar · Esc para fechar</span>
            </div>
          </>
        ) : null
      }
    >
      {!task ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : (
        <>
          {/* Body (scrollable) */}
          <div className="flex-1 overflow-y-auto">
            {/* Title */}
            <div className="px-6 pb-3 pt-5">
              <Input
                value={draft.title ?? task.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                onBlur={() => {
                  if (draft.title && draft.title !== task.title) {
                    patchMutation.mutate({ taskId, patch: { title: draft.title.trim() } });
                  }
                }}
                className={cn(
                  "h-auto border-0 bg-transparent px-0 py-1 text-xl font-semibold leading-tight shadow-none focus-visible:ring-0",
                  isDone && "text-muted-foreground line-through",
                )}
              />
            </div>

            {/* Metadata grid */}
            <div className="px-6 pb-6">
              <dl className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-1 text-sm">
                <MetaRow label="Responsável">
                  <AssigneePicker
                    brandId={brandId}
                    value={task.assignee_id}
                    onChange={(id) => patchMutation.mutate({ taskId, patch: { assignee_id: id } })}
                    compact
                  />
                </MetaRow>

                <MetaRow label="Prazo">
                  <DuePicker
                    value={task.due_at}
                    onChange={(iso) => patchMutation.mutate({ taskId, patch: { due_at: iso } })}
                  />
                </MetaRow>

                <MetaRow label="Status">
                  <Select
                    value={task.status}
                    onValueChange={(v) =>
                      patchMutation.mutate({
                        taskId,
                        patch: { status: v as TaskStatus, done: v === "done" },
                      })
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        "h-7 w-auto gap-1.5 border px-2.5 text-xs font-medium",
                        statusMeta?.badge,
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_META[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </MetaRow>

                <MetaRow label="Prioridade">
                  <Select
                    value={task.priority}
                    onValueChange={(v) =>
                      patchMutation.mutate({ taskId, patch: { priority: v as TaskPriority } })
                    }
                  >
                    <SelectTrigger
                      className={cn(
                        "h-7 w-auto gap-1.5 border px-2.5 text-xs font-medium",
                        priorityMeta?.badge,
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TASK_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PRIORITY_META[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </MetaRow>

                <MetaRow label="Conta">
                  <ClientPicker
                    brandId={brandId}
                    value={task.client_id}
                    onChange={(id) =>
                      patchMutation.mutate({
                        taskId,
                        patch: { client_id: id, project_id: null },
                      })
                    }
                  />
                </MetaRow>

                <MetaRow label="Projeto">
                  <ProjectPicker
                    brandId={brandId}
                    clientId={task.client_id}
                    value={task.project_id}
                    onChange={(id) => patchMutation.mutate({ taskId, patch: { project_id: id } })}
                  />
                </MetaRow>
              </dl>
            </div>

            <Separator />

            {/* Timesheet · Play / Pause / Stop */}
            <div className="space-y-2 px-6 py-4">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Timesheet</h3>
              </div>
              <TaskTimerWidget brandId={brandId} taskId={task.id} />
            </div>

            <Separator />

            {/* Subtasks */}
            <div className="px-6 py-5">
              <SubtasksSection taskId={task.id} />
            </div>

            <Separator />

            {/* Description */}
            <div className="space-y-1.5 px-6 py-5">
              <label className="text-xs font-medium text-muted-foreground">Descrição</label>
              <Textarea
                rows={4}
                placeholder="Adicione contexto, checklist e links..."
                value={draft.description ?? task.description ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                onBlur={() => {
                  const val = (draft.description ?? "").trim();
                  if ((task.description ?? "") !== val) {
                    patchMutation.mutate({ taskId, patch: { description: val || null } });
                  }
                }}
                className="resize-none border-transparent bg-transparent px-2 text-sm shadow-none hover:border-border focus-visible:border-border focus-visible:bg-background"
              />
            </div>

            <Separator />

            {/* Comments */}
            <div className="space-y-3 px-6 py-5">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">Discussão</h3>
                <Badge variant="secondary" className="text-[10px]">
                  {commentsQ.data?.length ?? 0}
                </Badge>
              </div>
              {commentsQ.isLoading ? (
                <div className="text-xs text-muted-foreground">Carregando comentários...</div>
              ) : (commentsQ.data ?? []).length === 0 ? (
                <p className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
                  Sem comentários. Use @ para mencionar alguém do time.
                </p>
              ) : (
                <ul className="space-y-3">
                  {(commentsQ.data ?? []).map((c) => (
                    <li key={c.id} className="flex gap-3">
                      <TaskAssignee name={c.author_name} avatarUrl={c.author_avatar} size={28} />
                      <div className="flex-1 rounded-md border bg-muted/30 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium">{displayName({ full_name: c.author_name, email: members.find((m) => m.id === c.author_id)?.email ?? null }, "Alguém")}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(c.created_at), "d 'de' MMM · HH:mm", { locale: ptBR })}
                            {c.author_id === currentUserId ? (
                              <button
                                className="ml-2 text-muted-foreground hover:text-destructive"
                                onClick={() => removeComment.mutate(c.id)}
                                aria-label="Excluir comentário"
                              >
                                <Trash2 className="inline h-3 w-3" />
                              </button>
                            ) : null}
                          </span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm">
                          <MentionText text={c.body} people={members} />
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </ExpandedModal>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center py-0.5">{children}</dd>
    </>
  );
}

function DuePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const local = value ? new Date(value) : null;
  const label = local ? format(local, "d 'de' MMM · HH:mm", { locale: ptBR }) : "Sem prazo";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 justify-start gap-1.5 px-2 text-xs font-normal hover:bg-muted",
            !local && "text-muted-foreground",
          )}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Data e hora</label>
          <Input
            type="datetime-local"
            className="h-8 text-xs"
            value={local ? toLocalDatetimeInput(local) : ""}
            onChange={(e) => {
              onChange(e.target.value ? new Date(e.target.value).toISOString() : null);
            }}
          />
          <div className="flex justify-between pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Limpar
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
              Ok
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// re-export commonly-needed icons for consumers of shared
export { PauseCircle, CalendarIcon, MessageSquare, Folder };
// ---------- Subtasks + progress ----------

export function SubtasksSection({ taskId }: { taskId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listSubtasksFn);
  const add = useServerFn(addSubtaskFn);
  const patch = useServerFn(updateSubtaskFn);
  const remove = useServerFn(deleteSubtaskFn);
  const [title, setTitle] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const q = useQuery({
    queryKey: ["task-subtasks", taskId],
    queryFn: () => list({ data: { taskId } }),
  });
  const items = q.data ?? [];
  const doneCount = items.filter((s) => s.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["task-subtasks", taskId] });
    // O progresso das subtarefas aparece na lista/kanban, então recarrega as tarefas também.
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  const rename = useMutation({
    mutationFn: (v: { subtaskId: string; title: string }) =>
      patch({ data: { subtaskId: v.subtaskId, patch: { title: v.title } } as never }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: (t: string) => add({ data: { taskId, title: t } }),
    onSuccess: () => {
      setTitle("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggle = useMutation({
    mutationFn: (v: { subtaskId: string; done: boolean }) =>
      patch({ data: { subtaskId: v.subtaskId, patch: { done: v.done } } as never }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (subtaskId: string) => remove({ data: { subtaskId } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Subtarefas</h3>
        <Badge variant="secondary" className="text-[10px]">
          {doneCount}/{items.length}
        </Badge>
      </div>

      {items.length > 0 ? (
        <div className="space-y-1.5">
          <Progress value={pct} className="h-1.5" />
          <p className="text-[11px] text-muted-foreground">{pct}% concluído</p>
        </div>
      ) : null}

      {q.isLoading ? (
        <div className="text-xs text-muted-foreground">Carregando subtarefas...</div>
      ) : items.length === 0 ? (
        <p className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
          Nenhuma subtarefa. Quebre a tarefa em passos menores.
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((s) => (
            <li
              key={s.id}
              className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50"
            >
              <Checkbox
                checked={s.done}
                onCheckedChange={(v) => toggle.mutate({ subtaskId: s.id, done: v === true })}
                aria-label={s.done ? "Marcar como pendente" : "Marcar como concluída"}
              />
              {editingId === s.id ? (
                <Input
                  autoFocus
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={() => {
                    const t = editingTitle.trim();
                    if (t && t !== s.title) rename.mutate({ subtaskId: s.id, title: t });
                    else setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-7 flex-1 text-sm"
                />
              ) : (
                <button
                  type="button"
                  className={cn(
                    "flex-1 truncate text-left text-sm",
                    s.done && "text-muted-foreground line-through",
                  )}
                  onClick={() => {
                    setEditingId(s.id);
                    setEditingTitle(s.title);
                  }}
                  title="Clique para editar"
                >
                  {s.title}
                </button>
              )}
              <button
                className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={() => del.mutate(s.id)}
                aria-label="Excluir subtarefa"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = title.trim();
          if (t) create.mutate(t);
        }}
      >
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Adicionar subtarefa..."
          className="h-8 text-sm"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!title.trim() || create.isPending}
        >
          {create.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
        </Button>
      </form>
    </div>
  );
}
