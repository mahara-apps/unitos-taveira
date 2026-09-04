import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DashboardPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full space-y-6 px-4 py-6 sm:px-6 lg:px-8", className)}>{children}</div>
  );
}

export const DashboardPanelSurface = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<"div">>(
  function DashboardPanelSurface({ children, className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("overflow-hidden rounded-xl border border-border/60 bg-card", className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);

export function DashboardIconFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function DashboardMutedPill({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function DashboardCountBadge({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
