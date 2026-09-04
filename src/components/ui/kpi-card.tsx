import { forwardRef, type ReactNode } from "react";

import { PageKpi, type KpiStatus } from "@/components/ui/page-kpi";

/**
 * KpiCard — adaptador de compatibilidade sobre o `PageKpi` canônico.
 *
 * As telas antigas usam tons decorativos (emerald/violet/sky/...). Aqui eles são
 * traduzidos para o estado semântico do padrão único de KPI, de forma que todas
 * as páginas compartilhem exatamente o mesmo desenho. Para telas novas, importe
 * `PageKpi`/`PageKpiGrid` diretamente.
 */
export const KPI_TONES = {
  emerald: "success",
  amber: "warning",
  rose: "danger",
  violet: "info",
  sky: "info",
  pink: "info",
  neutral: "neutral",
} as const satisfies Record<string, KpiStatus>;

export type KpiTone = keyof typeof KPI_TONES;

export type KpiCardProps = {
  icon?: ReactNode;
  label: string;
  value: number | string;
  sub?: ReactNode;
  tone?: KpiTone;
  /** Aceito por compatibilidade — o padrão de KPI não exibe gráficos. */
  spark?: number[];
  onClick?: () => void;
  active?: boolean;
  dimmed?: boolean;
  trailing?: ReactNode;
  className?: string;
};

export const KpiCard = forwardRef<HTMLDivElement | HTMLButtonElement, KpiCardProps>(
  function KpiCard(
    { icon, label, value, sub, tone = "neutral", onClick, active, dimmed, trailing, className },
    ref,
  ) {
    return (
      <PageKpi
        ref={ref}
        icon={icon}
        label={label}
        value={value}
        description={sub}
        status={KPI_TONES[tone]}
        onClick={onClick}
        active={active}
        dimmed={dimmed}
        trailing={trailing}
        className={className}
      />
    );
  },
);
