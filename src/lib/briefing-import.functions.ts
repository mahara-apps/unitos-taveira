import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ImportRunRow } from "@/lib/briefing-import.server";

/**
 * Server functions da camada de importação de briefing.
 * Toda escrita passa por `briefing-import.server.ts`; o escopo por
 * brand/cliente é garantido pela RLS das tabelas (`client_in_scope`).
 */

const Scope = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
});

const RunScope = Scope.extend({ runId: z.string().uuid() });

/** Run enriquecida para o histórico (autor e arquivo resolvidos no servidor). */
export type ImportRunListItem = ImportRunRow & {
  author_name: string | null;
  document_name: string | null;
};

export const listBriefingImportRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.extend({ limit: z.number().int().min(1).max(100).optional() }).parse(i))
  .handler(async ({ data, context }): Promise<ImportRunListItem[]> => {
    const { listImportRuns } = await import("@/lib/briefing-import.server");
    const runs = await listImportRuns(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      limit: data.limit,
    });
    if (runs.length === 0) return [];

    const db = context.supabase as unknown as { from: (t: string) => any };

    const authorIds = [...new Set(runs.map((r) => r.created_by).filter((v): v is string => !!v))];
    const authors = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profiles } = await db
        .from("user_profiles")
        .select("id, full_name")
        .in("id", authorIds);
      for (const p of (profiles as Array<{ id: string; full_name: string | null }> | null) ?? []) {
        authors.set(p.id, p.full_name || "Usuário");
      }
    }

    const docIds = [...new Set(runs.map((r) => r.document_id).filter((v): v is string => !!v))];
    const docs = new Map<string, string>();
    if (docIds.length > 0) {
      const { data: rows } = await db
        .from("client_documents")
        .select("id, name")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .in("id", docIds);
      for (const d of (rows as Array<{ id: string; name: string }> | null) ?? []) {
        docs.set(d.id, d.name);
      }
    }

    return runs.map((run) => ({
      ...run,
      author_name: run.created_by ? (authors.get(run.created_by) ?? null) : null,
      document_name: run.document_id ? (docs.get(run.document_id) ?? null) : null,
    }));
  });

export const getBriefingImportRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RunScope.parse(i))
  .handler(async ({ data, context }) => {
    const { getImportRun, listImportChanges, listImportSteps } = await import(
      "@/lib/briefing-import.server"
    );
    const run = await getImportRun(context.supabase, data);
    if (!run) return { run: null, changes: [], steps: [], documentName: null };
    const [changes, steps] = await Promise.all([
      listImportChanges(context.supabase, data),
      listImportSteps(context.supabase, data).catch(() => []),
    ]);

    let documentName: string | null = null;
    if (run.document_id) {
      const { data: doc } = await (context.supabase as unknown as { from: (t: string) => any })
        .from("client_documents")
        .select("name")
        .eq("id", run.document_id)
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .maybeSingle();
      documentName = (doc as { name: string } | null)?.name ?? null;
    }

    return { run, changes, steps, documentName };
  });

export const decideBriefingImportChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    RunScope.extend({
      decisions: z
        .array(
          z.object({
            field: z.string().min(1).max(60),
            decision: z.enum(["accepted", "rejected"]),
          }),
        )
        .min(1),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { decideImportChanges } = await import("@/lib/briefing-import.server");
    return decideImportChanges(context.supabase, { ...data, userId: context.userId });
  });

export const applyBriefingImportRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    RunScope.extend({
      acceptFields: z.array(z.string().min(1).max(60)).optional(),
      rejectFields: z.array(z.string().min(1).max(60)).optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { applyImportRun, decideImportChanges } = await import("@/lib/briefing-import.server");
    // Revisão explícita: o que não foi selecionado fica registrado como rejeitado.
    if (data.rejectFields?.length) {
      await decideImportChanges(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId,
        runId: data.runId,
        userId: context.userId,
        decisions: data.rejectFields.map((field) => ({ field, decision: "rejected" as const })),
      }).catch(() => undefined);
    }
    return applyImportRun(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      runId: data.runId,
      userId: context.userId,
      ...(data.acceptFields ? { acceptFields: data.acceptFields } : {}),
    });
  });

export const retryBriefingImportRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RunScope.parse(i))
  .handler(async ({ data, context }) => {
    const { retryImportRun } = await import("@/lib/briefing-import.server");
    return retryImportRun(context.supabase, data);
  });
