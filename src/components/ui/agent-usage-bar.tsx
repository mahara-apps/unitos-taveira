import { cn } from "@/lib/utils";

export type AgentUsageBarProps = {
  agent: string;
  cost: number;
  jobs: number;
  /** Custo máximo usado como referência para a largura da barra. */
  max: number;
  /** Casas decimais do valor monetário (default: 3). */
  precision?: number;
  /** Símbolo/prefixo monetário (default: "$"). */
  currency?: string;
  className?: string;
};

/**
 * AgentUsageBar — linha de consumo por agente de IA: nome, barra proporcional
 * ao custo, valor em dinheiro e nº de execuções.
 *
 * Extraído do card "IA & performance" do Dashboard geral.
 */
export function AgentUsageBar({
  agent,
  cost,
  jobs,
  max,
  precision = 3,
  currency = "$",
  className,
}: AgentUsageBarProps) {
  const width = Math.max(0, (cost / Math.max(0.0001, max)) * 100);
  return (
    <div className={cn("", className)}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="truncate font-medium">{agent}</span>
        <span className="ml-2 font-mono tabular-nums text-muted-foreground">
          {currency}
          {cost.toFixed(precision)} · {jobs}×
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}
