// KPIs principais da Visão geral — padrão único PageKpi/PageKpiGrid.
// Cada KPI aponta para a aba onde a ação realmente acontece.
import { AlertTriangle, CalendarClock, HeartPulse, Layers, ThumbsUp } from "lucide-react";
import { PageKpi, PageKpiGrid, type KpiStatus } from "@/components/ui/page-kpi";

function healthStatus(score: number): KpiStatus {
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

export function OverviewKpis({
  health,
  pendingApprovals,
  overdueTasks,
  scheduled,
  contentTotal,
  loading,
  onOpenTab,
}: {
  health: number;
  pendingApprovals: number;
  overdueTasks: number;
  scheduled: number;
  contentTotal: number;
  loading?: boolean;
  onOpenTab?: (tab: string) => void;
}) {
  const v = (n: number) => (loading ? "—" : n);
  return (
    <PageKpiGrid columns={5}>
      <PageKpi
        icon={<HeartPulse />}
        label="Saúde da conta"
        value={loading ? "—" : `${health}%`}
        status={healthStatus(health)}
        description="Prazos, aprovações, briefing e agenda"
      />
      <PageKpi
        icon={<ThumbsUp />}
        label="Aprovações pendentes"
        value={v(pendingApprovals)}
        status={pendingApprovals > 0 ? "warning" : "success"}
        description="Aguardando o cliente"
        onClick={onOpenTab ? () => onOpenTab("publicacoes") : undefined}
      />
      <PageKpi
        icon={<AlertTriangle />}
        label="Tarefas atrasadas"
        value={v(overdueTasks)}
        status={overdueTasks > 0 ? "danger" : "success"}
        description="Prazo já vencido"
        onClick={onOpenTab ? () => onOpenTab("trabalho") : undefined}
      />
      <PageKpi
        icon={<CalendarClock />}
        label="Publicações agendadas"
        value={v(scheduled)}
        status="info"
        description="Já com data marcada"
        onClick={onOpenTab ? () => onOpenTab("publicacoes") : undefined}
      />
      <PageKpi
        icon={<Layers />}
        label="Conteúdos em produção"
        value={v(contentTotal)}
        description="No fluxo de produção"
        onClick={onOpenTab ? () => onOpenTab("pauta") : undefined}
      />
    </PageKpiGrid>
  );
}
