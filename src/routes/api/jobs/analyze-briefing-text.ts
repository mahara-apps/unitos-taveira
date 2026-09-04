import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { guardClientScope } from "@/lib/http-scope.server";
import { waitUntil } from "@/lib/wait-until.server";

/**
 * Worker de importação a partir de TEXTO (colado, notas, e-mails, transcrição
 * ou texto extraído de docx/planilha no navegador).
 *
 * Reutiliza integralmente a camada de import-execution existente:
 * fingerprint/idempotência (`startImportRun`), claim de concorrência,
 * etapas (`setRunStep`), proposta campo a campo (`saveImportProposal`) e
 * aplicação idempotente via `applyImportRun`. Nada é aplicado aqui.
 */

const BodySchema = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  text: z.string().min(40).max(400_000),
  sourceKind: z.enum(["paste", "transcript"]).optional(),
  /** Rótulo do material (nomes de arquivos, "Texto colado"). */
  label: z.string().max(300).optional(),
  force: z.boolean().optional(),
});

function buildUserClient(token: string) {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

/** Execução real acontece no worker da fila (retomável, com lease e reaper). */

export const Route = createFileRoute("/api/jobs/analyze-briefing-text")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        if (token.split(".").length !== 3) return new Response("Unauthorized", { status: 401 });

        const raw = await request.json().catch(() => null);
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) {
          return new Response(JSON.stringify(parsed.error.format()), { status: 400 });
        }

        const supabase = buildUserClient(token);
        // Mesmo padrão do middleware: getClaims pode falhar por cache de JWKS;
        // nesse caso validamos o token direto antes de recusar.
        const { data: claims } = await supabase.auth.getClaims(token).catch(() => ({ data: null }));
        let userId = claims?.claims?.sub as string | undefined;
        if (!userId) {
          const { data: userData } = await supabase.auth.getUser(token);
          userId = userData?.user?.id;
        }
        if (!userId) return new Response("Unauthorized", { status: 401 });


        const denied = await guardClientScope(supabase, userId, parsed.data.clientId);
        if (denied) return denied;

        const { buildInputFingerprint, startImportRun } = await import(
          "@/lib/briefing-import.server"
        );
        const sourceKind = parsed.data.sourceKind ?? "paste";
        const fingerprint = await buildInputFingerprint({
          sourceKind,
          rawText: parsed.data.text,
        });
        const { run, reused } = await startImportRun(supabase as never, {
          brandId: parsed.data.brandId,
          clientId: parsed.data.clientId,
          userId,
          sourceKind,
          rawText: parsed.data.text,
          inputFingerprint: fingerprint,
          force: parsed.data.force === true,
        });

        if (reused && run.status !== "queued") {
          return new Response(JSON.stringify({ ok: true, runId: run.id, reused: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Kick imediato do worker; se o isolate morrer, o reaper devolve a run à fila.
        const { processImportQueue } = await import("@/lib/briefing-import-worker.server");
        waitUntil(processImportQueue({ limit: 1 }));

        return new Response(JSON.stringify({ ok: true, runId: run.id, reused }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
