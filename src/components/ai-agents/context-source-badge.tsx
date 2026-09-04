import { Dna, BarChart3, BookText, Layers } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * ContextSourceBadge — traces which slice of the Brand Hub corporate
 * memory grounded a given AI-generated block. Rendered as an ultra-clean
 * low-profile chip with a Radix tooltip that reassures the manager the
 * insight is tailored, not generic.
 *
 * Adaptive to light/dark modes via semantic tokens: `bg-muted/40`,
 * `border-border/60`, `text-muted-foreground`.
 */
export type ContextSource = "persona" | "competitors" | "knowledge" | "full";

const SOURCES: Record<ContextSource, { icon: typeof Dna; label: string; tooltip: string }> = {
  persona: {
    icon: Dna,
    label: "Context source · Persona & Briefing",
    tooltip:
      "This insight was strictly tailored using the active audience, tone rules and briefing configured inside your Brand Hub module.",
  },
  competitors: {
    icon: BarChart3,
    label: "Context source · Competitor Benchmarking",
    tooltip:
      "This insight was strictly tailored using the competitor handles and engagement patterns registered inside your Brand Hub module.",
  },
  knowledge: {
    icon: BookText,
    label: "Context source · Knowledge Base Vault (PDF)",
    tooltip:
      "This insight was strictly tailored using the reference handbooks and private documents uploaded to your Brand Hub Knowledge Base.",
  },
  full: {
    icon: Layers,
    label: "Context source · Full Brand Hub Blueprint",
    tooltip:
      "This insight was strictly tailored using the active rules, competitor data and reference handbooks configured inside your Brand Hub module.",
  },
};

export function ContextSourceBadge({
  source,
  className,
}: {
  source: ContextSource;
  className?: string;
}) {
  const { icon: Icon, label, tooltip } = SOURCES[source];
  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex select-none items-center gap-1.5 rounded-full",
              "border border-border/60 bg-muted/40 dark:bg-zinc-900/50",
              "px-2 py-0.5 font-mono text-[10px] leading-none tracking-tight",
              "text-muted-foreground hover:text-foreground",
              "transition-colors",
              className,
            )}
          >
            <Icon className="h-3 w-3 opacity-80" strokeWidth={2} />
            <span className="truncate">{label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-[280px] text-[11px] leading-relaxed"
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
