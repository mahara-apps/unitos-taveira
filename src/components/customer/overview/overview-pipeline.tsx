import { Layers, Sparkles } from "lucide-react";
import { funnelColorFor } from "@/components/ui/funnel-stages";
import { OverviewCard, OverviewEmpty, OverviewLink } from "./overview-shared";

export type PipelineStage = { key: string; label: string; count: number; color?: string | null };

export function OverviewPipeline({
  stages,
  total,
  pipelineName,
}: {
  stages: PipelineStage[];
  total: number;
  pipelineName?: string | null;
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <OverviewCard
      title="Pipeline de conteúdo"
      subtitle={
        total === 0
          ? "Nenhum conteúdo gerado ainda"
          : `${total} conteúdos${pipelineName ? ` · ${pipelineName}` : ""}`
      }
      icon={<Layers className="h-4 w-4" />}
      footer={<OverviewLink label="Ver produção" href="/content" />}
    >
      {stages.length === 0 || total === 0 ? (
        <OverviewEmpty
          icon={<Sparkles className="h-4 w-4" />}
          title="Nenhum conteúdo em produção"
          hint="Gere as primeiras pautas para acompanhar o fluxo aqui."
        />
      ) : (
        <ul className="space-y-2">
          {stages.map((s) => {
            const w = s.count === 0 ? 0 : Math.max(6, (s.count / max) * 100);
            return (
              <li key={s.key} className="flex items-center gap-3">
                <span className="w-20 shrink-0 truncate text-[12px] text-muted-foreground">
                  {s.label}
                </span>
                <div className="relative h-5 flex-1 overflow-hidden rounded-md bg-muted/40">
                  <div
                    className="h-full rounded-md opacity-80 transition-all"
                    style={{
                      width: `${w}%`,
                      backgroundColor: funnelColorFor(s.key, s.color),
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-[12px] font-medium tabular-nums">
                  {s.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}
