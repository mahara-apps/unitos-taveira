import { createFileRoute, redirect } from "@tanstack/react-router";

// Os excedentes vivem no perfil do cliente (aba "Produção").
// Rota mantida apenas para não quebrar links antigos.
export const Route = createFileRoute("/_authenticated/settings/overages")({
  beforeLoad: () => {
    throw redirect({ to: "/customers" });
  },
});
