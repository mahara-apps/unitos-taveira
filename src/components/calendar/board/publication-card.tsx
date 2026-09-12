import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatLabel,
  timeLabel,
  NETWORK_COLOR,
  statusDisplay,
} from "@/lib/publication-status-tokens";
import { SOCIAL_NETWORKS, classifySocialNetwork } from "@/lib/calendar-tokens";
import type { PublicationItem } from "@/lib/calendar-board.functions";
import { formatDateTimeBr } from "@/lib/timezone";

/**
 * Card de PUBLICAÇÃO do calendário.
 * Regras de anatomia: TÍTULO sempre em primeiro plano (1–2 linhas), miniatura
 * pequena com placeholder neutro, meta "horário · canal · formato" e UM único
 * sinal de status (faixa lateral + pill pequena).
 */

export type CardDensity = "compact" | "comfortable";

function networksOf(item: PublicationItem) {
  const raw = item.destinations.length ? item.destinations.map((d) => d.channel) : item.channels;
  return Array.from(new Set(raw.map((c) => classifySocialNetwork(c))));
}

function formatsOf(item: PublicationItem) {
  const raw = item.destinations.length ? item.destinations.map((d) => d.format) : item.formats;
  return Array.from(new Set(raw.filter(Boolean).map((f) => formatLabel(f))));
}

function ChannelMeta({ item }: { item: PublicationItem }) {
  const nets = networksOf(item);
  if (!nets.length) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {nets.slice(0, 3).map((k) => {
        const Icon = SOCIAL_NETWORKS[k].Icon;
        return (
          <Icon
            key={k}
            className={cn("h-3 w-3", NETWORK_COLOR[k])}
            strokeWidth={2}
            aria-label={SOCIAL_NETWORKS[k].label}
          />
        );
      })}
      {nets.length === 1 ? <span>{SOCIAL_NETWORKS[nets[0]!].label}</span> : null}
    </span>
  );
}

/** Miniatura da arte — placeholder neutro e discreto quando não há arte. */
function Thumb({ url, size = 32 }: { url: string | null; size?: number }) {
  return url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="shrink-0 rounded-[5px] border border-border/60 object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[5px] bg-muted/70 text-muted-foreground/50"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <ImageIcon className="h-3 w-3" strokeWidth={1.75} />
    </span>
  );
}

function StatusPill({ item, className }: { item: PublicationItem; className?: string }) {
  const token = statusDisplay(item.overall);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium leading-tight",
        token.chip,
        className,
      )}
    >
      {token.label}
    </span>
  );
}

export function PublicationCard({
  item,
  onOpen,
  density = "comfortable",
}: {
  item: PublicationItem;
  onOpen: (item: PublicationItem) => void;
  density?: CardDensity;
}) {
  const token = statusDisplay(item.overall);
  const compact = density === "compact";
  const formats = formatsOf(item);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      title={item.title}
      className={cn(
        "group flex w-full items-start gap-2 rounded-md border border-l-[3px] border-border/60 bg-background text-left transition-all hover:border-border hover:shadow-sm",
        compact ? "px-1.5 py-1.5" : "px-2 py-2",
        token.accent,
      )}
    >
      <Thumb url={item.coverUrl} size={compact ? 26 : 34} />
      <span className="min-w-0 flex-1 space-y-1">
        <span
          className={cn(
            "block font-medium leading-snug text-foreground",
            compact ? "line-clamp-1 text-[11px]" : "line-clamp-2 text-xs",
          )}
        >
          {item.title}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] leading-none text-muted-foreground">
          <span className="font-semibold tabular-nums">{timeLabel(item.when)}</span>
          <ChannelMeta item={item} />
          {formats.length && !compact ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{formats.join(" · ")}</span>
            </>
          ) : null}
        </span>
        <StatusPill item={item} />
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
  const token = statusDisplay(item.overall);
  const formats = formatsOf(item);
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={cn(
        "flex w-full items-center gap-3 border-l-[3px] px-4 py-2.5 text-left transition-colors hover:bg-muted/40",
        token.accent,
      )}
    >
      <Thumb url={item.coverUrl} size={38} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">{item.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {showDay && item.when
              ? formatDateTimeBr(item.when)
              : timeLabel(item.when)}
          </span>
          <span aria-hidden>·</span>
          <ChannelMeta item={item} />
          {formats.length ? (
            <>
              <span aria-hidden>·</span>
              <span>{formats.join(" · ")}</span>
            </>
          ) : null}
        </span>
      </span>
      <StatusPill item={item} className="px-2 py-0.5" />
    </button>
  );
}
