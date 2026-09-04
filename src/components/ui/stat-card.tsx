/**
 * StatCard — alias canônico para o KpiCard.
 *
 * O KpiCard já implementa o padrão "card de métrica" do Dashboard geral:
 * barra de cor semântica no topo, ícone circular no canto superior esquerdo,
 * label em caps/cinza, valor grande, subtítulo e sparkline opcional.
 *
 * Para qualquer tela nova, prefira importar StatCard daqui — o alias existe
 * apenas para deixar a API pública alinhada ao vocabulário pedido no
 * requisito de extração de primitivos ("StatCard"), sem duplicar a
 * implementação do KpiCard.
 */
export { KpiCard as StatCard, KPI_TONES as STAT_CARD_TONES } from "@/components/ui/kpi-card";
export type {
  KpiCardProps as StatCardProps,
  KpiTone as StatCardTone,
} from "@/components/ui/kpi-card";
