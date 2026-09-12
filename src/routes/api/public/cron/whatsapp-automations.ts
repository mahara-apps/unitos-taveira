import { createFileRoute } from "@tanstack/react-router";
import { assertCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/api/public/cron/whatsapp-automations")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = assertCronRequest(request);
        if (denied) return denied;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { enqueueDueClientAutomations, processClientAutomationQueue } = await import(
          "@/lib/whatsapp/automation-worker.server"
        );
        const enqueued = await enqueueDueClientAutomations(supabaseAdmin);
        const results = await processClientAutomationQueue(supabaseAdmin);
        return Response.json({ ok: true, enqueued, processed: results.length, results });
      },
    },
  },
});