import { contentFormatLabel } from "@/lib/content-formats";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  ShieldAlert,
  ThumbsDown,
  ListChecks,
} from "lucide-react";
import {
  addPlanLinkPublic,
  decideMonthlyPlanPublic,
  deletePlanLinkPublic,
  listPlanLinksPublic,
  resolveMonthlyPlanPublic,
  type PublicPlanResolve,
  type PublicTopicClientStatus,
} from "@/lib/monthly-plan-public.functions";
import { PLAN_CHANNEL_LABEL, type PlanChannel } from "@/lib/monthly-plan-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { WorkLinkForm, WorkLinkList } from "@/components/ui/work-links";
import type { WorkLink } from "@/lib/work-links.functions";

const searchSchema = z.object({ token: z.string().min(8) });

/**
 * Links de referência que o cliente anexa a uma pauta (ex.: pasta do Drive com
 * as fotos da peça). Somente links — sem upload de arquivo.
 */
function PublicTopicLinks({ token, topicId }: { token: string; topicId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listPlanLinksPublic);
  const add = useServerFn(addPlanLinkPublic);
  const del = useServerFn(deletePlanLinkPublic);
  const key = ["public-plan-links", token];

  const q = useQuery({ queryKey: key, queryFn: () => list({ data: { token } }) });
  const links = (q.data ?? []).filter((l) => l.topic_id === topicId);

  const addMut = useMutation({
    mutationFn: (v: { url: string; title: string }) =>
      add({ data: { token, topicId, url: v.url, title: v.title || undefined } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      toast.success("Link anexado");
    },
    onError: () => toast.error("Não conseguimos salvar este link. Confira a URL."),
  });
  const delMut = useMutation({
    mutationFn: (linkId: string) => del({ data: { token, linkId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: () => toast.error("Não conseguimos remover este link agora."),
  });

  return (
    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Links de referência
      </div>
      <WorkLinkList
        links={links as unknown as WorkLink[]}
        emptyLabel="Nenhum link anexado. Cole um link do Drive, Figma, etc."
        removingId={delMut.isPending ? delMut.variables : null}
        onRemove={(l) => (l.created_by_client ? delMut.mutate(l.id) : undefined)}
      />
      <WorkLinkForm
        compact
        pending={addMut.isPending}
        onSubmit={(url, title) => addMut.mutate({ url, title })}
      />
    </div>
  );
}

export const Route = createFileRoute("/pauta/$planId")({
  validateSearch: (raw: Record<string, unknown>) => searchSchema.parse(raw),
  component: PublicMonthlyPlanPage,
  head: () => ({
    meta: [
      { title: "Pauta mensal — Aprovação do cliente" },
      {
        name: "description",
        content:
          "Revise os temas planejados para o mês e aprove, rejeite ou solicite ajustes — na pauta inteira ou item por item.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Pauta mensal — Aprovação" },
      { property: "og:description", content: "Revise e decida sobre os temas do mês." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type ItemDecision = { decision: "approved" | "rejected" | "changes"; comment: string };
type Mode = "idle" | "changes" | "reject" | "per_item";

const ERRORS: Record<string, string> = {
  feedback_required: "Descreva o motivo ou o que deseja ajustar.",
  item_comment_required: "Explique o motivo nos itens rejeitados ou com ajuste.",
  items_incomplete: "Decida todos os itens antes de enviar.",
  invalid_topic: "Um dos itens não pertence mais a esta pauta. Recarregue a página.",
  plan_not_pending: "Esta pauta já foi respondida.",
  plan_not_found: "Pauta não encontrada. Solicite um novo link à agência.",
  plan_has_no_topics: "Esta pauta não tem temas para aprovar. Avise a agência.",
  invalid_token: "Link inválido. Solicite um novo link de aprovação à agência.",
  token_revoked: "Este link foi cancelado. Solicite um novo link à agência.",
  token_expired: "Este link expirou. Solicite um novo link à agência.",
  token_lookup_failed: "Não conseguimos validar seu link agora. Tente novamente em instantes.",
  decision_items_failed: "Não conseguimos salvar as decisões dos itens. Tente novamente.",
  decision_failed: "Não conseguimos salvar sua resposta. Tente novamente em instantes.",
};


const PILL = "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium";

const CHANNEL_PILL: Record<string, string> = {
  instagram: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400",
  tiktok: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
  linkedin: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  youtube: "border-red-500/30 bg-red-500/10 text-red-400",
  facebook: "border-blue-500/30 bg-blue-500/10 text-blue-400",
};

function channelLabel(channel: string) {
  return PLAN_CHANNEL_LABEL[channel as PlanChannel] ?? channel;
}

function StatusPill({ status }: { status: PublicTopicClientStatus }) {
  const map = {
    pending: {
      label: "Aguardando você",
      cls: "border-border/60 bg-muted/40 text-muted-foreground",
    },
    approved: {
      label: "Aprovado",
      cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    },
    changes: {
      label: "Ajuste solicitado",
      cls: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    },
    rejected: { label: "Rejeitado", cls: "border-rose-500/30 bg-rose-500/10 text-rose-400" },
  } as const;
  const m = map[status] ?? map.pending;
  return <span className={`${PILL} ${m.cls}`}>{m.label}</span>;
}

function PublicMonthlyPlanPage() {
  const { token } = Route.useSearch();
  const qc = useQueryClient();
  const resolveFn = useServerFn(resolveMonthlyPlanPublic);
  const decideFn = useServerFn(decideMonthlyPlanPublic);
  const [mode, setMode] = useState<Mode>("idle");
  const [feedback, setFeedback] = useState("");
  const [items, setItems] = useState<Record<string, ItemDecision>>({});

  const planQ = useQuery<PublicPlanResolve>({
    queryKey: ["public-monthly-plan", token],
    queryFn: () => resolveFn({ data: { token } }),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (kind: "approve" | "reject" | "changes" | "per_item") =>
      decideFn({
        data: {
          token,
          decision: kind,
          feedback,
          items:
            kind === "per_item"
              ? Object.entries(items).map(([topicId, v]) => ({
                  topicId,
                  decision: v.decision,
                  comment: v.comment,
                }))
              : undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        res.status === "client_approved"
          ? "Pauta aprovada. Obrigado!"
          : res.status === "client_rejected"
            ? "Resposta registrada. A equipe será avisada."
            : "Ajustes enviados à equipe.",
      );
      setMode("idle");
      void qc.invalidateQueries({ queryKey: ["public-monthly-plan", token] });
    },
    onError: (e: Error) =>
      toast.error(ERRORS[e.message] ?? "Não foi possível registrar sua resposta."),
  });

  const topics = useMemo(() => planQ.data?.topics ?? [], [planQ.data]);
  const allDecided = useMemo(
    () => topics.length > 0 && topics.every((t) => items[t.id]),
    [topics, items],
  );

  if (planQ.isLoading) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-8 p-6">
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-6 w-52" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </main>
    );
  }

  if (planQ.isError || !planQ.data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md rounded-2xl border-border/60 bg-card/40 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-destructive" /> Link inválido ou expirado
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Solicite um novo link de aprovação à sua agência.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { plan, client } = planQ.data;
  const decided = plan.status !== "pending_client";
  const approvedCount = topics.filter((t) => t.client_status === "approved").length;
  const changesCount = topics.filter((t) => t.client_status === "changes").length;
  const rejectedCount = topics.filter((t) => t.client_status === "rejected").length;

  const bannerCls =
    plan.status === "client_approved"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
      : plan.status === "client_rejected"
        ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
        : "border-amber-500/30 bg-amber-500/10 text-amber-400";

  return (
    <div className={decided ? "pb-16" : "pb-40"}>
      <main className="mx-auto w-full max-w-5xl space-y-8 p-6">
        {decided ? (
          <div className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${bannerCls}`}>
            {plan.status === "client_approved" ? (
              <>
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Pauta aprovada. A equipe já iniciou a produção.</span>
              </>
            ) : plan.status === "client_rejected" ? (
              <>
                <ThumbsDown className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p>Pauta rejeitada.</p>
                  {plan.client_feedback ? (
                    <p className="mt-1 opacity-80">{plan.client_feedback}</p>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p>Ajustes solicitados. Os itens aprovados seguiram para produção.</p>
                  {plan.client_feedback ? (
                    <p className="mt-1 opacity-80">{plan.client_feedback}</p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        {/* Estratégia */}
        <section className="space-y-5 rounded-2xl border border-border/60 bg-card/40 p-6 backdrop-blur">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {client.name}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">{plan.title}</h1>
          </div>

          {plan.description || plan.objectives ? (
            <div className="grid gap-5 md:grid-cols-2">
              {plan.description ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Descrição
                  </div>
                  <p className="text-sm text-foreground/90">{plan.description}</p>
                </div>
              ) : null}
              {plan.objectives ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Objetivos
                  </div>
                  <p className="whitespace-pre-line text-sm text-foreground/90">
                    {plan.objectives}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4 text-xs">
            <span className={`${PILL} border-border/60 bg-muted/40 text-muted-foreground`}>
              {topics.length} {topics.length === 1 ? "tema" : "temas"}
            </span>
            {approvedCount > 0 ? (
              <span className={`${PILL} border-emerald-500/30 bg-emerald-500/10 text-emerald-400`}>
                {approvedCount} aprovados
              </span>
            ) : null}
            {changesCount > 0 ? (
              <span className={`${PILL} border-amber-500/30 bg-amber-500/10 text-amber-400`}>
                {changesCount} com ajuste
              </span>
            ) : null}
            {rejectedCount > 0 ? (
              <span className={`${PILL} border-rose-500/30 bg-rose-500/10 text-rose-400`}>
                {rejectedCount} rejeitados
              </span>
            ) : null}
          </div>
        </section>

        {/* Temas */}
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Ideias de posts</h2>
            <p className="text-xs text-muted-foreground">
              {decided
                ? "Estas foram as suas decisões."
                : "Revise cada tema e aprove a pauta inteira ou decida item por item."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {topics.map((t, i) => {
              const local = items[t.id];
              const state = local?.decision ?? t.client_status;
              const cardCls =
                state === "approved"
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : state === "changes"
                    ? "border-amber-500/40 bg-amber-500/5"
                    : state === "rejected"
                      ? "border-border/40 bg-muted/30 opacity-70"
                      : "border-border/60 bg-card/40 hover:border-border";
              return (
                <div key={t.id} className={`rounded-xl border p-4 transition ${cardCls}`}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <StatusPill
                      status={(local?.decision ?? t.client_status) as PublicTopicClientStatus}
                    />
                  </div>

                  <p className="text-sm font-semibold text-foreground">{t.topic_title}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {t.channel ? (
                      <span
                        className={`${PILL} ${
                          CHANNEL_PILL[t.channel] ??
                          "border-border/60 bg-muted/40 text-muted-foreground"
                        }`}
                      >
                        {channelLabel(t.channel)}
                      </span>
                    ) : null}
                    {t.content_format ? (
                      <span
                        className={`${PILL} border-violet-500/30 bg-violet-500/10 text-violet-400`}
                      >
                        {contentFormatLabel(t.content_format)}
                      </span>
                    ) : null}
                  </div>

                  {t.angle ? (
                    <div className="mt-3">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Gancho
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">{t.angle}</p>
                    </div>
                  ) : null}

                  {t.target_audience ? (
                    <div className="mt-3">
                      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Público-alvo
                      </div>
                      <p className="text-xs leading-relaxed text-foreground/80">
                        {t.target_audience}
                      </p>
                    </div>
                  ) : null}

                  {t.rationale ? (
                    <p className="mt-3 rounded-md bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground/80">Por quê: </span>
                      {t.rationale}
                    </p>
                  ) : null}

                  {t.client_comment ? (
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                      “{t.client_comment}”
                    </p>
                  ) : null}

                  <PublicTopicLinks token={token} topicId={t.id} />

                  {mode === "per_item" && !decided ? (
                    <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(["approved", "changes", "rejected"] as const).map((d) => {
                          const active = local?.decision === d;
                          const cls =
                            d === "approved"
                              ? "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                              : d === "changes"
                                ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                                : "border-rose-500/40 text-rose-400 hover:bg-rose-500/10";
                          const activeCls =
                            d === "approved"
                              ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300"
                              : d === "changes"
                                ? "border-amber-500/50 bg-amber-500/20 text-amber-300"
                                : "border-rose-500/50 bg-rose-500/20 text-rose-300";
                          return (
                            <Button
                              key={d}
                              size="sm"
                              variant="outline"
                              className={`h-7 px-2 text-xs ${active ? activeCls : cls}`}
                              onClick={() =>
                                setItems((prev) => ({
                                  ...prev,
                                  [t.id]: { decision: d, comment: prev[t.id]?.comment ?? "" },
                                }))
                              }
                            >
                              {d === "approved"
                                ? "Aprovar"
                                : d === "changes"
                                  ? "Pedir ajuste"
                                  : "Rejeitar"}
                            </Button>
                          );
                        })}
                      </div>
                      {local && local.decision !== "approved" ? (
                        <Textarea
                          value={local.comment}
                          onChange={(e) =>
                            setItems((prev) => ({
                              ...prev,
                              [t.id]: { decision: local.decision, comment: e.target.value },
                            }))
                          }
                          maxLength={1000}
                          rows={3}
                          placeholder="O que deve mudar neste item?"
                          className="text-xs"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Barra de ações fixa */}
      {!decided ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/95 backdrop-blur">
          <div className="mx-auto w-full max-w-5xl space-y-2 px-6 py-3">
            {mode === "idle" ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  className="gap-1.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                  onClick={() => setMode("reject")}
                >
                  <ThumbsDown className="h-4 w-4" /> Rejeitar pauta
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={() => setMode("per_item")}>
                  <ListChecks className="h-4 w-4" /> Decidir item por item
                </Button>
                <Button variant="outline" className="gap-1.5" onClick={() => setMode("changes")}>
                  <MessageSquare className="h-4 w-4" /> Solicitar ajustes
                </Button>
                <Button
                  className="gap-1.5 border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                  onClick={() => decide.mutate("approve")}
                  disabled={decide.isPending}
                >
                  {decide.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Aprovar pauta inteira
                </Button>
              </div>
            ) : mode === "per_item" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Decida cada item acima. Itens rejeitados ou com ajuste precisam de um comentário.
                </p>
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="Observação geral (opcional)"
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setMode("idle")}
                    disabled={decide.isPending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className="gap-1.5 border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
                    onClick={() => decide.mutate("per_item")}
                    disabled={decide.isPending || !allDecided}
                  >
                    {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Enviar decisões
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder={
                    mode === "reject"
                      ? "Por que esta pauta não atende?"
                      : "O que você gostaria de ajustar nesta pauta?"
                  }
                />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setMode("idle")}
                    disabled={decide.isPending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className={
                      mode === "reject"
                        ? "gap-1.5 border border-rose-500/30 bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                        : "gap-1.5 border border-amber-500/30 bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
                    }
                    onClick={() => decide.mutate(mode === "reject" ? "reject" : "changes")}
                    disabled={decide.isPending}
                  >
                    {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {mode === "reject" ? "Confirmar rejeição" : "Enviar ajustes"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
