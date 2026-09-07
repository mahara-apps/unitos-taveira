import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  CalendarDays,
  FileText,
  Check,
  X,
  MessageSquareWarning,
  MessageCircle,
  Clock,
  Loader2,
  ImageIcon,
  User2,
  CalendarClock,
  Hourglass,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { PortalLink, usePortalApi, usePortalCanInteract } from "./portal-context";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import type { PortalTabId } from "./portal-nav";
import { PautaApprovals } from "./portal-pauta";
import { PortalCalendar } from "./portal-calendar";
import { PortalBriefing } from "./portal-briefing";
import { PortalFiles } from "./portal-files";
import { PortalBrand } from "./portal-brand";
import { PLAN_PENDING_CLIENT_STATUS } from "@/lib/monthly-plan-client.types";
import { EmptyState, ErrorState, GridSkeleton, ListSkeleton, formatDate } from "./portal-shared";

/* ---------------------------------- HOME ---------------------------------- */

/**
 * FASE 2 — Início orientado a ação.
 *
 * Só usa dados reais já expostos pelo portal: `metrics`, `approvals("pending")`,
 * `plans`, `briefingRequests` e `calendar(mês atual)`. Nenhuma métrica nova,
 * nenhuma chamada nova ao banco e nenhum termo interno da agência.
 */
export function HomeTab() {
  const api = usePortalApi();
  const ym = new Date().toISOString().slice(0, 7);

  const metricsQ = useQuery({
    queryKey: ["portal", "metrics", api.scopeKey],
    queryFn: () => api.metrics(),
    staleTime: 30_000,
  });
  const pendingQ = useQuery({
    queryKey: ["portal", "approvals", api.scopeKey, "pending"],
    queryFn: () => api.approvals("pending"),
    staleTime: 30_000,
  });
  const plansQ = useQuery({
    queryKey: ["portal", "plans", api.scopeKey],
    queryFn: () => api.plans(),
    staleTime: 30_000,
  });
  const briefingQ = useQuery({
    queryKey: ["portal", "briefing-requests", api.scopeKey],
    queryFn: () => api.briefingRequests(),
    staleTime: 30_000,
  });
  const calendarQ = useQuery({
    queryKey: ["portal", "calendar", api.scopeKey, ym],
    queryFn: () => api.calendar(ym),
    staleTime: 30_000,
  });

  const pendingPosts = pendingQ.data ?? [];
  const plansAwaiting = (plansQ.data ?? []).filter((p) => p.status === PLAN_PENDING_CLIENT_STATUS);
  const briefingsPending = (briefingQ.data ?? []).filter(
    (r) => r.status === "requested" || (r.pending_fields?.length ?? 0) > 0,
  );

  const now = Date.now();
  const upcoming = useMemo(
    () =>
      (calendarQ.data ?? [])
        .filter((p) => p.scheduled_at && new Date(p.scheduled_at).getTime() >= now)
        .sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1))
        .slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarQ.data],
  );

  const recent = useMemo(() => {
    const items: Array<{ id: string; text: string; detail: string; when: string }> = [];
    for (const p of calendarQ.data ?? []) {
      if (p.approval?.decided_at) {
        items.push({
          id: `post-${p.id}`,
          text: p.title ?? "Conteúdo",
          detail:
            p.approval.status === "approved"
              ? "Você aprovou"
              : p.approval.status === "adjust"
                ? "Você pediu ajustes"
                : p.approval.status === "rejected"
                  ? "Você recusou"
                  : "Você respondeu",
          when: p.approval.decided_at,
        });
      } else if (p.published_at) {
        items.push({
          id: `pub-${p.id}`,
          text: p.title ?? "Conteúdo",
          detail: "Publicado",
          when: p.published_at,
        });
      }
    }
    for (const p of plansQ.data ?? []) {
      if (p.client_decision_at)
        items.push({
          id: `plan-${p.id}`,
          text: p.title,
          detail: "Pauta respondida",
          when: p.client_decision_at,
        });
    }
    for (const r of briefingQ.data ?? []) {
      if (r.submitted_at)
        items.push({
          id: `br-${r.id}`,
          text: "Briefing",
          detail: "Respostas enviadas",
          when: r.submitted_at,
        });
    }
    return items.sort((a, b) => (a.when < b.when ? 1 : -1)).slice(0, 6);
  }, [calendarQ.data, plansQ.data, briefingQ.data]);

  const failed =
    metricsQ.isError &&
    pendingQ.isError &&
    plansQ.isError &&
    briefingQ.isError &&
    calendarQ.isError;
  const loadingKpis = metricsQ.isLoading || plansQ.isLoading || briefingQ.isLoading;
  const kpiValue = (v: number) => (loadingKpis ? <Skeleton className="h-6 w-10" /> : v);

  const pendingCount = metricsQ.data?.pending ?? pendingPosts.length;

  if (failed)
    return (
      <ErrorState
        description="Não conseguimos carregar seu resumo agora."
        onRetry={() => {
          metricsQ.refetch();
          pendingQ.refetch();
          plansQ.refetch();
          briefingQ.refetch();
          calendarQ.refetch();
        }}
      />
    );

  return (
    <div className="space-y-6">
      <PageKpiGrid columns={5}>
        <PortalLink tab="approvals" className="block">
          <PageKpi
            label="Aguardando aprovação"
            value={kpiValue(pendingCount)}
            icon={<Hourglass />}
            status={pendingCount > 0 ? "warning" : "success"}
            description={pendingCount > 0 ? "Conteúdos esperando você" : "Nada pendente"}
          />
        </PortalLink>
        <PortalLink tab="pauta" className="block">
          <PageKpi
            label="Pauta pendente"
            value={kpiValue(plansAwaiting.length)}
            icon={<Sparkles />}
            status={plansAwaiting.length > 0 ? "warning" : "success"}
            description={
              plansAwaiting.length > 0 ? "Pautas do mês para revisar" : "Nenhuma pauta em aberto"
            }
          />
        </PortalLink>
        <PortalLink tab="briefing" className="block">
          <PageKpi
            label="Briefing pendente"
            value={kpiValue(briefingsPending.length)}
            icon={<FileText />}
            status={briefingsPending.length > 0 ? "warning" : "success"}
            description={
              briefingsPending.length > 0 ? "Perguntas da equipe" : "Nenhuma pergunta em aberto"
            }
          />
        </PortalLink>
        <PortalLink tab="calendar" className="block">
          <PageKpi
            label="Próximos compromissos"
            value={calendarQ.isLoading ? <Skeleton className="h-6 w-10" /> : upcoming.length}
            icon={<CalendarClock />}
            status="info"
            description="Publicações já com data"
          />
        </PortalLink>
        <PageKpi
          label="Prazos de produção"
          value={
            metricsQ.isLoading ? (
              <Skeleton className="h-6 w-10" />
            ) : (
              (metricsQ.data?.sla.overdue ?? 0)
            )
          }
          icon={<ShieldCheck />}
          status={
            (metricsQ.data?.sla.overdue ?? 0) > 0
              ? "danger"
              : (metricsQ.data?.sla.atRisk ?? 0) > 0
                ? "warning"
                : "success"
          }
          description={
            (metricsQ.data?.sla.overdue ?? 0) > 0
              ? "Conteúdos fora do prazo"
              : (metricsQ.data?.sla.tracked ?? 0) > 0
                ? "Produção dentro do prazo"
                : "Sem prazo em acompanhamento"
          }
        />
      </PageKpiGrid>

      {/* Pendências */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">O que precisa de você</h2>
        {loadingKpis ? (
          <ListSkeleton />
        ) : pendingCount === 0 && plansAwaiting.length === 0 && briefingsPending.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Você está em dia"
            description="Assim que a equipe enviar algo para sua aprovação, aparece aqui."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pendingCount > 0 && (
              <PendingAction
                icon={CheckSquare}
                title="Aprovar conteúdo"
                description={`${pendingCount} ${pendingCount === 1 ? "conteúdo aguarda" : "conteúdos aguardam"} sua aprovação.`}
                cta="Aprovar conteúdo"
                tab="approvals"
              />
            )}
            {plansAwaiting.length > 0 && (
              <PendingAction
                icon={Sparkles}
                title="Aprovar pauta"
                description={
                  plansAwaiting.length === 1
                    ? `${plansAwaiting[0].title} — ${plansAwaiting[0].pending} ${plansAwaiting[0].pending === 1 ? "item sem decisão" : "itens sem decisão"}.`
                    : `${plansAwaiting.length} pautas aguardam sua resposta.`
                }
                cta="Aprovar pauta"
                tab="pauta"
              />
            )}
            {briefingsPending.length > 0 && (
              <PendingAction
                icon={FileText}
                title="Responder briefing"
                description={
                  briefingsPending[0]?.due_at
                    ? `Responda até ${formatDate(briefingsPending[0].due_at)}.`
                    : "A equipe precisa de algumas informações da sua marca."
                }
                cta="Responder briefing"
                tab="briefing"
              />
            )}
          </div>
        )}
      </section>

      {/* Próximas publicações */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">Próximas publicações</h2>
          <Button size="sm" variant="ghost" asChild>
            <PortalLink tab="calendar">
              Ver calendário <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </PortalLink>
          </Button>
        </div>
        {calendarQ.isLoading ? (
          <ListSkeleton />
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nenhuma publicação com data"
            description="Quando um conteúdo aprovado receber data, ele aparece aqui."
          />
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
            {upcoming.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.title ?? "Conteúdo"}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      {new Date(p.scheduled_at as string).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {(p.channels ?? []).slice(0, 3).map((c) => (
                      <Badge key={c} variant="secondary" className="capitalize">
                        {c}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Atividade recente */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight">Atividade recente</h2>
        {calendarQ.isLoading ? (
          <ListSkeleton />
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="Nada por aqui ainda"
            description="Suas aprovações e respostas ficam registradas nesta lista."
          />
        ) : (
          <ol className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{r.text}</div>
                  <div className="text-xs text-muted-foreground">{r.detail}</div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(r.when)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function PendingAction({
  icon: Icon,
  title,
  description,
  cta,
  tab,
}: {
  icon: typeof Hourglass;
  title: string;
  description: string;
  cta: string;
  tab: PortalTabId;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-card p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="h-4 w-4 text-severity-warning" />
          {title}
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Button size="sm" asChild className="self-start">
        <PortalLink tab={tab}>
          {cta} <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </PortalLink>
      </Button>
    </div>
  );
}

/* ---------------------------------- PAUTA --------------------------------- */

/** Pauta virou área de primeiro nível (antes era uma seção dentro de Aprovações). */
export function PautaTab() {
  return <PautaApprovals />;
}

/* ------------------------------- MINHA MARCA ------------------------------ */

export function BrandTab() {
  return <PortalBrand />;
}

/* -------------------------------- APPROVALS ------------------------------- */

type ApprovalFilter = "pending" | "approved" | "adjust" | "all";

const APPROVAL_FILTERS: Array<{ id: ApprovalFilter; label: string }> = [
  { id: "pending", label: "Pendentes" },
  { id: "approved", label: "Aprovados" },
  { id: "adjust", label: "Ajustes solicitados" },
  { id: "all", label: "Todos" },
];

/** Rótulos voltados ao cliente — nada de status técnico. */
const DECISION_LABEL: Record<string, string> = {
  pending: "Aguardando você",
  approved: "Aprovado por você",
  rejected: "Recusado por você",
  adjust: "Ajustes solicitados",
  changes_requested: "Ajustes solicitados",
};

const DECISION_TONE: Record<string, { badge: string; bar: string; box: string }> = {
  pending: {
    badge: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
    box: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  approved: {
    badge: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
    box: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  rejected: {
    badge: "border-rose-500/40 text-rose-600 dark:text-rose-400",
    bar: "bg-rose-500",
    box: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  adjust: {
    badge: "border-sky-500/40 text-sky-600 dark:text-sky-400",
    bar: "bg-sky-500",
    box: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
};

function decisionTone(status: string) {
  return DECISION_TONE[status === "changes_requested" ? "adjust" : status] ?? DECISION_TONE.pending;
}

const EMPTY_BY_FILTER: Record<ApprovalFilter, { title: string; description: string }> = {
  pending: {
    title: "Você está em dia",
    description: "Nenhum conteúdo aguardando sua aprovação neste momento.",
  },
  approved: {
    title: "Nenhum conteúdo aprovado ainda",
    description: "Os conteúdos que você aprovar ficam guardados aqui.",
  },
  adjust: {
    title: "Nenhum ajuste solicitado",
    description: "Quando você pedir alterações em um conteúdo, ele aparece nesta lista.",
  },
  all: {
    title: "Nada compartilhado ainda",
    description: "Assim que a equipe enviar conteúdos para você, eles aparecem aqui.",
  },
};

export function ApprovalsTab() {
  const api = usePortalApi();
  const [filter, setFilter] = useState<ApprovalFilter>("pending");
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["portal", "approvals", api.scopeKey, filter],
    queryFn: () => api.approvals(filter),
  });
  const metricsQ = useQuery({
    queryKey: ["portal", "metrics", api.scopeKey],
    queryFn: () => api.metrics(),
    staleTime: 30_000,
  });
  const pendingCount = metricsQ.data?.pending ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-card p-1">
        {APPROVAL_FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
              {f.id === "pending" && pendingCount > 0 && (
                <span className="rounded-full bg-severity-warning/15 px-1.5 text-[10px] font-medium text-severity-warning">
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {filter === "pending" && pendingCount > 0 && (
        <p className="text-xs text-muted-foreground">
          Abra cada conteúdo para ver a imagem e o texto antes de aprovar. Para pedir alterações ou
          recusar, é necessário escrever um comentário.
        </p>
      )}

      {q.isLoading ? (
        <GridSkeleton />
      ) : q.isError ? (
        <ErrorState
          description="Não conseguimos carregar seus conteúdos agora."
          message={(q.error as Error)?.message}
          onRetry={() => q.refetch()}
        />
      ) : !q.data?.length ? (
        <EmptyState
          icon={filter === "pending" ? CheckCircle2 : CheckSquare}
          title={EMPTY_BY_FILTER[filter].title}
          description={EMPTY_BY_FILTER[filter].description}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {q.data.map((p) => (
            <ApprovalCard
              key={p.id}
              post={p as unknown as Record<string, unknown>}
              onOpen={() => setOpenId(p.id)}
            />
          ))}
        </div>
      )}

      {openId && <ApprovalDialog postId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ApprovalCard({ post, onOpen }: { post: Record<string, unknown>; onOpen: () => void }) {
  const status = ((post.approval as { status: string } | undefined)?.status ?? "pending") as string;
  const tone = decisionTone(status);
  const channels = Array.isArray(post.channels) ? (post.channels as string[]) : [];
  const sla = post.sla as
    | { status?: string; hoursRemaining?: number; hoursOverdue?: number }
    | undefined;
  return (
    <button
      onClick={onOpen}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card text-left transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-md"
    >
      <span className={`absolute inset-x-0 top-0 z-10 h-0.5 ${tone.bar}`} />
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
        {post.cover_url ? (
          <img
            src={post.cover_url as string}
            alt={(post.title as string) || "Prévia do conteúdo"}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <ImageIcon className="h-6 w-6 opacity-40" />
            <span className="text-[11px]">Sem imagem</span>
          </div>
        )}
        <Badge
          variant="outline"
          className={`absolute left-2 top-2.5 border bg-background/85 backdrop-blur ${tone.badge}`}
        >
          {DECISION_LABEL[status] ?? DECISION_LABEL.pending}
        </Badge>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/10 to-transparent p-2.5 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="inline-flex items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium text-black">
            {status === "pending" ? "Revisar" : "Ver detalhes"}
            <ArrowRight className="h-3 w-3" />
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="line-clamp-2 text-sm font-medium leading-snug">
          {(post.title as string) || "Conteúdo"}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {channels.slice(0, 3).map((c) => (
            <Badge
              key={c}
              variant="secondary"
              className="rounded-md px-1.5 py-0 text-[10px] capitalize"
            >
              {c}
            </Badge>
          ))}
        </div>
        {post.scheduled_at ? (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3 w-3" />
            {formatDate(post.scheduled_at as string)}
          </div>
        ) : null}
        {sla?.status && sla.status !== "none" ? <SlaBadge sla={sla} /> : null}
      </div>
    </button>
  );
}

function ApprovalDialog({ postId, onClose }: { postId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const api = usePortalApi();
  // Decisão só aparece quando o cliente realmente pode decidir.
  const canDecide = usePortalCanInteract("approvals");
  const q = useQuery({
    queryKey: ["portal", "post", api.scopeKey, postId],
    queryFn: () => api.post(postId),
  });
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<null | "reject" | "adjust" | "comment">(null);
  const [activeMedia, setActiveMedia] = useState(0);
  const m = useMutation({
    mutationFn: (payload: {
      decision: "approved" | "rejected" | "adjust" | "comment";
      note?: string;
    }) => api.decidePost({ postId, ...payload }),
    onSuccess: (_r, vars) => {
      toast.success(
        vars.decision === "approved"
          ? "Conteúdo aprovado"
          : vars.decision === "rejected"
            ? "Conteúdo recusado"
            : vars.decision === "adjust"
              ? "Ajustes solicitados"
              : "Comentário enviado",
      );
      // Lista, resumo e detalhe atualizam imediatamente; o detalhe fica aberto
      // para o cliente ver a decisão registrada sem perder o contexto.
      qc.invalidateQueries({ queryKey: ["portal", "approvals", api.scopeKey] });
      qc.invalidateQueries({ queryKey: ["portal", "metrics", api.scopeKey] });
      qc.invalidateQueries({ queryKey: ["portal", "calendar", api.scopeKey] });
      qc.invalidateQueries({ queryKey: ["portal", "post", api.scopeKey, postId] });
      setNote("");
      setMode(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const post = q.data?.post;
  const approval = q.data?.approval;
  const media = useMemo(() => q.data?.media ?? [], [q.data]);
  const gallery = useMemo(() => {
    const list: Array<{ url: string; type: string }> = [];
    if (post?.cover_url) list.push({ url: post.cover_url as string, type: "image" });
    for (const item of media) {
      if (item.url && item.url !== post?.cover_url) list.push(item);
    }
    return list;
  }, [post?.cover_url, media]);
  const current = gallery[activeMedia] ?? gallery[0];
  const currentStatus = approval?.status ?? "pending";
  const sla = post?.sla;
  const tone = decisionTone(currentStatus);
  const decided = Boolean(approval && approval.status !== "pending");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl gap-0 overflow-hidden p-0">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          {/* Prévia */}
          <div className="relative flex flex-col bg-muted/40">
            <div className="relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden md:aspect-auto md:flex-1">
              {current?.url ? (
                <img
                  src={current.url}
                  alt={post?.title ?? "Prévia do conteúdo"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <ImageIcon className="h-8 w-8 opacity-40" />
                  <span className="text-xs">Sem imagem</span>
                </div>
              )}
              <Badge
                variant="outline"
                className={`absolute left-3 top-3 border bg-background/85 backdrop-blur ${tone.badge}`}
              >
                {DECISION_LABEL[currentStatus] ?? DECISION_LABEL.pending}
              </Badge>
            </div>
            {gallery.length > 1 && (
              <div className="flex gap-2 overflow-x-auto border-t border-border/60 bg-background/60 p-2">
                {gallery.map((g, i) => (
                  <button
                    key={g.url + i}
                    type="button"
                    onClick={() => setActiveMedia(i)}
                    className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-md border transition ${
                      i === activeMedia
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border/60 opacity-70 hover:opacity-100"
                    }`}
                  >
                    <img src={g.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Conteúdo e decisão */}
          <div className="flex max-h-[88vh] min-w-0 flex-col">
            <DialogHeader className="space-y-2 border-b border-border/60 px-5 py-4 text-left">
              <DialogTitle className="pr-8 text-base font-semibold leading-snug">
                {post?.title ?? "Conteúdo"}
              </DialogTitle>
              <div className="flex flex-wrap items-center gap-1.5">
                {(post?.channels ?? []).map((c) => (
                  <Badge key={c} variant="secondary" className="rounded-md text-[10px] capitalize">
                    {c}
                  </Badge>
                ))}
                {post?.scheduled_at && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarClock className="h-3 w-3" />
                    Previsto para {formatDate(post.scheduled_at as string)}
                  </span>
                )}
                {sla && sla.status !== "none" ? <SlaBadge sla={sla} /> : null}
              </div>
            </DialogHeader>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
              {q.isLoading ? (
                <>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-32 w-full" />
                </>
              ) : q.isError ? (
                <ErrorState
                  description="Não conseguimos carregar este conteúdo."
                  message={(q.error as Error)?.message}
                  onRetry={() => void q.refetch()}
                />
              ) : (
                <>
                  {decided && approval && (
                    <section className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                        Sua decisão
                      </div>
                      <div className={`rounded-md border px-3 py-2 text-xs ${tone.box}`}>
                        <div className="font-medium">
                          {DECISION_LABEL[approval.status] ?? "Respondido"}
                        </div>
                        {approval.notes && (
                          <div className="mt-1 whitespace-pre-line opacity-80">
                            {approval.notes}
                          </div>
                        )}
                        {(approval.decided_by_name || approval.decided_at) && (
                          <div className="mt-1.5 inline-flex items-center gap-1 opacity-70">
                            <User2 className="h-3 w-3" />
                            {approval.decided_by_name ?? "Você"}
                            {approval.decided_at && <> · {formatDate(approval.decided_at)}</>}
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                  <section className="space-y-1.5">
                    <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                      Texto da publicação
                    </div>
                    <div className="whitespace-pre-line rounded-md border border-border/60 bg-muted/40 p-3 leading-relaxed">
                      {(post?.copy as string) || "Sem texto por enquanto."}
                    </div>
                  </section>
                  {post?.script && (
                    <section className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                        Roteiro
                      </div>
                      <div className="whitespace-pre-line rounded-md border border-border/60 bg-muted/40 p-3 leading-relaxed">
                        {post.script}
                      </div>
                    </section>
                  )}
                  {mode && (
                    <section className="space-y-1.5">
                      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                        {mode === "reject"
                          ? "Por que você está recusando?"
                          : mode === "adjust"
                            ? "O que deve ser ajustado?"
                            : "Seu comentário"}
                      </div>
                      <Textarea
                        autoFocus
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                          mode === "comment"
                            ? "Deixe uma observação para a equipe…"
                            : "Explique com detalhes para a equipe resolver de primeira…"
                        }
                        className="min-h-[110px] resize-none"
                      />
                      {!note.trim() && mode !== "comment" && (
                        <p className="text-[11px] text-muted-foreground">
                          O comentário é obrigatório nesta opção.
                        </p>
                      )}
                    </section>
                  )}
                </>
              )}
            </div>

            {/* Ações */}
            <div className="space-y-3 border-t border-border/60 bg-card/70 px-5 py-4">
              {!canDecide ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Este acesso é de acompanhamento: as decisões ficam com quem tem login
                    autorizado.
                  </p>
                  <Button size="sm" variant="ghost" className="w-full" onClick={onClose}>
                    Voltar para a lista
                  </Button>
                </div>
              ) : mode ? (
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setMode(null);
                      setNote("");
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    variant={mode === "reject" ? "destructive" : "default"}
                    disabled={m.isPending || (mode !== "comment" && !note.trim())}
                    onClick={() =>
                      m.mutate({
                        decision: mode === "reject" ? "rejected" : mode,
                        note: note.trim() || undefined,
                      })
                    }
                  >
                    {m.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : mode === "reject" ? (
                      "Confirmar recusa"
                    ) : mode === "adjust" ? (
                      "Enviar pedido de ajuste"
                    ) : (
                      "Enviar comentário"
                    )}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={m.isPending}
                    onClick={() => m.mutate({ decision: "approved" })}
                  >
                    {m.isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-4 w-4" />
                    )}
                    {decided && currentStatus === "approved" ? "Manter aprovado" : "Aprovar"}
                  </Button>
                  <div className="grid grid-cols-3 gap-2">
                    <Button size="sm" variant="outline" onClick={() => setMode("adjust")}>
                      <MessageSquareWarning className="mr-1 h-4 w-4" /> Ajustes
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setMode("reject")}>
                      <X className="mr-1 h-4 w-4" /> Recusar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setMode("comment")}>
                      <MessageCircle className="mr-1 h-4 w-4" /> Comentar
                    </Button>
                  </div>
                  <Button size="sm" variant="ghost" className="w-full" onClick={onClose}>
                    Voltar para a lista
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SlaBadge({
  sla,
}: {
  sla: { status?: string; hoursRemaining?: number; hoursOverdue?: number };
}) {
  const hours = sla.status === "overdue" ? (sla.hoursOverdue ?? 0) : (sla.hoursRemaining ?? 0);
  const duration = hours >= 24 ? `${Math.ceil(hours / 24)}d` : `${Math.ceil(hours)}h`;
  if (sla.status === "overdue") {
    return (
      <Badge variant="outline" className="border-severity-critical/30 text-severity-critical">
        Prazo excedido · {duration}
      </Badge>
    );
  }
  if (sla.status === "at_risk") {
    return (
      <Badge variant="outline" className="border-severity-warning/30 text-severity-warning">
        Prazo próximo · {duration}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-health-good/30 text-health-good">
      No prazo · {duration}
    </Badge>
  );
}

/* -------------------------------- CALENDAR -------------------------------- */

export function CalendarTab() {
  return <PortalCalendar />;
}

/* ---------------------------------- FILES --------------------------------- */

export function FilesTab() {
  return <PortalFiles />;
}

/* -------------------------------- BRIEFING -------------------------------- */

export function BriefingTab() {
  return <PortalBriefing />;
}
