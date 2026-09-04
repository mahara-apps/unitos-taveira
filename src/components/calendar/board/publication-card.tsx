import { AlertTriangle, CheckCircle2, Clock, ImageOff, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PUBLICATION_STATUS,
  formatLabel,
  formatChip,
  timeLabel,
  NETWORK_COLOR,
} from "@/lib/publication-status-tokens";
import { SOCIAL_NETWORKS, classifySocialNetwork } from "@/lib/calendar-tokens";
import type { PublicationItem } from "@/lib/calendar-board.functions";

/**
 * Card compacto de PUBLICAÇÃO (peça = unidade, mesmo com vários destinos).
 * Mostra thumbnail, horário, destinos e status real — nada de legenda completa.
 */

function DestinationDots({ item }: { item: PublicationItem }) {
  if (item.destinations.length === 0) {
    const nets = Array.from(new Set(item.channels.map((c) => classifySocialNetwork(c))));
    if (!nets.length) return null;
    return (
      <span className="flex items-center gap-1">
        {nets.slice(0, 3).map((k) => {
          const Icon = SOCIAL_NETWORKS[k].Icon;
          return <Icon key={k} className={cn("h-3 w-3", NETWORK_COLOR[k])} strokeWidth={2} />;
        })}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      {item.destinations.slice(0, 4).map((d) => {
        const key = classifySocialNetwork(d.channel);
        const Icon = SOCIAL_NETWORKS[key].Icon;
        const ok = d.status === "published";
        const bad = d.status === "failed";
        const busy = d.status === "publishing";
        return (
          <span
            key={d.placementId ?? key + d.format}
            className="inline-flex items-center gap-0.5"
            title={`${SOCIAL_NETWORKS[key].label} · ${formatLabel(d.format)} · ${d.status}`}
          >
            <Icon
              className={cn(
                "h-3 w-3",
                bad ? "text-destructive" : NETWORK_COLOR[key],
                !ok && !bad && !busy ? "opacity-70" : null,
              )}
              strokeWidth={2}
            />
            {ok ? (
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400" />
            ) : bad ? (
              <XCircle className="h-2.5 w-2.5 text-destructive" />
            ) : busy ? (
              <Loader2 className="h-2.5 w-2.5 animate-spin text-sky-500" />
            ) : (
              <Clock className="h-2.5 w-2.5 text-muted-foreground/70" />
            )}
          </span>
        );
      })}
      {item.destinations.length > 4 ? (
        <span className="text-[10px] tabular-nums text-muted-foreground">
          +{item.destinations.length - 4}
        </span>
      ) : null}
    </span>
  );
}

function Thumb({ url, size = 28 }: { url: string | null; size?: number }) {
  return url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="shrink-0 rounded-[4px] border border-border/60 object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[4px] border border-dashed border-border/70 text-muted-foreground/60"
      style={{ width: size, height: size }}
    >
      <ImageOff className="h-3 w-3" />
    </span>
  );
}

export function PublicationCard({
  item,
  onOpen,
}: {
  item: PublicationItem;
  onOpen: (item: PublicationItem) => void;
}) {
  const token = PUBLICATION_STATUS[item.overall];
  const failedCount = item.destinations.filter((d) => d.status === "failed").length;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={cn(
        "group flex w-full items-start gap-2 rounded-md border border-l-2 border-border/60 bg-background px-1.5 py-1.5 text-left transition-all hover:border-border hover:shadow-sm",
        token.accent,
      )}
    >
      <Thumb url={item.coverUrl} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
            {timeLabel(item.when)}
          </span>
          <span className="truncate text-[11px] font-medium leading-tight">{item.title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <DestinationDots item={item} />
          <span className={cn("h-1.5 w-1.5 rounded-full", token.dot)} aria-hidden />
          <span className={cn("text-[10px] font-medium leading-none", token.text)}>
            {item.overall === "partial"
              ? `${item.publishedCount}/${item.totalDestinations} publicados`
              : token.label}
          </span>
          {failedCount > 0 && item.overall !== "failed" ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-destructive">
              <AlertTriangle className="h-2.5 w-2.5" /> {failedCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

export function PublicationRow({
  item,
  onOpen,
  showDay = true,
}: {
  item: PublicationItem;
  onOpen: (item: PublicationItem) => void;
  showDay?: boolean;
}) {
  const token = PUBLICATION_STATUS[item.overall];
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
    >
      <Thumb url={item.coverUrl} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">{item.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {showDay ? (
            <span className="tabular-nums">
              {item.when
                ? new Date(item.when).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Sem data"}
            </span>
          ) : (
            <span className="tabular-nums">{timeLabel(item.when)}</span>
          )}
          <span aria-hidden>·</span>
          <DestinationDots item={item} />
          {item.formats.length ? (
            <>
              <span aria-hidden>·</span>
              <span className="flex flex-wrap items-center gap-1">
                {item.formats.map((f) => (
                  <span
                    key={f}
                    className={cn(
                      "rounded-full border px-1.5 py-px text-[10px] font-medium leading-none",
                      formatChip(f),
                    )}
                  >
                    {formatLabel(f)}
                  </span>
                ))}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
          token.chip,
        )}
      >
        {item.overall === "partial"
          ? `Parcial ${item.publishedCount}/${item.totalDestinations}`
          : token.label}
      </span>
    </button>
  );
}
