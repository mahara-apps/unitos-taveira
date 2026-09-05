import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { usePortalApi } from "./portal-context";
import { PortalSchedule } from "./portal-schedule";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  buildMonthGrid,
  formatMonth,
  shiftYm,
} from "./portal-shared";

/**
 * FASE 5 — Calendário do Portal.
 *
 * Apresentação apenas: consome o mesmo `api.calendar(mês)` (RPC `portal_calendar`)
 * e `api.post(id)` para o detalhe. Nada de stage, IDs, tarefas ou responsáveis:
 * cada item é classificado em linguagem de cliente como Agendado, Publicado ou
 * Compromisso.
 */

type Kind = "scheduled" | "published" | "appointment";

type CalItem = {
  id: string;
  kind: Kind;
  title: string;
  at: string | null;
  channels: string[];
  format: string | null;
  coverUrl: string | null;
  /** Compromissos não abrem detalhe de publicação. */
  isPost: boolean;
};

const KIND_META: Record<Kind, { label: string; dot: string; chip: string }> = {
  scheduled: {
    label: "Agendado",
    dot: "bg-sky-500",
    chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  published: {
    label: "Publicado",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  appointment: {
    label: "Compromisso",
    dot: "bg-violet-500",
    chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
};

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  blog: "Blog",
};

function channelLabel(c: string) {
  return CHANNEL_LABEL[c.toLowerCase()] ?? c;
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeLabel(iso: string | null) {
  if (!iso) return "Sem horário definido";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fullDateLabel(iso: string | null) {
  if (!iso) return "Data a definir";
  return new Date(iso).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });
}

function normalize(rows: unknown[]): CalItem[] {
  return rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const at =
      (typeof r.scheduled_at === "string" ? r.scheduled_at : null) ??
      (typeof r.published_at === "string" ? r.published_at : null);
    const stage = typeof r.stage === "string" ? r.stage : null;
    const eventType = typeof r.event_type === "string" ? r.event_type : null;
    const kind: Kind = eventType
      ? "appointment"
      : stage === "published" || typeof r.published_at === "string"
        ? "published"
        : "scheduled";
    return {
      id: String(
        r.id ?? `${at ?? "sem-data"}-${typeof r.title === "string" ? r.title : "publicacao"}`,
      ),
      kind,
      title: (typeof r.title === "string" && r.title) || "Publicação",
      at,
      channels: Array.isArray(r.channels) ? (r.channels as string[]).filter(Boolean) : [],
      format: typeof r.format === "string" ? r.format : null,
      coverUrl: typeof r.cover_url === "string" ? r.cover_url : null,
      isPost: !eventType,
    };
  });
}

export function PortalCalendar() {
  const api = usePortalApi();
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [view, setView] = useState<"month" | "agenda">("month");
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["portal", "calendar", api.scopeKey, ym],
    queryFn: () => api.calendar(ym),
  });

  const items = useMemo(() => normalize(q.data ?? []), [q.data]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalItem[]>();
    for (const it of items) {
      if (!it.at) continue;
      const k = it.at.slice(0, 10);
      map.set(k, [...(map.get(k) ?? []), it]);
    }
    return map;
  }, [items]);

  const counts = useMemo(
    () => ({
      scheduled: items.filter((i) => i.kind === "scheduled").length,
      published: items.filter((i) => i.kind === "published").length,
      appointment: items.filter((i) => i.kind === "appointment").length,
    }),
    [items],
  );

  const days = useMemo(() => buildMonthGrid(ym), [ym]);
  const todayKey = dayKey(new Date());
  const openItem = items.find((i) => i.id === openId) ?? null;

  const agenda = useMemo(() => {
    const groups = new Map<string, CalItem[]>();
    for (const it of items) {
      const k = it.at ? it.at.slice(0, 10) : "sem-data";
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const dayItems = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div className="space-y-4">
      {/* datas propostas pela equipe aguardando confirmação do cliente */}
      <PortalSchedule month={ym} />

      {/* navegação de mês + legenda */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => setYm(shiftYm(ym, -1))}
            aria-label="Mês anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[150px] rounded-md border border-border/60 bg-card px-3 py-1.5 text-center text-sm font-medium capitalize">
            {formatMonth(ym)}
          </div>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => setYm(shiftYm(ym, 1))}
            aria-label="Próximo mês"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="hidden items-center gap-1.5 sm:flex">
          <Button
            size="sm"
            variant={view === "month" ? "default" : "outline"}
            className="h-8 rounded-full text-xs"
            onClick={() => setView("month")}
          >
            Mês
          </Button>
          <Button
            size="sm"
            variant={view === "agenda" ? "default" : "outline"}
            className="h-8 rounded-full text-xs"
            onClick={() => setView("agenda")}
          >
            Agenda
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {(["scheduled", "published", "appointment"] as Kind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${KIND_META[k].dot}`} />
            {KIND_META[k].label} ({counts[k]})
          </span>
        ))}
      </div>

      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState
          description="Não conseguimos carregar o calendário deste mês agora."
          message={(q.error as Error)?.message}
          onRetry={() => q.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Nada programado neste mês"
          description="Assim que a equipe agendar publicações ou compromissos para este período, eles aparecem aqui."
        />
      ) : (
        <>
          {/* MÊS — só desktop */}
          {view === "month" && (
            <div className="hidden overflow-hidden rounded-xl border border-border/60 bg-card sm:block">
              <div className="grid grid-cols-7 border-b border-border/60 bg-muted/40">
                {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => (
                  <div
                    key={d}
                    className="px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((d, i) => {
                  const key = d ? dayKey(d) : null;
                  const dItems = key ? (byDay.get(key) ?? []) : [];
                  const isToday = key === todayKey;
                  return (
                    <div
                      key={i}
                      className={`min-h-[104px] border-b border-r border-border/60 p-2 align-top ${
                        d ? "" : "bg-muted/20"
                      }`}
                    >
                      {d && (
                        <>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span
                              className={`text-[11px] font-medium ${
                                isToday
                                  ? "flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {d.getDate()}
                            </span>
                          </div>
                          <div className="space-y-1">
                            {dItems.slice(0, 3).map((it) => (
                              <button
                                key={it.id}
                                onClick={() => setOpenId(it.id)}
                                title={it.title}
                                className="flex w-full items-center gap-1.5 rounded border border-border/60 bg-background px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-accent/50"
                              >
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${KIND_META[it.kind].dot}`}
                                />
                                <span className="truncate">{it.title}</span>
                              </button>
                            ))}
                            {dItems.length > 3 && (
                              <button
                                onClick={() => setSelectedDay(key)}
                                className="w-full rounded px-1 py-0.5 text-left text-[11px] font-medium text-primary hover:bg-primary/10"
                              >
                                +{dItems.length - 3} neste dia
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AGENDA — sempre no mobile, opcional no desktop */}
          <div className={view === "agenda" ? "space-y-4" : "space-y-4 sm:hidden"}>
            {agenda.map(([key, group]) => (
              <div key={key} className="space-y-2">
                <div className="text-xs font-medium capitalize text-muted-foreground">
                  {key === "sem-data" ? "Sem data definida" : fullDateLabel(group[0].at)}
                </div>
                <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
                  {group.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => setOpenId(it.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{it.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" /> {timeLabel(it.at)}
                          </span>
                          {it.channels.length > 0 && (
                            <span>{it.channels.map(channelLabel).join(" · ")}</span>
                          )}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${KIND_META[it.kind].chip}`}
                      >
                        {KIND_META[it.kind].label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* dia com muitos itens */}
      <Dialog open={Boolean(selectedDay)} onOpenChange={(o) => !o && setSelectedDay(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base capitalize">
              {fullDateLabel(dayItems[0]?.at ?? null)}
            </DialogTitle>
          </DialogHeader>
          <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
            {dayItems.map((it) => (
              <button
                key={it.id}
                onClick={() => {
                  setSelectedDay(null);
                  setOpenId(it.id);
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/40"
              >
                <span className="truncate">{it.title}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${KIND_META[it.kind].chip}`}
                >
                  {KIND_META[it.kind].label}
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <CalendarItemDialog item={openItem} onClose={() => setOpenId(null)} />
    </div>
  );
}

/* -------------------------------- detalhe -------------------------------- */

function CalendarItemDialog({ item, onClose }: { item: CalItem | null; onClose: () => void }) {
  const api = usePortalApi();
  const q = useQuery({
    queryKey: ["portal", "post", api.scopeKey, item?.id],
    queryFn: () => api.post(item!.id),
    enabled: Boolean(item?.isPost),
  });

  const detail = q.data as
    | { post?: { copy?: string | null; script?: string | null; cover_url?: string | null } }
    | undefined;
  const copy = detail?.post?.copy ?? null;
  const script = detail?.post?.script ?? null;
  const cover = detail?.post?.cover_url ?? item?.coverUrl ?? null;

  return (
    <Dialog open={Boolean(item)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="text-base">{item.title}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${KIND_META[item.kind].chip}`}
                >
                  {KIND_META[item.kind].label}
                </span>
                {item.format && (
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] capitalize text-muted-foreground">
                    {item.format}
                  </span>
                )}
              </div>

              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 capitalize">
                  <CalendarDays className="h-3.5 w-3.5" /> {fullDateLabel(item.at)}
                </div>
                <div className="flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" /> {timeLabel(item.at)}
                </div>
                {item.channels.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {item.channels.map(channelLabel).join(" · ")}
                  </div>
                )}
              </div>

              {cover && (
                <img
                  src={cover}
                  alt={item.title}
                  className="w-full rounded-lg border border-border/60 object-cover"
                />
              )}

              {item.isPost && q.isLoading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando conteúdo…
                </div>
              )}

              {copy && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    Texto da publicação
                  </div>
                  <p className="mt-1 whitespace-pre-line">{copy}</p>
                </div>
              )}
              {!copy && script && (
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Roteiro</div>
                  <p className="mt-1 whitespace-pre-line">{script}</p>
                </div>
              )}

              {item.isPost && !q.isLoading && !copy && !script && !cover && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ImageIcon className="h-3.5 w-3.5" /> O conteúdo desta publicação ainda está em
                  preparação.
                </p>
              )}

              {item.kind === "published" && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Já publicado no canal.
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Placeholder de carregamento usado enquanto o mês troca. */
export function CalendarSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}
