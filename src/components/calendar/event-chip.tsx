import { normalizeContentFormat } from "@/lib/content-formats";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { EVENT_TYPE_STYLES, SOCIAL_NETWORKS, classifySocialNetwork } from "@/lib/calendar-tokens";
import type { CalendarPost } from "@/lib/calendar.functions";
import type { CalendarEvent } from "@/lib/calendar-events.functions";

export type UnifiedEvent =
  | { kind: "post"; data: CalendarPost }
  | { kind: "event"; data: CalendarEvent };

export function EventChip({
  item,
  onOpen,
}: {
  item: UnifiedEvent;
  onOpen: (item: UnifiedEvent) => void;
}) {
  if (item.kind === "post") {
    const p = item.data;
    const t = new Date(p.scheduled_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const primaryChannel = p.channels?.[0];
    const netKey = classifySocialNetwork(primaryChannel);
    const NetIcon = SOCIAL_NETWORKS[netKey].Icon;
    const isStory = normalizeContentFormat(p.format) === "stories";
    const isPublished = p.status === "published";
    const statusLabel = isPublished ? "Publicado" : "Agendado";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onOpen(item)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] transition-all hover:-translate-y-px hover:shadow-sm",
              EVENT_TYPE_STYLES.post.chip,
            )}
          >
            <NetIcon className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} />
            {isStory ? (
              <span className="inline-flex items-center gap-0.5 rounded-sm bg-fuchsia-500/15 px-1 py-[1px] text-[9px] font-semibold uppercase leading-none text-fuchsia-600 dark:text-fuchsia-400">
                <CircleDot className="h-2 w-2" strokeWidth={2.5} />
                Story
              </span>
            ) : null}
            <span className="tabular-nums font-semibold opacity-70">{t}</span>
            <span className="truncate flex-1">{p.title}</span>
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                isPublished ? "bg-primary" : "bg-muted-foreground/50",
              )}
              aria-label={statusLabel}
            />
            {p.author ? (
              <Avatar className="h-4 w-4 ring-1 ring-background">
                {p.author.avatar_url ? (
                  <AvatarImage src={p.author.avatar_url} alt={p.author.name ?? ""} />
                ) : null}
                <AvatarFallback className="text-[8px]">
                  {(p.author.name ?? "?").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <div className="font-medium">{p.title}</div>
          <div className="mt-0.5 text-muted-foreground">
            {SOCIAL_NETWORKS[netKey].label}
            {isStory ? " · Story" : ""} · {t} · {statusLabel}
            {p.author?.name ? ` · ${p.author.name}` : ""}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  const e = item.data;
  const style = EVENT_TYPE_STYLES[e.type];
  const t = e.all_day
    ? "Dia todo"
    : new Date(e.starts_at).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen(item)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] transition-all hover:-translate-y-px hover:shadow-sm",
            style.chip,
          )}
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} />
          {!e.all_day ? <span className="tabular-nums font-semibold opacity-70">{t}</span> : null}
          <span className="truncate flex-1">{e.title}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <div className="font-medium">{e.title}</div>
        <div className="mt-0.5 text-muted-foreground">
          {style.label} · {t}
          {e.is_global ? " · Global" : ""}
        </div>
        {e.description ? (
          <div className="mt-1 text-muted-foreground/80 line-clamp-3">{e.description}</div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
