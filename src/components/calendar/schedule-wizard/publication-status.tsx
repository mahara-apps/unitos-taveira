import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/errors";
import {
  cancelQueuedPlacementFn,
  listPostPublicationStateFn,
  rebindPlacementConnectionFn,
  retryFailedPlacementFn,
} from "@/lib/publish-retry.functions";

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  blog: "Blog",
};

const FORMAT_LABEL: Record<string, string> = {
  feed: "Feed",
  stories: "Stories",
  reels: "Reels",
  carrossel: "Carrossel",
};

/**
 * Painel "Publicação" do composer.
 *
 * Separa três conceitos que antes se misturavam:
 *  1. HISTÓRICO da publicação (placements, inclusive de contas já removidas);
 *  2. DESTINOS ATUAIS (client_social_accounts → social_connections ativas);
 *  3. seleção atual do composer (fora deste painel).
 *
 * Uma conta removida nunca volta como destino publicável: para recuperar um
 * destino histórico o usuário escolhe EXPLICITAMENTE uma conta atual do mesmo
 * canal (nunca casamento por username) e só então republicamos aquele destino.
 */
export function PublicationStatusPanel({ postId, brandId }: { postId: string; brandId: string }) {
  const qc = useQueryClient();
  const listState = useServerFn(listPostPublicationStateFn);
  const retryFn = useServerFn(retryFailedPlacementFn);
  const rebindFn = useServerFn(rebindPlacementConnectionFn);
  const cancelQueueFn = useServerFn(cancelQueuedPlacementFn);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});

  const stateQ = useQuery({
    queryKey: ["post-publication-state", postId],
    queryFn: () => listState({ data: { postId, brandId } }),
    refetchInterval: (q) =>
      (q.state.data?.destinations ?? []).some(
        (d) =>
          d.status === "scheduled" || d.status === "publishing" || d.status === "awaiting_retry",
      )
        ? 15_000
        : false,
  });

  const state = stateQ.data;
  // Só interessa quando houve tentativa real de publicação.
  const relevant =
    !!state &&
    state.destinations.some((d) =>
      ["published", "failed", "publishing", "awaiting_retry"].includes(d.status),
    );
  if (!relevant) return null;

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["post-publication-state", postId] });
    await qc.invalidateQueries({ queryKey: ["calendar-posts"] });
    await qc.invalidateQueries({ queryKey: ["publication-board"] });
  }

  async function handleRetry(placementId: string, label: string) {
    if (retrying) return;
    setRetrying(placementId);
    try {
      await retryFn({ data: { postId, brandId, placementId } });
      toast.success(`${label} recolocado na fila de publicação.`);
      await refresh();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setRetrying(null);
    }
  }

  /** Cancela o item pendente na fila para liberar reagendamento imediato. */
  async function handleCancelQueue(placementId: string, label: string) {
    if (retrying) return;
    setRetrying(placementId);
    try {
      await cancelQueueFn({ data: { postId, brandId, placementId } });
      toast.success(`${label} removido da fila. Você já pode reagendar.`);
      await refresh();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setRetrying(null);
    }
  }

  /** Recupera destino histórico: revincula à conta atual escolhida + republica. */
  async function handleRecover(placementId: string, label: string) {
    const connectionId = picked[placementId];
    if (!connectionId) {
      toast.error("Escolha a conta atual que deve publicar este destino.");
      return;
    }
    if (retrying) return;
    setRetrying(placementId);
    try {
      await rebindFn({ data: { postId, brandId, placementId, connectionId } });
      await retryFn({ data: { postId, brandId, placementId } });
      toast.success(`${label} recuperado e recolocado na fila de publicação.`);
      await refresh();
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setRetrying(null);
    }
  }

  const destinations = state!.destinations;
  const targets = state!.availableTargets ?? [];
  const failed = destinations.filter((d) => d.canRetry);
  const recoverable = destinations.filter((d) => d.needsRebind);

  return (
    <section className="rounded-lg border border-border/70 bg-muted/20 p-3">
      <header className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold tracking-tight">Publicação</span>
          {state!.overall === "published" ? (
            <Badge className="h-5 text-[10px]">Publicado</Badge>
          ) : state!.overall === "partial" ? (
            <Badge variant="destructive" className="h-5 text-[10px]">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Publicação parcial
            </Badge>
          ) : (
            <Badge variant="outline" className="h-5 text-[10px]">
              Em andamento
            </Badge>
          )}
        </div>
        {failed.length > 1 ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            disabled={!!retrying}
            onClick={async () => {
              // Reutiliza exatamente a ação individual, um destino por vez.
              for (const d of failed) {
                await handleRetry(d.placementId, CHANNEL_LABEL[d.channel] ?? d.channel);
              }
            }}
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Republicar destinos com falha
          </Button>
        ) : null}
      </header>

      {recoverable.length ? (
        <p className="mb-2 flex items-start gap-1.5 rounded-md border border-orange-500/40 bg-orange-500/5 px-2.5 py-2 text-[11px] leading-snug text-orange-700 dark:text-orange-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Esta publicação possui destinos históricos que não estão mais conectados. Escolha a conta
          atual do cliente para recuperar cada destino pendente.
        </p>
      ) : null}

      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Histórico da publicação
      </h4>
      <ul className="space-y-1.5">
        {destinations.map((d) => {
          const label = CHANNEL_LABEL[d.channel] ?? d.channel ?? "Destino";
          const fmt = FORMAT_LABEL[d.format] ?? d.format;
          const options = targets.filter((t) => !d.channel || t.channel === d.channel);
          return (
            <li
              key={d.placementId}
              className={cn(
                "rounded-md border px-2.5 py-2",
                d.status === "published"
                  ? "border-border/60 bg-background"
                  : d.status === "failed"
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
                  ) : (
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate text-xs font-medium">
                    {label} · {fmt}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {d.historical ? "Conta removida" : d.accountLabel ? `@${d.accountLabel}` : ""}
                  </span>
                  {d.status === "published" ? (
                    <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
                      Publicado
                    </Badge>
                  ) : d.status === "awaiting_retry" ? (
                    <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
                      Aguardando nova tentativa
                    </Badge>
                  ) : d.historical ? (
                    <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
                      Histórico
                    </Badge>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
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
                  {d.canRetry ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      disabled={!!retrying}
                      onClick={() => handleRetry(d.placementId, label)}
                    >
                      {retrying === d.placementId ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3 w-3" />
                      )}
                      Republicar {label}
                    </Button>
                  ) : null}
                  {d.status === "awaiting_retry" && d.canCancelQueue ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      disabled={!!retrying}
                      onClick={() => handleCancelQueue(d.placementId, label)}
                    >
                      {retrying === d.placementId ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <XCircle className="mr-1 h-3 w-3" />
                      )}
                      Cancelar da fila
                    </Button>
                  ) : null}
                </div>
              </div>

              {d.needsRebind ? (
                <div className="mt-2 space-y-1.5 rounded-md border border-border/60 bg-background px-2.5 py-2">
                  <p className="text-[11px] text-muted-foreground">
                    {options.length
                      ? `Destinos atuais disponíveis para ${label}: escolha a conta que deve publicar.`
                      : `Nenhuma conta ${label} vinculada a este cliente hoje. Vincule em Perfil do cliente > Canais.`}
                  </p>
                  {options.length ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Select
                        value={picked[d.placementId] ?? ""}
                        onValueChange={(v) =>
                          setPicked((prev) => ({ ...prev, [d.placementId]: v }))
                        }
                      >
                        <SelectTrigger className="h-7 w-[260px] text-[11px]">
                          <SelectValue placeholder="Selecionar conta atual" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((t) => (
                            <SelectItem
                              key={t.connectionId}
                              value={t.connectionId}
                              className="text-[11px]"
                            >
                              {CHANNEL_LABEL[t.channel] ?? t.channel} ·{" "}
                              {t.handle ? `@${t.handle}` : t.accountLabel}
                              {t.externalId ? ` · ID ${t.externalId}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={!!retrying || !picked[d.placementId]}
                        onClick={() => handleRecover(d.placementId, label)}
                      >
                        {retrying === d.placementId ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1 h-3 w-3" />
                        )}
                        Republicar {label}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {d.status === "failed" && d.error ? (
                <p className="mt-1 pl-5 text-[11px] leading-snug text-destructive">{d.error}</p>
              ) : null}
              {d.status === "awaiting_retry" ? (
                <p className="mt-1 pl-5 text-[11px] leading-snug text-muted-foreground">
                  {d.error ? `${d.error} · ` : ""}
                  {d.nextAttemptAt
                    ? `Próxima tentativa automática às ${new Date(d.nextAttemptAt).toLocaleString(
                        "pt-BR",
                        { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" },
                      )}.`
                    : "A publicação segue na fila e será tentada novamente."}
                </p>
              ) : null}
              {d.status === "published" && d.publishedAt ? (
                <p className="mt-1 pl-5 text-[11px] text-muted-foreground">
                  Publicado em{" "}
                  {new Date(d.publishedAt).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h4 className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Destinos disponíveis atualmente
      </h4>
      {targets.length ? (
        <ul className="space-y-1">
          {targets.map((t) => (
            <li
              key={t.connectionId}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-[11px]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="font-medium">{CHANNEL_LABEL[t.channel] ?? t.channel}</span>
              <span className="truncate text-muted-foreground">
                {t.handle ? `@${t.handle}` : t.accountLabel}
                {t.externalId ? ` · ID ${t.externalId}` : ""}
              </span>
              <span className="ml-auto shrink-0 text-emerald-600 dark:text-emerald-400">
                Pronto para publicar
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-border/70 px-2.5 py-2 text-[11px] text-muted-foreground">
          Nenhuma conta vinculada a este cliente. Vincule em Perfil do cliente &gt; Canais.
        </p>
      )}
    </section>
  );
}
