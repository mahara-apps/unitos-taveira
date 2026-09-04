import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Scope = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export type DocumentBriefingSummary = {
  description: string | null;
  mission: string | null;
  positioning: string | null;
  values: string | null;
  audience: string | null;
  pain_points: string | null;
  demographics: string | null;
  offer: string | null;
  differentials: string | null;
  objections: string | null;
  journey: string | null;
  desires: string | null;
  tone_text: string | null;
  hashtags: string[] | null;
  goals: string | null;
};

export type ClientDocumentAi = {
  id: string;
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string | null;
  ai_status: "idle" | "queued" | "running" | "done" | "failed";
  ai_model: string | null;
  ai_error: string | null;
  analyzed_at: string | null;
  applied_to_briefing_at: string | null;
  visible_to_client: boolean;
  ai_summary: {
    document_type?: string | null;
    executive_summary?: string | null;
    extracted_text?: string | null;
    briefing?: DocumentBriefingSummary;
    confidence?: number | null;
  } | null;
};

/** List documents with AI metadata for the Documents & Context tab. */
export const listClientDocumentsAi = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.parse(i))
  .handler(async ({ data, context }): Promise<ClientDocumentAi[]> => {
    // Auto-cura na leitura: documento cuja execução morreu/expirou nunca fica
    // preso em "Analisando" — a rotina do banco fecha o estado com o motivo real.
    const { callRpc } = await import("@/lib/supabase-rpc");
    await callRpc(context.supabase, "reconcile_client_document_ai", {
      _brand_id: data.brandId,
      _client_id: data.clientId,
    }).catch(() => undefined);

    const { data: rows, error } = await (
      context.supabase as unknown as {
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
                order: (
                  c: string,
                  o: { ascending: boolean },
                ) => Promise<{ data: ClientDocumentAi[] | null; error: unknown }>;
              };
            };
          };
        };
      }
    )
      .from("client_documents")
      .select(
        "id, name, storage_path, mime_type, size_bytes, created_at, updated_at, ai_status, ai_model, ai_error, analyzed_at, applied_to_briefing_at, ai_summary, visible_to_client",
      )
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });
    if (error) throw error as Error;
    return rows ?? [];
  });

const VisibilityInput = Scope.extend({
  documentId: z.string().uuid(),
  visible: z.boolean(),
});

/** Fase 0a: controle explícito de exposição de documentos no portal do cliente (padrão: não visível). */
export const setClientDocumentVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => VisibilityInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true; visible: boolean }> => {
    const { error } = await context.supabase
      .from("client_documents")
      .update({ visible_to_client: data.visible })
      .eq("id", data.documentId)
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId);
    if (error) throw error as Error;
    return { ok: true, visible: data.visible };
  });

const ApplyInput = Scope.extend({
  documentId: z.string().uuid(),
  fields: z.array(z.string().min(1).max(60)).min(1),
});

const ALLOWED_FIELDS = new Set<keyof DocumentBriefingSummary>([
  "description",
  "mission",
  "positioning",
  "values",
  "audience",
  "pain_points",
  "demographics",
  "offer",
  "differentials",
  "objections",
  "journey",
  "desires",
  "tone_text",
  "hashtags",
  "goals",
]);

/**
 * Merge the selected AI-extracted fields into the client's briefing.
 *
 * A escrita agora passa pela camada de execução de importação
 * (`briefing_import_runs`): a run do documento é reaproveitada, os campos
 * selecionados são aceitos e o apply é idempotente (uma run já aplicada
 * devolve a versão existente). Quando não existe run — documentos analisados
 * antes desta camada — cai no caminho legado direto.
 */
export const applyDocumentToBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ApplyInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: doc, error: docErr } = await (
      context.supabase as unknown as {
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
                    data: { ai_summary: ClientDocumentAi["ai_summary"] } | null;
                    error: unknown;
                  }>;
                };
              };
            };
          };
        };
      }
    )
      .from("client_documents")
      .select("ai_summary")
      .eq("id", data.documentId)
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (docErr) throw docErr as Error;
    if (!doc?.ai_summary?.briefing) throw new Error("document_not_analyzed");

    const source = doc.ai_summary.briefing;
    const patch: Record<string, unknown> = {};
    for (const field of data.fields) {
      if (!ALLOWED_FIELDS.has(field as keyof DocumentBriefingSummary)) continue;
      const value = source[field as keyof DocumentBriefingSummary];
      if (value == null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === "string" && value.trim().length === 0) continue;
      patch[field] = value;
    }
    if (Object.keys(patch).length === 0) {
      throw new Error("Nenhum campo válido selecionado.");
    }

    const runId = await findDocumentRunId(context.supabase, data);
    if (runId) {
      const { applyImportRun } = await import("@/lib/briefing-import.server");
      const result = await applyImportRun(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId,
        runId,
        userId: context.userId,
        acceptFields: Object.keys(patch),
      });
      await markDocumentApplied(context.supabase, data.documentId);
      return {
        ok: true,
        appliedFields: result.appliedFields,
        runId,
        versionId: result.versionId,
        counts: result.counts,
      };
    }

    // Caminho legado (documento sem run de importação).
    const { writeCanonicalBriefing } = await import("@/lib/briefing-write.server");
    await writeCanonicalBriefing(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      patch,
      authorId: context.userId,
      origin: "document",
    });
    await markDocumentApplied(context.supabase, data.documentId);
    return { ok: true, appliedFields: Object.keys(patch) };
  });

/** Run de importação mais recente e aplicável para o documento. */
async function findDocumentRunId(
  supabase: unknown,
  scope: { brandId: string; clientId: string; documentId: string },
): Promise<string | null> {
  const { data } = await (supabase as { from: (t: string) => any })
    .from("briefing_import_runs")
    .select("id, status")
    .eq("brand_id", scope.brandId)
    .eq("client_id", scope.clientId)
    .eq("document_id", scope.documentId)
    .in("status", ["proposed", "applying", "applied"])
    .order("created_at", { ascending: false })
    .limit(1);
  const row = ((data as Array<{ id: string }> | null) ?? [])[0];
  return row?.id ?? null;
}

async function markDocumentApplied(supabase: unknown, documentId: string): Promise<void> {
  await (
    supabase as unknown as {
      from: (t: string) => {
        update: (v: unknown) => { eq: (k: string, v: string) => Promise<unknown> };
      };
    }
  )
    .from("client_documents")
    .update({ applied_to_briefing_at: new Date().toISOString() })
    .eq("id", documentId);
}


/**
 * Get the current briefing snapshot for before/after comparison in the UI.
 * Lê a fonte canônica (clients.brand_hub), com fallback de compatibilidade.
 */
export const getBriefingSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.parse(i))
  .handler(async ({ data, context }): Promise<Partial<DocumentBriefingSummary>> => {
    const { loadCanonicalBriefing } = await import("@/lib/briefing-source.server");
    const canonical = await loadCanonicalBriefing(context.supabase, {
      clientId: data.clientId,
      brandId: data.brandId,
    });
    return canonical.hub as Partial<DocumentBriefingSummary>;
  });
