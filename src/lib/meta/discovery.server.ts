import {
  readPagesPayload,
  accountDiscoveryStatus,
  accountStatusReason,
  type CachedPagesPayload,
  type PublishAuthorizationInfo,
  type DiscoveredAccountStatus,
} from "./portfolio-shared";
import {
  decideDiscoveryMode,
  mergeIncrementalPayload,
  type DiscoveryMode,
  type DiscoveryModeReason,
} from "./refresh-policy";


/**
 * Descoberta Meta compartilhada (server-only).
 *
 * Uma única implementação de "o que a Meta devolve AGORA para este token":
 * usada tanto pela aba "Contas disponíveis" quanto pela reconexão. A varredura
 * é sempre a fonte de verdade — contas que a Meta não devolve mais deixam de
 * ser tratadas como autorizadas.
 */

export type DiscoveredAccount = {
  channel: "facebook" | "instagram";
  /** SEMPRE o ID externo da Meta (Page ID ou IG Business ID). */
  externalId: string;
  label: string;
  handle: string | null;
  pictureUrl: string | null;
  pageId: string | null;
  instagramBusinessId: string | null;
  /** Página irmã (para vincular Página + Instagram juntos). */
  pairPageId: string | null;
  status: DiscoveredAccountStatus;
  /** Explicação acionável quando o status não é "ready". */
  statusReason: string | null;
  /** Business Portfolio de origem do ativo. */
  businessId: string | null;
  businessName: string | null;
};


type SupabaseLike = {
  from: (table: string) => any;
};

export type DiscoveryOutcome = {
  payload: CachedPagesPayload;
  loadedAt: string;
  error: string | null;
  /** Modo efetivamente executado (`incremental` = varredura rasa). */
  mode?: DiscoveryMode;
  /** Motivo da escolha do modo (telemetria/UI). */
  modeReason?: DiscoveryModeReason;
};

/**
 * Executa varredura real na Graph API, persiste o resultado na sessão e
 * revoga conexões desta marca/usuário Meta que não apareceram mais.
 *
 * REFRESH INCREMENTAL: quando os ativos salvos ainda são válidos (token já
 * varrido, cache presente e recente) a varredura roda com `deep: false` — só
 * `/me/accounts` — e o resultado é MESCLADO ao payload conhecido. Nesse modo a
 * varredura NÃO é autoridade sobre o conjunto de ativos, portanto não revoga
 * conexões. A varredura completa continua acontecendo em token novo, ausência
 * de cache, cache expirado ou pedido explícito de descoberta completa.
 */
export async function runMetaDiscovery(
  supabase: SupabaseLike,
  session: {
    id: string;
    brand_id: string;
    meta_user_id: string;
    user_token_ciphertext: string | null;
    pages: unknown;
    portfolio_loaded_at?: string | null;
  },
  opts?: { fullDiscovery?: boolean },
): Promise<DiscoveryOutcome> {
  const known = readPagesPayload(session.pages);
  if (!session.user_token_ciphertext) {
    return {
      payload: known,
      loadedAt: new Date().toISOString(),
      error: "Sessão da Meta sem token. Faça a autorização novamente.",
    };
  }

  const { decryptCredential } = await import("@/lib/credentials-crypto.server");
  const { MetaGraphError } = await import("./provider.server");

  let userToken: string;
  try {
    userToken = await decryptCredential(session.user_token_ciphertext);
  } catch {
    return {
      payload: known,
      loadedAt: new Date().toISOString(),
      error: "Sua autorização da Meta não é mais válida. Autorize novamente.",
    };
  }

  let publishAuthorization: PublishAuthorizationInfo | null = known.publishAuthorization ?? null;
  try {
    const { getPublishAuthorization } = await import("./granular-scopes.server");
    publishAuthorization = (await getPublishAuthorization(userToken)) as PublishAuthorizationInfo;
  } catch {
    /* granularidade indisponível não invalida a descoberta */
  }

  const { runSharedScan, wasTokenDeepScanned } = await import("./scan-cache.server");
  const decision = decideDiscoveryMode({
    requestedFull: opts?.fullDiscovery === true,
    knownAssetCount: known.pages.length + known.standaloneInstagram.length,
    loadedAt: session.portfolio_loaded_at ?? null,
    tokenAlreadyScanned: wasTokenDeepScanned(userToken),
  });

  try {
    // Varredura COMPARTILHADA: se o modal de portfólios já varreu este token
    // há instantes, reutilizamos o resultado em vez de repetir tudo.
    const { scan } = await runSharedScan(userToken, {
      label: `Meta discovery (accounts, ${decision.mode})`,
      deep: decision.deep,
    });
    const tokenById = new Map(known.pages.map((p) => [p.pageId, p.pageAccessToken]));
    const scanned: CachedPagesPayload = {
      pages: scan.pages.map((p) => ({
        pageId: p.pageId,
        pageName: p.pageName,
        category: p.category ?? null,
        pagePictureUrl: p.pagePictureUrl ?? null,
        instagramBusinessId: p.instagramBusinessId ?? null,
        instagramUsername: p.instagramUsername ?? null,
        instagramPictureUrl: p.instagramPictureUrl ?? null,
        businessId: p.businessId ?? null,
        businessName: p.businessName ?? null,
        pageAccessToken: p.pageAccessToken || tokenById.get(p.pageId) || undefined,
      })),
      standaloneInstagram: scan.standaloneInstagram.map((i) => ({
        instagramId: i.instagramId,
        username: i.username ?? null,
        name: i.name ?? null,
        pictureUrl: i.pictureUrl ?? null,
        businessName: i.businessName ?? null,
      })),
      warnings: scan.warnings,
      businessCount: scan.businessCount ?? 0,
      businesses: scan.businesses ?? [],
      publishAuthorization,
    };

    const payload =
      decision.mode === "incremental"
        ? mergeIncrementalPayload(known, scanned, publishAuthorization)
        : scanned;

    const loadedAt = new Date().toISOString();
    await supabase
      .from("meta_oauth_sessions")
      .update({
        pages: payload as unknown as Record<string, unknown>,
        businesses: (payload.businesses ?? []) as unknown as Record<string, unknown>,
        portfolio_loaded_at: loadedAt,
        portfolio_load_status:
          payload.pages.length + payload.standaloneInstagram.length > 0 ? "loaded" : "empty",
        portfolio_error: null,
        portfolio_rate_limited_until: null,
      })
      .eq("id", session.id);

    // Só a varredura COMPLETA é autoridade sobre o conjunto de ativos: um
    // refresh incremental (só `/me/accounts`) não vê ativos de portfólio e não
    // pode revogar nada.
    if (decision.mode === "full") {
      await revokeUndiscoveredConnections(
        supabase,
        session.brand_id,
        session.meta_user_id,
        discoveredIds(payload),
      );
    }

    return {
      payload,
      loadedAt,
      error: null,
      mode: decision.mode,
      modeReason: decision.reason,
    };

  } catch (err) {
    const detail =
      err instanceof MetaGraphError
        ? `Meta: ${err.message}`
        : err instanceof Error
          ? err.message
          : "Falha ao consultar a Graph API da Meta.";
    await supabase
      .from("meta_oauth_sessions")
      .update({ portfolio_load_status: "error", portfolio_error: detail })
      .eq("id", session.id);
    return { payload: known, loadedAt: new Date().toISOString(), error: detail };
  }
}

export function discoveredIds(payload: CachedPagesPayload): Set<string> {
  return new Set<string>([
    ...payload.pages.map((p) => p.pageId),
    ...(payload.pages.map((p) => p.instagramBusinessId).filter(Boolean) as string[]),
    ...payload.standaloneInstagram.map((i) => i.instagramId),
  ]);
}

/**
 * Conexões salvas deste usuário Meta que não vieram na descoberta atual não
 * podem continuar "active": passam a revoked (histórico preservado).
 */
async function revokeUndiscoveredConnections(
  supabase: SupabaseLike,
  brandId: string,
  metaUserId: string,
  ids: Set<string>,
): Promise<void> {
  if (ids.size === 0) return;
  const { data: existing } = await supabase
    .from("social_connections")
    .select("id, external_id, status")
    .eq("brand_id", brandId)
    .eq("provider", "meta")
    .eq("owner_external_id", metaUserId)
    .in("channel", ["facebook", "instagram"]);
  const stale = (
    (existing ?? []) as Array<{ id: string; external_id: string; status: string }>
  ).filter((c) => c.status === "active" && !ids.has(c.external_id));
  for (const c of stale) {
    await supabase
      .from("social_connections")
      .update({
        status: "revoked",
        last_error:
          "Conta não apareceu na última autorização da Meta. Reconecte e selecione esta conta durante o consentimento.",
      })
      .eq("id", c.id);
  }
}

/** Converte o portfólio bruto em contas apresentáveis (identidade = ID Meta). */
export function toDiscoveredAccounts(payload: CachedPagesPayload): DiscoveredAccount[] {
  const auth = payload.publishAuthorization ?? null;
  const businessNameById = new Map(
    (payload.businesses ?? []).map((b) => [b.id, b.name] as const),
  );
  const out: DiscoveredAccount[] = [];
  for (const p of payload.pages) {
    const businessId = p.businessId ?? null;
    const businessName =
      p.businessName ?? (businessId ? businessNameById.get(businessId) ?? null : null);
    out.push({
      channel: "facebook",
      externalId: p.pageId,
      label: p.pageName,
      handle: null,
      pictureUrl: p.pagePictureUrl ?? null,
      pageId: p.pageId,
      instagramBusinessId: p.instagramBusinessId ?? null,
      pairPageId: p.pageId,
      status: accountDiscoveryStatus(auth, "facebook", p.pageId),
      statusReason: accountStatusReason(auth, "facebook", p.pageId),
      businessId,
      businessName,
    });
    if (p.instagramBusinessId) {
      out.push({
        channel: "instagram",
        externalId: p.instagramBusinessId,
        label: p.instagramUsername ?? p.pageName,
        handle: p.instagramUsername ?? null,
        pictureUrl: p.instagramPictureUrl ?? p.pagePictureUrl ?? null,
        pageId: p.pageId,
        instagramBusinessId: p.instagramBusinessId,
        pairPageId: p.pageId,
        status: accountDiscoveryStatus(auth, "instagram", p.instagramBusinessId),
        statusReason: accountStatusReason(auth, "instagram", p.instagramBusinessId),
        businessId,
        businessName,
      });
    }
  }
  for (const i of payload.standaloneInstagram) {
    out.push({
      channel: "instagram",
      externalId: i.instagramId,
      label: i.username ?? i.name ?? i.instagramId,
      handle: i.username ?? null,
      pictureUrl: i.pictureUrl ?? null,
      pageId: null,
      instagramBusinessId: i.instagramId,
      pairPageId: null,
      status: accountDiscoveryStatus(auth, "instagram", i.instagramId),
      statusReason: accountStatusReason(auth, "instagram", i.instagramId),
      businessId: null,
      businessName: i.businessName ?? null,
    });
  }
  return out;

}
