import { createFileRoute } from "@tanstack/react-router";
import { assertCronRequest } from "@/lib/cron-auth.server";

// Cron endpoint: sincroniza roll-up de social_posts como eventos do Brain.
// Chamado por pg_cron 1×/dia; gate por `CRON_SECRET` (header x-cron-secret).
export const Route = createFileRoute("/api/public/hooks/social-metrics-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronDenied = assertCronRequest(request);
        if (cronDenied) return cronDenied;
        const { runSocialMetricsSync } = await import("@/lib/brain/social-metrics-sync.server");
        try {
          const report = await runSocialMetricsSync();
          return Response.json({ ok: true, report });
        } catch (err) {
          console.error("[social-metrics-sync] failed", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
