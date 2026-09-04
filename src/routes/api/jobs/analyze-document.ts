import { createFileRoute } from "@tanstack/react-router";
import { guardClientScope } from "@/lib/http-scope.server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { BriefingAnalysis } from "@/lib/briefing-analysis-schema";
import { waitUntil } from "@/lib/wait-until.server";

// Worker que lê um documento (PDF, imagem, DOC) do bucket `brand-documents`,
// extrai o texto principal e sugere campos para o briefing do cliente.

const BodySchema = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  documentId: z.string().uuid(),
  /** Origem informada pela UI — preservada em `briefing_import_runs.source_kind`. */
  sourceKind: z.enum(["document", "transcript"]).optional(),
  /** Reanálise explícita: ignora o reuso por fingerprint. */
  force: z.boolean().optional(),
});



function buildUserClient(token: string) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export type DocumentAiSummary = BriefingAnalysis;




/** Execução real acontece no worker da fila (retomável, com lease e reaper). */


export const Route = createFileRoute("/api/jobs/analyze-document")({
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
        const { data: claims } = await supabase.auth.getClaims(token).catch(() => ({ data: null }));
        let userId = claims?.claims?.sub as string | undefined;
        if (!userId) {
          const { data: userData } = await supabase.auth.getUser(token);
          userId = userData?.user?.id;
        }
        if (!userId) return new Response("Unauthorized", { status: 401 });

        // Fase 2: escopo de cliente validado antes de baixar o documento.
        const denied = await guardClientScope(supabase, userId, parsed.data.clientId);
        if (denied) return denied;

        // Metadados do arquivo → fingerprint estável para idempotência.
        const { data: meta } = await (
          supabase as unknown as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (
                  k: string,
                  v: string,
                ) => {
                  eq: (
                    k: string,
                    v: string,
                  ) => {
                    eq: (
                      k: string,
                      v: string,
                    ) => {
                      maybeSingle: () => Promise<{
                        data: {
                          storage_path: string;
                          size_bytes: number | null;
                          mime_type: string | null;
                        } | null;
                      }>;
                    };
                  };
                };
              };
            };
          }
        )
          .from("client_documents")
          .select("storage_path, size_bytes, mime_type")
          .eq("id", parsed.data.documentId)
          .eq("brand_id", parsed.data.brandId)
          .eq("client_id", parsed.data.clientId)
          .maybeSingle();
        if (!meta) return new Response("Not found", { status: 404 });

        const { buildInputFingerprint, startImportRun } = await import(
          "@/lib/briefing-import.server"
        );
        const fingerprint = await buildInputFingerprint({
          sourceKind: "document",
          documentPath: meta.storage_path,
          documentSize: meta.size_bytes,
          documentMime: meta.mime_type,
        });
        const { run, reused } = await startImportRun(supabase as never, {
          brandId: parsed.data.brandId,
          clientId: parsed.data.clientId,
          userId,
          // A UI pode marcar transcrição; o fingerprint segue o arquivo.
          sourceKind: parsed.data.sourceKind ?? "document",
          documentId: parsed.data.documentId,
          inputFingerprint: fingerprint,
          force: parsed.data.force === true,
        });


        // Reuso: já existe execução viva para o mesmo arquivo — não gasta IA.
        if (reused && run.status !== "queued") {
          return new Response(JSON.stringify({ ok: true, runId: run.id, reused: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        await (
          supabase as unknown as {
            from: (t: string) => {
              update: (v: unknown) => { eq: (k: string, v: string) => Promise<unknown> };
            };
          }
        )
          .from("client_documents")
          .update({ ai_status: "queued", ai_error: null })
          .eq("id", parsed.data.documentId);

        // Kick imediato do worker: a execução é retomável e, se este isolate morrer,
        // o reaper devolve a run para a fila (nada fica preso em `running`).
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
