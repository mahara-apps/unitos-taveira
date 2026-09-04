import { createFileRoute, redirect } from "@tanstack/react-router";

/** Rota legada — a gestão de recursos vive em Administração do Cliente. */
export const Route = createFileRoute("/_authenticated/super-admin/features")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/recursos" });
  },
});
