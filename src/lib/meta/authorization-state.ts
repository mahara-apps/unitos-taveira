/**
 * Estado Meta: AUTORIZAÇÃO × PORTFÓLIO EMPRESARIAL × CANAIS (lógica pura).
 *
 * Três conceitos que NÃO são a mesma coisa:
 *
 * 1. AUTORIZAÇÃO (`meta_oauth_sessions`) — um usuário Meta concedeu acesso ao
 *    app neste workspace. Vários administradores da agência podem autorizar.
 * 2. BUSINESS PORTFOLIO (`meta_business_id`) — o portfólio empresarial dono dos
 *    ativos. Uma autorização pode alcançar VÁRIOS portfólios, e um portfólio
 *    pode ser alcançado por VÁRIAS autorizações (dois admins do mesmo BM).
 * 3. CANAL CONECTADO (`social_connections`) — ativo escolhido e salvo.
 *
 * Um portfólio autorizado sem nenhum canal continua autorizado: é o estado
 * "contas disponíveis aguardando seleção". Nunca criamos linhas artificiais em
 * `social_connections` para representar autorização.
 */

/** Uma concessão de acesso feita por um usuário Meta neste workspace. */
export type MetaAuthorizationSummary = {
  metaUserId: string | null;
  metaUserName: string | null;
  metaUserEmail: string | null;
  authorizedAt: string | null;
  /** Portfólios empresariais alcançados por esta autorização. */
  businesses: Array<{ id: string; name: string | null }>;
};

export type MetaPortfolioSummary = {
  /** Identidade real do portfólio empresarial (null em linhas legadas). */
  businessId: string | null;
  businessName: string | null;
  /**
   * Compatibilidade: identidade usada em linhas antigas, onde o "portfólio"
   * era gravado como o ID do usuário Meta.
   */
  ownerExternalId: string | null;
  ownerName: string | null;
  /** true = agrupado por usuário Meta porque não há identidade de portfólio. */
  legacyIdentity: boolean;
  channelCount: number;
  activeCount: number;
  attentionCount: number;
  clientCount: number;
  channels: string[];
  connectedAt: string | null;
  /** true = existe autorização válida alcançando este portfólio. */
  authorized: boolean;
  /** Usuários Meta que autorizaram o app para este portfólio. */
  authorizedByMetaUserIds: string[];
};

export type MetaPortfolioStatus = {
  /** true = o workspace tem pelo menos uma autorização Meta válida. */
  authorized: boolean;
  /** Compatibilidade: usuário Meta da autorização mais recente. */
  metaUserName: string | null;
  metaUserEmail: string | null;
  authorizedAt: string | null;
  /** Todas as autorizações válidas (multi-administrador). */
  authorizations: MetaAuthorizationSummary[];
  portfolios: MetaPortfolioSummary[];
};

export type ConnectionRow = {
  channel: string;
  status: string;
  owner_external_id: string | null;
  owner_name: string | null;
  client_id: string | null;
  created_at: string | null;
  meta_business_id?: string | null;
  meta_business_name?: string | null;
};

export type SessionRow = {
  meta_user_id: string | null;
  meta_user_name: string | null;
  meta_user_email: string | null;
  user_token_ciphertext: string | null;
  user_token_expires_at: string | null;
  revoked_at?: string | null;
  created_at: string | null;
  /** Portfólios empresariais descobertos por esta sessão. */
  businesses?: unknown;
};

/** Status de conexão que ainda representa um canal existente no workspace. */
const ACTIVE_STATUSES = new Set(["active", "attention", "needs_reauth", "error", "expired"]);

/**
 * Sessão utilizável AGORA. Espelha exatamente o filtro usado na descoberta de
 * contas — se a sessão alimenta "Contas disponíveis", ela também precisa
 * alimentar "Portfólios Meta autorizados".
 */
export function isSessionAuthorized(session: SessionRow, nowMs: number = Date.now()): boolean {
  if (session.revoked_at) return false;
  if (!session.user_token_ciphertext) return false;
  if (!session.user_token_expires_at) return true;
  return new Date(session.user_token_expires_at).getTime() > nowMs;
}

export function readSessionBusinesses(raw: unknown): Array<{ id: string; name: string | null }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; name: string | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as { id?: unknown; name?: unknown };
    if (typeof o.id !== "string" || !o.id) continue;
    out.push({ id: o.id, name: typeof o.name === "string" ? o.name : null });
  }
  return out;
}

const UNKNOWN = "__unknown__";

export function buildMetaPortfolioStatus(
  connections: ConnectionRow[],
  sessions: SessionRow[],
  nowMs: number = Date.now(),
): MetaPortfolioStatus {
  type Entry = MetaPortfolioSummary & { clientIds: Set<string>; metaUserIds: Set<string> };
  const map = new Map<string, Entry>();

  const ensure = (params: {
    businessId: string | null;
    businessName: string | null;
    ownerExternalId: string | null;
    ownerName: string | null;
    at: string | null;
  }): Entry => {
    const legacyIdentity = !params.businessId;
    const key = params.businessId ?? `user:${params.ownerExternalId ?? UNKNOWN}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        businessId: params.businessId,
        businessName: params.businessName,
        ownerExternalId: params.ownerExternalId,
        ownerName: params.ownerName,
        legacyIdentity,
        channelCount: 0,
        activeCount: 0,
        attentionCount: 0,
        clientCount: 0,
        channels: [],
        connectedAt: params.at,
        authorized: false,
        authorizedByMetaUserIds: [],
        clientIds: new Set<string>(),
        metaUserIds: new Set<string>(),
      };
      map.set(key, entry);
    }
    if (!entry.businessName && params.businessName) entry.businessName = params.businessName;
    if (!entry.ownerName && params.ownerName) entry.ownerName = params.ownerName;
    if (!entry.ownerExternalId && params.ownerExternalId) {
      entry.ownerExternalId = params.ownerExternalId;
    }
    return entry;
  };

  for (const r of connections) {
    if (r.status === "revoked" || !ACTIVE_STATUSES.has(r.status)) continue;
    const entry = ensure({
      businessId: r.meta_business_id ?? null,
      businessName: r.meta_business_name ?? null,
      ownerExternalId: r.owner_external_id ?? null,
      ownerName: r.owner_name ?? null,
      at: r.created_at,
    });
    entry.channelCount += 1;
    if (r.status === "active") entry.activeCount += 1;
    else entry.attentionCount += 1;
    if (!entry.channels.includes(r.channel)) entry.channels.push(r.channel);
    if (r.client_id) entry.clientIds.add(r.client_id);
  }

  const active = sessions.filter((s) => isSessionAuthorized(s, nowMs));
  const authorizations: MetaAuthorizationSummary[] = active.map((s) => ({
    metaUserId: s.meta_user_id ?? null,
    metaUserName: s.meta_user_name ?? null,
    metaUserEmail: s.meta_user_email ?? null,
    authorizedAt: s.created_at ?? null,
    businesses: readSessionBusinesses(s.businesses),
  }));

  for (const auth of authorizations) {
    const businesses = auth.businesses;
    if (businesses.length === 0) {
      // Autorização sem portfólio conhecido (ainda não descobriu, ou usuário
      // é admin direto das Páginas): mantém a identidade legada por usuário.
      const entry = ensure({
        businessId: null,
        businessName: null,
        ownerExternalId: auth.metaUserId,
        ownerName: auth.metaUserName,
        at: auth.authorizedAt,
      });
      entry.authorized = true;
      if (auth.metaUserId) entry.metaUserIds.add(auth.metaUserId);
      if (!entry.connectedAt) entry.connectedAt = auth.authorizedAt;
      continue;
    }
    for (const b of businesses) {
      const entry = ensure({
        businessId: b.id,
        businessName: b.name,
        ownerExternalId: auth.metaUserId,
        ownerName: auth.metaUserName,
        at: auth.authorizedAt,
      });
      entry.authorized = true;
      if (auth.metaUserId) entry.metaUserIds.add(auth.metaUserId);
      if (!entry.connectedAt) entry.connectedAt = auth.authorizedAt;
    }
  }

  const newest = active[0] ?? null;

  return {
    authorized: active.length > 0,
    metaUserName: newest?.meta_user_name ?? null,
    metaUserEmail: newest?.meta_user_email ?? null,
    authorizedAt: newest?.created_at ?? null,
    authorizations,
    portfolios: [...map.values()].map(({ clientIds, metaUserIds, ...p }) => ({
      ...p,
      clientCount: clientIds.size,
      authorizedByMetaUserIds: [...metaUserIds],
    })),
  };
}
