import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { useActiveContext } from "@/hooks/use-active-context";
import { MonthlyPlanView } from "@/components/monthly-plan/monthly-plan-view";

export const Route = createFileRoute("/_authenticated/monthly-plan/$planId")({
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
