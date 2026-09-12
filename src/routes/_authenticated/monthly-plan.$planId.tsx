import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { useActiveContext } from "@/hooks/use-active-context";
import { MonthlyPlanView } from "@/components/monthly-plan/monthly-plan-view";

export const Route = createFileRoute("/_authenticated/monthly-plan/$planId")({
  head: () => ({
    meta: [
      { title: "Detalhe da pauta | Unitos" },
      {
        name: "description",
        content: "Revise ideias, contexto e aprovação de uma pauta mensal no Unitos.",
      },
      { property: "og:title", content: "Detalhe da pauta | Unitos" },
      {
        property: "og:description",
        content: "Revise ideias, contexto e aprovação de uma pauta mensal no Unitos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MonthlyPlanDetailPage,
});

function MonthlyPlanDetailPage() {
  const { brandId, clientId } = useActiveContext();
  const { planId } = Route.useParams();
  const navigate = useNavigate();

  return (
    <MonthlyPlanView
      brandId={brandId!}
      clientId={clientId!}
      planId={planId}
      onSelectPlan={(id) => {
        if (id) void navigate({ to: "/monthly-plan/$planId", params: { planId: id } });
        else void navigate({ to: "/monthly-plan" });
      }}
    />
  );
}
