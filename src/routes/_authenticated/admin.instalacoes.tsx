import { Outlet, createFileRoute } from "@tanstack/react-router";

/** Layout do módulo MASTER de Instalações — lista e detalhe da instalação. */
export const Route = createFileRoute("/_authenticated/admin/instalacoes")({
  component: () => <Outlet />,
});
