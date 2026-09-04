import type { ReactNode } from "react";

/**
 * Small icon-in-a-ring empty state used inside PanelCard bodies.
 * Mirrors the Dashboard's `EmptyState`.
 */
export function PanelEmptyState({
  icon,
  text,
  className = "",
}: {
  icon: ReactNode;
  text: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 px-6 py-10 text-center ${className}`}
    >
      <div className="grid h-10 w-10 place-items-center rounded-full border border-border/60 bg-background/40 text-muted-foreground">
        {icon}
      </div>
      <div className="text-xs text-muted-foreground">{text}</div>
    </div>
  );
}
