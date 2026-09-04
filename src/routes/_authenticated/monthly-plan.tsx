import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import { AlertTriangle } from "lucide-react";

import { useActiveContext } from "@/hooks/use-active-context";
import { usePageHeader } from "@/hooks/use-page-header";

export const Route = createFileRoute("/_authenticated/monthly-plan")({
  beforeLoad: () => ensureFeatureEnabled("monthly_plan"),
  component: MonthlyPlanLayout,
});

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function MonthlyPlanLayout() {
  const { brandId, clientId } = useActiveContext();

  usePageHeader(
    {
      title: "Pauta mensal",
      subtitle: "Planeje os temas do mês antes de produzir os posts",
    },
    [clientId],
  );

  if (!brandId || !clientId || !UUID_RE.test(brandId) || !UUID_RE.test(clientId)) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4" /> Selecione um cliente no seletor acima para acessar a
          Pauta.
        </div>
      </div>
    );
  }

  return <Outlet />;
}
