import { createFileRoute } from "@tanstack/react-router";
import { runAiModelHealthCheck } from "@/lib/ai-model-health.server";
import { assertCronRequest } from "@/lib/cron-auth.server";

/**
 * Daily health check: pings each provider's models (per role) with the
 * most-recent active brand key, auto-promotes successors for deprecated
 * models and notifies the super admins in-app.
 */
export const Route = createFileRoute("/api/public/hooks/ai-models-health")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronDenied = assertCronRequest(request);
        if (cronDenied) return cronDenied;

        try {
          const result = await runAiModelHealthCheck();
          return Response.json(result);
        } catch (err) {
          console.error("[ai-models-health] falhou", err);
          return Response.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
