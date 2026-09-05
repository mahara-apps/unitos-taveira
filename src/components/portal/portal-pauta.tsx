import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { usePortalApi, usePortalCanInteract } from "./portal-context";
import { EmptyState, ErrorState, ListSkeleton, formatDate } from "./portal-shared";
import type { PlanDecisionItem, PublicPlanTopic } from "@/lib/monthly-plan-client.types";
import { PLAN_PENDING_CLIENT_STATUS } from "@/lib/monthly-plan-client.types";

/**
 * Pauta do portal — mesmo fluxo real de `monthly_plans` (decisão item a item
 * enviada de uma vez, como o backend exige). Esta camada é só apresentação:
 * linguagem de cliente, progresso, filtros e detalhe do item.
 */

type Decision = PlanDecisionItem["decision"];
type Filter = "awaiting" | "approved" | "changes" | "all";

const DECISION_ERRORS: Record<string, string> = {
  feedback_required: "Descreva o motivo ou o que deseja ajustar.",
  item_comment_required: "Explique o motivo nas publicações rejeitadas ou com ajuste.",
  items_incomplete: "Revise todas as publicações antes de enviar.",
  invalid_topic: "Uma das publicações não pertence mais a esta pauta. Recarregue a página.",
  plan_not_pending: "Esta pauta já foi respondida.",
  plan_not_found: "Pauta não encontrada. Avise a agência.",
  plan_has_no_topics: "Esta pauta não tem publicações para aprovar. Avise a agência.",
  invalid_token: "Seu acesso expirou. Solicite um novo link à agência.",
  token_revoked: "Este acesso foi cancelado. Solicite um novo link à agência.",
  token_expired: "Este acesso expirou. Solicite um novo link à agência.",
  decision_items_failed: "Não conseguimos salvar as decisões. Tente novamente.",
  decision_failed: "Não conseguimos salvar sua decisão. Tente novamente em instantes.",
};

const FILTERS: Array<{ id: Filter; label: string }> = [

  { id: "awaiting", label: "Aguardando você" },
  { id: "approved", label: "Aprovadas" },
  { id: "changes", label: "Ajustes" },
  { id: "all", label: "Todas" },
];

const STATUS_LABEL: Record<Decision | "pending", string> = {
  pending: "Aguardando você",
  approved: "Aprovada",
  changes: "Ajustes solicitados",
  rejected: "Ajustes solicitados",
};

function statusTone(s: Decision | "pending") {
  if (s === "approved") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (s === "pending") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-sky-500/15 text-sky-600 dark:text-sky-400";
}

function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

/* --------------------------------- lista --------------------------------- */

export function PautaApprovals() {
  const api = usePortalApi();
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["portal", "plans", api.scopeKey], queryFn: () => api.plans() });

  if (openId) return <PautaDetail planId={openId} onBack={() => setOpenId(null)} />;
  if (q.isLoading) return <ListSkeleton />;
  if (q.isError)
    return (
      <ErrorState
        description="Não conseguimos carregar suas pautas agora."
        message={(q.error as Error)?.message}
        onRetry={() => q.refetch()}
      />
    );
  if (!q.data?.length)
    return (
      <EmptyState
        icon={Sparkles}
        title="Nenhuma pauta compartilhada"
        description="Quando a equipe enviar a pauta do mês para sua aprovação, ela aparece aqui."
      />
    );

  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
      {q.data.map((p) => {
        const awaiting = p.status === PLAN_PENDING_CLIENT_STATUS;
        return (
          <button
            key={p.id}
            onClick={() => setOpenId(p.id)}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
          >
            <div className="min-w-0 space-y-1">
              <div className="truncate text-sm font-medium">{p.title}</div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 capitalize">
                  <CalendarDays className="h-3 w-3" /> {monthLabel(p.created_at)}
                </span>
                <span>{p.topics} publicações previstas</span>
                {awaiting && p.pending > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {p.pending} aguardando você
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  awaiting
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {awaiting
                  ? "Aguardando você"
                  : p.client_decision_at
                    ? `Respondida em ${formatDate(p.client_decision_at)}`
                    : "Em preparação"}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------- detalhe -------------------------------- */

function PautaDetail({ planId, onBack }: { planId: string; onBack: () => void }) {
  const api = usePortalApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["portal", "plan", api.scopeKey, planId],
    queryFn: () => api.plan(planId),
  });
  const [items, setItems] = useState<Record<string, { decision: Decision; comment: string }>>({});
  const [feedback, setFeedback] = useState("");
  const [filter, setFilter] = useState<Filter>("awaiting");
  const [detailId, setDetailId] = useState<string | null>(null);

  const topics = useMemo(() => q.data?.topics ?? [], [q.data]);
  const editable = q.data?.plan.status === PLAN_PENDING_CLIENT_STATUS;

  type Row = {
    topic: PublicPlanTopic;
    decision: Decision | "pending";
    comment: string;
    staged: boolean;
  };

  const rows = useMemo<Row[]>(
    () =>
      topics.map((topic) => {
        const local = items[topic.id];
        const saved: Decision | "pending" = topic.client_status;
        const decision: Decision | "pending" = local?.decision ?? saved;
        return {
          topic,
          decision,
          comment: local?.comment ?? topic.client_comment ?? "",
          staged: Boolean(local),
        };
      }),
    [topics, items],
  );

  const counts = useMemo(
    () => ({
      total: rows.length,
      pending: rows.filter((r) => r.decision === "pending").length,
      approved: rows.filter((r) => r.decision === "approved").length,
      changes: rows.filter((r) => r.decision === "changes" || r.decision === "rejected").length,
    }),
    [rows],
  );

  const filtered = rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "awaiting"
        ? r.decision === "pending"
        : filter === "approved"
          ? r.decision === "approved"
          : r.decision === "changes" || r.decision === "rejected",
  );

  const decided = counts.total - counts.pending;
  const progress = counts.total ? Math.round((decided / counts.total) * 100) : 0;

  const canAct = usePortalCanInteract("pauta");
  const decide = useMutation({
    mutationFn: (payload: Parameters<typeof api.decidePlan>[0]) =>
      canAct ? api.decidePlan(payload) : Promise.reject(new Error("Este acesso é somente de acompanhamento.")),
    onSuccess: (res) => {
      toast.success(
        res.changes > 0
          ? `Pauta enviada — ${res.approved} aprovadas e ${res.changes} com ajustes solicitados.`
          : `Pauta aprovada — ${res.approved} publicações liberadas.`,
      );
      setItems({});
      setFeedback("");
      setDetailId(null);
      qc.invalidateQueries({ queryKey: ["portal", "plan", api.scopeKey, planId] });
      qc.invalidateQueries({ queryKey: ["portal", "plans", api.scopeKey] });
      qc.invalidateQueries({ queryKey: ["portal", "metrics", api.scopeKey] });
    },
    onError: (e: Error) =>
      toast.error(DECISION_ERRORS[e.message] ?? "Não foi possível registrar sua decisão."),

  });

  const setDecision = (topicId: string, decision: Decision, comment = "") =>
    setItems((prev) => ({ ...prev, [topicId]: { decision, comment } }));

  const submit = () => {
    const payload: PlanDecisionItem[] = rows.map((r) => ({
      topicId: r.topic.id,
      decision: r.decision === "pending" ? "approved" : r.decision,
      comment: r.decision === "approved" ? "" : r.comment,
    }));
    decide.mutate({ planId, decision: "per_item", feedback, items: payload });
  };

  const detailRow = rows.find((r) => r.topic.id === detailId) ?? null;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
        <ChevronLeft className="h-4 w-4" /> Voltar
      </Button>

      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState
          description="Não conseguimos carregar esta pauta agora."
          message={(q.error as Error)?.message}
          onRetry={() => q.refetch()}
        />
      ) : !q.data ? (
        <EmptyState
          icon={Sparkles}
          title="Pauta indisponível"
          description="Peça um novo link à equipe."
        />
      ) : (
        <>
          {/* cabeçalho: período + progresso real */}
          <div className="rounded-xl border border-border/60 bg-card p-5">
            <div className="text-xs capitalize text-muted-foreground">
              {monthLabel(q.data.plan.created_at)}
            </div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">{q.data.plan.title}</h2>
            {q.data.plan.objectives && (
              <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                {q.data.plan.objectives}
              </p>
            )}

            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {decided} de {counts.total} publicações revisadas
                </span>
                <span className="font-medium">{progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{counts.approved} aprovadas</span>
                <span>{counts.changes} com ajustes</span>
                <span>{counts.pending} aguardando você</span>
              </div>
            </div>

            {!editable && (
              <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {q.data.plan.client_decision_at
                  ? `Respondida em ${formatDate(q.data.plan.client_decision_at)}`
                  : "Ainda não liberada para aprovação"}
              </div>
            )}
            {!editable && q.data.plan.client_feedback && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
                <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
                {q.data.plan.client_feedback}
              </p>
            )}
          </div>

          {/* filtros */}
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => {
              const n =
                f.id === "all"
                  ? counts.total
                  : f.id === "awaiting"
                    ? counts.pending
                    : f.id === "approved"
                      ? counts.approved
                      : counts.changes;
              return (
                <Button
                  key={f.id}
                  size="sm"
                  variant={filter === f.id ? "default" : "outline"}
                  className="h-8 rounded-full text-xs"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                >
                  {f.label} ({n})
                </Button>
              );
            })}
          </div>

          {/* lista de itens */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={
                filter === "awaiting"
                  ? "Nada aguardando você"
                  : filter === "approved"
                    ? "Nenhuma publicação aprovada ainda"
                    : filter === "changes"
                      ? "Nenhum ajuste solicitado"
                      : "Nenhuma publicação nesta pauta"
              }
              description="Use os filtros acima para ver as demais publicações da pauta."
            />
          ) : (
            <div className="space-y-2">
              {filtered.map(({ topic, decision, comment, staged }) => (
                <div
                  key={topic.id}
                  className="rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-border"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      onClick={() => setDetailId(topic.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="text-sm font-medium">{topic.topic_title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 capitalize">
                          <CalendarDays className="h-3 w-3" /> {monthLabel(q.data.plan.created_at)}
                        </span>
                        {topic.channel && <span className="capitalize">{topic.channel}</span>}
                        {topic.content_format && (
                          <span className="capitalize">{topic.content_format}</span>
                        )}
                      </div>
                    </button>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusTone(decision)}`}
                    >
                      {STATUS_LABEL[decision]}
                      {staged ? " · a enviar" : ""}
                    </span>
                  </div>

                  {comment && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" /> {comment}
                    </p>
                  )}

                  {editable && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant={decision === "approved" ? "default" : "outline"}
                        className="h-8 gap-1 text-xs"
                        onClick={() => setDecision(topic.id, "approved")}
                      >
                        <Check className="h-3.5 w-3.5" /> Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant={
                          decision === "changes" || decision === "rejected" ? "default" : "outline"
                        }
                        className="h-8 gap-1 text-xs"
                        onClick={() => setDetailId(topic.id)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Solicitar ajustes
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => setDetailId(topic.id)}
                      >
                        Ver detalhes
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* envio */}
          {editable && (
            <div className="sticky bottom-0 space-y-3 rounded-xl border border-border/60 bg-card/95 p-4 backdrop-blur">
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Comentário geral para a equipe (opcional)"
                className="min-h-16 text-sm"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button className="gap-1.5" disabled={decide.isPending} onClick={submit}>
                  {decide.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  {counts.pending > 0
                    ? `Enviar decisões (aprovando ${counts.pending} restantes)`
                    : "Enviar decisões"}
                </Button>
                {counts.pending > 0 && (
                  <span className="text-xs text-muted-foreground">
                    Publicações sem decisão serão enviadas como aprovadas.
                  </span>
                )}
              </div>
            </div>
          )}

          <TopicDialog
            row={detailRow}
            editable={Boolean(editable)}
            onClose={() => setDetailId(null)}
            onApprove={(id) => {
              setDecision(id, "approved");
              setDetailId(null);
            }}
            onChanges={(id, comment) => {
              setDecision(id, "changes", comment);
              setDetailId(null);
            }}
          />
        </>
      )}
    </div>
  );
}

/* ---------------------------- detalhe do item ---------------------------- */

function TopicDialog({
  row,
  editable,
  onClose,
  onApprove,
  onChanges,
}: {
  row: { topic: PublicPlanTopic; decision: Decision | "pending"; comment: string } | null;
  editable: boolean;
  onClose: () => void;
  onApprove: (id: string) => void;
  onChanges: (id: string, comment: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "changes">("view");
  const [comment, setComment] = useState("");

  const topic = row?.topic;

  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(o) => {
        if (!o) {
          setMode("view");
          setComment("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {topic && row && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{topic.topic_title}</DialogTitle>
              <DialogDescription className="capitalize">
                {[topic.channel, topic.content_format].filter(Boolean).join(" · ") ||
                  "Publicação planejada"}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${statusTone(row.decision)}`}
              >
                {STATUS_LABEL[row.decision]}
              </span>

              {topic.angle && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Ideia central</div>
                  <p className="mt-1 whitespace-pre-line">{topic.angle}</p>
                </div>
              )}
              {topic.target_audience && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Para quem</div>
                  <p className="mt-1 whitespace-pre-line">{topic.target_audience}</p>
                </div>
              )}
              {topic.rationale && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Por que faz sentido
                  </div>
                  <p className="mt-1 whitespace-pre-line">{topic.rationale}</p>
                </div>
              )}
              {row.comment && (
                <div className="rounded-lg bg-muted/60 p-3">
                  <div className="text-xs font-medium text-muted-foreground">Seu comentário</div>
                  <p className="mt-1 whitespace-pre-line text-xs">{row.comment}</p>
                </div>
              )}

              {editable &&
                (mode === "changes" ? (
                  <div className="space-y-2">
                    <Textarea
                      autoFocus
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Conte o que precisa mudar nesta publicação"
                      className="min-h-24 text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={!comment.trim()}
                        onClick={() => {
                          onChanges(topic.id, comment.trim());
                          setMode("view");
                          setComment("");
                        }}
                      >
                        Enviar pedido de ajuste
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="gap-1.5" onClick={() => onApprove(topic.id)}>
                      <Check className="h-4 w-4" /> Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        setComment(row.comment ?? "");
                        setMode("changes");
                      }}
                    >
                      <RotateCcw className="h-4 w-4" /> Solicitar ajustes
                    </Button>
                  </div>
                ))}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
