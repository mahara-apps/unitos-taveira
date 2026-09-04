import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SOCIAL_NETWORKS, type SocialNetworkKey } from "@/lib/calendar-tokens";
import { PUBLICATION_STATUS } from "@/lib/publication-status-tokens";

export type StatusFilter =
  | "all"
  | "proposed"
  | "scheduled"
  | "awaiting_approval"
  | "published"
  | "failed"
  | "drafts";

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: "Tudo",
  proposed: "Agenda sugerida",
  scheduled: "Agendados",
  awaiting_approval: "Aguardando aprovação",
  published: "Publicados",
  failed: "Falharam",
  drafts: "Rascunhos",
};

const ACCENT: Record<StatusFilter, string> = {
  all: "bg-foreground/60",
  proposed: PUBLICATION_STATUS.proposed.dot,
  scheduled: PUBLICATION_STATUS.scheduled.dot,
  awaiting_approval: PUBLICATION_STATUS.awaiting_approval.dot,
  published: PUBLICATION_STATUS.published.dot,
  failed: PUBLICATION_STATUS.failed.dot,
  drafts: PUBLICATION_STATUS.draft.dot,
};

/** Barra compacta de status — cada número é um filtro real sobre os dados. */
export function StatusFilterBar({
  counts,
  value,
  onChange,
}: {
  counts: Record<StatusFilter, number>;
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
}) {
  const order: StatusFilter[] = [
    "all",
    "proposed",
    "scheduled",
    "awaiting_approval",
    "published",
    "failed",
    "drafts",
  ];
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/60 bg-background px-1.5 py-1.5">
      {order.map((key) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-muted text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", ACCENT[key])} aria-hidden />
            {STATUS_FILTER_LABEL[key]}
            <span
              className={cn(
                "tabular-nums",
                key === "failed" && counts.failed > 0
                  ? "font-semibold text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {counts[key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Filtros secundários: canal e formato — compactos, sempre ligados aos dados. */
export function SecondaryFilters({
  channelOptions,
  channelFilter,
  onToggleChannel,
  onClearChannels,
  formatOptions,
  formatFilter,
  onFormat,
}: {
  channelOptions: Array<{ key: SocialNetworkKey; label: string; count: number }>;
  channelFilter: SocialNetworkKey[];
  onToggleChannel: (k: SocialNetworkKey) => void;
  onClearChannels: () => void;
  formatOptions: Array<{ key: string; label: string; count: number }>;
  formatFilter: string | null;
  onFormat: (v: string | null) => void;
}) {
  if (!channelOptions.length && !formatOptions.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {channelOptions.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Canal
          </span>
          {channelOptions.map((opt) => {
            const Icon = SOCIAL_NETWORKS[opt.key].Icon;
            const active = channelFilter.includes(opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onToggleChannel(opt.key)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="h-3 w-3" strokeWidth={2} />
                {opt.label}
                <span className="tabular-nums opacity-70">{opt.count}</span>
              </button>
            );
          })}
          {channelFilter.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              onClick={onClearChannels}
            >
              Limpar
            </Button>
          ) : null}
        </div>
      ) : null}

      {formatOptions.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Formato
          </span>
          {formatOptions.map((opt) => {
            const active = formatFilter === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onFormat(active ? null : opt.key)}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/60 bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {opt.label}
                <span className="tabular-nums opacity-70">{opt.count}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
