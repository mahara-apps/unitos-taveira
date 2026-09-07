import { cn } from "@/lib/utils";
import { STATUS_GROUP_ORDER, STATUS_GROUP_TOKEN } from "@/lib/publication-status-tokens";

/** Legenda fixa: COR = STATUS. Mesma linguagem em todas as visões. */
export function StatusLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]", className)}
      aria-label="Legenda de status"
    >
      {STATUS_GROUP_ORDER.map((key) => {
        const token = STATUS_GROUP_TOKEN[key];
        return (
          <li key={key} className="inline-flex items-center gap-1 text-muted-foreground">
            <span className={cn("h-2 w-2 rounded-full", token.dot)} aria-hidden />
            {token.label}
          </li>
        );
      })}
    </ul>
  );
}
