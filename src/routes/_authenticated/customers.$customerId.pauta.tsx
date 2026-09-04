import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * A pauta agora vive dentro do painel do cliente como aba.
 * Mantemos a rota antiga funcionando com redirect, preservando ?planId=.
 */
export const Route = createFileRoute("/_authenticated/customers/$customerId/pauta")({
  beforeLoad: ({ params, search }) => {
    const planId = (search as { planId?: string } | undefined)?.planId;
    throw redirect({
      to: "/customers/$customerId",
      params: { customerId: params.customerId },
      search: { tab: "pauta", ...(planId ? { planId } : {}) } as never,
      replace: true,
    });
  },
});
