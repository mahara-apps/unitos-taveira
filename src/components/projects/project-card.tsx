// Card compacto de projeto — apenas apresentação, sem query própria.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ProjectCardProps = {
  name: string;
  accentColor: string;
  clientName: string | null;
  clientColor: string | null;
  statusLabel: string;
  statusClassName: string;
  planBadge?: ReactNode;
  periodLabel: string;
  approved: number;
  published: number;
  pending: number;
  total: number;
  ownerName?: string | null;
  onOpen: () => void;
};

export function ProjectCard(props: ProjectCardProps) {
  const completed = Math.min(props.total, props.approved + props.published);
  const pct = props.total > 0 ? Math.round((completed / props.total) * 100) : 0;
  const width = (value: number) => (props.total > 0 ? `${(value / props.total) * 100}%` : "0%");
  const initials = (props.ownerName ?? "Sem responsável")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return (
    <button
      type="button"
      onClick={props.onOpen}
      title={props.name}
      className={cn(
        "group relative flex min-h-[190px] w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-card p-4 text-left",
        "transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: props.accentColor }}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 pl-1">
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-foreground">{props.name}</span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: props.clientColor ?? props.accentColor }}
            />
            <span className="truncate">{props.clientName ?? "Sem cliente"}</span>
          </span>
        </span>
        <Badge
          variant="outline"
          className={cn("h-5 shrink-0 rounded-full px-2 text-[10px]", props.statusClassName)}
        >
          {props.statusLabel}
        </Badge>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 pl-1">
        {props.planBadge ?? null}
        <span className="inline-flex h-6 max-w-full items-center rounded-full border border-border/60 bg-muted/35 px-2.5 text-[10px] text-muted-foreground">
          <span className="truncate">{props.periodLabel}</span>
        </span>
      </div>

      <div className="mt-auto space-y-2 pl-1 pt-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="tabular-nums">
            <strong className="font-semibold text-foreground">{completed}</strong>/{props.total} peças concluídas
          </span>
          <span className="font-medium tabular-nums text-foreground">{pct}%</span>
        </div>
        <span className="flex h-1.5 overflow-hidden rounded-full bg-muted">
          <span className="bg-content-published" style={{ width: width(props.published) }} />
          <span className="bg-content-approved" style={{ width: width(props.approved) }} />
          <span className="bg-severity-info" style={{ width: width(props.pending) }} />
        </span>
        <span className="flex min-w-0 items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {props.approved > 0 ? <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-content-approved" />{props.approved} aprovadas</span> : null}
          {props.published > 0 ? <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-content-published" />{props.published} publicadas</span> : null}
          {props.pending > 0 ? <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-severity-info" />{props.pending} pendentes</span> : null}
          <span className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" title={props.ownerName ?? "Sem responsável"}>
            {initials || "—"}
          </span>
        </span>
      </div>
    </button>
  );
}
