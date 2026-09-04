import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";

export type AlertSeverity = "critical" | "warning" | "info";

const TONE: Record<AlertSeverity, string> = {
  critical: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

const DEFAULT_ICON: Record<AlertSeverity, ComponentType<{ className?: string }>> = {
  critical: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

export type AlertBannerProps = {
  severity: AlertSeverity;
  title: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  trailing?: ReactNode;
  className?: string;
};

/**
 * AlertBanner — banner de alerta com fundo colorido por severidade.
 * Extraído do card `AlertChip` do Dashboard geral.
 */
export function AlertBanner({
  severity,
  title,
  description,
  icon,
  trailing,
  className,
}: AlertBannerProps) {
  const Icon = icon ?? DEFAULT_ICON[severity];
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-card p-3 transition hover:shadow-sm",
        TONE[severity],
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        {description ? (
          <div className="truncate text-xs text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {trailing ? (
        <span className="rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
