import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  Upload,
  X,
  ImageIcon,
  FileText,
  RotateCcw,
  CheckCircle2,
  Link2,
  Copy as CopyIcon,
  ShieldX,
  ChevronLeft,
  ChevronRight,
  Play,
  Images,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  createPostFn,
  updatePostFn,
  deletePostFn,
  reworkPostFn,
  getPostDetailFn,
  uploadPostReferenceMediaFn,
  removePostReferenceMediaFn,
  signPostReferenceMediaFn,
  listBrandAssigneesFn,
  regeneratePostContentFn,
  type PipelineStage,
  type BoardPost,
  type PostTimelineEvent,
  type ScriptScene,
} from "@/lib/content.functions";
import {
  listApprovalTokensFn,
  createApprovalTokenFn,
  revokeApprovalTokenFn,
} from "@/lib/approval.functions";
import { listClientLinkedChannelsFn, type LinkedChannel } from "@/lib/client-channels.functions";
import { useAccessRole } from "@/hooks/use-access-role";
import { Link } from "@tanstack/react-router";
import { saveScheduledPostFn } from "@/lib/scheduling-wizard.functions";
import { supabase } from "@/integrations/supabase/client";
import { getCachedUser } from "@/lib/auth-cache";
import { cn } from "@/lib/utils";
import { CHANNELS, CHANNEL_STYLES, FORMAT_STYLES, PRIORITY_STYLES } from "./stage-colors";
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABEL,
  normalizeContentFormat,
} from "@/lib/content-formats";
import {
  updateScheduleSlotFn,
  clearScheduleSlotFn,
} from "@/lib/schedule-approval.functions";
import {
  scheduleDisplay,
  scheduleFullLabel,
  hasProposalTrack,
  fromLocalInputValue,
  toLocalInputValue as tzToLocalInputValue,
} from "@/lib/post-schedule-display";
import { type PlacementFormat } from "@/lib/placements.functions";
import { listProjects } from "@/lib/projects.functions";
import { FolderKanban } from "lucide-react";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { describeError } from "@/lib/errors";

// Taxonomia de formatos: fonte única em `@/lib/content-formats`.
// Internamente SEMPRE chave canônica ("feed" | "stories" | "reels" |
// "carrossel"); a UI exibe o label via CONTENT_FORMAT_LABEL.

type Priority = "low" | "medium" | "high" | "urgent";

type CommonProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  clientId: string;
  pipelineId: string;
  stages: PipelineStage[];
  invalidateKey: readonly unknown[];
};

type CreateProps = CommonProps & {
  mode: "create";
  defaultStageId?: string;
  defaultScheduledAt?: string; // ISO string; pre-fills scheduled date/time
  defaultProjectId?: string | null;
  postId?: never;
};

type EditProps = CommonProps & {
  mode: "edit";
  postId: string;
  defaultStageId?: never;
};

export type TaskDialogProps = CreateProps | EditProps;

export function TaskDialog(props: TaskDialogProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border/60 bg-background p-0 sm:max-w-[640px]"
      >
        {props.mode === "edit" ? (
          <Suspense fallback={<LoadingBody />}>
            <EditBody {...props} />
          </Suspense>
        ) : (
          <CreateBody {...props} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function LoadingBody() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function QuickApprovalLinkButton({ postId }: { postId: string }) {
  const qc = useQueryClient();
  const createTok = useServerFn(createApprovalTokenFn);
  const m = useMutation({
    mutationFn: () => createTok({ data: { postId, expiresInDays: 14 } }),
    onSuccess: (t) => {
      const url =
        typeof window !== "undefined"
          ? `${window.location.origin}/approval/${t.token}`
          : `/approval/${t.token}`;
      void navigator.clipboard?.writeText(url).catch(() => {});
      toast.success("Link de aprovação copiado");
      qc.invalidateQueries({ queryKey: ["approval-tokens", postId] });
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => m.mutate()}
      disabled={m.isPending}
    >
      {m.isPending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Link2 className="mr-1.5 h-3.5 w-3.5" />
      )}
      Gerar link
    </Button>
  );
}

function AssigneeSelect({
  brandId,
  value,
  onChange,
  className,
}: {
  brandId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const fetchMembers = useServerFn(listBrandAssigneesFn);
  const { data: members } = useQuery({
    queryKey: ["brand-assignees", brandId],
    queryFn: () => fetchMembers({ data: { brandId } }),
    staleTime: 60_000,
    enabled: !!brandId,
  });
  const list = members ?? [];
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger className={cn("h-9 w-full min-w-0 gap-1 text-xs", className)}>
        <SelectValue placeholder="Sem responsável" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">
          <span className="inline-flex items-center gap-2">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground">
              ·
            </span>
            Sem responsável
          </span>
        </SelectItem>
        {list.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <span className="inline-flex items-center gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-medium text-primary-foreground">
                {initials(m.name)}
              </span>
              {m.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ----------------- Create -----------------

function ProjectSelect({
  brandId,
  clientId,
  value,
  onChange,
  className,
  fallback,
}: {
  brandId: string;
  clientId: string;
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
  /** Projeto já vinculado à peça — garante exibição mesmo antes da lista carregar. */
  fallback?: { id: string; name: string; color: string | null } | null;
}) {
  const fetchProjects = useServerFn(listProjects);
  const { data } = useQuery({
    queryKey: ["projects", brandId, clientId, "picker"],
    queryFn: () => fetchProjects({ data: { brandId, clientId } }),
    staleTime: 60_000,
    enabled: !!brandId && !!clientId,
  });
  const projects = (
    (data?.projects ?? []) as Array<{
      id: string;
      name: string;
      color: string | null;
      status: string;
    }>
  ).filter((p) => p.status !== "archived");
  const options =
    fallback && !projects.some((p) => p.id === fallback.id)
      ? [{ ...fallback, status: "active" }, ...projects]
      : projects;
  return (
    <Select value={value ?? "none"} onValueChange={(v) => onChange(v === "none" ? null : v)}>
      <SelectTrigger className={cn("h-9 w-full min-w-0 gap-1 text-xs", className)}>
        <FolderKanban className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
        <SelectValue placeholder="Sem projeto" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Sem projeto</SelectItem>
        {options.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <span className="inline-flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: p.color ?? "#8b5cf6" }}
              />
              {p.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CreateBody({
  onOpenChange,
  brandId,
  clientId,
  pipelineId,
  stages,
  defaultStageId,
  defaultScheduledAt,
  defaultProjectId,
  invalidateKey,
}: CreateProps) {
  const qc = useQueryClient();
  const createPost = useServerFn(createPostFn);

  const [state, setState] = useState(() => {
    const s = emptyState(defaultStageId ?? stages[0]?.id ?? "");
    if (defaultScheduledAt) s.scheduledAt = toLocalInputValue(defaultScheduledAt);
    if (defaultProjectId) s.projectId = defaultProjectId;
    return s;
  });

  useEffect(() => {
    const s = emptyState(defaultStageId ?? stages[0]?.id ?? "");
    if (defaultScheduledAt) s.scheduledAt = toLocalInputValue(defaultScheduledAt);
    if (defaultProjectId) s.projectId = defaultProjectId;
    setState(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultStageId, stages.length, defaultScheduledAt, defaultProjectId]);

  // Pré-seleciona o usuário atual como responsável ao abrir em criação.
  useEffect(() => {
    let cancelled = false;
    getCachedUser().then((user) => {
      const uid = user?.id ?? null;
      if (!uid || cancelled) return;
      setState((p) => (p.assigneeId ? p : { ...p, assigneeId: uid }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = useMutation({
    mutationFn: async () =>
      createPost({
        data: {
          brandId,
          clientId,
          pipelineId,
          stageId: state.stageId,
          title: state.title.trim(),
          channels: state.channels.length ? state.channels : undefined,
          target_connection_ids: state.targetConnectionIds.length
            ? state.targetConnectionIds
            : undefined,
          destinations: state.destinations.length ? state.destinations : undefined,
          format: state.format || null,
          copy: state.copy.trim() || null,
          internal_briefing: state.internalBriefing.trim() || null,
          client_briefing: state.clientBriefing.trim() || null,
          script: state.script.trim() ? [{ cena: 1, fala: state.script.trim() }] : null,
          scheduled_at: fromLocalInputValue(state.scheduledAt),
          remind_at: fromLocalInputValue(state.remindAt),
          priority: state.priority === "none" ? null : state.priority,
          tags: state.tags.length ? state.tags : undefined,
          visible_in_portal: state.visibleInPortal,
          assignees: state.assigneeId ? [state.assigneeId] : undefined,
          project_id: state.projectId ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("Tarefa criada");
      qc.invalidateQueries({ queryKey: invalidateKey });
      qc.invalidateQueries({ queryKey: ["projects", brandId] });
      if (state.projectId)
        qc.invalidateQueries({ queryKey: ["project", brandId, state.projectId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  return (
    <>
      <div className="sticky top-0 z-10 space-y-3 border-b border-border/60 bg-background/95 px-6 pb-3 pt-4 backdrop-blur">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Nova tarefa</h2>
          <p className="text-xs text-muted-foreground">
            Preencha os detalhes para adicionar ao pipeline.
          </p>
        </div>
        <div className="grid grid-cols-3 items-center gap-2">
          <Select
            value={state.stageId}
            onValueChange={(v) => setState((p) => ({ ...p, stageId: v }))}
          >
            <SelectTrigger className="h-9 w-full min-w-0 gap-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AssigneeSelect
            brandId={brandId}
            value={state.assigneeId}
            onChange={(id) => setState((p) => ({ ...p, assigneeId: id }))}
          />
          <ProjectSelect
            brandId={brandId}
            clientId={clientId}
            value={state.projectId}
            onChange={(id) => setState((p) => ({ ...p, projectId: id }))}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <TaskLayout
          state={state}
          setState={setState}
          stages={stages}
          mode="create"
          brandId={brandId}
          clientId={clientId}
        />
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border/60 bg-background/95 px-6 py-3 backdrop-blur">
        <Button variant="ghost" className="h-9" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button
          className="h-9"
          onClick={() => create.mutate()}
          disabled={!state.title.trim() || !state.stageId || create.isPending}
        >
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Criar
        </Button>
      </div>
    </>
  );
}

// ----------------- Edit -----------------

function EditBody({
  onOpenChange,
  brandId,
  clientId,
  pipelineId,
  stages,
  postId,
  invalidateKey,
}: EditProps) {
  const qc = useQueryClient();
  const getDetail = useServerFn(getPostDetailFn);
  const updatePost = useServerFn(updatePostFn);
  const deletePost = useServerFn(deletePostFn);
  const reworkPost = useServerFn(reworkPostFn);
  const uploadRef = useServerFn(uploadPostReferenceMediaFn);
  const removeRef = useServerFn(removePostReferenceMediaFn);
  const signRefs = useServerFn(signPostReferenceMediaFn);

  const { data } = useSuspenseQuery({
    queryKey: ["post-detail", postId],
    queryFn: () => getDetail({ data: { postId } }),
  });

  const post = data.post;
  const [state, setState] = useState(() => stateFromPost(post, stages));
  // Initial destinations hydrate no primeiro render (state inicial).
  useEffect(() => {
    setState((prev) =>
      prev.destinations.length === 0 && (data.destinations ?? []).length > 0
        ? { ...prev, destinations: data.destinations }
        : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setState(stateFromPost(post, stages, data.destinations ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  const refs = Array.isArray(post.reference_media) ? post.reference_media : [];
  const reviewStatus = post.review_status ?? "pending";
  const aiPhase = post.ai_phase ?? null;

  const refsKey = refs.map((r) => r.path).join("|");
  useEffect(() => {
    const paths = refs.map((r) => r.path).filter(Boolean);
    if (paths.length === 0) {
      setSignedUrls({});
      return;
    }
    let cancelled = false;
    signRefs({ data: { paths } }).then((res) => {
      if (!cancelled) setSignedUrls(res.urls);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey]);

  const save = useMutation({
    mutationFn: async () => {
      await updatePost({
        data: {
          postId,
          patch: {
            title: state.title.trim(),
            copy: state.copy.trim() || null,
            internal_briefing: state.internalBriefing.trim() || null,
            client_briefing: state.clientBriefing.trim() || null,
            script: state.script.trim() ? [{ cena: 1, fala: state.script.trim() }] : null,
            channels: state.channels as never,
            target_connection_ids: state.targetConnectionIds,
            format: state.format || null,
            priority: state.priority === "none" ? null : state.priority,
            tags: state.tags,
            visible_in_portal: state.visibleInPortal,
            scheduled_at: fromLocalInputValue(state.scheduledAt),
            remind_at: fromLocalInputValue(state.remindAt),
            stage_id: state.stageId || null,
            assignee_id: state.assigneeId,
            project_id: state.projectId,
          },
          destinations: state.destinations,
        },
      });
    },
    onSuccess: () => {
      toast.success("Tarefa atualizada");
      qc.invalidateQueries({ queryKey: invalidateKey });
      qc.invalidateQueries({ queryKey: ["post-detail", postId] });
      qc.invalidateQueries({ queryKey: ["projects", brandId] });
      if (state.projectId)
        qc.invalidateQueries({ queryKey: ["project", brandId, state.projectId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  const remove = useMutation({
    mutationFn: () => deletePost({ data: { postId } }),
    onSuccess: () => {
      toast.success("Tarefa excluída");
      qc.invalidateQueries({ queryKey: invalidateKey });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  const rework = useMutation({
    mutationFn: (notes: string) => reworkPost({ data: { postId, notes } }),
    onSuccess: () => {
      toast.success("Enviado para refação");
      qc.invalidateQueries({ queryKey: invalidateKey });
      qc.invalidateQueries({ queryKey: ["post-detail", postId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  const approveOnly = useMutation({
    mutationFn: () => updatePost({ data: { postId, patch: { review_status: "approved" } } }),
    onSuccess: () => {
      toast.success("Aprovado");
      qc.invalidateQueries({ queryKey: invalidateKey });
      qc.invalidateQueries({ queryKey: ["post-detail", postId] });
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  const scheduleFromKanban = useServerFn(saveScheduledPostFn);
  const approveAndSchedule = useMutation({
    mutationFn: async () => {
      if (!state.scheduledAt) throw new Error("Defina data/hora de agendamento");
      if (state.destinations.length === 0)
        throw new Error("Selecione ao menos uma conta de destino");
      // Primeiro marca aprovado (também sincroniza posts.stage para trigger).
      await updatePost({
        data: { postId, patch: { review_status: "approved" } },
      });
      // Agora enfileira via mesmo motor do wizard.
      return scheduleFromKanban({
        data: {
          postId,
          brandId,
          clientId,
          title: state.title.trim() || "Sem título",
          copy: state.copy ?? "",
          mediaPaths: refs.map((r) => r.path).filter(Boolean),
          hashtags: [],
          destinations: state.destinations,
          scheduledAt: fromLocalInputValue(state.scheduledAt)!,
          action: "schedule",
        },
      });
    },
    onSuccess: () => {
      toast.success("Aprovado e agendado");
      qc.invalidateQueries({ queryKey: invalidateKey });
      qc.invalidateQueries({ queryKey: ["post-detail", postId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  // Autosave apenas do campo copy (Hook/Headline/Copy/CTA/Hashtags serializados)
  // para evitar perda de texto gerado por IA quando o drawer é fechado sem Save.
  const [copyAutosaveStatus, setCopyAutosaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const initialCopyRef = useRef(state.copy);
  useEffect(() => {
    initialCopyRef.current = flattenCopy(post.copy);
  }, [post.id, post.copy]);
  useEffect(() => {
    if (state.copy === initialCopyRef.current) return;
    setCopyAutosaveStatus("saving");
    const handle = setTimeout(async () => {
      try {
        await updatePost({
          data: { postId, patch: { copy: state.copy.trim() || null } },
        });
        initialCopyRef.current = state.copy;
        setCopyAutosaveStatus("saved");
        qc.invalidateQueries({ queryKey: ["post-detail", postId] });
      } catch {
        setCopyAutosaveStatus("idle");
      }
    }, 1200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.copy, postId]);

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const isImage = (f: File) => f.type.startsWith("image/");
      const isVideo = (f: File) => f.type.startsWith("video/");
      const existingCount = refs.length;
      let uploaded = 0;
      for (const file of files) {
        // Size guard on the client (server also enforces).
        const max = isVideo(file) ? 100 * 1024 * 1024 : 25 * 1024 * 1024;
        if (file.size > max) {
          toast.error(`${file.name}: excede o limite (${isVideo(file) ? "100 MB" : "25 MB"})`);
          continue;
        }
        if (!isImage(file) && !isVideo(file)) {
          toast.error(`${file.name}: formato não suportado`);
          continue;
        }
        try {
          const base64 = await fileToBase64(file);
          const res = await uploadRef({
            data: {
              postId,
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              base64,
            },
          });
          uploaded += 1;
          // Generate thumbnail (best-effort) and attach to the same entry.
          try {
            const thumb = await generateThumbnail(file);
            if (thumb) {
              const thumbB64 = await blobToBase64(thumb);
              await uploadRef({
                data: {
                  postId,
                  filename: `thumb-${file.name.replace(/\.[^.]+$/, "")}.webp`,
                  contentType: "image/webp",
                  base64: thumbB64,
                  variant: "thumb",
                  originalPath: res.path,
                },
              });
            }
          } catch (thumbErr) {
            console.warn("thumb failed", thumbErr);
          }
        } catch (err) {
          toast.error(`${file.name}: ${(err as Error).message ?? "falha ao enviar"}`);
        }
      }
      return { uploaded, totalAfter: existingCount + uploaded };
    },
    onSuccess: (r) => {
      if (r.uploaded > 0) {
        toast.success(r.uploaded === 1 ? "Mídia anexada" : `${r.uploaded} mídias anexadas`);
        // Auto-carrossel when ending with 2+ media (except Story format).
        const current = normalizeContentFormat(state.format);
        if (r.totalAfter >= 2 && current !== "stories") {
          if (current !== "carrossel") {
            setState((s) => ({ ...s, format: "carrossel" }));
            toast.info("Formato ajustado para Carrossel");
          }
        } else if (r.totalAfter <= 1 && current === "carrossel") {
          setState((s) => ({ ...s, format: "feed" }));
        }
      }
      qc.invalidateQueries({ queryKey: ["post-detail", postId] });
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  const removeMedia = useMutation({
    mutationFn: (path: string) => removeRef({ data: { postId, path } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["post-detail", postId] });
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  return (
    <>
      <div className="sticky top-0 z-10 space-y-3 border-b border-border/60 bg-background/95 px-6 pb-3 pt-4 backdrop-blur">
        <div className="flex items-start gap-3 pr-8">
          <div className="min-w-0 flex-1">
            <Input
              value={state.title}
              onChange={(e) => setState((p) => ({ ...p, title: e.target.value }))}
              placeholder="Nome do post"
              className="h-9 border-0 bg-transparent px-0 text-base font-semibold tracking-tight shadow-none focus-visible:ring-0"
            />
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {reviewStatus === "pending" && aiPhase === "idea" ? (
                <Badge
                  variant="outline"
                  className="rounded-md border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                >
                  Aguardando aprovação
                </Badge>
              ) : null}
              {aiPhase === "copy_running" ? (
                <Badge
                  variant="outline"
                  className="rounded-md border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                >
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Gerando copy
                </Badge>
              ) : null}
              {aiPhase === "copy_ready" ? (
                <Badge
                  variant="outline"
                  className="rounded-md border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                >
                  Legenda gerada pelos agentes
                </Badge>
              ) : null}
              {aiPhase === "copy_failed_retryable" || aiPhase === "copy_failed" ? (
                <Badge
                  variant="outline"
                  className="rounded-md border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                >
                  Geração pendente — pode tentar novamente
                </Badge>
              ) : null}
              {aiPhase === "copy_failed_permanent" ? (
                <Badge
                  variant="outline"
                  className="rounded-md border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                >
                  Geração bloqueada — verificar configuração
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.25fr)] items-center gap-2">
          <Select
            value={state.stageId}
            onValueChange={(v) => setState((p) => ({ ...p, stageId: v }))}
          >
            <SelectTrigger className="h-9 w-full min-w-0 gap-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AssigneeSelect
            brandId={brandId}
            value={state.assigneeId}
            onChange={(id) => setState((p) => ({ ...p, assigneeId: id }))}
          />
          <ProjectSelect
            brandId={brandId}
            clientId={clientId}
            value={state.projectId}
            onChange={(id) => setState((p) => ({ ...p, projectId: id }))}
            fallback={data.project}
          />
          <div className="flex items-center justify-end gap-1.5">
            {reviewStatus !== "approved" ? (
              <>
                <Button
                  size="sm"
                  onClick={() => approveOnly.mutate()}
                  disabled={approveOnly.isPending}
                  className="h-9 flex-1"
                >
                  {approveOnly.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Aprovar
                </Button>
                {state.scheduledAt && state.destinations.length > 0 ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => approveAndSchedule.mutate()}
                    disabled={approveAndSchedule.isPending}
                    className="h-9 whitespace-nowrap"
                    title="Aprova e agenda no calendário social"
                  >
                    {approveAndSchedule.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    + Agendar
                  </Button>
                ) : null}
              </>
            ) : (
              <Badge
                variant="outline"
                className="h-9 w-full justify-center rounded-md border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                <CheckCircle2 className="mr-1 h-3 w-3" /> Aprovado
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <TaskLayout
          state={state}
          setState={setState}
          stages={stages}
          mode="edit"
          postId={postId}
          createdAt={post.created_at}
          copyAutosaveStatus={copyAutosaveStatus}
          captionActions={
            !state.copy.trim() ||
            aiPhase === "copy_failed" ||
            aiPhase === "copy_failed_retryable" ||
            aiPhase === "copy_failed_permanent" ? (
              <RegenerateCaptionButton postId={postId} invalidateKey={invalidateKey} />
            ) : null
          }
          brandId={brandId}
          clientId={clientId}
          scheduleSlot={
            hasProposalTrack(post) ? (
              <ScheduleAgendaBlock
                post={post}
                brandId={brandId}
                clientId={clientId}
                invalidateKey={invalidateKey}
                postId={postId}
              />
            ) : null
          }
          mediaSlot={
            <MediaReferenceBlock
              refs={refs}
              signedUrls={signedUrls}
              fileInput={fileInput}
              onFiles={(fs) => upload.mutate(fs)}
              onRemove={(p) => removeMedia.mutate(p)}
              uploading={upload.isPending}
            />
          }
        />

        <div className="mt-6 space-y-5">
          <Separator />
          {post.design_brief ? (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" /> Briefing visual (IA)
              </Label>
              <DashboardPanelSurface className="bg-background/60 p-3 text-sm whitespace-pre-wrap">
                {post.design_brief}
              </DashboardPanelSurface>
            </div>
          ) : null}

          <Separator />
          <Timeline items={data.timeline} />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-background/95 px-6 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (confirm("Excluir esta tarefa?")) remove.mutate();
          }}
          disabled={remove.isPending}
        >
          <Trash2 className="mr-1.5 h-4 w-4" /> Excluir
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const notes = window.prompt("Descreva o ajuste solicitado (opcional):") ?? "";
              rework.mutate(notes);
            }}
            disabled={rework.isPending}
          >
            {rework.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Refazer
          </Button>
          <Button size="sm" className="h-9" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Salvar
          </Button>
        </div>
      </div>
    </>
  );
}

// ----------------- Shared UI -----------------

type TaskState = {
  title: string;
  stageId: string;
  assigneeId: string | null;
  channels: string[];
  targetConnectionIds: string[];
  format: string;
  destinations: Array<{ connectionId: string; channel: string; format: PlacementFormat }>;
  copy: string;
  internalBriefing: string;
  clientBriefing: string;
  script: string;
  scheduledAt: string;
  remindAt: string;
  priority: Priority | "none";
  tags: string[];
  visibleInPortal: boolean;
  projectId: string | null;
};

function emptyState(stageId: string): TaskState {
  return {
    title: "",
    stageId,
    assigneeId: null,
    channels: [],
    targetConnectionIds: [],
    format: "feed",
    destinations: [],
    copy: "",
    internalBriefing: "",
    clientBriefing: "",
    script: "",
    scheduledAt: "",
    remindAt: "",
    priority: "none",
    tags: [],
    visibleInPortal: false,
    projectId: null,
  };
}

// Formats ISO string into <input type="datetime-local"> value no fuso oficial
// (America/Sao_Paulo) — mesma leitura usada pelo calendário.
function toLocalInputValue(iso: string): string {
  return tzToLocalInputValue(iso);
}

function stateFromPost(
  post: BoardPost,
  stages: PipelineStage[],
  destinations: Array<{ connectionId: string; channel: string; format: PlacementFormat }> = [],
): TaskState {
  const scriptText =
    Array.isArray(post.script) && post.script.length > 0
      ? (post.script as ScriptScene[])
          .map((s) => s.fala ?? s.observacao ?? "")
          .filter(Boolean)
          .join("\n\n")
      : "";
  return {
    title: post.title ?? "",
    stageId: post.stage_id ?? stages[0]?.id ?? "",
    assigneeId: (post.assignee_id ?? null) as string | null,
    channels: (post.channels ?? []) as string[],
    targetConnectionIds: (post.target_connection_ids ?? []) as string[],
    format: normalizeContentFormat(post.format) ?? "",
    destinations,
    copy: flattenCopy(post.copy),
    internalBriefing: post.internal_briefing ?? "",
    clientBriefing: post.client_briefing ?? "",
    script: scriptText,
    scheduledAt: post.scheduled_at ? tzToLocalInputValue(post.scheduled_at) : "",
    remindAt: post.remind_at ? tzToLocalInputValue(post.remind_at) : "",
    priority: ["low", "medium", "high", "urgent"].includes(post.priority ?? "")
      ? (post.priority as Priority)
      : "none",
    tags: (post.tags ?? []) as string[],
    visibleInPortal: !!post.visible_in_portal,
    projectId: (post.project_id ?? null) as string | null,
  };
}

function TaskLayout({
  state,
  setState,
  stages,
  mode,
  postId,
  createdAt,
  copyAutosaveStatus,
  captionActions,
  mediaSlot,
  scheduleSlot,
  brandId,
  clientId,
}: {
  state: TaskState;
  setState: (fn: (prev: TaskState) => TaskState) => void;
  stages: PipelineStage[];
  mode: "create" | "edit";
  postId?: string;
  createdAt?: string | null;
  copyAutosaveStatus?: "idle" | "saving" | "saved";
  captionActions?: React.ReactNode;
  mediaSlot?: ReactNode;
  scheduleSlot?: ReactNode;
  brandId?: string;
  clientId?: string;
}) {
  const [tagInput, setTagInput] = useState("");
  const { role } = useAccessRole();
  // Fonte única: client_social_accounts → social_connections (canais do cliente).
  const listClientChannels = useServerFn(listClientLinkedChannelsFn);
  const clientChannelsQ = useQuery({
    enabled: !!(brandId && clientId),
    queryKey: ["client-linked-channels", brandId, clientId],
    queryFn: () => listClientChannels({ data: { brandId: brandId!, clientId: clientId! } }),
    staleTime: 30_000,
  });
  const assignedConnections = clientChannelsQ.data ?? [];
  const set = <K extends keyof TaskState>(key: K, value: TaskState[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));
  const toggleChannel = (id: string) =>
    setState((prev) => ({
      ...prev,
      channels: prev.channels.includes(id)
        ? prev.channels.filter((c) => c !== id)
        : [...prev.channels, id],
    }));
  const toggleTargetConnection = (row: LinkedChannel) =>
    setState((prev) => {
      const has = prev.destinations.some((d) => d.connectionId === row.connectionId);
      const nextDests = has
        ? prev.destinations.filter((d) => d.connectionId !== row.connectionId)
        : [
            ...prev.destinations,
            {
              connectionId: row.connectionId,
              channel: row.channel,
              format: normalizeContentFormat(prev.format) ?? "feed",
            },
          ];
      const nextIds = nextDests.map((d) => d.connectionId);
      const nextChannels = Array.from(new Set(nextDests.map((d) => d.channel)));
      return {
        ...prev,
        destinations: nextDests,
        targetConnectionIds: nextIds,
        channels: nextChannels,
      };
    });
  const setDestinationFormat = (connectionId: string, format: PlacementFormat) =>
    setState((prev) => ({
      ...prev,
      destinations: prev.destinations.map((d) =>
        d.connectionId === connectionId ? { ...d, format } : d,
      ),
    }));
  const addTag = () => {
    const v = tagInput.trim();
    if (!v) return;
    setState((prev) => (prev.tags.includes(v) ? prev : { ...prev, tags: [...prev.tags, v] }));
    setTagInput("");
  };
  const removeTag = (t: string) =>
    setState((prev) => ({ ...prev, tags: prev.tags.filter((x) => x !== t) }));

  return (
    <div className="space-y-6">
      <div className="space-y-5">
        {mode === "create" ? (
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Título *
            </Label>
            <Input
              value={state.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Nome da tarefa..."
              autoFocus
            />
          </div>
        ) : null}

        {assignedConnections.length > 0 ? (
          <div className="space-y-2">
            <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Vai publicar? Selecione a conta de destino
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {assignedConnections.map((row) => {
                const meta = CHANNELS.find((c) => c.id === row.channel);
                const Icon = meta?.icon;
                const dest = state.destinations.find((d) => d.connectionId === row.connectionId);
                const active = !!dest;
                return (
                  <div key={row.connectionId} className="inline-flex items-center">
                    <button
                      type="button"
                      onClick={() => toggleTargetConnection(row)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition ${
                        active
                          ? (CHANNEL_STYLES[row.channel] ??
                            "border-primary bg-primary/10 text-foreground")
                          : "border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground"
                      } ${active ? "rounded-r-none border-r-0" : ""}`}
                      title={row.accountLabel ?? row.channel}
                    >
                      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                      <span className="truncate max-w-[140px]">
                        {row.accountLabel ?? meta?.label ?? row.channel}
                      </span>
                    </button>
                    {active ? (
                      <Select
                        value={dest!.format}
                        onValueChange={(v) =>
                          setDestinationFormat(row.connectionId, v as PlacementFormat)
                        }
                      >
                        <SelectTrigger className="h-8 rounded-l-none border-l border-border/60 bg-background/60 px-2 text-[11px] font-medium text-muted-foreground">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTENT_FORMATS.map((f) => (
                            <SelectItem key={f} value={f}>
                              {CONTENT_FORMAT_LABEL[f]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : brandId && clientId && !clientChannelsQ.isLoading ? (
          <div className="space-y-1.5 rounded-md border border-dashed p-3">
            <p className="text-xs text-muted-foreground">Nenhum canal vinculado a este cliente.</p>
            {role === "admin" ? (
              <Link
                to="/customers/$customerId"
                params={{ customerId: clientId }}
                search={{ tab: "publicacoes" }}
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Vincular canal
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            Formato
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {CONTENT_FORMATS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => set("format", f)}
                className={`h-8 rounded-md border px-3 text-xs font-medium transition ${
                  state.format === f
                    ? (FORMAT_STYLES[f] ?? "border-primary bg-primary/10 text-foreground")
                    : "border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground"
                }`}
              >
                {CONTENT_FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        {mediaSlot ? <div>{mediaSlot}</div> : null}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Legenda
            </Label>
            {captionActions}
          </div>
          <Textarea
            value={state.copy}
            onChange={(e) => set("copy", e.target.value)}
            rows={14}
            placeholder="Legenda completa da peça (abertura, desenvolvimento, CTA e hashtags)…"
            className="min-h-[260px] text-sm leading-relaxed"
          />
          {mode === "edit" ? (
            <div className="flex justify-end px-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              {copyAutosaveStatus === "saving"
                ? "Salvando…"
                : copyAutosaveStatus === "saved"
                  ? "Salvo automaticamente"
                  : ""}
            </div>
          ) : null}
        </div>

        <Tabs defaultValue="internal" className="w-full">
          <TabsList variant="grid" className="grid w-full grid-cols-3">
            <TabsTrigger value="internal">Briefing interno</TabsTrigger>
            <TabsTrigger value="client">Briefing cliente</TabsTrigger>
            <TabsTrigger value="script">Roteiro</TabsTrigger>
          </TabsList>
          <TabsContent value="internal">
            <Textarea
              value={state.internalBriefing}
              onChange={(e) => set("internalBriefing", e.target.value)}
              rows={5}
              placeholder="Apenas equipe interna..."
            />
          </TabsContent>
          <TabsContent value="client">
            <Textarea
              value={state.clientBriefing}
              onChange={(e) => set("clientBriefing", e.target.value)}
              rows={5}
              placeholder="Visível no portal do cliente..."
            />
          </TabsContent>
          <TabsContent value="script" className="space-y-2">
            <Textarea
              value={state.script}
              onChange={(e) => set("script", e.target.value)}
              rows={5}
              placeholder="Roteiro / script do vídeo..."
            />
          </TabsContent>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border/50 pt-5">
        {mode === "create" ? (
          <div className="space-y-1.5">
            <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
              Etapa
            </Label>
            <Select value={state.stageId} onValueChange={(v) => set("stageId", v)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {scheduleSlot ? <div className="col-span-2">{scheduleSlot}</div> : null}

        <div className="space-y-1.5">
          <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            Data de publicação
          </Label>
          <Input
            type="datetime-local"
            value={state.scheduledAt}
            onChange={(e) => set("scheduledAt", e.target.value)}
          />
          {mode === "edit" && createdAt ? (
            <p className="text-[11px] text-muted-foreground">
              Criado em{" "}
              {new Date(createdAt).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            Lembrete <span className="normal-case text-muted-foreground/70">(opcional)</span>
          </Label>
          <Input
            type="datetime-local"
            value={state.remindAt}
            onChange={(e) => set("remindAt", e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Você receberá uma notificação no sistema neste horário.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            Prioridade
          </Label>
          <Select
            value={state.priority}
            onValueChange={(v) => set("priority", v as Priority | "none")}
          >
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-zinc-400" />
                  Sem prioridade
                </span>
              </SelectItem>
              <SelectItem value="low">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  Baixa
                </span>
              </SelectItem>
              <SelectItem value="medium">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  Média
                </span>
              </SelectItem>
              <SelectItem value="high">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  Alta
                </span>
              </SelectItem>
              <SelectItem value="urgent">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-600" />
                  Urgente
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
            Tags
          </Label>
          <div className="flex flex-wrap gap-1">
            {state.tags.map((t) => (
              <Badge
                key={t}
                variant="secondary"
                className="h-6 cursor-pointer rounded-md border border-border/60 bg-background/60 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => removeTag(t)}
              >
                {t} ×
              </Badge>
            ))}
          </div>
          <div className="flex gap-1">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="Adicionar tag"
              className="h-8 text-xs"
            />
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={addTag}>
              +
            </Button>
          </div>
        </div>

        <div className="col-span-2 grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/60 px-3 py-2">
            <Label className="text-xs">Visível no portal</Label>
            <Switch
              checked={state.visibleInPortal}
              onCheckedChange={(v) => set("visibleInPortal", v)}
            />
          </div>
          {mode === "edit" && postId ? <ApprovalLinkSection postId={postId} /> : null}
        </div>
      </div>
    </div>
  );
}

// ----------------- Sub-sections (edit only) -----------------

const VERB_LABELS: Record<string, string> = {
  created: "Criado",
  updated: "Atualizado",
  stage_changed: "Estágio alterado",
  approved: "Aprovado",
  rework_requested: "Refação solicitada",
  media_uploaded: "Mídia anexada",
  media_removed: "Mídia removida",
  media_generated: "Mídia gerada por IA",
  assignee_changed: "Responsável alterado",
  scheduled: "Agendado",
  published: "Publicado",
  copy_generated: "Copy gerada",
  design_generated: "Design gerado",
  ai_phase_started: "Fase de IA iniciada",
  ai_phase_completed: "Fase de IA concluída",
  comment_added: "Comentário adicionado",
  approval_link_created: "Link de aprovação criado",
  approval_link_revoked: "Link de aprovação revogado",
  client_approved: "Aprovado pelo cliente",
  client_rejected: "Rejeitado pelo cliente",
};

function translateVerb(v: string): string {
  return VERB_LABELS[v] ?? v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function initialsOf(name: string | null): string {
  if (!name) return "?";
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/**
 * Só aparece quando a geração automática dos agentes não concluiu a legenda.
 * Reexecuta o MESMO orquestrador da materialização da pauta (agent_prompts).
 */
function RegenerateCaptionButton({
  postId,
  invalidateKey,
}: {
  postId: string;
  invalidateKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const run = useServerFn(regeneratePostContentFn);
  const mut = useMutation({
    mutationFn: () => run({ data: { postId, force: true } }),
    onSuccess: () => {
      toast.success("Legenda gerada pelos agentes");
      qc.invalidateQueries({ queryKey: invalidateKey });
      qc.invalidateQueries({ queryKey: ["post-detail", postId] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Falha ao gerar a legenda"),
  });
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 text-xs"
      disabled={mut.isPending}
      onClick={() => mut.mutate()}
    >
      {mut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {mut.isPending ? "Gerando…" : "Gerar legenda"}
    </Button>
  );
}

function Timeline({ items }: { items: PostTimelineEvent[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem eventos registrados.</p>;
  }
  return (
    <div>
      <p className="mb-2 text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
        Histórico
      </p>
      <ul className="space-y-2 text-sm">
        {items.map((ev) => {
          const when = new Date(ev.created_at).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <li
              key={ev.id}
              className="flex items-start gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5"
            >
              <Badge
                variant="secondary"
                className="mt-0.5 shrink-0 rounded-md border border-border/60 bg-card font-normal"
              >
                {translateVerb(ev.verb)}
              </Badge>
              <div className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
                {ev.actor_avatar ? (
                  <img
                    src={ev.actor_avatar}
                    alt={ev.actor_name ?? ""}
                    className="h-5 w-5 shrink-0 rounded-full object-cover"
                  />
                ) : ev.actor_name ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                    {initialsOf(ev.actor_name)}
                  </span>
                ) : null}
                <span className="truncate">
                  {ev.actor_name ? (
                    <>
                      <span className="text-foreground">{ev.actor_name}</span>
                      {" · "}
                    </>
                  ) : null}
                  {when}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ApprovalLinkSection({ postId }: { postId: string }) {
  const qc = useQueryClient();
  const listTokens = useServerFn(listApprovalTokensFn);
  const createTok = useServerFn(createApprovalTokenFn);
  const revokeTok = useServerFn(revokeApprovalTokenFn);

  const q = useQuery({
    queryKey: ["approval-tokens", postId],
    queryFn: () => listTokens({ data: { postId } }),
  });

  const create = useMutation({
    mutationFn: () => createTok({ data: { postId, expiresInDays: 14 } }),
    onSuccess: () => {
      toast.success("Link de aprovação gerado");
      qc.invalidateQueries({ queryKey: ["approval-tokens", postId] });
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });
  const revoke = useMutation({
    mutationFn: (tokenId: string) => revokeTok({ data: { tokenId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["approval-tokens", postId] }),
    onError: (e: Error) => toast.error(describeError(e)),
  });

  const active = useMemo(
    () =>
      (q.data ?? []).filter(
        (t) => !t.revoked_at && (!t.expires_at || new Date(t.expires_at).getTime() > Date.now()),
      ),
    [q.data],
  );

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-background/60 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-xs">
          <Link2 className="h-3.5 w-3.5" /> Aprovação externa
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-xs"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          {create.isPending ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Link2 className="mr-1 h-3 w-3" />
          )}
          Gerar link
        </Button>
      </div>
      {active.length > 0 ? (
        <ul className="space-y-1.5">
          {active.map((t) => {
            const url =
              typeof window !== "undefined"
                ? `${window.location.origin}/approval/${t.token}`
                : `/approval/${t.token}`;
            return (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1 text-[11px]"
              >
                <code className="flex-1 truncate font-mono">{url}</code>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => {
                    void navigator.clipboard.writeText(url);
                    toast.success("Link copiado");
                  }}
                  title="Copiar"
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded-md p-1 text-destructive hover:bg-destructive/10"
                  onClick={() => revoke.mutate(t.id)}
                  title="Revogar"
                >
                  <ShieldX className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ----------------- Legenda (copy única) -----------------

// Compatibilidade: copies antigas foram salvas com marcadores de seção
// (### GANCHO / ### HEADLINE / ### COPY / ### CTA / ### HASHTAGS). A nova UI
// trabalha com uma legenda única, então achatamos o texto ao carregar sem
// destruir nada no banco.
const COPY_SECTION_RE = /^###\s+(?:GANCHO|HEADLINE|COPY|CTA|HASHTAGS)\s*$/gim;

function flattenCopy(raw: string | null | undefined): string {
  if (!raw) return "";
  if (!/^###\s+/m.test(raw)) return raw;
  return raw
    .split(COPY_SECTION_RE)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

// ---------------- Media helpers ----------------

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

// Produces a ~640px square-fit WebP thumbnail from an image or a video's
// first frame. Returns null on any failure (best-effort).
async function generateThumbnail(file: File): Promise<Blob | null> {
  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) return null;

  const targetMax = 640;

  const drawToCanvas = (
    source: HTMLImageElement | HTMLVideoElement,
    w: number,
    h: number,
  ): Promise<Blob | null> => {
    const scale = Math.min(1, targetMax / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);
    ctx.drawImage(source, 0, 0, cw, ch);
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/webp", 0.8));
  };

  const url = URL.createObjectURL(file);
  try {
    if (isImage) {
      const img = new Image();
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image load failed"));
      });
      return await drawToCanvas(img, img.naturalWidth, img.naturalHeight);
    }
    // Video: capture the first frame
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        try {
          video.currentTime = Math.min(0.1, video.duration || 0.1);
        } catch {
          resolve();
        }
      };
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("video load failed"));
    });
    return await drawToCanvas(video, video.videoWidth, video.videoHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------- Instagram-style carousel preview ----------------

type RefEntry = {
  path: string;
  name?: string;
  type?: string;
  size?: number;
  thumb_path?: string | null;
  pruned?: boolean | null;
};

function InstagramPreview({
  refs,
  urls,
  onRemove,
}: {
  refs: RefEntry[];
  urls: Record<string, string>;
  onRemove: (path: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  // MediaReferenceBlock is declared below to keep RefEntry type in scope.
  useEffect(() => {
    if (idx > refs.length - 1) setIdx(Math.max(0, refs.length - 1));
  }, [refs.length, idx]);

  if (refs.length === 0) return null;
  const current = refs[idx];
  const isVideo = (current.type ?? "").startsWith("video/");
  const originalUrl = urls[current.path];
  const thumbUrl = current.thumb_path ? urls[current.thumb_path] : null;
  const displayUrl = current.pruned && thumbUrl ? thumbUrl : (originalUrl ?? thumbUrl ?? null);

  return (
    <div className="space-y-2">
      <div className="relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-border/60 bg-foreground">
        <div className="relative aspect-square w-full">
          {displayUrl ? (
            isVideo && !current.pruned ? (
              <video
                key={current.path}
                src={displayUrl}
                controls
                playsInline
                className="h-full w-full object-cover"
                poster={thumbUrl ?? undefined}
              />
            ) : (
              <img
                src={displayUrl}
                alt={current.name ?? current.path}
                className="h-full w-full object-cover"
              />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          )}

          {isVideo && current.pruned ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/40">
              <Play className="h-10 w-10 text-background/90" />
            </div>
          ) : null}

          {refs.length > 1 ? (
            <>
              <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-foreground/70 px-2 py-0.5 text-[11px] font-medium text-background">
                <Images className="h-3 w-3" /> {idx + 1}/{refs.length}
              </span>
              {idx > 0 ? (
                <button
                  type="button"
                  onClick={() => setIdx((i) => Math.max(0, i - 1))}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md bg-foreground/60 p-1 text-background transition hover:bg-foreground/80"
                  aria-label="Anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : null}
              {idx < refs.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setIdx((i) => Math.min(refs.length - 1, i + 1))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-foreground/60 p-1 text-background transition hover:bg-foreground/80"
                  aria-label="Próximo"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}
            </>
          ) : null}

          <button
            type="button"
            onClick={() => onRemove(current.path)}
            title="Remover mídia"
            className="absolute left-2 top-2 rounded-md bg-foreground/70 p-1 text-background transition hover:bg-destructive hover:text-destructive-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {refs.length > 1 ? (
          <div className="flex items-center justify-center gap-1 bg-foreground/80 py-2">
            {refs.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === idx ? "w-4 bg-background" : "w-1.5 bg-background/40"
                }`}
                aria-label={`Ir para ${i + 1}`}
              />
            ))}
          </div>
        ) : null}
      </div>

      {refs.length > 1 ? (
        <div className="mx-auto flex max-w-sm gap-1.5 overflow-x-auto pb-1">
          {refs.map((r, i) => {
            const t = r.thumb_path ? urls[r.thumb_path] : urls[r.path];
            const isVid = (r.type ?? "").startsWith("video/");
            return (
              <button
                key={r.path}
                type="button"
                onClick={() => setIdx(i)}
                className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border/60 transition ${
                  i === idx ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100"
                }`}
              >
                {t ? (
                  <img src={t} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-muted" />
                )}
                {isVid ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-foreground/30">
                    <Play className="h-3.5 w-3.5 text-background" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <p className="text-center text-[11px] text-muted-foreground">
        {refs.length === 1
          ? "Preview estilo Instagram · adicione mais para virar Carrossel"
          : `Carrossel de ${refs.length} · arquivos originais mantidos por 30 dias após publicação`}
      </p>
    </div>
  );
}

function MediaReferenceBlock({
  refs,
  signedUrls,
  fileInput,
  onFiles,
  onRemove,
  uploading,
}: {
  refs: RefEntry[];
  signedUrls: Record<string, string>;
  fileInput: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: File[]) => void;
  onRemove: (path: string) => void;
  uploading: boolean;
}) {
  const [dragActive, setDragActive] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <ImageIcon className="h-3.5 w-3.5" /> Mídias de referência
        <span className="text-xs font-normal text-muted-foreground">
          (feeds, stories, moodboard)
        </span>
      </Label>
      <DashboardPanelSurface
        className={cn(
          "p-3 transition",
          dragActive && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
        )}
        onDragEnter={(e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer?.types?.includes("Files")) setDragActive(true);
        }}
        onDragOver={(e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer?.types?.includes("Files")) {
            e.dataTransfer.dropEffect = "copy";
            setDragActive(true);
          }
        }}
        onDragLeave={(e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={(e: React.DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
          const files = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
            /^(image|video)\//.test(f.type),
          );
          if (files.length > 0) onFiles(files);
        }}
      >
        {refs.length === 0 ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-6 text-xs transition",
              dragActive
                ? "border-primary/70 bg-primary/5 text-foreground"
                : "border-border/60 bg-card/40 text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <Upload className="h-4 w-4" />
            <span className="font-medium">Arraste e solte aqui</span>
            <span>ou clique para anexar. Ao inserir 2 ou mais, o post vira Carrossel.</span>
          </button>
        ) : (
          <InstagramPreview refs={refs} urls={signedUrls} onRemove={onRemove} />
        )}
        <div className="mt-2 flex justify-end">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            accept="image/*,video/*"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              if (fs.length > 0) onFiles(fs);
              e.target.value = "";
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Anexar
            </Button>
          </div>
        </div>
      </DashboardPanelSurface>
    </div>
  );
}

/**
 * Agenda proposta pela pauta — mesma fonte lida pelo calendário.
 * Editar aqui atualiza `proposed_at` via as funções de agenda (nunca
 * grava `scheduled_at`, que é a publicação efetiva).
 */
function ScheduleAgendaBlock({
  post,
  brandId,
  clientId,
  postId,
  invalidateKey,
}: {
  post: {
    proposed_at?: string | null;
    scheduled_at?: string | null;
    published_at?: string | null;
    schedule_status?: string | null;
    schedule_client_comment?: string | null;
  };
  brandId: string;
  clientId: string;
  postId: string;
  invalidateKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const updateSlot = useServerFn(updateScheduleSlotFn);
  const clearSlot = useServerFn(clearScheduleSlotFn);
  const schedule = scheduleDisplay(post);
  const [value, setValue] = useState(
    post.proposed_at ? tzToLocalInputValue(post.proposed_at) : "",
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: invalidateKey });
    qc.invalidateQueries({ queryKey: ["post-detail", postId] });
    qc.invalidateQueries({ queryKey: ["calendar-board"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const iso = fromLocalInputValue(value);
      if (!iso) throw new Error("Informe data e hora da agenda");
      await updateSlot({ data: { brandId, clientId, postId, proposedAt: iso } });
    },
    onSuccess: () => {
      toast.success("Agenda atualizada");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clear = useMutation({
    mutationFn: async () => {
      await clearSlot({ data: { brandId, clientId, postId } });
    },
    onSuccess: () => {
      setValue("");
      toast.success("Agenda removida");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground">
          Agenda da pauta
        </Label>
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wider ${schedule.chip}`}
        >
          {schedule.stateLabel}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 w-[220px]"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={save.isPending || !value}
          onClick={() => save.mutate()}
        >
          Salvar agenda
        </Button>
        {post.proposed_at ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
          >
            Remover
          </Button>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {schedule.iso
          ? `Data considerada no calendário: ${scheduleFullLabel(schedule.iso)} (America/Sao_Paulo).`
          : "Sem data — a peça aparece na faixa “Sem data” do calendário."}
      </p>
      {post.schedule_client_comment ? (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Cliente pediu alteração: {post.schedule_client_comment}
        </p>
      ) : null}
    </div>
  );
}
