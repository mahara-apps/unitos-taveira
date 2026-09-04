import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarPlus,
  Check,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Paperclip, ImageIcon, CalendarDays, UserCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  createStageFn,
  updateStageFn,
  deleteStageFn,
  createPostFn,
  movePostFn,
  listBrandAssigneesFn,
  STAGE_COLORS,
  type Board,
  type BoardPost,
  type PipelineStage,
  type StageColor,
} from "@/lib/content.functions";
import {
  STAGE_GRADIENT,
  PRIORITY_STYLES,
  PRIORITY_LABEL,
  FORMAT_STYLES,
  CHANNELS,
  CHANNEL_STYLES,
} from "./stage-colors";
import {
  CONTENT_FORMAT_LABEL,
  normalizeContentFormat,
  type ContentFormat,
} from "@/lib/content-formats";
import { scheduleDisplay, scheduleFullLabel } from "@/lib/post-schedule-display";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings2, AlarmClock } from "lucide-react";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { DashboardCountBadge, DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { describeError } from "@/lib/errors";

// Dot de cor da coluna — segue paleta semântica do DESIGN_SYSTEM.
// (`cyan` mapeado para `sky` para manter uma cor = um significado.)
const COLOR_MAP: Record<StageColor, string> = {
  muted: "bg-muted-foreground/60",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  cyan: "bg-sky-500",
};

function AssigneeChip({ brandId, assigneeId }: { brandId: string; assigneeId: string | null }) {
  const fetchMembers = useServerFn(listBrandAssigneesFn);
  const { data: members } = useQuery({
    queryKey: ["brand-assignees", brandId],
    queryFn: () => fetchMembers({ data: { brandId } }),
    staleTime: 60_000,
    enabled: !!brandId,
  });
  if (!assigneeId) {
    return (
      <span
        className="inline-flex items-center gap-1 text-muted-foreground/70"
        title="Sem responsável"
      >
        <UserCircle2 className="h-3.5 w-3.5 opacity-60" />
      </span>
    );
  }
  const m = members?.find((x) => x.id === assigneeId);
  const name = m?.name ?? "Responsável";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <span className="inline-flex items-center gap-1" title={name}>
      {m?.avatar_url ? (
        <img
          src={m.avatar_url}
          alt={name}
          className="h-4 w-4 rounded-full object-cover ring-1 ring-border/60"
        />
      ) : (
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[8px] font-semibold text-primary-foreground">
          {initials}
        </span>
      )}
      <span className="max-w-[90px] truncate text-[11px] text-foreground/80">{name}</span>
    </span>
  );
}

type Props = {
  board: Board;
  boardQueryKey: readonly unknown[];
  onOpenPost: (id: string) => void;
  onConfigureColumns?: () => void;
  onNewTask?: (stageId?: string) => void;
};

export type SortBy = "position" | "created" | "scheduled";
export type SortDir = "asc" | "desc";
export type StageSort = { by: SortBy; dir: SortDir };

type PropsExt = Props & {
  sortByStage?: Record<string, StageSort>;
  onCycleSort?: (stageId: string, by: Exclude<SortBy, "position">) => void;
};

export function ContentBoard({
  board,
  boardQueryKey,
  onOpenPost,
  onConfigureColumns,
  onNewTask,
  sortByStage,
  onCycleSort,
}: PropsExt) {
  const qc = useQueryClient();
  const movePost = useServerFn(movePostFn);
  const createStage = useServerFn(createStageFn);
  const updateStage = useServerFn(updateStageFn);
  const deleteStage = useServerFn(deleteStageFn);
  const createPost = useServerFn(createPostFn);

  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const postsByStage = useMemo(() => {
    const m = new Map<string, BoardPost[]>();
    for (const s of board.stages) m.set(s.id, []);
    for (const p of board.posts) {
      if (!p.stage_id) continue;
      if (!m.has(p.stage_id)) m.set(p.stage_id, []);
      m.get(p.stage_id)!.push(p);
    }
    for (const [stageId, list] of m.entries()) {
      const sort = sortByStage?.[stageId];
      if (!sort || sort.by === "position") {
        list.sort((a, b) => a.position - b.position);
      } else {
        const pick = (p: BoardPost) => {
          if (sort.by === "created") return new Date(p.created_at).getTime();
          // Ordena pela data EFETIVA (publicação/agendamento/proposta da pauta).
          const ts = scheduleDisplay(p).timestamp;
          return (
            ts ?? (sort.dir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY)
          );
        };
        list.sort((a, b) => {
          const diff = pick(a) - pick(b);
          return sort.dir === "asc" ? diff : -diff;
        });
      }
    }
    return m;
  }, [board, sortByStage]);

  const activePost = useMemo(
    () => (activeId ? (board.posts.find((p) => p.id === activeId) ?? null) : null),
    [activeId, board.posts],
  );

  const moveMutation = useMutation({
    mutationFn: (v: { postId: string; toStageId: string; toPosition: number }) =>
      movePost({ data: v }),
    onError: (e: Error) => {
      toast.error(describeError(e));
      qc.invalidateQueries({ queryKey: boardQueryKey });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: boardQueryKey });
    },
  });

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function handleDragOver(_e: DragOverEvent) {}
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const postId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    // Over can be a stage id or a post id — resolve to stage
    const targetStageId =
      board.stages.find((s) => s.id === overId)?.id ??
      board.posts.find((p) => p.id === overId)?.stage_id ??
      null;
    if (!targetStageId) return;

    const list = [...(postsByStage.get(targetStageId) ?? [])];
    const currentPost = board.posts.find((p) => p.id === postId);
    if (!currentPost) return;

    // Determine new position: append to bottom of target stage
    const lastPos = list.length > 0 ? list[list.length - 1].position : -1024;
    const newPos = lastPos + 1024;

    if (currentPost.stage_id === targetStageId && currentPost.position === newPos) return;

    // Optimistic update
    qc.setQueryData<Board>(boardQueryKey, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        posts: prev.posts.map((p) =>
          p.id === postId ? { ...p, stage_id: targetStageId, position: newPos } : p,
        ),
      };
    });

    moveMutation.mutate({ postId, toStageId: targetStageId, toPosition: newPos });
  }

  const addStage = useMutation({
    mutationFn: () =>
      createStage({
        data: { pipelineId: board.pipeline.id, label: "Nova coluna", color: "muted" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: boardQueryKey }),
    onError: (e: Error) => toast.error(describeError(e)),
  });

  const [creatingIn, setCreatingIn] = useState<string | null>(null);

  const addPost = useMutation({
    mutationFn: (v: { stageId: string; title: string }) =>
      createPost({
        data: {
          brandId: board.pipeline.brand_id,
          clientId: board.pipeline.client_id,
          pipelineId: board.pipeline.id,
          stageId: v.stageId,
          title: v.title,
        },
      }),
    onSuccess: () => {
      setCreatingIn(null);
      qc.invalidateQueries({ queryKey: boardQueryKey });
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <DashboardPanelSurface className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto overflow-y-hidden p-4">
          {board.stages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              posts={postsByStage.get(stage.id) ?? []}
              onOpenPost={onOpenPost}
              onRename={(label) =>
                updateStage({ data: { stageId: stage.id, patch: { label } } }).then(() =>
                  qc.invalidateQueries({ queryKey: boardQueryKey }),
                )
              }
              onRecolor={(color) =>
                updateStage({ data: { stageId: stage.id, patch: { color } } }).then(() =>
                  qc.invalidateQueries({ queryKey: boardQueryKey }),
                )
              }
              onDelete={() =>
                deleteStage({ data: { stageId: stage.id } })
                  .then(() => qc.invalidateQueries({ queryKey: boardQueryKey }))
                  .catch((e: Error) => toast.error(describeError(e)))
              }
              creating={creatingIn === stage.id}
              onStartCreate={() => setCreatingIn(stage.id)}
              onCancelCreate={() => setCreatingIn(null)}
              onConfirmCreate={(title) => addPost.mutate({ stageId: stage.id, title })}
              adding={addPost.isPending}
              onOpenRichCreate={onNewTask ? () => onNewTask(stage.id) : undefined}
              onConfigure={onConfigureColumns}
              sort={sortByStage?.[stage.id]}
              onCycleSort={onCycleSort ? (by) => onCycleSort(stage.id, by) : undefined}
            />
          ))}
          <button
            type="button"
            className="flex h-full min-w-[304px] shrink-0 items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-background/40 px-3 py-3 text-xs font-medium text-muted-foreground transition hover:border-border hover:bg-background/60 hover:text-foreground"
            onClick={() => addStage.mutate()}
            disabled={addStage.isPending}
          >
            <Plus className="h-4 w-4" /> Adicionar coluna
          </button>
        </div>
      </DashboardPanelSurface>
      <DragOverlay>
        {activePost ? (
          <div className="w-64 rotate-2">
            <PostCard post={activePost} onOpen={() => {}} isOverlay />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  stage,
  posts,
  onOpenPost,
  onRename,
  onRecolor,
  onDelete,
  creating,
  onStartCreate,
  onCancelCreate,
  onConfirmCreate,
  adding,
  onOpenRichCreate,
  onConfigure,
  sort,
  onCycleSort,
}: {
  stage: PipelineStage;
  posts: BoardPost[];
  onOpenPost: (id: string) => void;
  onRename: (label: string) => void;
  onRecolor: (color: StageColor) => void;
  onDelete: () => void;
  creating: boolean;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onConfirmCreate: (title: string) => void;
  adding: boolean;
  onOpenRichCreate?: () => void;
  onConfigure?: () => void;
  sort?: StageSort;
  onCycleSort?: (by: Exclude<SortBy, "position">) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(stage.label);
  const [newTitle, setNewTitle] = useState("");

  return (
    <div
      ref={setNodeRef}
      className={`relative flex h-full w-[304px] shrink-0 flex-col overflow-hidden rounded-xl border px-4 pb-4 pt-4 transition ${
        isOver ? "border-primary/60 bg-primary/5" : "border-border/60 bg-background/60"
      }`}
    >
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-linear-to-r ${STAGE_GRADIENT[stage.color] ?? STAGE_GRADIENT.muted}`}
      />
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-border/40 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_MAP[stage.color] ?? COLOR_MAP.muted}`}
                aria-label="Alterar cor"
              />
            </PopoverTrigger>
            <PopoverContent className="w-40 p-2">
              <div className="grid grid-cols-4 gap-1">
                {STAGE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onRecolor(c)}
                    className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition ${COLOR_MAP[c]} ${
                      stage.color === c ? "ring-2 ring-foreground" : ""
                    }`}
                    aria-label={c}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {editing ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-7 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onRename(label.trim() || stage.label);
                    setEditing(false);
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                onClick={() => {
                  onRename(label.trim() || stage.label);
                  setEditing(false);
                }}
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="truncate text-sm font-medium tracking-tight hover:underline"
              onClick={() => setEditing(true)}
            >
              {stage.label}
            </button>
          )}
          <Badge
            variant="secondary"
            className="h-5 shrink-0 rounded-md border border-border/60 bg-background/60 px-1.5 text-xs font-normal tabular-nums"
          >
            {posts.length}
          </Badge>
          {(() => {
            const overdueCount = posts.filter((p) => p.sla_status === "overdue").length;
            const atRiskCount = posts.filter((p) => p.sla_status === "at_risk").length;
            const slaH = stage.sla_hours ?? (stage.sla_days ? stage.sla_days * 24 : null);
            const slaLabel =
              slaH == null ? null : slaH < 24 ? `${slaH}h` : `${Math.round(slaH / 24)}d`;
            const tooltipCopy = slaLabel
              ? `Cada card pode permanecer no máximo ${slaLabel} nesta etapa. As tarefas atrasadas ultrapassaram esse prazo.`
              : `Nenhum SLA configurado para esta etapa. Defina em Configurações → SLA.`;
            return (
              <>
                {overdueCount > 0 ? (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex h-5 items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                          <AlarmClock className="h-2.5 w-2.5" /> {overdueCount}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[240px] border border-border bg-popover text-xs leading-snug text-popover-foreground">
                        <div className="font-semibold text-rose-600 dark:text-rose-400">
                          {overdueCount} tarefa(s) atrasada(s)
                        </div>
                        <div className="mt-0.5 text-muted-foreground">{tooltipCopy}</div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
                {atRiskCount > 0 ? (
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex h-5 items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                          <AlarmClock className="h-2.5 w-2.5" /> {atRiskCount}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[240px] border border-border bg-popover text-xs leading-snug text-popover-foreground">
                        <div className="font-semibold text-amber-600 dark:text-amber-400">
                          {atRiskCount} próxima(s) de vencer
                        </div>
                        <div className="mt-0.5 text-muted-foreground">
                          Já consumiram 80% do SLA{slaLabel ? ` de ${slaLabel}` : ""}.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
              </>
            );
          })()}
        </div>
        {onCycleSort ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <SortChip
              label="Criação"
              icon={<CalendarPlus className="h-3 w-3" />}
              active={sort?.by === "created"}
              dir={sort?.by === "created" ? sort.dir : null}
              onClick={() => onCycleSort("created")}
            />
          </div>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0 opacity-60 hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" /> Renomear
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenRichCreate ?? onStartCreate}>
              <Plus className="mr-2 h-4 w-4" /> Novo post
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                if (confirm(`Excluir "${stage.label}"?`)) onDelete();
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Excluir coluna
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1">
        {posts.map((p) => (
          <DraggablePostCard key={p.id} post={p} onOpen={onOpenPost} />
        ))}

        {posts.length === 0 && !creating ? (
          <div className="flex min-h-40 flex-1 items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/40">
            <PanelEmptyState
              icon={<ImageIcon className="h-5 w-5" />}
              text="Nenhuma tarefa nesta etapa."
              className="py-8"
            />
          </div>
        ) : null}

        {creating ? (
          <div className="rounded-lg border border-border/60 bg-card p-2">
            <Input
              autoFocus
              placeholder="Título do post"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) {
                  onConfirmCreate(newTitle.trim());
                  setNewTitle("");
                }
                if (e.key === "Escape") {
                  onCancelCreate();
                  setNewTitle("");
                }
              }}
            />
            <div className="mt-2 flex gap-1">
              <Button
                size="sm"
                onClick={() => {
                  if (newTitle.trim()) {
                    onConfirmCreate(newTitle.trim());
                    setNewTitle("");
                  }
                }}
                disabled={adding || !newTitle.trim()}
              >
                Adicionar
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancelCreate}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {!creating ? (
        <button
          type="button"
          onClick={onOpenRichCreate ?? onStartCreate}
          className="mt-3 flex h-9 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 text-xs font-medium text-muted-foreground transition hover:border-border hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Nova tarefa
        </button>
      ) : null}
    </div>
  );
}

function DraggablePostCard({ post, onOpen }: { post: BoardPost; onOpen: (id: string) => void }) {
  return <DraggablePostCardInner post={post} onOpen={onOpen} />;
}

function SortChip({
  label,
  icon,
  active,
  dir,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  dir: SortDir | null;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            className={`inline-flex h-5 items-center gap-0.5 rounded-md border px-1 text-[10px] transition ${
              active
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground"
            }`}
            aria-label={`Ordenar por ${label.toLowerCase()}`}
          >
            {icon}
            {active ? (
              dir === "asc" ? (
                <ArrowUp className="h-2.5 w-2.5" />
              ) : (
                <ArrowDown className="h-2.5 w-2.5" />
              )
            ) : (
              <ArrowUpDown className="h-2.5 w-2.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          Ordenar por {label.toLowerCase()}
          {active ? ` (${dir === "asc" ? "crescente" : "decrescente"})` : ""}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function DraggablePostCardInner({
  post,
  onOpen,
}: {
  post: BoardPost;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: post.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`touch-none ${isDragging ? "opacity-40" : ""}`}
    >
      <PostCard post={post} onOpen={onOpen} />
    </div>
  );
}

function PostCard({
  post,
  onOpen,
  isOverlay,
}: {
  post: BoardPost;
  onOpen: (id: string) => void;
  isOverlay?: boolean;
}) {
  const priority = post.priority ?? null;
  const refCount = Array.isArray(post.reference_media) ? post.reference_media.length : 0;
  const hasCover = !!post.cover_url;
  const channels = Array.isArray(post.channels) ? (post.channels as string[]) : [];
  const channelDefs = channels
    .map((id) => CHANNELS.find((c) => c.id === id))
    .filter(Boolean) as typeof CHANNELS;
  // Derive up to 3 canonical format chips, preferring posts.format, falling
  // back to post_placements. Non-format values (e.g. "tiktok") are ignored.
  const formatKeys: ContentFormat[] = (() => {
    const seen = new Set<ContentFormat>();
    const out: ContentFormat[] = [];
    const push = (k: ContentFormat | null) => {
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    };
    push(normalizeContentFormat(post.format));
    for (const pl of post.placements ?? []) push(normalizeContentFormat(pl.format));
    return out.slice(0, 3);
  })();
  const snippet = (post.copy ?? "")
    .replace(/^###\s+\w+\s*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  // Data + estado de agenda: mesma derivação usada pelo calendário.
  const schedule = scheduleDisplay(post);
  const missingDestination = channelDefs.length === 0 || formatKeys.length === 0;
  const tags = Array.isArray(post.tags) ? post.tags.filter(Boolean) : [];
  return (
    <button
      type="button"
      onClick={() => onOpen(post.id)}
      className={`group w-full overflow-hidden rounded-lg border border-border/60 bg-card text-left transition hover:border-primary/50 hover:shadow-sm ${
        isOverlay ? "cursor-grabbing shadow-lg" : ""
      }`}
    >
      {/* Visual placeholder / cover */}
      <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden border-b border-dashed border-border/60 bg-linear-to-br from-muted/60 to-muted/20">
        {hasCover ? (
          <img src={post.cover_url!} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground/70 transition group-hover:text-muted-foreground">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[10px] font-medium shadow-sm">
              <Sparkles className="h-3 w-3" /> Subir arte ou gerar com IA
            </div>
          </div>
        )}
      </div>

      <div className="p-3">
        {post.sla_status === "overdue" ||
        post.sla_status === "at_risk" ||
        priority ||
        missingDestination ||
        formatKeys.length > 0 ||
        channelDefs.length > 0 ? (
          <div className="mb-1 flex flex-wrap items-center gap-1">
            {post.sla_status === "overdue" ? (
              <span
                className="inline-flex items-center gap-0.5 rounded-full border border-rose-500/40 bg-rose-500/10 px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400"
                title={
                  post.hours_overdue && post.hours_overdue >= 24
                    ? `Atrasado há ${Math.floor(post.hours_overdue / 24)}d`
                    : `Atrasado há ${Math.round(post.hours_overdue ?? 0)}h`
                }
              >
                <AlarmClock className="h-2.5 w-2.5" /> Atrasado
                {post.hours_overdue
                  ? post.hours_overdue >= 24
                    ? ` · ${Math.floor(post.hours_overdue / 24)}d`
                    : ` · ${Math.round(post.hours_overdue)}h`
                  : ""}
              </span>
            ) : post.sla_status === "at_risk" ? (
              <span
                className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400"
                title={`${Math.round((post.sla_progress ?? 0) * 100)}% do SLA consumido`}
              >
                <AlarmClock className="h-2.5 w-2.5" /> Próximo de vencer
              </span>
            ) : null}
            {channelDefs.map((c) => {
              const Icon = c.icon;
              return (
                <span
                  key={c.id}
                  className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wider ${CHANNEL_STYLES[c.id] ?? "border-border/60 bg-muted/40 text-foreground/80"}`}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {c.label}
                </span>
              );
            })}
            {formatKeys.map((f) => (
              <span
                key={f}
                className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wider ${FORMAT_STYLES[f]}`}
              >
                {CONTENT_FORMAT_LABEL[f]}
              </span>
            ))}
            {missingDestination ? (
              <span
                className="inline-flex items-center rounded-full border border-dashed border-amber-500/50 bg-amber-500/5 px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400"
                title="Sem canal e/ou formato a peça não entra no calendário nem pode publicar."
              >
                Definir {channelDefs.length === 0 ? "canal" : ""}
                {channelDefs.length === 0 && formatKeys.length === 0 ? "/" : ""}
                {formatKeys.length === 0 ? "formato" : ""}
              </span>
            ) : null}
            {priority ? (
              <span
                className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[8px] font-semibold uppercase tracking-wider ${PRIORITY_STYLES[priority] ?? ""}`}
              >
                {PRIORITY_LABEL[priority] ?? priority}
              </span>
            ) : null}
          </div>
        ) : null}
        <p className="text-sm font-semibold leading-snug tracking-tight text-foreground line-clamp-2">
          {post.title}
        </p>
        {snippet ? (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{snippet}</p>
        ) : null}
        {tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
              >
                #{t}
              </span>
            ))}
            {tags.length > 4 ? (
              <span className="text-[10px] text-muted-foreground">+{tags.length - 4}</span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <AssigneeChip brandId={post.brand_id} assigneeId={post.assignee_id} />
          </div>
          <div className="flex items-center gap-2">
            {refCount > 0 ? (
              <DashboardCountBadge
                className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[11px] text-muted-foreground"
                title={`${refCount} anexo(s)`}
              >
                <Paperclip className="h-3 w-3" /> {refCount}
              </DashboardCountBadge>
            ) : null}
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0 tabular-nums ${schedule.chip}`}
              title={
                schedule.iso
                  ? `${schedule.stateLabel}: ${scheduleFullLabel(schedule.iso)}`
                  : "Sem data definida"
              }
            >
              <CalendarDays className="h-3 w-3" />
              {schedule.iso ? schedule.label : "Sem data"}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
