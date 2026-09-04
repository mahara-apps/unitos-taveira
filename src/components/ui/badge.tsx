import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/**
 * Tokens semânticos de cor no padrão "Cérebro de Agentes":
 * `border-{c}-500/20 bg-{c}-500/10 text-{c}-600 dark:text-{c}-300`.
 * Combine com `variant="outline"` e opcionalmente `h-5 rounded-full px-2 text-[10px]`.
 */
export type BadgeTone = "emerald" | "amber" | "red" | "blue" | "violet" | "slate" | "orange";

export const BADGE_TONE: Record<BadgeTone, string> = {
  emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  amber: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  red: "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300",
  blue: "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  violet: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  slate: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  orange: "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-300",
};

export function badgeTone(tone: BadgeTone): string {
  return BADGE_TONE[tone];
}

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {
  /** Aplica um tom semântico (emerald/amber/etc.). Force `variant="outline"` para melhor render. */
  tone?: BadgeTone;
}

function Badge({ className, variant, tone, ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        badgeVariants({ variant: tone ? "outline" : variant }),
        tone && badgeTone(tone),
        className,
      )}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
