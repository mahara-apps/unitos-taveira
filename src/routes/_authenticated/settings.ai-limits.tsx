import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect temporário: governança de IA (limites e consumo) foi movida para o
 * Centro de IA em /connections → aba IA.
 */
export const Route = createFileRoute("/_authenticated/settings/ai-limits")({
  beforeLoad: () => {
    throw redirect({ to: "/connections", search: { tab: "ai", section: "usage" } });
  },
});
