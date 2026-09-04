import { createFileRoute } from "@tanstack/react-router";
import { assertCronRequest } from "@/lib/cron-auth.server";

/**
 * Reaper das importações de briefing: runs com lease expirada voltam para
 * `queued` (se ainda há tentativas) ou terminam em `expired`, liberando o
 * índice de execução ativa para que o usuário possa importar novamente.
 *
 * Autenticação: `x-cron-secret` (CRON_SECRET).
 */
export const Route = createFileRoute("/api/public/cron/import-reaper")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = assertCronRequest(request);
        if (denied) return denied;
        const { reapImportRuns } = await import("@/lib/briefing-import-worker.server");
        const result = await reapImportRuns();
        return new Response(JSON.stringify({ ok: true, result }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
