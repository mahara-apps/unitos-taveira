import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";

import { useActiveContext } from "@/hooks/use-active-context";
import { MonthlyPlanView } from "@/components/monthly-plan/monthly-plan-view";

const SearchSchema = z.object({ planId: z.string().uuid().optional() });

export const Route = createFileRoute("/_authenticated/monthly-plan/")({
  head: () => ({
    meta: [
      { title: "Pautas mensais | Unitos" },
      {
        name: "description",
        content: "Planeje, gere e acompanhe as pautas mensais dos clientes no Unitos.",
      },
      { property: "og:title", content: "Pautas mensais | Unitos" },
      {
        property: "og:description",
        content: "Planeje, gere e acompanhe as pautas mensais dos clientes no Unitos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>) => SearchSchema.parse(s),
  component: MonthlyPlanIndexPage,
});

function MonthlyPlanIndexPage() {
  const { brandId, clientId } = useActiveContext();
  const { planId } = Route.useSearch();
  const navigate = useNavigate();

  // Compatibilidade com links legados: /monthly-plan?planId=... -> /monthly-plan/<id>
  useEffect(() => {
    if (planId) {
      void navigate({
        to: "/monthly-plan/$planId",
        params: { planId },
        replace: true,
      });
    }
  }, [planId, navigate]);

  if (planId) return null;

  return (
    <MonthlyPlanView
      brandId={brandId!}
      clientId={clientId!}
      planId={null}
      onSelectPlan={(id) => {
        if (id) void navigate({ to: "/monthly-plan/$planId", params: { planId: id } });
      }}
    />
  );
}
