import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect temporário — a configuração de SLA das etapas passou a viver
 * junto da edição das colunas do Pipeline (Conteúdo → Colunas).
 */
export const Route = createFileRoute("/_authenticated/settings/sla")({
  beforeLoad: () => {
    throw redirect({ to: "/content", search: { columns: true } });
  },
});
