import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ScoreListRowProps = {
  /** Iniciais/label curta renderizadas dentro do "avatar" colorido. */
  avatarLabel: string;
  /** Cor de fundo do avatar (hex ou CSS color). */
  avatarColor?: string | null;
  /** Nome principal — string simples ou nó React (ex.: <Link>). */
  name: ReactNode;
  /** Valor 0–100 usado no cálculo da barra e exibido à direita. */
  score: number;
  /** Texto secundário à direita da linha (ex.: contexto/breakdown). */
  meta?: ReactNode;
  /** Sufixo opcional após o número do score (ex.: "%"). */
  scoreSuffix?: string;
  className?: string;
};

function toneFor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

/**
 * ScoreListRow — linha de lista com avatar circular, nome, barra horizontal
 * colorida por faixa (>=70 verde, 50–70 laranja, <50 vermelho), score
 * numérico e texto secundário.
 *
 * Extraído da lista "Saúde dos clientes" do Dashboard geral.
 */
export function ScoreListRow({
  avatarLabel,
  avatarColor,
  name,
  score,
  meta,
  scoreSuffix,
  className,
}: ScoreListRowProps) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", className)}>
      <span
        className="h-8 w-8 shrink-0 rounded-lg text-center text-xs font-semibold leading-8 text-white"
        style={{ background: avatarColor ?? "#6366f1" }}
      >
        {avatarLabel}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-medium">{name}</div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
            {score}
            {scoreSuffix ?? ""}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", toneFor(score))}
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
          {meta ? <span className="shrink-0 text-[10px] text-muted-foreground">{meta}</span> : null}
        </div>
      </div>
    </div>
  );
}
