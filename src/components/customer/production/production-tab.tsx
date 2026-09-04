// Aba "Produção" do perfil do cliente: resumo do mês, relatório filtrável
// do que foi produzido e a fila de solicitações extras / excedentes.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Layers, PlusCircle, Radio } from "lucide-react";

import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { getPlanVolumetryFn } from "@/lib/monthly-plans.functions";
import { ProductionReport } from "./production-report";
import { ProductionOverages } from "./production-overages";

export function ProductionTab({ brandId, clientId }: { brandId: string; clientId: string }) {
  const loadVolumetry = useServerFn(getPlanVolumetryFn);
  const volQ = useQuery({
    queryKey: ["monthly-plan", "volumetry", brandId, clientId],
    queryFn: () => loadVolumetry({ data: { brandId, clientId } }),
    staleTime: 30_000,
  });

  const vol = volQ.data;
  const quotaByChannel = (vol?.monthlyQuota ?? {}) as Record<string, number>;
  const overageTotal = Object.values(vol?.approvedOverage ?? {}).reduce(
    (s, n) => s + (Number(n) || 0),
    0,
  );

  return (
    <div className="space-y-6">
      <PageKpiGrid columns={4}>
        <PageKpi
          icon={<CalendarClock />}
          label="Previstas no mês"
          value={vol ? vol.totalTarget : "—"}
          description="Volumetria do briefing"
        />
        <PageKpi
          icon={<Layers />}
          label="Geradas na pauta"
          value={vol ? vol.generatedTotal : "—"}
          status="info"
          description="Mês corrente"
        />
        <PageKpi
          icon={<PlusCircle />}
          label="Excedentes autorizados"
          value={vol ? overageTotal : "—"}
          description="Liberados pelo gestor"
          status={overageTotal > 0 ? "warning" : "neutral"}
        />
        <PageKpi
          icon={<Radio />}
          label="Cotas por canal"
          value={Object.keys(quotaByChannel).length}
          description="Canais com volumetria definida"
        />
      </PageKpiGrid>

      <ProductionReport brandId={brandId} clientId={clientId} quotaByChannel={quotaByChannel} />
      <ProductionOverages brandId={brandId} clientId={clientId} />
    </div>
  );
}
