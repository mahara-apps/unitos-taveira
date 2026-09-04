import type { ReactNode } from "react";

/**
 * Standard panel container used across the app. Mirrors the Dashboard's card
 * primitive so every surface (list, table, chart) shares the same header/body
 * shell, border radius, and dividers.
 */
export function PanelCard({
  title,
  subtitle,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{title}</div>
            {subtitle && (
              <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>
            )}
          </div>
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
