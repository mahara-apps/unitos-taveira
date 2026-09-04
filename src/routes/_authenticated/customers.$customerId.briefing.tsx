import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy standalone briefing route. The briefing now lives inside the customer
 * workspace as a tab — keep old bookmarks working with a permanent redirect.
 */
export const Route = createFileRoute("/_authenticated/customers/$customerId/briefing")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/customers/$customerId",
      params: { customerId: params.customerId },
      search: { tab: "briefing" } as never,
      replace: true,
    });
  },
});
