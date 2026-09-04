import { readPagesPayload } from "./portfolio-shared";
import { readSessionBusinesses } from "./authorization-state";

/**
 * Revogação da AUTORIZAÇÃO Meta de um workspace.
 *
 * Vocabulário (não confundir):
 * - autorização Meta    → linha em `meta_oauth_sessions` (usuário Meta que
 *   consentiu + token). É ela que torna contas "disponíveis".
 * - Business Portfolio  → `meta_business_id` (identidade real do portfólio).
 * - conta descoberta    → item devolvido pela Graph API (cache em `pages`).
 * - canal conectado     → linha em `social_connections` (status != revoked).
 * - vínculo com cliente → linha em `client_social_accounts`.
 * - histórico           → linhas revogadas/marcadas, preservadas para auditoria.
 *
 * Revogar = marcar `revoked_at`/`status = revoked`; nada é apagado (exceto os
 * vínculos derivados cliente↔canal, que são recriáveis). Toda query que decide
 * "o que a Meta autoriza AGORA" precisa filtrar `revoked_at is null`.
 *
 * GRANULARIDADE: desconectar um portfólio NUNCA derruba os outros portfólios
 * autorizados no mesmo workspace. Uma sessão só é revogada quando ela não
 * alcança mais nenhum portfólio ativo; caso contrário, apenas os ativos do
 * portfólio removido saem do cache de descoberta.
 */

/** Cliente Supabase mínimo usado aqui (facilita testes com fake). */
type AnyClient = {
  from: (table: string) => any;
};

export const ACTIVE_SESSION_FILTER = "revoked_at" as const;

export type RevokeResult = {
  removed: number;
  sessionsRevoked: boolean;
  /** Sessões que continuaram válidas por atenderem outros portfólios. */
  sessionsKept: number;
};

type SessionForRevoke = {
  id: string;
  meta_user_id: string | null;
  businesses: unknown;
  pages: unknown;
};

/**
 * Desconecta UM portfólio Meta do workspace (ou, em linhas legadas sem
 * identidade de portfólio, a autorização de um usuário Meta específico).
 *
 * Escopo sempre por `brand_id`: nenhum outro workspace é afetado.
 */
export async function revokeMetaPortfolio(
  supabase: AnyClient,
  params: {
    brandId: string;
    /** Identidade real do portfólio empresarial. */
    businessId?: string | null;
    /** Usado quando não há `businessId` (linhas legadas) ou como filtro extra. */
    ownerExternalId?: string | null;
    reason?: string;
  },
): Promise<RevokeResult> {
  const { brandId } = params;
  const businessId = params.businessId ?? null;
  const ownerExternalId = params.ownerExternalId ?? null;
  const reason = params.reason ?? "Portfólio Meta desconectado do workspace pela equipe.";
  const nowIso = new Date().toISOString();

  // 1) Canais do portfólio → revogados (histórico preservado).
  let query = supabase
    .from("social_connections")
    .select("id")
    .eq("brand_id", brandId)
    .eq("provider", "meta")
    .neq("status", "revoked");
  if (businessId) {
    query = query.eq("meta_business_id", businessId);
  } else if (ownerExternalId) {
    query = query.eq("owner_external_id", ownerExternalId).is("meta_business_id", null);
  } else {
    query = query.is("owner_external_id", null).is("meta_business_id", null);
  }
  const { data: conns, error: listErr } = await query;
  if (listErr) throw listErr;
  const ids = ((conns ?? []) as Array<{ id: string }>).map((c) => c.id);

  if (ids.length) {
    const { error: linkErr } = await supabase
      .from("client_social_accounts")
      .delete()
      .eq("brand_id", brandId)
      .in("connection_id", ids);
    if (linkErr) throw linkErr;

    const { error: revokeErr } = await supabase
      .from("social_connections")
      .update({
        status: "revoked",
        client_id: null,
        last_error: reason,
        last_synced_at: nowIso,
      })
      .eq("brand_id", brandId)
      .eq("provider", "meta")
      .in("id", ids);
    if (revokeErr) throw revokeErr;
  }

  // 2) Autorizações: revoga apenas as que deixam de alcançar algum portfólio.
  const { data: sessions, error: sessErr } = await supabase
    .from("meta_oauth_sessions")
    .select("id, meta_user_id, businesses, pages")
    .eq("brand_id", brandId)
    .is("revoked_at", null);
  if (sessErr) throw sessErr;

  let revoked = 0;
  let kept = 0;
  for (const s of (sessions ?? []) as SessionForRevoke[]) {
    const businesses = readSessionBusinesses(s.businesses);
    const touchesTarget = businessId
      ? businesses.some((b) => b.id === businessId)
      : !ownerExternalId || s.meta_user_id === ownerExternalId;
    if (!touchesTarget) {
      kept += 1;
      continue;
    }

    const remaining = businessId ? businesses.filter((b) => b.id !== businessId) : [];
    if (remaining.length === 0) {
      const { error } = await supabase
        .from("meta_oauth_sessions")
        .update({
          revoked_at: nowIso,
          revoked_reason: reason,
          expires_at: nowIso,
          user_token_expires_at: nowIso,
        })
        .eq("id", s.id)
        .eq("brand_id", brandId);
      if (error) throw error;
      revoked += 1;
      continue;
    }

    // A sessão ainda serve outros portfólios: mantém a autorização e apenas
    // remove os ativos do portfólio desconectado do cache de descoberta.
    const payload = readPagesPayload(s.pages);
    const prunedPages = payload.pages.filter((p) => (p.businessId ?? null) !== businessId);
    const prunedPayload = {
      ...payload,
      pages: prunedPages,
      businesses: remaining,
      businessCount: remaining.length,
    };
    const { error } = await supabase
      .from("meta_oauth_sessions")
      .update({
        pages: prunedPayload as unknown as Record<string, unknown>,
        businesses: remaining as unknown as Record<string, unknown>,
      })
      .eq("id", s.id)
      .eq("brand_id", brandId);
    if (error) throw error;
    kept += 1;
  }

  return { removed: ids.length, sessionsRevoked: revoked > 0, sessionsKept: kept };
}

/**
 * Revoga a autorização de UM usuário Meta (um administrador da agência) sem
 * mexer nas autorizações de outros administradores. Canais permanecem, pois
 * podem continuar autorizados por outra sessão do mesmo portfólio.
 */
export async function revokeMetaAuthorization(
  supabase: AnyClient,
  params: { brandId: string; metaUserId: string; reason?: string },
): Promise<{ sessionsRevoked: number }> {
  const nowIso = new Date().toISOString();
  const reason = params.reason ?? "Autorização Meta revogada pela equipe do workspace.";
  const { data, error } = await supabase
    .from("meta_oauth_sessions")
    .update({
      revoked_at: nowIso,
      revoked_reason: reason,
      expires_at: nowIso,
      user_token_expires_at: nowIso,
    })
    .eq("brand_id", params.brandId)
    .eq("meta_user_id", params.metaUserId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw error;
  return { sessionsRevoked: ((data ?? []) as Array<{ id: string }>).length };
}
