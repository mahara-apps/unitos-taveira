import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/errors";
import {
  PUBLICATION_STATUS,
  DESTINATION_STATUS_LABEL,
  formatLabel,
} from "@/lib/publication-status-tokens";
import { SOCIAL_NETWORKS, classifySocialNetwork } from "@/lib/calendar-tokens";
import type { PublicationItem } from "@/lib/calendar-board.functions";
import {
  cancelQueuedPlacementFn,
  retryFailedPlacementFn,
} from "@/lib/publish-retry.functions";
import { cancelPostScheduleFn } from "@/lib/scheduling-wizard.functions";
import { PostPreview } from "@/components/social/post-preview";
import type { PlacementFormat } from "@/lib/scheduling-formats";
import type { SocialChannel } from "@/lib/social-core/capabilities";
import { APP_TIMEZONE } from "@/lib/timezone";
import { scheduleDisplay, scheduleFullLabel } from "@/lib/post-schedule-display";

/**
 * Detalhe da publicação. Reaproveita as ações já existentes do pipeline:
 * cancelamento de agendamento (`cancelPostScheduleFn`) e republicação POR
 * DESTINO (`retryFailedPlacementFn`) — nunca reenvia destino já publicado.
 *
 * Layout de leitura em 2 colunas: prévia real do canal (mesma do Composer) +
 * legenda integral, agenda, destinos e histórico. Datas sempre no fuso oficial.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function dt(iso: string | null | undefined) {
  return iso ? scheduleFullLabel(iso) : "—";
}

const PREVIEW_FORMATS = ["feed", "reels", "stories", "carrossel"] as const;

function asPreviewFormat(format: string | null | undefined): PlacementFormat {
  const f = (format ?? "").toLowerCase();
  const hit = PREVIEW_FORMATS.find((k) => f.includes(k));
  if (hit) return hit as PlacementFormat;
  if (f.includes("stor")) return "stories";
  if (f.includes("short") || f.includes("video")) return "reels";
  return "feed";
}

function asPreviewChannel(channel: string | null | undefined): SocialChannel {
  return classifySocialNetwork(channel ?? "") as SocialChannel;
}

/** Abas de prévia: um par canal+formato por destino (ou pelos canais da peça). */
function previewTabs(item: PublicationItem) {
  const seen = new Set<string>();
  const tabs: Array<{
    key: string;
    label: string;
    channel: SocialChannel;
    format: PlacementFormat;
    handle: string;
  }> = [];
  for (const d of item.destinations) {
    const channel = asPreviewChannel(d.channel);
    const format = asPreviewFormat(d.format);
    const key = `${channel}-${format}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tabs.push({
      key,
      label: `${SOCIAL_NETWORKS[classifySocialNetwork(d.channel)].label} · ${formatLabel(d.format)}`,
      channel,
      format,
      handle: d.accountLabel ?? SOCIAL_NETWORKS[classifySocialNetwork(d.channel)].label,
    });
  }
  if (tabs.length === 0) {
    const channel = asPreviewChannel(item.channels[0] ?? "instagram");
    const format = asPreviewFormat(item.formats[0] ?? "feed");
    tabs.push({
      key: `${channel}-${format}`,
      label: `${SOCIAL_NETWORKS[classifySocialNetwork(item.channels[0] ?? "instagram")].label} · ${formatLabel(item.formats[0] ?? "feed")}`,
      channel,
      format,
      handle: SOCIAL_NETWORKS[classifySocialNetwork(item.channels[0] ?? "instagram")].label,
    });
  }
  return tabs;
}

export function PublicationDetailModal({
  item,
  open,
  onOpenChange,
  onEdit,
  onChanged,
}: {
  item: PublicationItem | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (item: PublicationItem) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const retry = useServerFn(retryFailedPlacementFn);
  const cancelQueue = useServerFn(cancelQueuedPlacementFn);
  const cancel = useServerFn(cancelPostScheduleFn);
  const [busy, setBusy] = useState<string | null>(null);
  const [tabKey, setTabKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const tabs = useMemo(() => (item ? previewTabs(item) : []), [item]);
  const schedule = useMemo(
    () =>
      scheduleDisplay({
        scheduled_at: item?.scheduledAt ?? null,
        proposed_at: item?.proposedAt ?? null,
        published_at: item?.publishedAt ?? null,
        schedule_status: item?.scheduleStatus ?? null,
        schedule_approved_at: item?.scheduleApprovedAt ?? null,
        schedule_client_comment: item?.scheduleClientComment ?? null,
      }),
    [item],
  );

  if (!item) return null;
  const token = PUBLICATION_STATUS[item.overall];
  const activeTab = tabs.find((t) => t.key === tabKey) ?? tabs[0]!;
  const copyText = item.copy?.trim() ?? "";
  const longCopy = copyText.length > 900;

  const canCancel =
    (item.overall === "scheduled" || item.overall === "failed") &&
    item.destinations.some((d) => d.status !== "published");
  const canEdit = item.overall !== "published";

  async function handleRetry(placementId: string, label: string) {
    if (busy) return;
    setBusy(placementId);
    try {
      await retry({ data: { postId: item!.postId, brandId: item!.brandId, placementId } });
      toast.success(`${label} recolocado na fila de publicação.`);
      await qc.invalidateQueries({ queryKey: ["publication-board"] });
      onChanged();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  /** Remove o item pendente da fila para liberar reagendamento imediato. */
  async function handleCancelQueue(placementId: string, label: string) {
    if (busy) return;
    setBusy(placementId);
    try {
      await cancelQueue({ data: { postId: item!.postId, brandId: item!.brandId, placementId } });
      toast.success(`${label} removido da fila. Você já pode reagendar.`);
      await qc.invalidateQueries({ queryKey: ["publication-board"] });
      onChanged();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (busy) return;
    setBusy("cancel");
    try {
      await cancel({ data: { postId: item!.postId, brandId: item!.brandId } });
      toast.success("Agendamento cancelado. A peça voltou para edição.");
      await qc.invalidateQueries({ queryKey: ["publication-board"] });
      onChanged();
      onOpenChange(false);
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={item.title}
      description={
        item.overall === "partial"
          ? `Publicação parcial — ${item.publishedCount} de ${item.totalDestinations} destinos publicados`
          : token.label
      }
      headerExtra={
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium", token.chip)}>
          {item.overall === "partial"
            ? `Parcial ${item.publishedCount}/${item.totalDestinations}`
            : token.label}
        </span>
      }
      footer={
        <>
          {canCancel ? (
            <Button variant="outline" size="sm" onClick={handleCancel} disabled={busy === "cancel"}>
              {busy === "cancel" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Cancelar agendamento
            </Button>
          ) : null}
          {canEdit ? (
            <Button size="sm" onClick={() => onEdit(item)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {item.overall === "draft"
                ? "Continuar edição"
                : item.overall === "scheduled"
                  ? "Editar / reagendar"
                  : "Editar"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:items-start">
        {/* Coluna 1 — prévia real do canal */}
        <div className="space-y-2">
          <div className="flex justify-center lg:justify-start">
            <PostPreview
              channel={activeTab.channel}
              format={activeTab.format}
              handle={activeTab.handle}
              avatarUrl={null}
              copy={copyText}
              media={item.coverUrl ? { publicUrl: item.coverUrl, kind: "image" } : null}
              mediaCount={1}
            />
          </div>
          {tabs.length > 1 ? (
            <div className="flex flex-wrap justify-center gap-1.5 lg:justify-start">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTabKey(t.key)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                    t.key === activeTab.key
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-center text-[11px] text-muted-foreground lg:text-left">
              {activeTab.label}
            </p>
          )}
        </div>

        {/* Coluna 2 — leitura e operação */}
        <div className="min-w-0 space-y-5">
          <Section title="Legenda">
            <div className="rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3">
              {copyText ? (
                <>
                  <p
                    className={cn(
                      "whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90",
                      longCopy && !expanded && "line-clamp-[12]",
                    )}
                  >
                    {copyText}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="text-[10.5px] text-muted-foreground">
                      {copyText.length} caracteres ·{" "}
                      {(copyText.match(/#[\p{L}\p{N}_]+/gu) ?? []).length} hashtags
                    </span>
                    <div className="flex items-center gap-1.5">
                      {longCopy ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setExpanded((v) => !v)}
                        >
                          <ChevronDown
                            className={cn(
                              "mr-1 h-3 w-3 transition-transform",
                              expanded && "rotate-180",
                            )}
                          />
                          {expanded ? "Recolher" : "Ver mais"}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(copyText)
                            .then(() => toast.success("Legenda copiada."))
                            .catch(() => toast.error("Não foi possível copiar."));
                        }}
                      >
                        <Copy className="mr-1 h-3 w-3" />
                        Copiar legenda
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sem legenda. Abra a edição para escrever o texto da peça.
                </p>
              )}
            </div>
          </Section>

          <Section title="Agenda">
            <div className="rounded-lg border border-border/60 bg-muted/10 px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    schedule.chip,
                  )}
                >
                  {schedule.stateLabel}
                </span>
                <span className="text-sm font-medium">{schedule.label}</span>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Fuso oficial: {APP_TIMEZONE} (GMT-3)
                {schedule.isProposal
                  ? " · data proposta pela pauta, ainda não é agendamento de publicação"
                  : ""}
              </p>
              {schedule.clientComment ? (
                <p className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-2.5 py-2 text-[11px] leading-snug text-rose-700 dark:text-rose-300">
                  Cliente pediu alteração: {schedule.clientComment}
                </p>
              ) : null}
            </div>
          </Section>

          <Section title={`Destinos (${item.destinations.length})`}>
            {item.destinations.length === 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground">
                <span>Nenhum destino configurado — a peça não pode publicar assim.</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onEdit(item)}
                >
                  Definir canal e conta
                </Button>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {item.destinations.map((d) => {
                  const net = SOCIAL_NETWORKS[classifySocialNetwork(d.channel)];
                  const Icon = net.Icon;
                  return (
                    <li
                      key={d.placementId ?? `${d.channel}-${d.format}`}
                      className={cn(
                        "rounded-md border px-2.5 py-2",
                        d.status === "failed"
                          ? "border-destructive/40 bg-destructive/5"
                          : "border-border/60 bg-background",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          {d.status === "published" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          ) : d.status === "failed" ? (
                            <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                          ) : d.status === "awaiting_retry" ? (
                            <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                          ) : d.status === "publishing" ? (
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-500" />
                          ) : (
                            <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-xs font-medium">
                            {net.label} · {formatLabel(d.format)}
                          </span>
                          {d.accountLabel ? (
                            <span className="truncate text-[11px] text-muted-foreground">
                              @{d.accountLabel}
                            </span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {DESTINATION_STATUS_LABEL[d.status] ?? d.status}
                          </span>
                          {d.permalink ? (
                            <a
                              href={d.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                            >
                              Ver <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : null}
                          {d.status === "awaiting_retry" &&
                          d.canCancelQueue &&
                          d.placementId ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              disabled={!!busy}
                              onClick={() => handleCancelQueue(d.placementId!, net.label)}
                            >
                              {busy === d.placementId ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <XCircle className="mr-1 h-3 w-3" />
                              )}
                              Cancelar da fila
                            </Button>
                          ) : null}
                          {d.canRetry && d.placementId ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              disabled={!!busy}
                              onClick={() => handleRetry(d.placementId!, net.label)}
                            >
                              {busy === d.placementId ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-1 h-3 w-3" />
                              )}
                              Tentar novamente
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {d.status === "failed" && d.error ? (
                        <p className="mt-1 pl-5 text-[11px] leading-snug text-destructive">
                          {d.error}
                          {d.attempts
                            ? ` (${d.attempts} tentativa${d.attempts > 1 ? "s" : ""})`
                            : ""}
                        </p>
                      ) : null}
                      {d.status === "awaiting_retry" ? (
                        <p className="mt-1 pl-5 text-[11px] leading-snug text-muted-foreground">
                          {d.error ? `${d.error} · ` : ""}
                          {d.nextAttemptAt
                            ? `Próxima tentativa automática em ${dt(d.nextAttemptAt)}.`
                            : "A publicação segue na fila e será tentada novamente."}
                        </p>
                      ) : null}
                      {d.status === "published" && d.publishedAt ? (
                        <p className="mt-1 pl-5 text-[11px] text-muted-foreground">
                          Publicado em {dt(d.publishedAt)}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {item.overall === "partial" ? (
            <div className="flex items-start gap-2 rounded-md border border-orange-500/40 bg-orange-500/5 px-3 py-2 text-[11px] text-orange-700 dark:text-orange-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Publicação parcial: {item.publishedCount} de {item.totalDestinations} destinos
                publicaram. A ação de republicar atua somente no destino com falha.
              </span>
            </div>
          ) : null}

          <Section title="Histórico">
            <details className="group rounded-md border border-border/60 bg-muted/10 px-3 py-2">
              <summary className="cursor-pointer list-none text-[11px] font-medium text-muted-foreground">
                Ver histórico da peça
              </summary>
              <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                <li>Criado em {dt(item.createdAt)}</li>
                {item.proposedAt ? <li>Agenda proposta para {dt(item.proposedAt)}</li> : null}
                {item.scheduleApprovedAt ? (
                  <li>Agenda aprovada em {dt(item.scheduleApprovedAt)}</li>
                ) : null}
                {item.scheduledAt ? <li>Agendado para {dt(item.scheduledAt)}</li> : null}
                {item.destinations
                  .filter((d) => d.publishedAt)
                  .map((d) => (
                    <li key={`h-${d.placementId}`}>
                      {SOCIAL_NETWORKS[classifySocialNetwork(d.channel)].label} publicado em{" "}
                      {dt(d.publishedAt)}
                    </li>
                  ))}
                {item.destinations
                  .filter((d) => d.status === "failed")
                  .map((d) => (
                    <li key={`hf-${d.placementId}`} className="text-destructive">
                      {SOCIAL_NETWORKS[classifySocialNetwork(d.channel)].label} falhou —{" "}
                      {d.error ?? "erro não informado"}
                    </li>
                  ))}
                <li>Última atualização em {dt(item.updatedAt)}</li>
              </ul>
            </details>
          </Section>
        </div>
      </div>
    </ExpandedModal>
  );
}
