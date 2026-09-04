import { forwardRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * PageKpi — componente ÚNICO de KPI/resumo de página do Unitos.
 *
 * Regras do padrão (não duplicar layouts locais):
 * - mesma altura, espaçamento, tipografia, raio e peso visual em todas as telas;
 * - estrutura fixa: [ícone pequeno] TÍTULO / número grande / contexto opcional;
 * - cor = SEMÂNTICA do estado (neutral | info | success | warning | danger),
 *   nunca decoração arbitrária por tela;
 * - sem gráficos, gradientes ou sombras decorativas dentro do card;
 * - clicável apenas quando o KPI representa um filtro real (`onClick`),
 *   com estado ativo consistente (`active`).
 */
export type KpiStatus = "neutral" | "info" | "success" | "warning" | "danger";

const STATUS_STYLES: Record<KpiStatus, { icon: string; bar: string; dot: string }> = {
  neutral: {
    icon: "text-muted-foreground",
    bar: "bg-border",
    dot: "bg-muted-foreground/60",
  },
  info: {
    icon: "text-severity-info",
    bar: "bg-severity-info",
    dot: "bg-severity-info",
  },
  success: {
    icon: "text-health-good",
    bar: "bg-health-good",
    dot: "bg-health-good",
  },
  warning: {
    icon: "text-severity-warning",
    bar: "bg-severity-warning",
    dot: "bg-severity-warning",
  },
  danger: {
    icon: "text-severity-critical",
    bar: "bg-severity-critical",
    dot: "bg-severity-critical",
  },
};

export type PageKpiProps = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** Estado semântico da informação (não decoração). */
  status?: KpiStatus;
  /** Contexto/descrição curta. Só use com dado real. */
  description?: ReactNode;
  /** Variação real medida; omita quando não houver comparação. */
  trend?: { value: number; label?: string };
  /** Torna o KPI um filtro clicável. */
  onClick?: () => void;
  active?: boolean;
  dimmed?: boolean;
  /** Etiqueta discreta no canto superior direito. */
  trailing?: ReactNode;
  className?: string;
};

export const PageKpi = forwardRef<HTMLDivElement | HTMLButtonElement, PageKpiProps>(
  function PageKpi(
    {
      label,
      value,
      icon,
      status = "neutral",
      description,
      trend,
      onClick,
      active,
      dimmed,
      trailing,
      className,
    },
    ref,
  ) {
    const s = STATUS_STYLES[status];
    const interactive = typeof onClick === "function";

    const base = cn(
      "relative flex h-full min-h-[104px] flex-col justify-between overflow-hidden rounded-xl border border-border/60 bg-card p-4 text-left transition-colors",
      interactive &&
        "cursor-pointer hover:border-foreground/25 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
      active && "border-primary bg-primary/5",
      dimmed && "opacity-60",
      className,
    );

    const inner = (
      <>
        <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", s.bar)} />
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {icon ? (
              <span className={cn("shrink-0 [&_svg]:h-3.5 [&_svg]:w-3.5", s.icon)}>{icon}</span>
            ) : (
              <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
            )}
            <span className="truncate text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {label}
            </span>
          </span>
          {trailing ? (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {trailing}
            </span>
          ) : null}
        </div>
        <div className="mt-2">
          <div className="text-2xl font-semibold leading-none tabular-nums tracking-tight">
            {value}
          </div>
          {trend || description ? (
            <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5 text-[11px] text-muted-foreground">
              {trend ? (
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    trend.value > 0
                      ? "text-health-good"
                      : trend.value < 0
                        ? "text-severity-critical"
                        : "text-muted-foreground",
                  )}
                >
                  {trend.value > 0 ? "+" : ""}
                  {trend.value}%{trend.label ? ` ${trend.label}` : ""}
                </span>
              ) : null}
              {description ? <span className="min-w-0">{description}</span> : null}
            </div>
          ) : null}
        </div>
      </>
    );

    if (interactive) {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          aria-pressed={active}
          className={base}
        >
          {inner}
        </button>
      );
    }
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} className={base}>
        {inner}
      </div>
    );
  },
);

/**
 * PageKpiGrid — grade responsiva padrão para 3–6 KPIs.
 * Nunca gera scroll horizontal: quebra em linhas mantendo o mesmo desenho.
 */
export function PageKpiGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6;
  className?: string;
}) {
  const cols: Record<2 | 3 | 4 | 5 | 6, string> = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
    6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
  };
  return <div className={cn("grid gap-3", cols[columns], className)}>{children}</div>;
}
