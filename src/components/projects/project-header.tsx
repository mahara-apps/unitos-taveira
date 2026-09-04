/**
 * Cabeçalho do projeto — barra única com identidade, cliente, responsável,
 * status e ações. Apenas apresentação; os controles vêm por slots.
 */
import type { ReactNode } from "react";
import { Progress } from "@/components/ui/progress";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";

export function ProjectHeader({
  name,
  color,
  clientName,
  clientNode,
  assignee,
  status,
  planBadge,
  actions,
  periodLabel,
  done,
  total,
}: {
  name: string;
  color: string;
  clientName: string;
  clientNode?: ReactNode;
  assignee?: ReactNode;
  status?: ReactNode;
  planBadge?: ReactNode;
  actions?: ReactNode;
  periodLabel: string;
  done: number;
  total: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <DashboardPanelSurface className="overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:flex sm:flex-wrap sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="h-8 w-1.5 shrink-0 rounded-full"
            style={{ background: color }}
          />
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold leading-tight sm:text-2xl">{name}</h2>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-mono uppercase tracking-widest">Cliente</span>
              {clientNode ?? <span className="truncate">{clientName}</span>}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {planBadge}
          {assignee}
          {status}
          {actions}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/60 bg-background/40 px-5 py-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums">{periodLabel}</span>
        <span className="tabular-nums">
          {done}/{total} peças concluídas
        </span>
        <span className="ml-auto flex min-w-[140px] items-center gap-2">
          <Progress value={pct} className="h-[3px] flex-1" />
          <span className="font-medium tabular-nums text-foreground">{pct}%</span>
        </span>
      </div>
    </DashboardPanelSurface>
  );
}
