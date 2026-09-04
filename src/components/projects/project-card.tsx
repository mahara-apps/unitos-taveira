// Card compacto de projeto — apenas apresentação, sem query própria.
import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
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
  published: number;
  total: number;
  onOpen: () => void;
};

export function ProjectCard(props: ProjectCardProps) {
  const pct = props.total > 0 ? Math.round((props.published / props.total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={props.onOpen}
      title={props.name}
      className={cn(
        "group relative flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-lg border border-border/60 bg-card px-3 py-2.5 text-left",
        "transition-colors hover:border-border hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: props.accentColor }}
      />

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 pl-1.5">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{props.name}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
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

      <div className="flex min-w-0 items-center gap-2 pl-1.5">
        {props.planBadge ?? null}
        <span className="truncate text-[11px] text-muted-foreground">{props.periodLabel}</span>
      </div>

      <div className="space-y-1 pl-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {props.published}/{props.total} publicadas
          </span>
          <span className="font-medium tabular-nums text-foreground">{pct}%</span>
        </div>
        <Progress value={pct} className="h-1" />
      </div>
    </button>
  );
}
