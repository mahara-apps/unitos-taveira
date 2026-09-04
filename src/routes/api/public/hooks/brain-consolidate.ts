import { createFileRoute } from "@tanstack/react-router";
import { brainConsolidateFn } from "@/lib/brain/legacy/brain-consolidate.functions";
import { assertCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/hooks/brain-consolidate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronDenied = assertCronRequest(request);
        if (cronDenied) return cronDenied;
        const result = await brainConsolidateFn({ data: {} });
        return Response.json(result);
      },
    },
  },
});
