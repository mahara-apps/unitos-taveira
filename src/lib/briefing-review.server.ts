import type { SupabaseClient } from "@supabase/supabase-js";
import { writeCanonicalBriefing } from "@/lib/briefing-write.server";
import { sanitizeRequestedFields } from "@/lib/briefing-fields";

/**
 * FASE 4 — Revisão e promoção do briefing.
 *
 * A proposta do cliente (`brand_briefing_proposals`) NUNCA vira briefing
 * oficial automaticamente. A agência compara campo a campo (hub atual ×
 * proposta) e decide:
 *
 * - `approved`  → todos os campos propostos são aceitos;
 * - `partial`   → apenas os campos aceitos são promovidos, o restante volta
 *                 como pendência para o cliente complementar;
 * - `changes_requested` → nada é promovido; a solicitação volta para o cliente.
 *
 * A promoção passa obrigatoriamente por `writeCanonicalBriefing`, que mescla
 * somente os campos aceitos em `clients.brand_hub` e grava um snapshot
 * imutável em `brand_briefing_versions` (autor, data, origem, campos alterados
 * e completude). Nada é sobrescrito silenciosamente: o valor anterior fica
 * registrado na versão anterior e a decisão fica em `brand_briefing_reviews`.
 */

export type BriefingReviewDecision = "approved" | "partial" | "changes_requested";

export type BriefingFieldDiff = {
  key: string;
  /** Valor hoje vigente no briefing canônico (clients.brand_hub). */
  current: string | string[] | null;
  /** Valor proposto pelo cliente (ausente quando não respondeu o campo). */
  proposed: string | string[] | null;
  answered: boolean;
  /** true quando a proposta difere do valor atual. */
  changed: boolean;
  /** true quando o campo atual está vazio (promoção não sobrescreve nada). */
  currentEmpty: boolean;
};

export type BriefingReviewDiff = {
  requestId: string;
  status: string;
  requestedFields: string[];
  proposalId: string | null;
  proposalNote: string | null;
  proposalAt: string | null;
  fields: BriefingFieldDiff[];
  acceptedFields: string[];
  pendingFields: string[];
  reviewDecision: BriefingReviewDecision | null;
  reviewNote: string | null;
  decidedAt: string | null;
};

export type BriefingReviewHistoryRow = {
  id: string;
  request_id: string;
  decision: BriefingReviewDecision;
  accepted_fields: string[];
  pending_fields: string[];
  note: string | null;
  created_at: string;
};

type Scope = { brandId: string; clientId: string };

function normalize(v: unknown): string | string[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v;
  return String(v);
}

function isEmpty(v: string | string[] | null): boolean {
  if (v == null) return true;
  return Array.isArray(v) ? v.length === 0 : v.trim().length === 0;
}

function same(a: string | string[] | null, b: string | string[] | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

async function loadRequest(supabase: SupabaseClient, scope: Scope, requestId: string) {
  const { data, error } = await supabase
    .from("brand_briefing_requests")
    .select(
      "id, status, requested_fields, accepted_fields, pending_fields, review_decision, review_note, decided_at, canceled_at",
    )
    .eq("id", requestId)
    .eq("brand_id", scope.brandId)
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("request_not_found");
  return data as {
    id: string;
    status: string;
    requested_fields: string[] | null;
    accepted_fields: string[] | null;
    pending_fields: string[] | null;
    review_decision: BriefingReviewDecision | null;
    review_note: string | null;
    decided_at: string | null;
    canceled_at: string | null;
  };
}

async function loadLatestProposal(supabase: SupabaseClient, scope: Scope, requestId: string) {
  const { data, error } = await supabase
    .from("brand_briefing_proposals")
    .select("id, payload, note, created_at")
    .eq("request_id", requestId)
    .eq("brand_id", scope.brandId)
    .eq("client_id", scope.clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as {
    id: string;
    payload: Record<string, unknown>;
    note: string | null;
    created_at: string;
  } | null;
}

async function loadHub(supabase: SupabaseClient, scope: Scope): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("clients")
    .select("brand_hub")
    .eq("id", scope.clientId)
    .eq("brand_id", scope.brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return ((data as { brand_hub?: Record<string, unknown> } | null)?.brand_hub ?? {}) as Record<
    string,
    unknown
  >;
}

/** Comparação campo a campo: briefing atual × proposta do cliente. */
export async function buildBriefingReviewDiff(
  supabase: SupabaseClient,
  scope: Scope,
  requestId: string,
): Promise<BriefingReviewDiff> {
  const request = await loadRequest(supabase, scope, requestId);
  const [proposal, hub] = await Promise.all([
    loadLatestProposal(supabase, scope, requestId),
    loadHub(supabase, scope),
  ]);

  const requestedFields = sanitizeRequestedFields(request.requested_fields ?? []);
  const payload = (proposal?.payload ?? {}) as Record<string, unknown>;

  const fields: BriefingFieldDiff[] = requestedFields.map((key) => {
    const current = normalize(hub[key]);
    const answered =
      Object.prototype.hasOwnProperty.call(payload, key) && !isEmpty(normalize(payload[key]));
    const proposed = answered ? normalize(payload[key]) : null;
    return {
      key,
      current,
      proposed,
      answered,
      changed: answered && !same(current, proposed),
      currentEmpty: isEmpty(current),
    };
  });

  return {
    requestId: request.id,
    status: request.status,
    requestedFields,
    proposalId: proposal?.id ?? null,
    proposalNote: proposal?.note ?? null,
    proposalAt: proposal?.created_at ?? null,
    fields,
    acceptedFields: request.accepted_fields ?? [],
    pendingFields: request.pending_fields ?? [],
    reviewDecision: request.review_decision,
    reviewNote: request.review_note,
    decidedAt: request.decided_at,
  };
}

export type DecideBriefingReviewInput = {
  requestId: string;
  decision: BriefingReviewDecision;
  /** Campos aceitos para promoção (ignorado em `changes_requested`). */
  acceptedFields?: string[];
  note?: string;
};

export type DecideBriefingReviewResult = {
  ok: true;
  decision: BriefingReviewDecision;
  promotedFields: string[];
  pendingFields: string[];
  versionId: string | null;
  requestStatus: "approved" | "requested";
};

/**
 * Decisão da agência sobre uma proposta. Promove apenas os campos aceitos,
 * cria uma nova versão do briefing e registra a decisão no histórico.
 */
export async function decideBriefingReview(
  supabase: SupabaseClient,
  scope: Scope,
  authorId: string | null,
  input: DecideBriefingReviewInput,
): Promise<DecideBriefingReviewResult> {
  const request = await loadRequest(supabase, scope, input.requestId);
  if (request.canceled_at) throw new Error("request_canceled");
  if (request.status === "requested") throw new Error("proposal_not_submitted");

  const proposal = await loadLatestProposal(supabase, scope, input.requestId);
  if (!proposal && input.decision !== "changes_requested") throw new Error("proposal_not_found");

  const requestedFields = sanitizeRequestedFields(request.requested_fields ?? []);
  const payload = (proposal?.payload ?? {}) as Record<string, unknown>;
  const answered = requestedFields.filter(
    (k) => Object.prototype.hasOwnProperty.call(payload, k) && !isEmpty(normalize(payload[k])),
  );

  let accepted: string[] = [];
  if (input.decision === "approved") {
    accepted = answered;
  } else if (input.decision === "partial") {
    const wanted = new Set(sanitizeRequestedFields(input.acceptedFields ?? []));
    accepted = answered.filter((k) => wanted.has(k));
    if (!accepted.length) throw new Error("no_accepted_fields");
  }

  const patch: Record<string, unknown> = {};
  for (const key of accepted) patch[key] = payload[key];

  const pending = requestedFields.filter((k) => !accepted.includes(k));
  const requestStatus: "approved" | "requested" =
    input.decision === "changes_requested" || pending.length > 0 ? "requested" : "approved";

  let versionId: string | null = null;
  let changedFields: string[] = [];
  if (Object.keys(patch).length > 0) {
    const written = await writeCanonicalBriefing(supabase, {
      brandId: scope.brandId,
      clientId: scope.clientId,
      patch,
      authorId,
      origin: "portal",
      skipEmpty: true,
      status: requestStatus === "approved" ? "approved" : "in_review",
    });
    versionId = written.versionId;
    changedFields = written.changedFields;
  } else {
    // Nenhuma promoção: apenas o ciclo de status volta para o cliente.
    await supabase
      .from("clients")
      .update({
        briefing_status: "requested",
        briefing_status_at: new Date().toISOString(),
        briefing_status_by: authorId,
      } as never)
      .eq("id", scope.clientId)
      .eq("brand_id", scope.brandId);
  }

  const now = new Date().toISOString();
  const { error: upErr } = await supabase
    .from("brand_briefing_requests")
    .update({
      status: requestStatus,
      accepted_fields: accepted,
      pending_fields: pending,
      review_decision: input.decision,
      review_note: input.note?.trim() || null,
      promoted_version_id: versionId,
      decided_at: now,
      decided_by: authorId,
      // Reabrir para o cliente exige nova resposta.
      submitted_at: requestStatus === "requested" ? null : now,
    } as never)
    .eq("id", request.id)
    .eq("brand_id", scope.brandId)
    .eq("client_id", scope.clientId);
  if (upErr) throw new Error(upErr.message);

  const { error: histErr } = await supabase.from("brand_briefing_reviews").insert({
    request_id: request.id,
    proposal_id: proposal?.id ?? null,
    brand_id: scope.brandId,
    client_id: scope.clientId,
    decision: input.decision,
    accepted_fields: accepted,
    pending_fields: pending,
    promoted: patch as never,
    note: input.note?.trim() || null,
    version_id: versionId,
    reviewed_by: authorId,
  } as never);
  if (histErr) throw new Error(histErr.message);

  return {
    ok: true,
    decision: input.decision,
    promotedFields: changedFields.length ? changedFields : accepted,
    pendingFields: pending,
    versionId,
    requestStatus,
  };
}

/** Histórico de decisões de um cliente (ou de uma solicitação). */
export async function listBriefingReviews(
  supabase: SupabaseClient,
  scope: Scope,
  requestId?: string | null,
): Promise<BriefingReviewHistoryRow[]> {
  let query = supabase
    .from("brand_briefing_reviews")
    .select("id, request_id, decision, accepted_fields, pending_fields, note, created_at")
    .eq("brand_id", scope.brandId)
    .eq("client_id", scope.clientId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (requestId) query = query.eq("request_id", requestId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    request_id: r.request_id as string,
    decision: r.decision as BriefingReviewDecision,
    accepted_fields: (r.accepted_fields as string[]) ?? [],
    pending_fields: (r.pending_fields as string[]) ?? [],
    note: (r.note as string | null) ?? null,
    created_at: r.created_at as string,
  }));
}
