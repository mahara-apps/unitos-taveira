import { createFileRoute } from "@tanstack/react-router";
import { assertCronRequest } from "@/lib/cron-auth.server";

// Cron endpoint: sintetiza feedbacks de rework em insights consolidados.
// Chamado por pg_cron 1×/dia; gate por `CRON_SECRET` (header x-cron-secret).
export const Route = createFileRoute("/api/public/hooks/brain-synthesis")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronDenied = assertCronRequest(request);
        if (cronDenied) return cronDenied;
        const { runBrainSynthesis } = await import("@/lib/brain/learning/synthesize.server");
        try {
          const report = await runBrainSynthesis();
          return Response.json({ ok: true, report });
        } catch (err) {
          console.error("[brain-synthesis] failed", err);
          return Response.json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      },
    },
  },
});
