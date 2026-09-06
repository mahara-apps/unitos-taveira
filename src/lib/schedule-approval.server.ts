/**
 * Aprovação da AGENDA de publicação (distinta da aprovação de conteúdo).
 *
 * Fluxo: proposed → client_pending (aprovada internamente) → reserved (cliente
 * aprovou) | client_changes (cliente pediu outra data).
 *
 * Aprovar agenda RESERVA a data — nunca publica e nunca agenda na fila real.
 * A publicação continua sendo responsabilidade do fluxo de agendamento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ScheduleStatus =
  | "none"
  | "proposed"
  | "internal_approved"
  | "client_pending"
  | "client_changes"
  | "reserved";

export type ScheduleActionResult = { updated: number; skipped: number };

const INTERNAL_APPROVABLE: ScheduleStatus[] = ["proposed", "client_changes"];

/**
 * Aprovação interna: valida a proposta e a envia para o cliente decidir.
 * Se a regra do cliente dispensa a aprovação da agenda, a data é RESERVADA
 * direto — nada fica pendente no portal.
 */
export async function internalApproveSchedule(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string; postIds: string[]; userId: string },
): Promise<ScheduleActionResult & { waived?: boolean }> {
  if (args.postIds.length === 0) return { updated: 0, skipped: 0 };
  const { requiresClientApproval } = await import("@/lib/client-policy.server");
  const needsClient = await requiresClientApproval(
    sb,
    { brandId: args.brandId, clientId: args.clientId },
    "schedule",
  );
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("posts")
    .update({
      schedule_status: needsClient ? "client_pending" : "reserved",
      schedule_approved_at: now,
      schedule_approved_by: args.userId,
      ...(needsClient ? {} : { schedule_client_decision_at: now }),
    } as never)
    .in("id", args.postIds)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .not("proposed_at", "is", null)
    .in("schedule_status", INTERNAL_APPROVABLE)
    .select("id");
  if (error) throw new Error(error.message);
  const updated = (data ?? []).length;
  return { updated, skipped: args.postIds.length - updated, waived: !needsClient };
}


/** Edição do slot proposto: volta ao início do fluxo de aprovação. */
export async function updateProposedSlot(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string; postId: string; proposedAt: string },
): Promise<void> {
  const { error } = await sb
    .from("posts")
    .update({
      proposed_at: args.proposedAt,
      schedule_status: "proposed",
      schedule_approved_at: null,
      schedule_approved_by: null,
      schedule_client_decision_at: null,
      schedule_client_comment: null,
    } as never)
    .eq("id", args.postId)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId);
  if (error) throw new Error(error.message);
}

/** Remove a proposta de agenda (a peça continua existindo, sem data). */
export async function clearProposedSlot(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string; postId: string },
): Promise<void> {
  const { error } = await sb
    .from("posts")
    .update({
      proposed_at: null,
      schedule_status: "none",
      schedule_approved_at: null,
      schedule_approved_by: null,
      schedule_client_decision_at: null,
      schedule_client_comment: null,
    } as never)
    .eq("id", args.postId)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId);
  if (error) throw new Error(error.message);
}

/** Decisão do cliente (portal): reserva a data ou pede alteração. */
export async function clientDecideSchedule(
  sb: SupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    postIds: string[];
    decision: "approve" | "changes";
    comment?: string;
  },
): Promise<ScheduleActionResult> {
  if (args.postIds.length === 0) return { updated: 0, skipped: 0 };
  const { data, error } = await sb
    .from("posts")
    .update({
      schedule_status: args.decision === "approve" ? "reserved" : "client_changes",
      schedule_client_decision_at: new Date().toISOString(),
      schedule_client_comment: (args.comment ?? "").trim().slice(0, 1000) || null,
    } as never)
    .in("id", args.postIds)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .not("proposed_at", "is", null)
    .in("schedule_status", ["client_pending", "internal_approved"])
    .select("id");
  if (error) throw new Error(error.message);
  const updated = (data ?? []).length;
  return { updated, skipped: args.postIds.length - updated };
}

export type ProposedScheduleItem = {
  postId: string;
  title: string;
  proposedAt: string;
  scheduleStatus: ScheduleStatus;
  format: string | null;
  channels: string[];
  rationale: string | null;
  clientComment: string | null;
};

/** Agenda proposta/reservada de um cliente numa janela — leitura para o portal. */
export async function listScheduleForClient(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string; from: string; to: string },
): Promise<ProposedScheduleItem[]> {
  const { data, error } = await sb
    .from("posts")
    .select(
      "id,title,format,channels,proposed_at,schedule_status,schedule_client_comment,internal_briefing",
    )
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .is("deleted_at", null)
    .not("proposed_at", "is", null)
    .gte("proposed_at", args.from)
    .lte("proposed_at", args.to)
    .in("schedule_status", ["client_pending", "internal_approved", "client_changes", "reserved"])
    .order("proposed_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      postId: row["id"] as string,
      title: (row["title"] as string | null) ?? "Publicação",
      proposedAt: row["proposed_at"] as string,
      scheduleStatus: ((row["schedule_status"] as string | null) ?? "none") as ScheduleStatus,
      format: (row["format"] as string | null) ?? null,
      channels: ((row["channels"] as string[] | null) ?? []) as string[],
      rationale: (row["internal_briefing"] as string | null) ?? null,
      clientComment: (row["schedule_client_comment"] as string | null) ?? null,
    };
  });
}

/** Link ativo do Portal do cliente (1 por cliente) para conferir a agenda. */
export type ClientScheduleLink = {
  token: string;
  /** Caminho relativo — a UI prefixa com a origem atual. */
  path: string;
  expiresAt: string | null;
  created: boolean;
};

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Garante um link de Portal ativo para o cliente e devolve o caminho da agenda.
 * Não envia nada: o link é copiado e enviado manualmente pela operação.
 */
export async function ensureClientScheduleLink(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string; userId: string },
): Promise<ClientScheduleLink | null> {
  // Escopo: o cliente precisa pertencer ao workspace ativo.
  const { data: clientRow, error: cErr } = await sb
    .from("clients")
    .select("id, brand_id")
    .eq("id", args.clientId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!clientRow || (clientRow as { brand_id: string }).brand_id !== args.brandId) {
    throw new Error("forbidden: cliente fora deste workspace.");
  }

  const nowIso = new Date().toISOString();
  const { data: existing, error: eErr } = await sb
    .from("portal_tokens")
    .select("token, expires_at")
    .eq("client_id", args.clientId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (eErr) throw new Error(eErr.message);

  const usable = (existing ?? []).find((t) => {
    const exp = (t as { expires_at: string | null }).expires_at;
    return !exp || exp > nowIso;
  }) as { token: string; expires_at: string | null } | undefined;

  if (usable) {
    return {
      token: usable.token,
      path: `/portal/${usable.token}/calendario`,
      expiresAt: usable.expires_at,
      created: false,
    };
  }

  const token = randomToken();
  const { error: iErr } = await sb.from("portal_tokens").insert({
    client_id: args.clientId,
    token,
    label: "Agenda de publicação",
    expires_at: null,
    created_by: args.userId,
  } as never);
  if (iErr) return null; // best-effort: aprovar não pode falhar por causa do link
  return { token, path: `/portal/${token}/calendario`, expiresAt: null, created: true };
}

/**
 * Reserva a data SEM passar pelo cliente. Só Owner/Admin (ou Super Admin).
 * Continua sem publicar e sem preencher `scheduled_at`.
 */
export async function reserveScheduleDirect(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string; postIds: string[]; userId: string },
): Promise<ScheduleActionResult> {
  if (args.postIds.length === 0) return { updated: 0, skipped: 0 };
  const { isBrandAdmin } = await import("@/lib/monthly-plan-delete.server");
  if (!(await isBrandAdmin(sb, args.userId, args.brandId))) {
    throw new Error("forbidden: apenas Owner/Admin podem reservar sem o cliente.");
  }
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("posts")
    .update({
      schedule_status: "reserved",
      schedule_approved_at: now,
      schedule_approved_by: args.userId,
      schedule_client_decision_at: now,
      schedule_client_comment: null,
    } as never)
    .in("id", args.postIds)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .not("proposed_at", "is", null)
    .in("schedule_status", ["proposed", "internal_approved", "client_pending", "client_changes"])
    .select("id");
  if (error) throw new Error(error.message);
  const updated = (data ?? []).length;
  return { updated, skipped: args.postIds.length - updated };
}
