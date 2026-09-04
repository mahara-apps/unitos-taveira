import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { VIEWS, VIEW_META, type View } from "./task-views";

export function TaskViewSwitcher({
  value,
  onChange,
}: {
  value: View;
  onChange: (view: View) => void;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="tablist"
        aria-label="Formas de visualizar as tarefas"
        className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1"
      >
        {VIEWS.map((v) => {
          const meta = VIEW_META[v];
          const Icon = meta.icon;
          const active = value === v;
          return (
            <Tooltip key={v}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={meta.label}
                  onClick={() => onChange(v)}
                  className={cn(
                    "grid h-8 w-9 place-items-center rounded-md transition",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{meta.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
