import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  Check,
  X,
  MessageSquareWarning,
  MessageCircle,
  Clock,
  Loader2,
  ImageIcon,
  User2,
  CalendarClock,
  CheckCircle2,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { PortalLink, usePortalApi, usePortalCanInteract, usePortalCanView } from "./portal-context";
import {
  ChannelDot,
  PortalRow,
  PortalSection,
  PortalStatusPill,
  PortalThumb,
  type PortalStatus,
} from "./portal-ui";
import type { PortalTabId } from "./portal-nav";
import { PautaApprovals } from "./portal-pauta";
import { PortalCalendar } from "./portal-calendar";
import { PortalBriefing } from "./portal-briefing";
import { PortalFiles } from "./portal-files";
import { PortalBrand } from "./portal-brand";
import { PLAN_PENDING_CLIENT_STATUS } from "@/lib/monthly-plan-client.types";
import { EmptyState, ErrorState, ListSkeleton, formatDate } from "./portal-shared";
import { formatDateTimeBr } from "@/lib/timezone";

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
  // O Início só consulta o que o cliente pode ver: módulo sem permissão não
  // gera chamada (o servidor recusaria) nem cartão na tela.
  const canApprovals = usePortalCanView("approvals");
  const canPauta = usePortalCanView("pauta");
  const canBriefing = usePortalCanView("briefing");
  const canCalendar = usePortalCanView("calendar");

  const metricsQ = useQuery({
    queryKey: ["portal", "metrics", api.scopeKey],
    queryFn: () => api.metrics(),
    staleTime: 30_000,
  });
  const pendingQ = useQuery({
    enabled: canApprovals,
    queryKey: ["portal", "approvals", api.scopeKey, "pending"],
    queryFn: () => api.approvals("pending"),
    staleTime: 30_000,
  });
  const plansQ = useQuery({
    enabled: canPauta,
    queryKey: ["portal", "plans", api.scopeKey],
    queryFn: () => api.plans(),
    staleTime: 30_000,
  });
  const briefingQ = useQuery({
    enabled: canBriefing,
    queryKey: ["portal", "briefing-requests", api.scopeKey],
    queryFn: () => api.briefingRequests(),
    staleTime: 30_000,
  });
  const calendarQ = useQuery({
    enabled: canCalendar,
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
    (!canApprovals || pendingQ.isError) &&
    (!canPauta || plansQ.isError) &&
    (!canBriefing || briefingQ.isError) &&
    (!canCalendar || calendarQ.isError);
  const loading =
    metricsQ.isLoading || (canPauta && plansQ.isLoading) || (canBriefing && briefingQ.isLoading);

  const pendingCount = canApprovals ? (metricsQ.data?.pending ?? pendingPosts.length) : 0;
  const scheduledCount = (calendarQ.data ?? []).filter(
    (p) => p.scheduled_at && !p.published_at,
  ).length;
  const publishedCount = (calendarQ.data ?? []).filter((p) => p.published_at).length;
  const todoCount =
    (pendingCount > 0 ? 1 : 0) +
    (plansAwaiting.length > 0 ? 1 : 0) +
    (briefingsPending.length > 0 ? 1 : 0);

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
    <div>
      <div className="px-0.5">
        <h1 className="text-[22px] font-extrabold tracking-tight">Olá!</h1>
        <p className="mt-0.5 text-[13.5px] text-muted-foreground">
          {loading
            ? "Carregando seu resumo…"
            : todoCount === 0
              ? "Você está em dia — nada precisa de você agora."
              : `Você tem ${todoCount} ${todoCount === 1 ? "coisa" : "coisas"} para fazer hoje.`}
        </p>
      </div>

      {/* Cartão-herói: UMA tarefa em destaque */}
      <div className="mt-4">
        {loading ? (
          <Skeleton className="h-44 w-full rounded-[18px]" />
        ) : pendingCount > 0 ? (
          <HeroCard
            label="Precisa de você"
            title={`${pendingCount} ${pendingCount === 1 ? "conteúdo para aprovar" : "conteúdos para aprovar"}`}
            description="Revise as artes e legendas e aprove — ou peça ajustes num toque."
            cta="Revisar agora"
            tab="approvals"
          />
        ) : plansAwaiting.length > 0 ? (
          <HeroCard
            label="Precisa de você"
            title={
              plansAwaiting.length === 1
                ? "1 pauta para responder"
                : `${plansAwaiting.length} pautas para responder`
            }
            description="Confira os temas propostos e diga o que segue."
            cta="Ver pauta"
            tab="pauta"
          />
        ) : briefingsPending.length > 0 ? (
          <HeroCard
            label="Precisa de você"
            title="Responder briefing"
            description={
              briefingsPending[0]?.due_at
                ? `A equipe precisa de algumas informações até ${formatDate(briefingsPending[0].due_at)}.`
                : "A equipe precisa de algumas informações da sua marca."
            }
            cta="Responder agora"
            tab="briefing"
          />
        ) : (
          <div className="flex items-center gap-3 rounded-[18px] border border-border bg-card p-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-portal-published-soft">
              <CheckCircle2 className="h-5 w-5 text-portal-published" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-extrabold">Tudo em dia</div>
              <p className="text-xs text-muted-foreground">
                Assim que a equipe enviar algo para você, aparece aqui.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Resumo curto */}
      <div className="mt-4 grid grid-cols-3 gap-2.5">
        <SummaryCell
          label="Aguardando você"
          value={pendingCount}
          status="waiting"
          loading={loading}
        />
        <SummaryCell
          label="Agendados"
          value={scheduledCount}
          status="scheduled"
          loading={calendarQ.isLoading}
        />
        <SummaryCell
          label="Publicados"
          value={publishedCount}
          status="published"
          loading={calendarQ.isLoading}
        />
      </div>

      {/* Próximas publicações */}
      {canCalendar ? (
        <PortalSection
          title="Próximas publicações"
          action={
            <PortalLink tab="calendar" className="text-[12.5px] font-bold text-primary">
              Ver tudo
            </PortalLink>
          }
        >
          {calendarQ.isLoading ? (
            <ListSkeleton />
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nenhuma publicação com data"
              description="Quando um conteúdo aprovado receber data, ele aparece aqui."
            />
          ) : (
            <div className="space-y-2.5">
              {upcoming.map((p) => (
                <PortalRow
                  key={p.id}
                  thumbUrl={(p as { cover_url?: string | null }).cover_url ?? null}
                  title={p.title ?? "Conteúdo"}
                  status="scheduled"
                  statusLabel="Agendado"
                  meta={
                    <>
                      <span>
                        {formatDateTimeBr(p.scheduled_at)}
                      </span>
                      {(p.channels ?? []).length > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          <ChannelDot /> {channelName((p.channels ?? [])[0] as string)}
                        </span>
                      ) : null}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </PortalSection>
      ) : null}

      {/* Atividade recente */}
      <PortalSection title="Atividade recente">
        {calendarQ.isLoading ? (
          <ListSkeleton />
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="Nada por aqui ainda"
            description="Suas aprovações e respostas ficam registradas nesta lista."
          />
        ) : (
          <ol className="space-y-2.5">
            {recent.slice(0, 4).map((r) => (
              <li key={r.id}>
                <div className="flex min-h-[62px] items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[11px] bg-portal-published-soft">
                    <Check className="h-5 w-5 text-portal-published" strokeWidth={2.4} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold">{r.detail}</div>
                    <div className="mt-0.5 truncate text-[11.5px] font-semibold text-muted-foreground">
                      {r.text} · {formatDate(r.when)}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </PortalSection>
    </div>
  );
}

/** Cartão-herói: a única tarefa em destaque no Início. */
function HeroCard({
  label,
  title,
  description,
  cta,
  tab,
}: {
  label: string;
  title: string;
  description: string;
  cta: string;
  tab: PortalTabId;
}) {
  return (
    <div className="rounded-[18px] bg-gradient-to-br from-portal-primary to-portal-primary-strong p-[18px] text-white shadow-lg shadow-portal-primary/25">
      <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-wider">
        <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> {label}
      </span>
      <h2 className="mt-3 text-[20px] font-extrabold leading-tight">{title}</h2>
      <p className="mt-1 text-[13px] leading-snug opacity-90">{description}</p>
      <PortalLink
        tab={tab}
        className="mt-4 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-extrabold text-portal-primary-strong"
      >
        {cta} <ArrowRight className="h-4 w-4" strokeWidth={2.6} />
      </PortalLink>
    </div>
  );
}

/** Resumo pequeno (substitui os KPIs). */
function SummaryCell({
  label,
  value,
  status,
  loading,
}: {
  label: string;
  value: number;
  status: PortalStatus;
  loading?: boolean;
}) {
  const color =
    status === "waiting"
      ? "text-portal-waiting"
      : status === "scheduled"
        ? "text-portal-scheduled"
        : "text-portal-published";
  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-3 text-center">
      <div className={`text-[20px] font-extrabold leading-none ${color}`}>
        {loading ? <Skeleton className="mx-auto h-5 w-8" /> : value}
      </div>
      <div className="mt-1.5 text-[11px] font-bold leading-tight text-muted-foreground">
        {label}
      </div>
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
  const qc = useQueryClient();
  const canDecide = usePortalCanInteract("approvals");
  const [filter, setFilter] = useState<ApprovalFilter>("pending");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<null | "approve" | "reject">(null);
  const [bulkNote, setBulkNote] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

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
  const list = q.data ?? [];
  const ids = list.map((p) => p.id);
  const openIndex = openId ? ids.indexOf(openId) : -1;
  // "X de N": quantos já foram respondidos entre os que chegaram para você.
  const total = filter === "pending" ? pendingCount : list.length;

  // Só faz sentido decidir em lote o que ainda está aguardando o cliente.
  const decidableIds = list
    .filter((p) => {
      const st = (p as unknown as { approval?: { status?: string } }).approval?.status ?? "pending";
      return st === "pending";
    })
    .map((p) => p.id);
  const canBatch = canDecide && decidableIds.length > 1;
  const selectedIds = decidableIds.filter((id) => selected.has(id));
  const allSelected = decidableIds.length > 0 && selectedIds.length === decidableIds.length;

  const exitSelection = () => {
    setSelectMode(false);
    setSelected(new Set());
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(decidableIds));

  /** Envia uma decisão por item, mantendo as mesmas checagens do servidor. */
  const runBulk = async (decision: "approved" | "rejected", note?: string) => {
    const targets = [...selectedIds];
    setProgress({ done: 0, total: targets.length });
    const failed: string[] = [];
    let lastError = "";
    for (const id of targets) {
      try {
        await api.decidePost({ postId: id, decision, note });
      } catch (err) {
        failed.push(id);
        lastError = err instanceof Error ? err.message : String(err);
      }
      setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
    }
    setProgress(null);
    setBulk(null);
    setBulkNote("");
    setSelected(new Set(failed));
    if (failed.length === 0) setSelectMode(false);
    const ok = targets.length - failed.length;
    if (ok > 0) {
      toast.success(
        decision === "approved"
          ? `${ok} ${ok === 1 ? "conteúdo aprovado" : "conteúdos aprovados"}`
          : `${ok} ${ok === 1 ? "conteúdo reprovado" : "conteúdos reprovados"}`,
      );
    }
    if (failed.length > 0) {
      toast.error(`${failed.length} não puderam ser enviados`, { description: lastError });
    }
    void qc.invalidateQueries({ queryKey: ["portal", "approvals", api.scopeKey] });
    void qc.invalidateQueries({ queryKey: ["portal", "metrics", api.scopeKey] });
  };

  const busy = progress !== null;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-[21px] font-extrabold tracking-tight">Aprovações</h1>
          {filter === "pending" && pendingCount > 0 ? (
            <span className="ml-auto text-xs font-extrabold text-muted-foreground">
              {Math.max(0, total - list.length)} de {total}
            </span>
          ) : null}
        </div>
        {filter === "pending" && total > 0 ? (
          <div className="mt-3 h-[5px] overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-portal-published transition-[width]"
              style={{
                width: `${Math.min(100, Math.round((Math.max(0, total - list.length) / total) * 100))}%`,
              }}
            />
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {APPROVAL_FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => {
                  setFilter(f.id);
                  exitSelection();
                }}
                aria-pressed={active}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-bold transition-colors ${
                  active ? "bg-accent text-primary" : "bg-muted text-muted-foreground"
                }`}
              >
                {f.label}
                {f.id === "pending" && pendingCount > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10.5px] font-extrabold text-white ${
                      active ? "bg-primary" : "bg-portal-waiting"
                    }`}
                  >
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
          {canBatch ? (
            <button
              type="button"
              onClick={() => (selectMode ? exitSelection() : setSelectMode(true))}
              className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[12.5px] font-bold text-muted-foreground transition-colors hover:bg-muted"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {selectMode ? "Cancelar seleção" : "Selecionar"}
            </button>
          ) : null}
        </div>
      </div>

      {selectMode ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5">
          <button
            type="button"
            onClick={toggleAll}
            className="text-[12.5px] font-bold text-primary underline-offset-2 hover:underline"
          >
            {allSelected ? "Limpar seleção" : "Selecionar todos"}
          </button>
          <span className="text-[12px] font-semibold text-muted-foreground">
            {selectedIds.length} de {decidableIds.length} selecionados
          </span>
        </div>
      ) : filter === "pending" && pendingCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          Toque num conteúdo para ver a arte e a legenda. Aprove ou peça ajustes.
        </p>
      ) : null}

      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState
          description="Não conseguimos carregar seus conteúdos agora."
          message={(q.error as Error)?.message}
          onRetry={() => q.refetch()}
        />
      ) : !list.length ? (
        <EmptyState
          icon={filter === "pending" ? CheckCircle2 : CheckSquare}
          title={EMPTY_BY_FILTER[filter].title}
          description={EMPTY_BY_FILTER[filter].description}
        />
      ) : (
        <div className={`space-y-2.5 ${selectMode ? "pb-28" : ""}`}>
          {list.map((p) => (
            <ApprovalListItem
              key={p.id}
              post={p as unknown as Record<string, unknown>}
              onOpen={() => setOpenId(p.id)}
              selectable={selectMode && decidableIds.includes(p.id)}
              selected={selected.has(p.id)}
              onToggle={() => toggleOne(p.id)}
            />
          ))}
        </div>
      )}

      {/* Barra de ação em lote — acima da barra inferior no celular */}
      {selectMode && selectedIds.length > 0 ? (
        <div className="fixed inset-x-0 bottom-[76px] z-40 px-3 min-[900px]:bottom-4">
          <div className="mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2.5 shadow-lg">
            <span className="px-1 text-[12.5px] font-extrabold">
              {selectedIds.length} de {decidableIds.length} selecionados
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={busy}
                onClick={() => setBulk("reject")}
              >
                <X className="h-3.5 w-3.5" /> Reprovar
              </Button>
              <Button
                size="sm"
                className="h-9 gap-1.5 bg-portal-published text-white hover:bg-portal-published/90"
                disabled={busy}
                onClick={() => setBulk("approve")}
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {allSelected ? "Aprovar todos" : "Aprovar selecionados"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmação da decisão em lote */}
      <Dialog
        open={bulk !== null}
        onOpenChange={(o) => {
          if (!o && !busy) {
            setBulk(null);
            setBulkNote("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {bulk === "reject"
                ? `Reprovar ${selectedIds.length} conteúdo${selectedIds.length === 1 ? "" : "s"}?`
                : `Aprovar ${selectedIds.length} conteúdo${selectedIds.length === 1 ? "" : "s"}?`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              {bulk === "reject"
                ? "Explique o motivo. Ele será registrado em todos os conteúdos escolhidos."
                : "Sua aprovação será registrada em cada conteúdo selecionado."}
            </p>
            {bulk === "reject" ? (
              <Textarea
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                rows={3}
                placeholder="O que precisa mudar nesses conteúdos?"
                className="text-sm"
              />
            ) : null}
            {progress ? (
              <div className="text-[12.5px] font-bold text-muted-foreground">
                Enviando {progress.done} de {progress.total}…
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setBulk(null);
                setBulkNote("");
              }}
            >
              Voltar
            </Button>
            <Button
              size="sm"
              variant={bulk === "reject" ? "destructive" : "default"}
              disabled={busy || (bulk === "reject" && bulkNote.trim().length < 3)}
              onClick={() =>
                void runBulk(
                  bulk === "reject" ? "rejected" : "approved",
                  bulk === "reject" ? bulkNote.trim() : undefined,
                )
              }
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {bulk === "reject" ? "Reprovar selecionados" : "Aprovar selecionados"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {openId && (
        <ApprovalDialog
          postId={openId}
          index={openIndex}
          total={list.length}
          onNavigate={(dir) => {
            const next = ids[openIndex + dir];
            if (next) setOpenId(next);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** Linha compacta de aprovação (nada de card com arte gigante). */
function ApprovalListItem({
  post,
  onOpen,
  selectable = false,
  selected = false,
  onToggle,
}: {
  post: Record<string, unknown>;
  onOpen: () => void;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const status = ((post.approval as { status: string } | undefined)?.status ?? "pending") as string;
  const channels = Array.isArray(post.channels) ? (post.channels as string[]) : [];
  const format = typeof post.format === "string" ? post.format : null;
  const channel = channels[0] ? channelName(channels[0]) : "Publicação";
  const pillStatus: PortalStatus =
    status === "approved"
      ? "published"
      : status === "adjust" || status === "changes_requested"
        ? "adjust"
        : status === "rejected"
          ? "adjust"
          : "waiting";

  const body = (
    <>
      <PortalThumb url={(post.cover_url as string) ?? null} size="md" />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-sm font-bold leading-snug">
          {(post.title as string) || "Conteúdo"}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
            <ChannelDot />
            {channel}
            {format ? ` · ${format}` : ""}
          </span>
          <PortalStatusPill status={pillStatus}>
            {DECISION_LABEL[status] ?? DECISION_LABEL.pending}
          </PortalStatusPill>
        </div>
      </div>
    </>
  );

  if (selectable) {
    return (
      <div
        className={`flex min-h-[84px] w-full items-center gap-3 rounded-2xl border bg-card p-3 text-left transition-colors ${
          selected ? "border-primary bg-accent/40" : "border-border"
        }`}
      >
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggle?.()}
          aria-label="Selecionar conteúdo"
          className="h-5 w-5 shrink-0"
        />
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {body}
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label="Abrir conteúdo"
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground/70 hover:bg-muted"
        >
          <ChevronRight className="h-4.5 w-4.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-[84px] w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40"
    >
      {body}
      <ChevronRight className="h-4.5 w-4.5 shrink-0 text-muted-foreground/60" />
    </button>
  );
}

const CHANNEL_NAME: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  blog: "Blog",
};
function channelName(c: string) {
  return CHANNEL_NAME[c.toLowerCase()] ?? c;
}

function ApprovalDialog({
  postId,
  onClose,
  index = -1,
  total = 0,
  onNavigate,
}: {
  postId: string;
  onClose: () => void;
  /** Posição na lista (para "3 de 32") — opcional. */
  index?: number;
  total?: number;
  onNavigate?: (dir: 1 | -1) => void;
}) {
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
      <DialogContent className="h-dvh max-h-dvh w-full max-w-none gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-lg sm:border">
        <div className="flex h-full min-h-0 flex-col overflow-y-auto md:grid md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] md:overflow-hidden">
          {/* Prévia */}
          <div className="relative flex shrink-0 flex-col bg-muted/40">
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
          <div className="flex min-w-0 flex-1 flex-col md:max-h-[88vh]">
            <DialogHeader className="space-y-2 border-b border-border/60 px-5 py-4 text-left">
              {index >= 0 && total > 0 ? (
                <div className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
                  <span>
                    {index + 1} de {total}
                  </span>
                  {onNavigate ? (
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Conteúdo anterior"
                        disabled={index <= 0}
                        onClick={() => onNavigate(-1)}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-muted disabled:opacity-40"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Próximo conteúdo"
                        disabled={index >= total - 1}
                        onClick={() => onNavigate(1)}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-muted disabled:opacity-40"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </span>
                  ) : null}
                </div>
              ) : null}
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

            {/* Ações — fixas na base, alvos grandes */}
            <div className="sticky bottom-0 space-y-2.5 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:px-5 md:py-4">
              {!canDecide ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Este acesso é de acompanhamento: as decisões ficam com quem tem login
                    autorizado.
                  </p>
                  <Button variant="ghost" className="h-12 w-full" onClick={onClose}>
                    Voltar
                  </Button>
                </div>
              ) : mode ? (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="h-12 flex-1 font-bold"
                    onClick={() => {
                      setMode(null);
                      setNote("");
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    className="h-12 flex-1 font-bold"
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
                <>
                  <div className="flex gap-2.5">
                    <Button
                      variant="outline"
                      className="h-13 min-h-[52px] flex-1 rounded-2xl text-[14.5px] font-extrabold"
                      onClick={() => setMode("adjust")}
                    >
                      <MessageSquareWarning className="mr-1.5 h-[18px] w-[18px]" /> Pedir ajustes
                    </Button>
                    <Button
                      className="h-13 min-h-[52px] flex-[1.3] rounded-2xl bg-portal-published text-[15px] font-extrabold text-white hover:bg-portal-published/90"
                      disabled={m.isPending}
                      onClick={() => m.mutate({ decision: "approved" })}
                    >
                      {m.isPending ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-1.5 h-[19px] w-[19px]" strokeWidth={2.6} />
                      )}
                      {decided && currentStatus === "approved" ? "Manter aprovado" : "Aprovar"}
                    </Button>
                  </div>
                  <div className="flex items-center justify-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground"
                      onClick={() => setMode("comment")}
                    >
                      <MessageCircle className="mr-1 h-4 w-4" /> Comentar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-muted-foreground"
                      onClick={() => setMode("reject")}
                    >
                      <X className="mr-1 h-4 w-4" /> Recusar
                    </Button>
                  </div>
                </>
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
