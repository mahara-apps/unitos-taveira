import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  FileText,
  ImageOff,
  Layers,
  Loader2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DashboardPanelSurface, DashboardIconFrame } from "@/components/ui/dashboard-primitives";

import {
  PUBLICATION_STATUS,
  dayLabel,
  formatLabel,
  relativeLabel,
  timeLabel,
  NETWORK_COLOR,
} from "@/lib/publication-status-tokens";
import { SOCIAL_NETWORKS, classifySocialNetwork } from "@/lib/calendar-tokens";
import type { PublicationItem } from "@/lib/calendar-board.functions";
import type { PendingSchedulePost } from "@/lib/scheduling-wizard.functions";

/**
 * Painel "Operação" — o que precisa de ação agora. Todos os itens vêm do
 * estado real das peças/destinos; nada é simulado.
 */

function Block({
  icon,
  tone,
  title,
  count,
  children,
  action,
}: {
  icon: React.ReactNode;
  tone?: string;
  title: string;
  count?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <DashboardPanelSurface>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <DashboardIconFrame className={tone}>{icon}</DashboardIconFrame>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold tracking-tight">{title}</div>
            {count !== undefined ? (
              <div className="text-[11px] text-muted-foreground">{count}</div>
            ) : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </DashboardPanelSurface>
  );
}

function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-3.5 py-4 text-[11px] leading-relaxed text-muted-foreground">
      <div className="font-medium text-foreground/80">{title}</div>
      {hint ? <div>{hint}</div> : null}
    </div>
  );
}

function Thumb({ url }: { url: string | null }) {
  return url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="h-8 w-8 shrink-0 rounded border border-border/60 object-cover"
    />
  ) : (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-dashed border-border/70 text-muted-foreground/60">
      <ImageOff className="h-3 w-3" />
    </span>
  );
}

function Channels({ item }: { item: PublicationItem }) {
  const nets = Array.from(
    new Set(
      (item.destinations.length ? item.destinations.map((d) => d.channel) : item.channels).map(
        (c) => classifySocialNetwork(c),
      ),
    ),
  );
  if (!nets.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {nets.slice(0, 4).map((k) => {
        const Icon = SOCIAL_NETWORKS[k].Icon;
        return <Icon key={k} className={cn("h-3 w-3", NETWORK_COLOR[k])} strokeWidth={2} />;
      })}
    </span>
  );
}

export function OperationsPanel({
  upcoming,
  attention,
  failures,
  drafts,
  draftsLoading,
  selectedDrafts = [],
  onToggleDraft,
  onBulkDrafts,
  onOpen,
  onOpenDraft,
  onSeeAllDrafts,
}: {
  upcoming: PublicationItem[];
  attention: PublicationItem[];
  failures: PublicationItem[];
  drafts: PendingSchedulePost[];
  draftsLoading?: boolean;
  /** IDs marcados para ação em massa. */
  selectedDrafts?: string[];
  onToggleDraft?: (postId: string) => void;
  onBulkDrafts?: () => void;
  onOpen: (item: PublicationItem) => void;
  onOpenDraft: (draft: PendingSchedulePost, index: number) => void;
  onSeeAllDrafts?: () => void;
}) {

  return (
    <div className="flex flex-col gap-3">
      <Block
        tone="border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300"
        icon={<CalendarClock className="h-4 w-4" />}
        title="Próximas publicações"
        count={`${upcoming.length} na fila`}
      >
        {upcoming.length === 0 ? (
          <Empty title="Nada agendado à frente" hint="Agende uma peça aprovada para vê-la aqui." />
        ) : (
          <ul className="divide-y divide-border/60">
            {upcoming.slice(0, 5).map((it) => {
              const token = PUBLICATION_STATUS[it.overall];
              return (
                <li key={it.postId}>
                  <button
                    type="button"
                    onClick={() => onOpen(it)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-muted/40"
                  >
                    <Thumb url={it.coverUrl} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground/80">
                          {dayLabel(it.when)}
                        </span>
                        <span className="tabular-nums">{timeLabel(it.when)}</span>
                      </span>
                      <span className="block truncate text-xs font-medium">{it.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Channels item={it} />
                        {it.formats.length ? (
                          <span>{it.formats.map(formatLabel).join(" · ")}</span>
                        ) : null}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                        token.chip,
                      )}
                    >
                      {token.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block
        tone="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300"
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Precisam de atenção"
        count={
          attention.length === 0
            ? "Nada pendente"
            : `${attention.length} ${attention.length === 1 ? "item" : "itens"}`
        }
      >
        {attention.length === 0 ? (
          <Empty title="Tudo certo" hint="Nenhuma pendência operacional agora." />
        ) : (
          <ul className="divide-y divide-border/60">
            {attention.slice(0, 6).map((it) => {
              const failed = it.destinations.filter((d) => d.status === "failed");
              const reason =
                it.overall === "failed"
                  ? "Falha de publicação"
                  : it.overall === "partial"
                    ? `Parcial — ${it.publishedCount}/${it.totalDestinations} destinos publicados`
                    : it.overall === "awaiting_approval"
                      ? "Aguardando aprovação"
                      : it.overall === "ready"
                        ? "Aprovado sem agendamento"
                        : "Requer verificação";
              return (
                <li key={it.postId}>
                  <button
                    type="button"
                    onClick={() => onOpen(it)}
                    className="flex w-full items-start gap-2 px-3.5 py-2 text-left transition-colors hover:bg-muted/40"
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        PUBLICATION_STATUS[it.overall].dot,
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{it.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {reason}
                      </span>
                      {failed[0]?.error ? (
                        <span className="mt-0.5 block line-clamp-2 text-[10px] leading-snug text-destructive">
                          {failed[0].error}
                        </span>
                      ) : null}
                    </span>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block
        tone="border-destructive/30 bg-destructive/10 text-destructive"
        icon={<XCircle className="h-4 w-4" />}
        title="Falhas recentes"
        count={
          failures.length === 0
            ? "Nenhuma falha"
            : `${failures.length} ${failures.length === 1 ? "peça" : "peças"}`
        }
      >
        {failures.length === 0 ? (
          <Empty title="Tudo certo" hint="Nenhuma falha de publicação encontrada." />
        ) : (
          <ul className="divide-y divide-border/60">
            {failures.slice(0, 4).map((it) => {
              const failed = it.destinations.filter((d) => d.status === "failed");
              return (
                <li key={it.postId} className="px-3.5 py-2">
                  <div className="flex items-start gap-2">
                    <Thumb url={it.coverUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{it.title}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {failed
                          .map(
                            (d) =>
                              `${SOCIAL_NETWORKS[classifySocialNetwork(d.channel)].label} · ${formatLabel(d.format)}`,
                          )
                          .join(" • ")}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Falhou {relativeLabel(it.updatedAt)}
                      </div>
                      {failed[0]?.error ? (
                        <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-destructive">
                          {failed[0].error}
                        </p>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1.5 h-6 px-2 text-[10px]"
                        onClick={() => onOpen(it)}
                      >
                        Ver detalhes
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Block>

      <Block
        tone="border-border/60 bg-muted/50 text-muted-foreground"
        icon={<FileText className="h-4 w-4" />}
        title="Rascunhos"
        count={
          draftsLoading
            ? "Carregando…"
            : `${drafts.length} ${drafts.length === 1 ? "rascunho" : "rascunhos"}`
        }
        action={
          <div className="flex items-center gap-1">
            {selectedDrafts.length && onBulkDrafts ? (
              <Button
                variant="outline"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={onBulkDrafts}
              >
                <Layers className="h-3 w-3" /> Em massa ({selectedDrafts.length})
              </Button>
            ) : null}
            {onSeeAllDrafts ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={onSeeAllDrafts}
              >
                Ver todos
              </Button>
            ) : null}
          </div>
        }
      >
        {draftsLoading ? (
          <div className="flex items-center gap-2 px-3.5 py-3 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
          </div>
        ) : drafts.length === 0 ? (
          <Empty title="Nenhum rascunho" hint="Peças em edição aparecem aqui." />
        ) : (
          <ul className="divide-y divide-border/60">
            {drafts.slice(0, 4).map((d, i) => (
              <li key={d.postId} className="flex items-center gap-2 pl-3.5">
                {onToggleDraft ? (
                  <Checkbox
                    checked={selectedDrafts.includes(d.postId)}
                    onCheckedChange={() => onToggleDraft(d.postId)}
                    aria-label={`Selecionar ${d.title}`}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => onOpenDraft(d, i)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-3.5 text-left transition-colors hover:bg-muted/40"
                >
                  <Thumb url={d.coverUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{d.title}</span>
                    <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      {d.channels.length ? (
                        <span className="inline-flex items-center gap-1">
                          {Array.from(new Set(d.channels.map((c) => classifySocialNetwork(c))))
                            .slice(0, 3)
                            .map((k) => {
                              const Icon = SOCIAL_NETWORKS[k].Icon;
                              return (
                                <Icon
                                  key={k}
                                  className={cn("h-3 w-3", NETWORK_COLOR[k])}
                                  strokeWidth={2}
                                />
                              );
                            })}
                        </span>
                      ) : null}
                      <span>{relativeLabel(d.approvedAt) || "—"}</span>
                      {d.coverUrl ? (
                        <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-2.5 w-2.5" /> mídia
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5">
                          <ImageOff className="h-2.5 w-2.5" /> sem mídia
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                </button>
              </li>
            ))}
          </ul>
        )}

      </Block>
    </div>
  );
}
