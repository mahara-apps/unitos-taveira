// Social Analytics Service — camada oficial de abstração entre a aplicação
// (dashboards, endpoints HTTP, server functions) e a interface `SocialProvider`
// (Meta, LinkedIn, TikTok, YouTube, X, Threads…).
//
// Arquitetura obrigatória:
//
//     Dashboard
//        ↓
//     SocialAnalyticsService   ← este módulo
//        ↓
//     SocialProvider           (src/lib/social/provider.ts)
//        ↓
//     MetaProvider             (src/lib/meta/provider.server.ts)
//        ↓
//     Meta Graph API
//
// Nenhuma tela / server function / route handler deve chamar a Graph API
// diretamente, importar providers concretos, ou reimplementar resolução de
// conexão, decriptação de token, inferência de rede e cache. Toda essa
// mecânica vive aqui.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  GetAudienceOptions,
  GetDashboardOptions,
  GetPostOptions,
  GetPostsOptions,
  GetProfileOptions,
  GetTopPostsOptions,
  ConnectOptions,
  DisconnectOptions,
  RefreshTokenOptions,
  PublishOptions,
  ScheduleOptions,
  SocialConnectStart,
  SocialPublishResult,
  SocialScheduleResult,
  SocialTokenInfo,
  ProviderResult,
  SocialAudience,
  SocialDashboard,
  SocialNetwork,
  SocialPost,
  SocialProfile,
} from "@/lib/social/types";
import type { SocialProvider, SocialProviderContext } from "@/lib/social/provider";
import { getSocialProviderForNetwork } from "@/lib/social/registry.server";
import { decryptCredential } from "@/lib/credentials-crypto.server";
import { SOCIAL_CACHE_TTL_MS, hashKey, socialCacheKey, withSocialCache } from "./cache";

export { SOCIAL_CACHE_TTL_MS };

// ---------------------------------------------------------------------------
// Autenticação — cliente Supabase por request, herda RLS do bearer do usuário
// ---------------------------------------------------------------------------

function isNewKey(k: string) {
  return k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");
}

function makeAuthedFetch(key: string, token: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (isNewKey(key) && headers.get("Authorization") === `Bearer ${key}`)
      headers.delete("Authorization");
    headers.set("apikey", key);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}

/**
 * Extrai o bearer token JWT do header `Authorization` de uma Request.
 * Lança `SocialServiceError` com 401 quando ausente/inválido.
 */
export function requireBearer(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw new SocialServiceError("db_error", "Unauthorized", 401);
  }
  const token = auth.slice(7);
  if (token.split(".").length !== 3) {
    throw new SocialServiceError("db_error", "Invalid token", 401);
  }
  return token;
}

/** Cliente Supabase autenticado como o usuário (RLS aplica). */
export function supabaseForUser(token: string): SupabaseClient<Database> {
  const url = process.env.SUPABASE_URL;
  const pubKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !pubKey) {
    throw new SocialServiceError("db_error", "Missing Supabase env", 500);
  }
  return createClient<Database>(url, pubKey, {
    global: {
      fetch: makeAuthedFetch(pubKey, token),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Erro estruturado. Rotas HTTP mapeiam `code` → status. */
export class SocialServiceError extends Error {
  constructor(
    readonly code:
      | "invalid_connection_id"
      | "not_found"
      | "connection_missing_token"
      | "unsupported_provider"
      | "provider_not_implemented"
      | "token_decrypt_failed"
      | "db_error"
      | "provider_error",
    message: string,
    readonly status: number = 500,
    readonly extras?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SocialServiceError";
  }
}

export type ResolvedConnection = {
  ctx: SocialProviderContext;
  network: SocialNetwork;
  provider: SocialProvider;
  /** Prefixo estável de cache: escopa por usuário + conexão. */
  cacheScope: string;
  /** Nome canônico da rota `social_connections.provider` (ex.: "meta"). */
  providerKey: string;
  externalName: string | null;
};

/** Provider key (`social_connections.provider`) → user-facing network id. */
function inferNetwork(provider: string, accountId: string | null): SocialNetwork | null {
  const p = provider.toLowerCase();
  if (p === "meta") return accountId ? "instagram" : "facebook";
  if (
    p === "instagram" ||
    p === "facebook" ||
    p === "linkedin" ||
    p === "tiktok" ||
    p === "youtube" ||
    p === "x" ||
    p === "threads"
  )
    return p;
  return null;
}

/**
 * Resolve uma `social_connections` row para o par (contexto, provider)
 * necessário para chamadas subsequentes. Escopa via RLS pelo Supabase
 * client fornecido — passe o cliente autenticado do usuário.
 */
export async function resolveConnection(
  supabase: SupabaseClient<Database>,
  connectionId: string,
  userTokenForCache: string,
): Promise<ResolvedConnection> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) {
    throw new SocialServiceError("invalid_connection_id", "connectionId inválido", 400);
  }

  const { data: row, error } = await supabase
    .from("social_connections")
    .select(
      "id, brand_id, provider, external_id, external_name, account_id, account_username, access_token_ciphertext, status",
    )
    .eq("id", connectionId)
    .maybeSingle();
  if (error) {
    throw new SocialServiceError("db_error", error.message, 500);
  }
  if (!row) {
    throw new SocialServiceError("not_found", "Conexão não encontrada", 404);
  }
  if (!row.access_token_ciphertext) {
    throw new SocialServiceError("connection_missing_token", "Conexão sem token — reconecte", 409);
  }

  const network = inferNetwork(row.provider, row.account_id);
  if (!network) {
    throw new SocialServiceError(
      "unsupported_provider",
      `Provider "${row.provider}" não suportado`,
      400,
      { provider: row.provider },
    );
  }

  const provider = getSocialProviderForNetwork(network);
  if (!provider) {
    throw new SocialServiceError(
      "provider_not_implemented",
      `Provider para "${network}" ainda não implementado`,
      501,
      { network },
    );
  }

  let accessToken: string;
  try {
    accessToken = await decryptCredential(row.access_token_ciphertext);
  } catch {
    // O token está gravado, mas não é mais legível: a chave de criptografia da
    // instalação (`BRAND_CREDENTIALS_SECRET`) não é a mesma que o cifrou. Não é
    // erro de servidor nem falha transitória — só reconectar resolve. Marcamos a
    // conexão para que a tela avise antes de o usuário abrir as métricas.
    const label = row.external_name ?? row.account_username ?? row.external_id;
    const message = `Conexão "${label}" precisa ser reconectada: o token salvo não pode mais ser lido. Reconecte a conta em Integrações.`;
    try {
      await supabase
        .from("social_connections")
        .update({ status: "needs_reconnect", last_error: message })
        .eq("id", row.id);
    } catch {
      // Sinalização é best-effort: nunca substitui o erro devolvido ao usuário.
    }
    throw new SocialServiceError("token_decrypt_failed", message, 409, {
      connectionId: row.id,
      needsReconnect: true,
    });
  }

  const ctx: SocialProviderContext = {
    connectionId: row.id,
    brandId: row.brand_id,
    provider: row.provider,
    externalId: row.external_id,
    externalName: row.external_name ?? null,
    accountId: row.account_id ?? null,
    accountUsername: row.account_username ?? null,
    accessToken,
  };

  return {
    ctx,
    network,
    provider,
    providerKey: row.provider,
    externalName: row.external_name ?? null,
    cacheScope: `${hashKey(userTokenForCache)}:${row.id}`,
  };
}

// ---------------------------------------------------------------------------
// Service surface — mesmo contrato do SocialProvider, com cache transparente.
// Route handlers e server functions devem chamar essas funções, nunca o
// provider diretamente.
// ---------------------------------------------------------------------------

function unwrap<T>(op: string, network: SocialNetwork, res: ProviderResult<T>): T {
  if (res.ok) return res.data;
  throw new SocialServiceError("provider_error", res.error, 502, { op, network, code: res.code });
}

export async function getDashboard(
  conn: ResolvedConnection,
  opts: Omit<GetDashboardOptions, "network"> & { period: string },
): Promise<SocialDashboard> {
  const res = await withSocialCache(
    socialCacheKey("dash", conn.cacheScope, {
      n: conn.network,
      p: opts.period,
      s: opts.range?.since,
      u: opts.range?.until,
    }),
    () =>
      conn.provider.getDashboard(conn.ctx, {
        network: conn.network,
        range: opts.range,
      }),
  );
  return unwrap("dashboard", conn.network, res);
}

export async function getPosts(
  conn: ResolvedConnection,
  opts: Omit<GetPostsOptions, "network"> = {},
): Promise<SocialPost[]> {
  const limit = opts.limit ?? 25;
  const res = await withSocialCache(
    socialCacheKey("posts", conn.cacheScope, { n: conn.network, l: limit }),
    () => conn.provider.getPosts(conn.ctx, { network: conn.network, limit }),
  );
  return unwrap("posts", conn.network, res);
}

export async function getPost(
  conn: ResolvedConnection,
  opts: Omit<GetPostOptions, "network">,
): Promise<SocialPost> {
  const res = await withSocialCache(
    socialCacheKey("post", conn.cacheScope, {
      n: conn.network,
      id: opts.postId,
    }),
    () =>
      conn.provider.getPost(conn.ctx, {
        network: conn.network,
        postId: opts.postId,
      }),
  );
  return unwrap("post", conn.network, res);
}

export async function getTopPosts(
  conn: ResolvedConnection,
  opts: Omit<GetTopPostsOptions, "network"> & {
    range?: { since?: string; until?: string };
  } = {},
): Promise<SocialPost[]> {
  const limit = opts.limit ?? 10;
  const res = await withSocialCache(
    socialCacheKey("top", conn.cacheScope, {
      n: conn.network,
      l: limit,
      s: opts.range?.since,
      u: opts.range?.until,
    }),
    () =>
      conn.provider.getTopPosts(conn.ctx, {
        network: conn.network,
        limit,
      }),
  );
  return unwrap("top-posts", conn.network, res);
}

export async function getAudience(
  conn: ResolvedConnection,
  opts: Omit<GetAudienceOptions, "network">,
): Promise<SocialAudience> {
  const res = await withSocialCache(
    socialCacheKey("aud", conn.cacheScope, {
      n: conn.network,
      s: opts.range.since,
      u: opts.range.until,
    }),
    () => conn.provider.getAudience(conn.ctx, { network: conn.network, ...opts }),
  );
  return unwrap("audience", conn.network, res);
}

export async function getProfile(
  conn: ResolvedConnection,
  opts: Omit<GetProfileOptions, "network"> = {},
): Promise<SocialProfile> {
  const res = await withSocialCache(
    socialCacheKey("profile", conn.cacheScope, { n: conn.network }),
    () => conn.provider.getProfile(conn.ctx, { network: conn.network, ...opts }),
  );
  return unwrap("profile", conn.network, res);
}

/** Converte `SocialServiceError` em `Response` JSON para route handlers. */
export function socialErrorResponse(err: unknown): Response {
  if (err instanceof SocialServiceError) {
    return Response.json(
      { error: err.code, message: err.message, ...(err.extras ?? {}) },
      { status: err.status },
    );
  }
  const message = err instanceof Error ? err.message : "unknown_error";
  return Response.json({ error: "internal", message }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Lifecycle & publishing — delegam ao provider concreto via registry.
// ---------------------------------------------------------------------------

function unwrapWrite<T>(op: string, network: SocialNetwork, res: ProviderResult<T>): T {
  if (!res.ok) {
    throw new SocialServiceError("provider_error", `[${network}] ${op}: ${res.error}`, 500);
  }
  return res.data;
}

export async function connect(opts: ConnectOptions): Promise<SocialConnectStart> {
  const provider = getSocialProviderForNetwork(opts.network);
  if (!provider) {
    throw new SocialServiceError(
      "provider_not_implemented",
      `Provider ${opts.network} não implementado`,
      501,
    );
  }
  if (!provider.connect) {
    throw new SocialServiceError(
      "provider_not_implemented",
      `Provider ${opts.network} não suporta connect()`,
      400,
    );
  }
  return unwrapWrite("connect", opts.network, await provider.connect(opts));
}

export async function disconnect(
  conn: ResolvedConnection,
  opts: Omit<DisconnectOptions, "network"> = {},
): Promise<{ revoked: boolean }> {
  if (!conn.provider.disconnect) {
    throw new SocialServiceError(
      "provider_not_implemented",
      `Provider ${conn.network} não suporta disconnect()`,
      400,
    );
  }
  return unwrapWrite(
    "disconnect",
    conn.network,
    await conn.provider.disconnect(conn.ctx, { network: conn.network, ...opts }),
  );
}

export async function refreshToken(
  conn: ResolvedConnection,
  opts: Omit<RefreshTokenOptions, "network"> = {},
): Promise<SocialTokenInfo & { accessToken: string }> {
  if (!conn.provider.refreshToken) {
    throw new SocialServiceError(
      "provider_not_implemented",
      `Provider ${conn.network} não suporta refreshToken()`,
      400,
    );
  }
  return unwrapWrite(
    "refreshToken",
    conn.network,
    await conn.provider.refreshToken(conn.ctx, { network: conn.network, ...opts }),
  );
}

export async function publish(
  conn: ResolvedConnection,
  opts: Omit<PublishOptions, "network">,
): Promise<SocialPublishResult> {
  if (!conn.provider.publish) {
    throw new SocialServiceError(
      "provider_not_implemented",
      `Provider ${conn.network} não suporta publish()`,
      400,
    );
  }
  return unwrapWrite(
    "publish",
    conn.network,
    await conn.provider.publish(conn.ctx, { network: conn.network, ...opts }),
  );
}

export async function schedule(
  conn: ResolvedConnection,
  opts: Omit<ScheduleOptions, "network">,
): Promise<SocialScheduleResult> {
  if (!conn.provider.schedule) {
    throw new SocialServiceError(
      "provider_not_implemented",
      `Provider ${conn.network} não suporta schedule()`,
      400,
    );
  }
  return unwrapWrite(
    "schedule",
    conn.network,
    await conn.provider.schedule(conn.ctx, { network: conn.network, ...opts }),
  );
}

/**
 * Namespace de conveniência — permite escrever
 * `SocialAnalyticsService.getDashboard(...)` no chamador, deixando explícito
 * qual camada está sendo invocada.
 */
export const SocialAnalyticsService = {
  resolveConnection,
  getDashboard,
  getPosts,
  getPost,
  getTopPosts,
  getAudience,
  getProfile,
  connect,
  disconnect,
  refreshToken,
  publish,
  schedule,
  errorResponse: socialErrorResponse,
  requireBearer,
  supabaseForUser,
};
