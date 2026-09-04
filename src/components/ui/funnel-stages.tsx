import { cn } from "@/lib/utils";

/**
 * Paleta fixa de estágios do funil editorial.
 * Compartilhada por qualquer visualização do sistema que precise
 * representar o pipeline de conteúdo.
 */
export const FUNNEL_STAGE_COLORS: Record<string, string> = {
  idea: "#0ea5e9",
  ideia: "#0ea5e9",
  roteiro: "#6366f1",
  script: "#6366f1",
  design: "#14b8a6",
  production: "#f59e0b",
  producao: "#f59e0b",
  produção: "#f59e0b",
  review: "#f97316",
  revisao: "#f97316",
  revisão: "#f97316",
  approved: "#10b981",
  aprovado: "#10b981",
  scheduled: "#8b5cf6",
  agendado: "#8b5cf6",
  published: "#ec4899",
  publicado: "#ec4899",
};

export function funnelColorFor(key: string, fallback?: string | null): string {
  const k = key.trim().toLowerCase();
  return FUNNEL_STAGE_COLORS[k] ?? fallback ?? "hsl(var(--primary))";
}

export type FunnelStage = {
  key: string;
  label: string;
  count: number;
  color?: string | null;
};

export type FunnelStagesProps = {
  stages: FunnelStage[];
  className?: string;
};

/**
 * FunnelStages — funil editorial em barras horizontais empilhadas coloridas
 * consistentemente por estágio (paleta fixa em FUNNEL_STAGE_COLORS).
 * Extraído do card "Funil editorial" do Dashboard geral.
 */
export function FunnelStages({ stages, className }: FunnelStagesProps) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className={cn("space-y-2 px-4 py-3", className)}>
      {stages.map((s) => {
        const w = Math.max(4, (s.count / max) * 100);
        const bg = funnelColorFor(s.key, s.color);
        return (
          <div key={s.key} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{s.label}</span>
            <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-muted/50">
              <div
                className="h-full rounded-md opacity-80 transition-all"
                style={{ width: `${w}%`, backgroundColor: bg }}
              />
              <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-medium text-foreground">
                {s.count}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
