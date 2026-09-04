import { createFileRoute } from "@tanstack/react-router";
import { assertCronRequest } from "@/lib/cron-auth.server";

/**
 * Consumidor agendado da fila de importação de briefing.
 *
 * Garante que uma run `queued` seja executada mesmo quando o kick imediato do
 * upload falhou (isolate morto, deploy, retry manual). Trabalho limitado por
 * invocação; concorrência resolvida pela lease no banco.
 *
 * Autenticação: `x-cron-secret` (CRON_SECRET) — nunca a chave publicável.
 */
export const Route = createFileRoute("/api/public/cron/import-worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = assertCronRequest(request);
        if (denied) return denied;
        const { processImportQueue } = await import("@/lib/briefing-import-worker.server");
        const report = await processImportQueue({ limit: 3 });
        return new Response(JSON.stringify({ ok: true, ...report }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
