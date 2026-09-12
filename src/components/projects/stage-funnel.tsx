/**
 * Funil de estágios do conteúdo do projeto — leitura rápida de quantos itens
 * existem em cada etapa. Apenas apresentação: as contagens vêm por prop.
 */
import { CONTENT_STAGE, CONTENT_STAGES, type ContentStage } from "@/lib/content-stage-tokens";
import { cn } from "@/lib/utils";

export function StageFunnel({
  counts,
  active,
  onSelect,
  className,
}: {
  counts: Record<ContentStage, number>;
  active?: ContentStage | null;
  onSelect?: (stage: ContentStage | null) => void;
  className?: string;
}) {
  const total = CONTENT_STAGES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const max = Math.max(1, ...CONTENT_STAGES.map((s) => counts[s] ?? 0));

  return (
    <div className={cn("grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border/60 bg-border/60 sm:grid-cols-3 lg:grid-cols-6", className)}>
      {CONTENT_STAGES.map((stage) => {
        const token = CONTENT_STAGE[stage];
        const count = counts[stage] ?? 0;
        const isActive = active === stage;
        const width = total === 0 ? 0 : Math.max(count > 0 ? 6 : 0, (count / max) * 100);
        return (
          <button
            key={stage}
            type="button"
            disabled={!onSelect}
            aria-pressed={isActive}
            onClick={() => onSelect?.(isActive ? null : stage)}
            className={cn(
              "min-w-0 bg-card px-3 py-3 text-left transition-colors",
              onSelect && "hover:bg-muted/50",
              isActive && "bg-primary/5 ring-1 ring-inset ring-primary/40",
            )}
          >
            <span className="flex items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", token.dot)} />
              <span className="truncate text-[11px] text-muted-foreground">{token.label}</span>
            </span>
            <span className="mt-1 block text-lg font-semibold tabular-nums leading-none">
              {count}
            </span>
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", token.bar)}
                style={{ width: `${width}%` }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function StageLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}>
      {CONTENT_STAGES.map((s) => (
        <span key={s} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={cn("h-1.5 w-1.5 rounded-full", CONTENT_STAGE[s].dot)} />
          {CONTENT_STAGE[s].label}
        </span>
      ))}
    </div>
  );
}
