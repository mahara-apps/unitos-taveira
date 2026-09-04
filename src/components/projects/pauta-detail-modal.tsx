/**
 * Modal de resumo de um item de pauta (job virtual "Pautas") dentro da tela do
 * projeto. Objetivo: gestão sem trocar de página — a ida para Conteúdo passa a
 * ser uma saída opcional no rodapé.
 *
 * SOMENTE LEITURA para o conteúdo da peça (briefing, legenda, agendamento, rede,
 * formato, local de postagem). Os únicos controles editáveis são os que já
 * existiam: dono e status da tarefa de produção.
 */
import { useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { listTasksFn, updateTaskFn, type TaskRow } from "@/lib/tasks.functions";
import { getPautaDetailFn, type PautaDetail } from "@/lib/projects.functions";
import { contentFormatLabel } from "@/lib/content-formats";
import { APP_TIMEZONE } from "@/lib/timezone";
import { AssigneePicker, type TeamOption } from "./assignee-picker";
import { StatusPicker } from "./status-picker";
import { CommentThread } from "./comment-thread";
import { WorkLinks } from "@/components/ui/work-links";
import { WorkItemRow, formatShortDate, isOverdue } from "./work-item-row";

export type PautaDetailItem = {
  /** Chave estável do item (topic_id ou post id quando fora da pauta). */
  key: string;
  title: string;
  coverUrl: string | null;
  channelLabel: string | null;
  formatLabel: string | null;
  stateLabel: string;
  stateClassName: string;
  scheduledAt: string | null;
  postId: string | null;
  /** Tópico da pauta mensal (ausente em peças criadas fora da pauta). */
  topicId?: string | null;
  /** Item sem tópico de pauta (peça criada fora da pauta). */
  outOfPlan?: boolean;
  planId?: string | null;
  /** Metadados usados na linha da lista. */
  tasksCount?: number;
  assigneeName?: string | null;
};

const CHANNEL_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  threads: "Threads",
  pinterest: "Pinterest",
  whatsapp: "WhatsApp",
  blog: "Blog",
  email: "E-mail",
  site: "Site",
};

const SCHEDULE_STATUS_LABELS: Record<string, string> = {
  none: "Sem agenda",
  proposed: "Agenda proposta",
  approved: "Agenda aprovada",
  rejected: "Agenda recusada",
  scheduled: "Agendado",
  published: "Publicado",
};

const PLACEMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  publishing: "Publicando",
  published: "Publicado",
  failed: "Falhou",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: APP_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${dateTimeFmt.format(d)} (BRT)`;
}

function channelLabel(c: string): string {
  return CHANNEL_LABELS[c] ?? c;
}

/** Normaliza `references` / `reference_media` (Json livre) em links exibíveis. */
type RefEntry = { url: string | null; label: string; isImage: boolean };

function normalizeRefs(value: unknown): RefEntry[] {
  const out: RefEntry[] = [];
  const push = (raw: unknown) => {
    if (!raw) return;
    if (typeof raw === "string") {
      const isUrl = /^https?:\/\//i.test(raw);
      out.push({
        url: isUrl ? raw : null,
        label: raw,
        isImage: /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(raw),
      });
      return;
    }
    if (typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      const url =
        (o["url"] as string | undefined) ??
        (o["src"] as string | undefined) ??
        (o["link"] as string | undefined) ??
        null;
      const label =
        (o["title"] as string | undefined) ??
        (o["name"] as string | undefined) ??
        (o["caption"] as string | undefined) ??
        url ??
        "Referência";
      const type = String(o["type"] ?? o["mime_type"] ?? "");
      out.push({
        url: url ?? null,
        label,
        isImage:
          type.startsWith("image") || (!!url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url)),
      });
    }
  };
  if (Array.isArray(value)) value.forEach(push);
  else push(value);
  return out.filter((r) => r.url || r.label);
}

/** Converte `script` (Json) em texto legível. */
function scriptToText(script: unknown): string | null {
  if (!script) return null;
  if (typeof script === "string") return script.trim() || null;
  if (Array.isArray(script)) {
    const lines = script
      .map((s) => {
        if (typeof s === "string") return s;
        if (s && typeof s === "object") {
          const o = s as Record<string, unknown>;
          return [o["scene"], o["title"], o["text"], o["description"]]
            .filter((v) => typeof v === "string" && v)
            .join(" — ");
        }
        return "";
      })
      .filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : null;
  }
  if (typeof script === "object") {
    const o = script as Record<string, unknown>;
    const text = [o["hook"], o["body"], o["cta"], o["text"]]
      .filter((v) => typeof v === "string" && v)
      .join("\n\n");
    return text || null;
  }
  return null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <span className="block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Section({
  title,
  children,
  hidden,
}: {
  title: string;
  children: ReactNode;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <section className="space-y-2">
      <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

function LongText({ text }: { text: string }) {
  return (
    <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 p-3 text-sm leading-relaxed">
      {text}
    </div>
  );
}

export function PautaDetailModal({
  open,
  onOpenChange,
  brandId,
  projectId,
  clientId,
  item,
  team,
  currentUserId,
  canEdit,
  onOpenTask,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  brandId: string;
  projectId: string;
  clientId: string | null;
  item: PautaDetailItem | null;
  team: TeamOption[];
  currentUserId?: string | null;
  canEdit: boolean;
  /** Abre o drawer de tarefa (mesmo usado na lista de tarefas do job). */
  onOpenTask?: (taskId: string) => void;
}) {
  const qc = useQueryClient();
  const listTasks = useServerFn(listTasksFn);
  const updateTask = useServerFn(updateTaskFn);
  const getDetail = useServerFn(getPautaDetailFn);

  const tasksQ = useQuery({
    queryKey: ["tasks", brandId, clientId ?? null, "all"],
    enabled: open && !!brandId,
    queryFn: () => listTasks({ data: { brandId, clientId: clientId ?? null, archive: "all" } }),
  });

  const detailQ = useQuery({
    queryKey: ["pauta-detail", brandId, projectId, item?.postId ?? null, item?.topicId ?? null],
    enabled: open && !!brandId && !!item && (!!item.postId || !!item.topicId),
    staleTime: 30_000,
    queryFn: () =>
      getDetail({
        data: {
          brandId,
          projectId,
          postId: item?.postId ?? null,
          topicId: item?.topicId ?? null,
        },
      }),
  });

  const detail = detailQ.data as PautaDetail | undefined;

  const tasks = useMemo(() => {
    const all = (tasksQ.data ?? []) as TaskRow[];
    if (!item?.postId) return [];
    return all.filter((t) => t.post_id === item.postId && t.project_id === projectId);
  }, [tasksQ.data, item?.postId, projectId]);

  const primary = tasks[0] ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks", brandId] });
    qc.invalidateQueries({ queryKey: ["job-tasks", brandId, projectId] });
    qc.invalidateQueries({ queryKey: ["project", brandId, projectId] });
  };

  const patchMut = useMutation({
    mutationFn: (v: { taskId: string; patch: Record<string, unknown> }) =>
      updateTask({ data: { brandId, taskId: v.taskId, patch: v.patch as never } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  if (!item) return null;

  const post = detail?.post ?? null;
  const topic = detail?.topic ?? null;
  const placements = detail?.placements ?? [];
  const ownerDisabled = !canEdit || !primary || patchMut.isPending;

  const channelText =
    post && post.channels.length > 0
      ? post.channels.map(channelLabel).join(", ")
      : (item.channelLabel ?? null);
  const formatText = post?.format ? contentFormatLabel(post.format) : (item.formatLabel ?? null);
  const scheduledText = fmtDateTime(post?.scheduled_at ?? item.scheduledAt);
  const refs = [...normalizeRefs(post?.references), ...normalizeRefs(post?.reference_media)];
  const scriptText = scriptToText(post?.script);
  const loading = detailQ.isLoading;

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={item.title}
      description={
        [channelText, formatText].filter(Boolean).join(" · ") ||
        (item.outOfPlan ? "Peça fora da pauta" : "Item da pauta")
      }
      headerExtra={
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] ${item.stateClassName}`}>
            {item.stateLabel}
          </Badge>
          {topic?.client_status && topic.client_status !== "pending" ? (
            <Badge variant="outline" className="text-[10px]">
              Cliente: {topic.client_status === "approved" ? "aprovado" : topic.client_status}
            </Badge>
          ) : null}
        </div>
      }
      footer={
        <>
          {item.planId && !item.outOfPlan ? (
            <Button asChild variant="ghost" size="sm" className="h-9">
              <Link to="/monthly-plan/$planId" params={{ planId: item.planId }}>
                Ver na pauta
              </Link>
            </Button>
          ) : null}
          {item.postId ? (
            <Button asChild variant="outline" size="sm" className="h-9">
              <Link to="/content" search={{ post: item.postId }}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir peça em Conteúdo
              </Link>
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        {/* Publicação — quando, onde e em que formato */}
        <div className="flex items-start gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
            {(post?.cover_url ?? item.coverUrl) ? (
              <img
                src={(post?.cover_url ?? item.coverUrl) as string}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImageIcon className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
            <Field label="Rede">
              <span className="block truncate text-sm">{channelText ?? "Não definida"}</span>
            </Field>
            <Field label="Formato">
              <span className="block truncate text-sm">{formatText ?? "Não definido"}</span>
            </Field>
            <Field label="Publicação">
              <span className="block text-sm tabular-nums">{scheduledText ?? "Sem data"}</span>
            </Field>
            <Field label="Prazo interno">
              <span className="block text-sm tabular-nums">
                {formatShortDate(primary?.due_at ?? null) ?? "—"}
              </span>
            </Field>
            {post?.schedule_status ? (
              <Field label="Agenda">
                <span className="block truncate text-sm">
                  {SCHEDULE_STATUS_LABELS[post.schedule_status] ?? post.schedule_status}
                </span>
              </Field>
            ) : null}
            {post?.priority ? (
              <Field label="Prioridade">
                <span className="block truncate text-sm">
                  {PRIORITY_LABELS[post.priority] ?? post.priority}
                </span>
              </Field>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {/* Local de postagem */}
        <Section title="Local de postagem" hidden={placements.length === 0}>
          <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
            {placements.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {p.connection_label ??
                    (p.connection_channel
                      ? channelLabel(p.connection_channel)
                      : "Conta não definida")}
                </span>
                {p.format ? (
                  <span className="text-[11px] text-muted-foreground">
                    {contentFormatLabel(p.format)}
                  </span>
                ) : null}
                {p.is_primary ? (
                  <Badge variant="outline" className="text-[10px]">
                    principal
                  </Badge>
                ) : null}
                {p.status ? (
                  <span className="text-[11px] text-muted-foreground">
                    {PLACEMENT_STATUS_LABELS[p.status] ?? p.status}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </Section>

        {/* Briefing */}
        <Section
          title="Briefing"
          hidden={
            !topic?.angle &&
            !topic?.rationale &&
            !topic?.target_audience &&
            !post?.internal_briefing &&
            !post?.client_briefing &&
            !post?.design_brief
          }
        >
          <div className="space-y-3">
            {topic?.angle ? (
              <Field label="Ângulo">
                <p className="text-sm leading-relaxed">{topic.angle}</p>
              </Field>
            ) : null}
            {topic?.target_audience ? (
              <Field label="Público-alvo">
                <p className="text-sm leading-relaxed">{topic.target_audience}</p>
              </Field>
            ) : null}
            {topic?.rationale ? (
              <Field label="Racional da pauta">
                <LongText text={topic.rationale} />
              </Field>
            ) : null}
            {post?.internal_briefing ? (
              <Field label="Briefing interno">
                <LongText text={post.internal_briefing} />
              </Field>
            ) : null}
            {post?.client_briefing ? (
              <Field label="Briefing do cliente">
                <LongText text={post.client_briefing} />
              </Field>
            ) : null}
            {post?.design_brief ? (
              <Field label="Brief de design">
                <LongText text={post.design_brief} />
              </Field>
            ) : null}
          </div>
        </Section>

        {/* Legenda / copy */}
        <Section
          title="Legenda"
          hidden={!post?.copy && !scriptText && (post?.tags?.length ?? 0) === 0}
        >
          <div className="space-y-3">
            {post?.copy ? <LongText text={post.copy} /> : null}
            {scriptText ? (
              <Field label="Roteiro">
                <LongText text={scriptText} />
              </Field>
            ) : null}
            {post && post.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {post.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">
                    #{t.replace(/^#/, "")}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </Section>

        {/* Referências */}
        <Section title="Referências" hidden={refs.length === 0}>
          <div className="flex flex-wrap gap-2">
            {refs.map((r, i) => (
              <div
                key={`${r.url ?? r.label}-${i}`}
                className="flex max-w-full items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2 py-1.5"
              >
                {r.isImage && r.url ? (
                  <img src={r.url} alt="" className="h-8 w-8 rounded object-cover" />
                ) : null}
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-[220px] truncate text-xs text-primary hover:underline"
                  >
                    {r.label}
                  </a>
                ) : (
                  <span className="max-w-[220px] truncate text-xs">{r.label}</span>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* Links enviados pela equipe e pelo cliente */}
        {item.topicId || item.postId ? (
          <Section title="Links e referências">
            <WorkLinks
              target={item.topicId ? "topic" : "post"}
              targetId={(item.topicId ?? item.postId) as string}
              title="Links"
              readOnly={!canEdit}
            />
          </Section>
        ) : null}

        {/* Devolutiva do cliente */}
        <Section title="Comentário do cliente" hidden={!topic?.client_comment}>
          <LongText text={topic?.client_comment ?? ""} />
        </Section>

        {/* Dono + status do item (grava na tarefa de produção) */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <Field label="Dono">
            <AssigneePicker
              value={primary?.assignee_id ?? null}
              options={team}
              disabled={ownerDisabled}
              onChange={(userId) =>
                primary && patchMut.mutate({ taskId: primary.id, patch: { assignee_id: userId } })
              }
            />
          </Field>
          {primary ? (
            <Field label="Status">
              <StatusPicker
                brandId={brandId}
                scope="task"
                value={primary.status_id}
                disabled={!canEdit || patchMut.isPending}
                onChange={(statusId) =>
                  patchMut.mutate({ taskId: primary.id, patch: { status_id: statusId } })
                }
              />
            </Field>
          ) : null}
          {!primary ? (
            <span className="text-[11px] text-muted-foreground">
              Dono disponível após a pauta virar produção.
            </span>
          ) : null}
        </div>

        {/* Tarefas de produção ligadas ao item */}
        <Section title="Tarefas de produção">
          {tasksQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="rounded-lg border border-border/60">
              <PanelEmptyState
                text="Nenhuma tarefa de produção vinculada a este item ainda."
                icon={null}
              />
            </div>
          ) : (
            <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
              {tasks.map((t) => (
                <WorkItemRow
                  key={t.id}
                  title={t.title}
                  done={t.done}
                  onOpen={onOpenTask ? () => onOpenTask(t.id) : undefined}
                  assignee={
                    <span className="hidden text-[11px] text-muted-foreground sm:inline">
                      {team.find((m) => m.user_id === t.assignee_id)?.full_name ?? "Sem dono"}
                    </span>
                  }
                  dateLabel={formatShortDate(t.due_at)}
                  overdue={isOverdue(t.due_at, t.done)}
                />
              ))}
            </div>
          )}
        </Section>

        {/* Observações do item */}
        <Section title="Observações">
          {primary ? (
            <CommentThread
              brandId={brandId}
              level="task"
              taskId={primary.id}
              currentUserId={currentUserId}
              placeholder="Registrar observação sobre esta pauta…"
            />
          ) : (
            <p className="text-[11px] text-muted-foreground">
              As observações ficam disponíveis quando o item vira tarefa de produção.
            </p>
          )}
        </Section>
      </div>
    </ExpandedModal>
  );
}
