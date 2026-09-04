import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sanitizeRequestedFields } from "@/lib/briefing-fields";

/**
 * FASE 3 — Lado AGÊNCIA das solicitações de briefing.
 *
 * A agência escolhe quais campos do briefing canônico (`clients.brand_hub`) o
 * cliente precisa responder. A resposta chega como PROPOSTA
 * (`brand_briefing_proposals`) vinculada à solicitação e à versão do briefing
 * vigente no momento do pedido — o hub oficial nunca é alterado nesta fase.
 */

export type BriefingRequestRow = {
  id: string;
  brand_id: string;
  client_id: string;
  requested_fields: string[];
  message: string | null;
  status: "requested" | "submitted" | "in_review" | "approved";
  base_version_id: string | null;
  accepted_fields: string[];
  pending_fields: string[];
  review_decision: "approved" | "partial" | "changes_requested" | null;
  review_note: string | null;
  decided_at: string | null;
  due_at: string | null;
  requested_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  canceled_at: string | null;
  proposals: number;
};

export type BriefingProposalRow = {
  id: string;
  request_id: string;
  payload: Record<string, string | string[]>;
  attachments: Array<{
    name: string;
    path: string;
    mime: string | null;
    size: number | null;
    url?: string | null;
  }>;
  note: string | null;
  submitted_via: "portal_session" | "portal_token";
  created_at: string;
};

const Scope = z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() });

export const listBriefingRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.parse(i))
  .handler(async ({ context, data }): Promise<BriefingRequestRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("brand_briefing_requests")
      .select("*, brand_briefing_proposals(id)")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("requested_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      brand_id: r.brand_id as string,
      client_id: r.client_id as string,
      requested_fields: (r.requested_fields as string[]) ?? [],
      message: (r.message as string | null) ?? null,
      status: r.status as BriefingRequestRow["status"],
      base_version_id: (r.base_version_id as string | null) ?? null,
      due_at: (r.due_at as string | null) ?? null,
      requested_at: r.requested_at as string,
      submitted_at: (r.submitted_at as string | null) ?? null,
      reviewed_at: (r.reviewed_at as string | null) ?? null,
      canceled_at: (r.canceled_at as string | null) ?? null,
      accepted_fields: (r.accepted_fields as string[]) ?? [],
      pending_fields: (r.pending_fields as string[]) ?? [],
      review_decision: (r.review_decision as BriefingRequestRow["review_decision"]) ?? null,
      review_note: (r.review_note as string | null) ?? null,
      decided_at: (r.decided_at as string | null) ?? null,
      proposals: Array.isArray(r.brand_briefing_proposals) ? r.brand_briefing_proposals.length : 0,
    }));
  });

export const createBriefingRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Scope.extend({
      fields: z.array(z.string()).min(1),
      message: z.string().max(2000).optional(),
      dueAt: z.string().datetime().nullish(),
    }).parse(i),
  )
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const fields = sanitizeRequestedFields(data.fields);
    if (!fields.length) throw new Error("Selecione ao menos um campo válido do briefing.");

    // Versão vigente do briefing = base da proposta (reuso da Fase 2).
    const { data: version } = await context.supabase
      .from("brand_briefing_versions")
      .select("id")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: row, error } = await context.supabase
      .from("brand_briefing_requests")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        requested_fields: fields,
        message: data.message?.trim() || null,
        due_at: data.dueAt ?? null,
        status: "requested",
        base_version_id: (version as { id?: string } | null)?.id ?? null,
        requested_by: context.userId,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Ciclo de status do briefing do cliente: draft → requested.
    await context.supabase
      .from("clients")
      .update({
        briefing_status: "requested",
        briefing_status_at: new Date().toISOString(),
        briefing_status_by: context.userId,
      } as never)
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId);

    return { id: (row as { id: string }).id };
  });

/** Cancela uma solicitação ainda aberta (não remove histórico). */
export const cancelBriefingRequestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ requestId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("brand_briefing_requests")
      .update({ canceled_at: new Date().toISOString() } as never)
      .eq("id", data.requestId)
      .is("submitted_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Respostas recebidas de uma solicitação, com anexos assinados. */
export const getBriefingProposalsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ requestId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }): Promise<BriefingProposalRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("brand_briefing_proposals")
      .select("id, request_id, payload, attachments, note, submitted_via, created_at")
      .eq("request_id", data.requestId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { signPortalDocument } = await import("@/lib/portal-media.server");
    return await Promise.all(
      ((rows ?? []) as Array<Record<string, unknown>>).map(async (r) => {
        const atts = (
          Array.isArray(r.attachments) ? r.attachments : []
        ) as BriefingProposalRow["attachments"];
        const signed = await Promise.all(
          atts.map(async (a) => ({ ...a, url: a.path ? await signPortalDocument(a.path) : null })),
        );
        return {
          id: r.id as string,
          request_id: r.request_id as string,
          payload: (r.payload ?? {}) as Record<string, string | string[]>,
          attachments: signed,
          note: (r.note as string | null) ?? null,
          submitted_via: r.submitted_via as BriefingProposalRow["submitted_via"],
          created_at: r.created_at as string,
        };
      }),
    );
  });

/** Marca a solicitação respondida como "em revisão" pela agência. */
export const markBriefingRequestInReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.extend({ requestId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("brand_briefing_requests")
      .update({
        status: "in_review",
        reviewed_at: new Date().toISOString(),
        reviewed_by: context.userId,
      } as never)
      .eq("id", data.requestId)
      .eq("status", "submitted");
    if (error) throw new Error(error.message);

    await context.supabase
      .from("clients")
      .update({
        briefing_status: "in_review",
        briefing_status_at: new Date().toISOString(),
        briefing_status_by: context.userId,
      } as never)
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId);

    return { ok: true };
  });

/* ------------------------- FASE 4 — revisão e promoção ------------------------- */

/** Comparação campo a campo (briefing atual × proposta) para a tela de revisão. */
export const getBriefingReviewDiffFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.extend({ requestId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { buildBriefingReviewDiff } = await import("@/lib/briefing-review.server");
    return buildBriefingReviewDiff(
      context.supabase,
      { brandId: data.brandId, clientId: data.clientId },
      data.requestId,
    );
  });

/** Aprovar, aprovar parcialmente ou solicitar complementação. */
export const decideBriefingReviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Scope.extend({
      requestId: z.string().uuid(),
      decision: z.enum(["approved", "partial", "changes_requested"]),
      acceptedFields: z.array(z.string()).optional(),
      note: z.string().max(2000).optional(),
    }).parse(i),
  )
  .handler(async ({ context, data }) => {
    const { decideBriefingReview } = await import("@/lib/briefing-review.server");
    return decideBriefingReview(
      context.supabase,
      { brandId: data.brandId, clientId: data.clientId },
      context.userId,
      {
        requestId: data.requestId,
        decision: data.decision,
        acceptedFields: data.acceptedFields,
        note: data.note,
      },
    );
  });

/** Histórico de decisões de revisão. */
export const listBriefingReviewsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Scope.extend({ requestId: z.string().uuid().nullish() }).parse(i))
  .handler(async ({ context, data }) => {
    const { listBriefingReviews } = await import("@/lib/briefing-review.server");
    return listBriefingReviews(
      context.supabase,
      { brandId: data.brandId, clientId: data.clientId },
      data.requestId ?? null,
    );
  });
