import { z } from "zod";

/**
 * Runtime siblings for `portfolio.functions.ts`.
 *
 * Server-function files are split by the build: anything at module scope that
 * is not an import, a type or an exported server function gets stripped, which
 * turns these helpers into `ReferenceError`s at runtime. Keep them here.
 */

export type PortfolioPage = {
  pageId: string;
  pageName: string;
  category: string | null;
  pagePictureUrl: string | null;
  instagramBusinessId: string | null;
  instagramUsername: string | null;
  instagramPictureUrl: string | null;
  /** Business Portfolio (Business Manager) dono/compartilhador do ativo. */
  businessId?: string | null;
  businessName?: string | null;
};


export type PortfolioThreadsAccount = {
  threadsUserId: string;
  username: string | null;
  name: string | null;
  pictureUrl: string | null;
  linkedViaPageId?: string;
};

export type PortfolioAdAccount = {
  adAccountId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  accountStatus: number | null;
  businessName: string | null;
};

/** Autorização granular de publicação (espelho serializável do server). */
export type ChannelAuthorizationInfo = {
  broad: boolean;
  targets: string[];
  granted: boolean;
};

export type PublishAuthorizationInfo = {
  instagram: ChannelAuthorizationInfo;
  facebook: ChannelAuthorizationInfo;
  checkedAt: string;
  unavailable: boolean;
};

/** Estado canônico de UX de uma conta descoberta. */
export type DiscoveredAccountStatus = "ready" | "authorization_required" | "unavailable";

export type PortfolioResponse = {
  sessionId: string;
  metaUser: { id: string; name: string | null; email: string | null };
  portfolioStatus: "not_loaded" | "loaded" | "empty" | "error" | "rate_limited";
  portfolioLoadedAt: string | null;
  portfolioError: string | null;
  portfolioRateLimitedUntil: string | null;
  scopes: string[];
  requestedScopes: string[];
  missingScopes: string[];
  pages: PortfolioPage[];
  pagesCount: number;
  pagesWithIgCount: number;
  pagesWithoutIgCount: number;
  standaloneInstagram: PortfolioStandaloneInstagram[];
  standaloneInstagramCount: number;
  scanWarnings: string[];
  businessCount: number;
  /** Autorização granular por canal (target_ids da Meta). */
  publishAuthorization: PublishAuthorizationInfo | null;
  threadsAccounts: PortfolioThreadsAccount[];
  adAccounts: PortfolioAdAccount[];
  connected: {
    facebook: Record<string, string>;
    instagram: Record<string, string>;
    threads: Record<string, string>;
    ads: Record<string, string>;
  };
  expiresAt: string;
};

export const GetInput = z.object({
  brandId: z.string().uuid(),
  sessionId: z.string().uuid(),
  channel: z.enum(["facebook", "instagram", "threads", "ads"]).optional(),
  refresh: z.boolean().optional(),
});

export const LinkInput = z.object({
  brandId: z.string().uuid(),
  sessionId: z.string().uuid(),
  channel: z.enum(["facebook", "instagram", "threads", "ads"]),
  targetId: z.string().min(1),
  clientId: z.string().uuid().optional(),
  /**
   * When the target is a Page that has an Instagram Business account attached,
   * link both channels in one action (Página + Instagram vêm juntos).
   */
  linkPair: z.boolean().optional(),
});

export const UnlinkInput = z.object({
  brandId: z.string().uuid(),
  connectionId: z.string().uuid(),
});

/** Meta rate-limit error codes (Graph API + Business Manager). */
export const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
export const RATE_LIMIT_PREFIX = "RATE_LIMIT:";
/** Prefix used so the UI can restart OAuth instead of showing a dead end. */
export const SESSION_INVALID_PREFIX = "META_SESSION_INVALID:";

export function isMetaRateLimit(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; graph?: { code?: number } };
  if (e.status === 429) return true;
  if (e.graph?.code && META_RATE_LIMIT_CODES.has(e.graph.code)) return true;
  return false;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Instagram Business account with no Page the user can administer. */
export type PortfolioStandaloneInstagram = {
  instagramId: string;
  username: string | null;
  name: string | null;
  pictureUrl: string | null;
  businessName: string | null;
};

export type CachedBusiness = { id: string; name: string | null };

export type CachedPagesPayload = {
  pages: Array<PortfolioPage & { pageAccessToken?: string }>;
  standaloneInstagram: PortfolioStandaloneInstagram[];
  warnings: string[];
  businessCount: number;
  /** Business Portfolios que esta autorização alcança. */
  businesses?: CachedBusiness[];
  publishAuthorization?: PublishAuthorizationInfo | null;
};

/**
 * `meta_oauth_sessions.pages` holds either a bare array (sessions created
 * before the portfolio-wide scan) or the full payload object. Normalizes both.
 */
export function readPagesPayload(raw: unknown): CachedPagesPayload {
  const empty: CachedPagesPayload = {
    pages: [],
    standaloneInstagram: [],
    warnings: [],
    businessCount: 0,
    businesses: [],
    publishAuthorization: null,
  };
  if (!raw) return empty;
  if (Array.isArray(raw)) {
    return { ...empty, pages: raw as CachedPagesPayload["pages"] };
  }
  if (typeof raw === "object") {
    const o = raw as Partial<CachedPagesPayload>;
    return {
      pages: Array.isArray(o.pages) ? o.pages : [],
      standaloneInstagram: Array.isArray(o.standaloneInstagram) ? o.standaloneInstagram : [],
      warnings: Array.isArray(o.warnings) ? o.warnings : [],
      businessCount: typeof o.businessCount === "number" ? o.businessCount : 0,
      businesses: Array.isArray(o.businesses) ? o.businesses : [],
      publishAuthorization:
        (o.publishAuthorization as PublishAuthorizationInfo | undefined) ?? null,
    };
  }
  return empty;
}


/**
 * Guard against concurrent discovery for the same session/channel. A double
 * click on "Sincronizar" (or a client+server duplicate call) must result in ONE
 * Graph discovery, not two. Server workers are stateless per request, so this
 * only de-dupes within an instance — which is exactly where the duplicates
 * happen.
 */
const inflightDiscovery = new Map<string, Promise<void>>();

export function beginDiscovery(key: string): { wait: Promise<void> | null; done: () => void } {
  const existing = inflightDiscovery.get(key);
  if (existing) return { wait: existing, done: () => {} };
  let release: () => void = () => {};
  const p = new Promise<void>((resolve) => {
    release = resolve;
  });
  inflightDiscovery.set(key, p);
  return {
    wait: null,
    done: () => {
      inflightDiscovery.delete(key);
      release();
    },
  };
}

/**
 * Merges freshly discovered Pages with previously known ones (cache), keeping
 * the fresh row when both exist. Never drops known assets.
 */
export function mergeDiscoveredPages(
  fresh: CachedPagesPayload["pages"],
  known: CachedPagesPayload["pages"],
): CachedPagesPayload["pages"] {
  const byId = new Map<string, CachedPagesPayload["pages"][number]>();
  for (const p of known) byId.set(p.pageId, p);
  for (const p of fresh) {
    const prev = byId.get(p.pageId);
    byId.set(p.pageId, {
      ...prev,
      ...p,
      // Keep a previously captured token if the fresh row came without one.
      pageAccessToken: p.pageAccessToken || prev?.pageAccessToken || undefined,
    });
  }
  return Array.from(byId.values());
}

/** Strips tokens from cached discovery metadata (safe to reuse across sessions). */
export function stripPageTokens(pages: CachedPagesPayload["pages"]): CachedPagesPayload["pages"] {
  return pages.map(({ pageAccessToken: _drop, ...rest }) => rest);
}

/**
 * Status canônico de uma conta descoberta, derivado APENAS da autorização
 * granular do target real. Nunca infere por username nem por canal conectado.
 */
export function accountDiscoveryStatus(
  auth: PublishAuthorizationInfo | null | undefined,
  channel: "instagram" | "facebook",
  targetId: string | null | undefined,
): DiscoveredAccountStatus {
  if (!targetId) return "unavailable";
  if (!auth || auth.unavailable) return "authorization_required";
  const ch = auth[channel];
  if (!ch.granted) return "authorization_required";
  if (ch.broad) return "ready";
  return ch.targets.includes(String(targetId)) ? "ready" : "authorization_required";
}

/**
 * Motivo acionável do status — o usuário precisa saber O QUE FAZER, não apenas
 * que a conta está "Não disponível".
 */
export function accountStatusReason(
  auth: PublishAuthorizationInfo | null | undefined,
  channel: "instagram" | "facebook",
  targetId: string | null | undefined,
): string | null {
  const label = channel === "instagram" ? "Instagram" : "Página";
  if (!targetId) return `${label} sem ID válido retornado pela Meta.`;
  if (!auth || auth.unavailable) {
    return "Não foi possível confirmar a autorização granular do app junto à Meta agora. Tente sincronizar novamente.";
  }
  const ch = auth[channel];
  if (!ch.granted) {
    return `O app não recebeu a permissão necessária para ${label}. Reautorize na Meta concedendo as permissões solicitadas.`;
  }
  if (ch.broad || ch.targets.includes(String(targetId))) return null;
  return `Este ativo existe no Business Portfolio, mas não foi selecionado durante o consentimento. Clique em "Autorizar na Meta" e marque este ${label} na tela de escolha de ativos.`;
}

