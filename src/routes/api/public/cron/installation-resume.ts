import { createFileRoute } from "@tanstack/react-router";
import { assertCronRequest } from "@/lib/cron-auth.server";

/**
 * Continuação do provisionamento automático de instalações (somente MASTER).
 * Cada execução aplica a próxima fatia do baseline das operações sem
 * heartbeat, tornando o provisionamento independente da aba do navegador.
 *
 * Autenticação: `x-cron-secret` (CRON_SECRET).
 */
export const Route = createFileRoute("/api/public/cron/installation-resume")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = assertCronRequest(request);
        if (denied) return denied;
        const { resumeStaleAutomatedProvisions } = await import(
          "@/lib/installation/resume-worker.server"
        );
        const result = await resumeStaleAutomatedProvisions();
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
