import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePortalSessionScope } from "@/lib/portal-permissions.server";
import {
  resolveSessionScope,
  resolveTokenScope,
  scopedAdmin,
  type PortalScope,
} from "@/lib/portal-scope.server";
import { sanitizeProposalPayload } from "@/lib/briefing-fields";

/**
 * FASE 3 — Lado CLIENTE (Portal) das solicitações de briefing.
 *
 * Os dois modos do portal (token e sessão) usam o MESMO núcleo: o escopo é
 * resolvido/validado pelo banco (`portal_resolve`) e só depois os dados são
 * lidos/gravados. A resposta do cliente é gravada como PROPOSTA em
 * `brand_briefing_proposals` — `clients.brand_hub` nunca é alterado aqui.
 */

export type PortalBriefingRequest = {
  id: string;
  requested_fields: string[];
  message: string | null;
  status: "requested" | "submitted" | "in_review" | "approved";
  due_at: string | null;
  requested_at: string;
  submitted_at: string | null;
  /** Última resposta enviada pelo cliente (se houver). */
  answered: Record<string, string | string[]> | null;
  /** FASE 4 — resultado da revisão da agência (visível ao cliente). */
  review_decision: "approved" | "partial" | "changes_requested" | null;
  review_note: string | null;
  accepted_fields: string[];
  /** Campos que o cliente ainda precisa complementar. */
  pending_fields: string[];
  decided_at: string | null;
};

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const AnswerIn = z.object({
  requestId: z.string().uuid(),
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  note: z.string().max(2000).optional(),
  attachments: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        mime: z.string().max(120).nullish(),
        dataBase64: z.string().min(1),
      }),
    )
    .max(MAX_ATTACHMENTS)
    .optional(),
});

type AnswerInput = z.infer<typeof AnswerIn>;

async function listRequests(scope: PortalScope): Promise<PortalBriefingRequest[]> {
  const admin = await scopedAdmin();
  const { data, error } = await admin
    .from("brand_briefing_requests")
    .select("*, brand_briefing_proposals(payload, created_at)")
    .eq("brand_id", scope.brandId)
    .eq("client_id", scope.clientId)
    .is("canceled_at", null)
    .order("requested_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const proposals = (
      Array.isArray(r.brand_briefing_proposals) ? r.brand_briefing_proposals : []
    ) as Array<{
      payload: Record<string, string | string[]>;
      created_at: string;
    }>;
    const latest = [...proposals].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return {
      id: r.id as string,
      requested_fields: (r.requested_fields as string[]) ?? [],
      message: (r.message as string | null) ?? null,
      status: r.status as PortalBriefingRequest["status"],
      due_at: (r.due_at as string | null) ?? null,
      requested_at: r.requested_at as string,
      submitted_at: (r.submitted_at as string | null) ?? null,
      answered: latest?.payload ?? null,
      review_decision: (r.review_decision as PortalBriefingRequest["review_decision"]) ?? null,
      review_note: (r.review_note as string | null) ?? null,
      accepted_fields: (r.accepted_fields as string[]) ?? [],
      pending_fields: (r.pending_fields as string[]) ?? [],
      decided_at: (r.decided_at as string | null) ?? null,
    };
  });
}

function decodeBase64(value: string): Uint8Array {
  const raw =
    value.includes(",") && value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, "_").slice(-120) || "anexo";
}

async function submitProposal(
  scope: PortalScope,
  input: AnswerInput,
  via: "portal_session" | "portal_token",
  submittedBy: string | null,
): Promise<{ ok: true; proposalId: string }> {
  const admin = await scopedAdmin();

  const { data: request, error: reqErr } = await admin
    .from("brand_briefing_requests")
    .select("id, requested_fields, base_version_id, status, canceled_at")
    .eq("id", input.requestId)
    .eq("brand_id", scope.brandId)
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (reqErr) throw new Error(reqErr.message);
  const row = request as {
    id: string;
    requested_fields: string[];
    base_version_id: string | null;
    canceled_at: string | null;
  } | null;
  if (!row) throw new Error("request_not_found");
  if (row.canceled_at) throw new Error("request_canceled");

  const payload = sanitizeProposalPayload(
    input.answers as Record<string, unknown>,
    row.requested_fields ?? [],
  );
  if (!Object.keys(payload).length) throw new Error("empty_answers");

  const attachments: Array<{ name: string; path: string; mime: string | null; size: number }> = [];
  for (const file of input.attachments ?? []) {
    const bytes = decodeBase64(file.dataBase64);
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("attachment_too_large");
    const path = `${scope.brandId}/${scope.clientId}/briefing-proposals/${row.id}/${Date.now()}-${safeName(file.name)}`;
    const { error: upErr } = await admin.storage
      .from("brand-documents")
      .upload(path, bytes, { contentType: file.mime ?? "application/octet-stream", upsert: false });
    if (upErr) throw new Error(upErr.message);
    attachments.push({ name: file.name, path, mime: file.mime ?? null, size: bytes.byteLength });
  }

  const { data: proposal, error: insErr } = await admin
    .from("brand_briefing_proposals")
    .insert({
      request_id: row.id,
      brand_id: scope.brandId,
      client_id: scope.clientId,
      base_version_id: row.base_version_id,
      payload: payload as never,
      attachments: attachments as never,
      note: input.note?.trim() || null,
      submitted_via: via,
      submitted_by: submittedBy,
    } as never)
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);

  await admin
    .from("brand_briefing_requests")
    .update({ status: "submitted", submitted_at: new Date().toISOString() } as never)
    .eq("id", row.id);

  // Ciclo de status do briefing: requested → submitted (hub intacto).
  await admin
    .from("clients")
    .update({ briefing_status: "submitted", briefing_status_at: new Date().toISOString() } as never)
    .eq("id", scope.clientId)
    .eq("brand_id", scope.brandId);

  // Aviso interno: briefing respondido pelo cliente precisa chegar na equipe.
  const { notifyInternalTeam } = await import("@/lib/client-comms.server");
  await notifyInternalTeam({
    brandId: scope.brandId,
    clientId: scope.clientId,
    title: "Briefing enviado pelo cliente",
    body: input.note?.trim() || "As respostas estão prontas para revisão",
    href: `/inbox?cliente=${scope.clientId}&tipo=briefing`,
    dedupeParts: ["briefing_submitted", row.id, (proposal as { id: string }).id],
    payload: { request_id: row.id, inbox_type: "briefing" },
  });

  return { ok: true, proposalId: (proposal as { id: string }).id };
}

/* ------------------------------- modo TOKEN ------------------------------- */

export const listPortalBriefingRequestsFn = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(10) }).parse(i))
  .handler(
    async ({ data }): Promise<PortalBriefingRequest[]> =>
      listRequests(await resolveTokenScope(data.token)),
  );

export const submitPortalBriefingProposalFn = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AnswerIn.extend({ token: z.string().min(10) }).parse(i))
  .handler(async () => {
    // Link sem senha é somente leitura: responder briefing exige login.
    throw new Error("portal_token_read_only");
  });

/* ------------------------------ modo SESSÃO ------------------------------- */

export const listPortalSessionBriefingRequestsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i ?? {}))
  .handler(
    async ({ context, data }): Promise<PortalBriefingRequest[]> =>
      listRequests(
        await resolvePortalSessionScope(context.supabase, data.clientId, "briefing", "view"),
      ),
  );

export const submitPortalSessionBriefingProposalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AnswerIn.extend({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) =>
    submitProposal(
      await resolvePortalSessionScope(context.supabase, data.clientId, "briefing", "interact"),
      data,
      "portal_session",
      context.userId,
    ),
  );
