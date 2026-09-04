// Resultados dos últimos 30 dias. Sem gráficos decorativos: só números reais
// no padrão PageKpi.
import { BarChart3, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { OverviewCard, OverviewEmpty, OverviewLink } from "./overview-shared";

export function OverviewPerformance({
  published,
  scheduled,
  pendingApprovals,
  totalApprovals,
  decidedApprovals,
  onOpenChannels,
}: {
  published: number;
  scheduled: number;
  pendingApprovals: number;
  totalApprovals: number;
  decidedApprovals: number;
  onOpenChannels?: () => void;
}) {
  const hasData = published > 0 || scheduled > 0 || totalApprovals > 0;
  const approvalPct = totalApprovals ? Math.round((decidedApprovals / totalApprovals) * 100) : 0;

  return (
    <OverviewCard
      title="Resultados"
      subtitle="Últimos 30 dias"
      icon={<BarChart3 className="h-4 w-4" />}
      footer={hasData ? <OverviewLink label="Ver analytics" href="/analytics" /> : undefined}
    >
      {!hasData ? (
        <OverviewEmpty
          icon={<Plug className="h-4 w-4" />}
          title="Ainda sem resultados para mostrar"
          hint="Vincule as redes do cliente e publique para acompanhar os números aqui."
          action={
            <Button size="sm" variant="outline" className="h-8" onClick={onOpenChannels}>
              Vincular redes
            </Button>
          }
        />
      ) : (
        <PageKpiGrid columns={2}>
          <PageKpi label="Publicadas" value={published} status="success" />
          <PageKpi label="Agendadas" value={scheduled} status="info" />
          <PageKpi
            label="Aprovações pendentes"
            value={pendingApprovals}
            status={pendingApprovals > 0 ? "warning" : "neutral"}
            description={totalApprovals ? `${approvalPct}% já respondidas` : undefined}
          />
          <PageKpi
            label="Aprovações no período"
            value={totalApprovals}
            description={totalApprovals ? `${decidedApprovals} respondidas` : undefined}
          />
        </PageKpiGrid>
      )}
    </OverviewCard>
  );
}
