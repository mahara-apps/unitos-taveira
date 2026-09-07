import { createFileRoute, redirect } from "@tanstack/react-router";

// Rota legada: o relatório de anúncios agora vive como aba dentro de Mídia paga.
export const Route = createFileRoute("/_authenticated/media-report")({
  beforeLoad: () => {
    throw redirect({ to: "/media-plans", search: { tab: "relatorio" }, replace: true });
  },
});
