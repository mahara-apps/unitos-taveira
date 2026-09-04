import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  GetInput,
  LinkInput,
  UnlinkInput,
  RATE_LIMIT_PREFIX,
  SESSION_INVALID_PREFIX,
  isMetaRateLimit,
  nowIso,
  readPagesPayload,
  beginDiscovery,
} from "./portfolio-shared";

import type { PublishAuthorizationInfo } from "./portfolio-shared";

export type {
  PortfolioPage,
  PortfolioStandaloneInstagram,
  PortfolioThreadsAccount,
  PortfolioAdAccount,
  PortfolioResponse,
} from "./portfolio-shared";
export { SESSION_INVALID_PREFIX } from "./portfolio-shared";

import type {
  PortfolioPage,
  PortfolioStandaloneInstagram,
  PortfolioThreadsAccount,
  PortfolioAdAccount,
  PortfolioResponse,
} from "./portfolio-shared";

export const getMetaPortfolio = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => GetInput.parse(input))
  .handler(async ({ data, context }): Promise<PortfolioResponse> => {
    const { assertIntegrationAuthority } = await import("@/lib/access-guard");
    await assertIntegrationAuthority(context.supabase, context.userId, data.brandId);
    const { data: session, error } = await context.supabase
      .from("meta_oauth_sessions")
      .select(
        "id, brand_id, meta_user_id, meta_user_name, meta_user_email, scopes, requested_scopes, pages, threads_accounts, ad_accounts, user_token_ciphertext, expires_at, portfolio_loaded_at, portfolio_load_status, portfolio_error, portfolio_rate_limited_until",
      )
      .eq("id", data.sessionId)
      .eq("brand_id", data.brandId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!session)
      throw new Error(
        `${SESSION_INVALID_PREFIX} Sessão da Meta não encontrada ou revogada. Autorize novamente na Meta.`,
      );
    if (new Date(session.expires_at).getTime() < Date.now()) {
      throw new Error(`${SESSION_INVALID_PREFIX} Sessão da Meta expirou. Faça login novamente.`);
    }

    const sessionState = session as typeof session & {
      portfolio_loaded_at?: string | null;
      portfolio_load_status?: "not_loaded" | "loaded" | "empty" | "error" | "rate_limited" | null;
      portfolio_error?: string | null;
      portfolio_rate_limited_until?: string | null;
    };
    let portfolioStatus = sessionState.portfolio_load_status ?? "not_loaded";
    let portfolioLoadedAt = sessionState.portfolio_loaded_at ?? null;
    let portfolioError = sessionState.portfolio_error ?? null;
    let portfolioRateLimitedUntil = sessionState.portfolio_rate_limited_until ?? null;

    // Cache-first by default. Opening the dialog must never trigger a Meta
    // Graph scan; the scan only happens when the user explicitly clicks
    // "Sincronizar" and sends refresh=true.
    // The `pages` column holds either a bare array (legacy sessions) or the
    // richer payload `{ pages, standaloneInstagram, warnings, businessCount }`.
    const pagesPayload = readPagesPayload(session.pages);
    let cachedPages = pagesPayload.pages as Array<PortfolioPage & { pageAccessToken?: string }>;
    let cachedStandaloneIg = pagesPayload.standaloneInstagram;
    let scanWarnings = pagesPayload.warnings;
    let businessCount = pagesPayload.businessCount;
    let cachedBusinesses = pagesPayload.businesses ?? [];

    let publishAuthorization = pagesPayload.publishAuthorization ?? null;
    let cachedThreads =
      (session.threads_accounts as unknown as Array<
        PortfolioThreadsAccount & { accessToken?: string }
      >) ?? [];
    let cachedAds = (session.ad_accounts as unknown as PortfolioAdAccount[]) ?? [];

    // FAIL-CLOSED: uma sessão recém-autorizada NUNCA é preenchida com contas
    // de sessões anteriores. Só o que a Meta devolver para o token atual pode
    // aparecer na tela de descoberta (reconexão => nova descoberta real).
    const seededFromCache = false;

    const ch = data.channel ?? null;
    const needPages =
      (ch === null || ch === "facebook" || ch === "instagram" || ch === "threads") &&
      !!data.refresh;
    // Threads is a disabled product: never queried automatically. Only an
    // explicit refresh of the Threads channel itself may probe it.
    const needThreads = ch === "threads" && !!data.refresh;
    const needAds = (ch === null || ch === "ads") && !!data.refresh;

    const rateLimitedUntil = sessionState.portfolio_rate_limited_until;
    const inCooldown = !!rateLimitedUntil && new Date(rateLimitedUntil).getTime() > Date.now();

    if ((needPages || needThreads || needAds) && inCooldown) {
      // Cooldown must never be converted into "no accounts": keep the known
      // assets and report the rate-limited state instead of scanning.
      const knownCount = cachedPages.length + cachedStandaloneIg.length;
      console.log(
        `Meta discovery: requests=0 cache=${knownCount > 0 ? "hit" : "miss"} status=rate_limited cached_accounts=${knownCount}`,
      );
      if (knownCount === 0) {
        throw new Error(
          `${RATE_LIMIT_PREFIX} Limite de requisições da Meta atingido. Tente novamente após ${new Date(
            rateLimitedUntil!,
          ).toLocaleString("pt-BR")}.`,
        );
      }
      portfolioStatus = "rate_limited";
      portfolioRateLimitedUntil = rateLimitedUntil ?? null;
    }

    let discoveryLock: { done: () => void } | null = null;
    if ((needPages || needThreads || needAds) && !inCooldown) {
      const lock = beginDiscovery(`${session.id}:${ch ?? "all"}`);
      if (lock.wait) {
        // Another in-flight discovery for the same session/channel: wait for it
        // and serve the cache it wrote instead of firing a duplicate scan.
        await lock.wait;
        const fresh = await context.supabase
          .from("meta_oauth_sessions")
          .select("pages, portfolio_load_status, portfolio_loaded_at, portfolio_error")
          .eq("id", session.id)
          .maybeSingle();
        const payload = readPagesPayload(fresh.data?.pages);
        if (payload.pages.length > 0 || payload.standaloneInstagram.length > 0) {
          cachedPages = payload.pages;
          cachedStandaloneIg = payload.standaloneInstagram;
          scanWarnings = payload.warnings;
          businessCount = payload.businessCount;
          cachedBusinesses = payload.businesses ?? cachedBusinesses;
          publishAuthorization = payload.publishAuthorization ?? publishAuthorization;
        }
        portfolioStatus =
          (fresh.data?.portfolio_load_status as typeof portfolioStatus) ?? portfolioStatus;
        portfolioLoadedAt = fresh.data?.portfolio_loaded_at ?? portfolioLoadedAt;
        portfolioError = fresh.data?.portfolio_error ?? null;
        console.log("Meta discovery: requests=0 cache=hit status=deduped");
      } else {
        discoveryLock = lock;
      }
    }

    if (discoveryLock) {
      try {
        const { decryptCredential } = await import("@/lib/credentials-crypto.server");
        const { MetaProvider, MetaGraphError } = await import("./provider.server");
        const provider = new MetaProvider();
        const invalidateSession = async () => {
          const nowIso = new Date().toISOString();
          await context.supabase
            .from("meta_oauth_sessions")
            .update({ expires_at: nowIso, user_token_expires_at: nowIso })
            .eq("id", session.id);
        };
        if (!session.user_token_ciphertext) {
          await invalidateSession();
          throw new Error(
            `${SESSION_INVALID_PREFIX} Token do usuário Meta ausente. Faça login novamente.`,
          );
        }
        let userToken: string;
        try {
          userToken = await decryptCredential(session.user_token_ciphertext);
        } catch (err) {
          console.error("[getMetaPortfolio] decrypt failed", err);
          await invalidateSession();
          throw new Error(
            `${SESSION_INVALID_PREFIX} Sua sessão da Meta não é mais válida. Faça login novamente.`,
          );
        }

        console.log("[getMetaPortfolio] scanning", {
          sessionId: session.id,
          channel: ch,
          needPages,
          needThreads,
          needAds,
        });

        // Autorização granular do token (target_ids). Uma requisição, sem
        // efeito colateral: é o que separa "usuário autorizado" de
        // "conta autorizada".
        try {
          const { getPublishAuthorization } = await import("./granular-scopes.server");
          publishAuthorization = (await getPublishAuthorization(
            userToken,
          )) as PublishAuthorizationInfo;
        } catch {
          publishAuthorization = publishAuthorization ?? null;
        }

        try {
          if (needPages) {
            const knownPages = cachedPages;
            const knownIg = cachedStandaloneIg;
            // Varredura COMPARTILHADA com a trilha de "Contas disponíveis":
            // uma descoberta por operação, nunca duas. Se este token já passou
            // por uma varredura PROFUNDA nesta instância, a rasa reaproveita o
            // resultado em vez de repetir todas as arestas.
            const { runSharedScan, wasTokenDeepScanned } = await import("./scan-cache.server");
            const { scan, source } = await runSharedScan(userToken, {
              label: "Meta discovery (portfolio)",
              deep: !wasTokenDeepScanned(userToken),
            });
            console.log(
              `Meta discovery: requests=${source === "fresh" ? scan.requestCount : 0} cache=${
                source === "fresh" ? (seededFromCache ? "seeded" : "miss") : source
              } deep=${scan.deep} stop=${scan.stopReason} pages=${scan.pages.length} withIg=${
                scan.pages.filter((p) => !!p.instagramBusinessId).length
              } standaloneIg=${scan.standaloneInstagram.length} warnings=${scan.warnings.length}`,
            );
            const fresh = scan.pages.map((p) => ({
              pageId: p.pageId,
              pageName: p.pageName,
              category: p.category ?? null,
              pagePictureUrl: p.pagePictureUrl ?? null,
              instagramBusinessId: p.instagramBusinessId ?? null,
              instagramUsername: p.instagramUsername ?? null,
              instagramPictureUrl: p.instagramPictureUrl ?? null,
              businessId: p.businessId ?? null,
              businessName: p.businessName ?? null,
              pageAccessToken: p.pageAccessToken,
            }));

            // A varredura é a fonte de verdade: contas que a Meta não devolve
            // mais para este token deixam de existir na descoberta (nada de
            // manter contas antigas como válidas). Tokens já capturados são
            // reaproveitados apenas para Páginas que continuam autorizadas.
            const tokenById = new Map(knownPages.map((p) => [p.pageId, p.pageAccessToken]));
            cachedPages = fresh.map((p) => ({
              ...p,
              pageAccessToken: p.pageAccessToken || tokenById.get(p.pageId) || undefined,
            })) as typeof cachedPages;
            cachedStandaloneIg = scan.standaloneInstagram.map((i) => ({
              instagramId: i.instagramId,
              username: i.username,
              name: i.name,
              pictureUrl: i.pictureUrl,
              businessName: i.businessName,
            }));

            scanWarnings = scan.warnings;
            businessCount = scan.businessCount || businessCount;
            cachedBusinesses = scan.businesses?.length ? scan.businesses : cachedBusinesses;

            // RECONEXÃO FAIL-CLOSED: conexões salvas deste mesmo usuário Meta que
            // não aparecem mais na nova descoberta perdem o status "active" — não
            // podem continuar sendo tratadas como prontas sem nova comprovação.
            const discoveredIds = new Set<string>([
              ...cachedPages.map((p) => p.pageId),
              ...(cachedPages.map((p) => p.instagramBusinessId).filter(Boolean) as string[]),
              ...cachedStandaloneIg.map((i) => i.instagramId),
            ]);
            if (discoveredIds.size > 0) {
              const { data: existing } = await context.supabase
                .from("social_connections")
                .select("id, external_id, channel, status")
                .eq("brand_id", data.brandId)
                .eq("provider", "meta")
                .eq("owner_external_id", session.meta_user_id)
                .in("channel", ["facebook", "instagram"]);
              const stale = (existing ?? []).filter(
                (c) => c.status === "active" && !discoveredIds.has(c.external_id),
              );
              for (const c of stale) {
                await context.supabase
                  .from("social_connections")
                  .update({
                    status: "revoked",
                    last_error:
                      "Conta não apareceu na última autorização da Meta. Reconecte e selecione esta conta durante o consentimento.",
                  })
                  .eq("id", c.id);
              }
              if (stale.length > 0) {
                console.log(
                  `[getMetaPortfolio] revoked ${stale.length} stale meta connection(s) after re-discovery`,
                );
              }
            }
          }

          if (needThreads) {
            const pagesForThreads = cachedPages.map((p) => ({
              pageId: p.pageId,
              pageName: p.pageName,
              pageAccessToken: p.pageAccessToken ?? "",
            }));
            const scanned = await provider.listThreadsAccounts(userToken, pagesForThreads as never);
            console.log("[getMetaPortfolio] threads fetched", scanned.length);
            cachedThreads = scanned.map((t) => ({
              threadsUserId: t.threadsUserId,
              username: t.username ?? null,
              name: t.name ?? null,
              pictureUrl: t.pictureUrl ?? null,
              linkedViaPageId: t.linkedViaPageId,
              accessToken: t.accessToken,
            }));
          }
          if (needAds) {
            cachedAds = await provider.listAdAccounts(userToken);
            console.log("[getMetaPortfolio] ad accounts fetched", cachedAds.length);
          }

          const loadedCount =
            ch === "instagram"
              ? cachedPages.filter((p) => !!p.instagramBusinessId).length +
                cachedStandaloneIg.length
              : ch === "facebook"
                ? cachedPages.length
                : ch === "threads"
                  ? cachedThreads.length
                  : ch === "ads"
                    ? cachedAds.length
                    : cachedPages.length + cachedThreads.length + cachedAds.length;

          const loadedAt = nowIso();
          const nextStatus = loadedCount > 0 ? "loaded" : "empty";
          const { error: upErr } = await context.supabase
            .from("meta_oauth_sessions")
            .update({
              pages: {
                pages: cachedPages,
                standaloneInstagram: cachedStandaloneIg,
                warnings: scanWarnings,
                businessCount,
                businesses: cachedBusinesses,
                publishAuthorization,
              } as unknown as import("@/integrations/supabase/types").Json,
              threads_accounts:
                cachedThreads as unknown as import("@/integrations/supabase/types").Json,
              ad_accounts: cachedAds as unknown as import("@/integrations/supabase/types").Json,
              businesses:
                cachedBusinesses as unknown as import("@/integrations/supabase/types").Json,
              portfolio_loaded_at: loadedAt,
              portfolio_load_status: nextStatus,
              portfolio_error: null,
              portfolio_rate_limited_until: null,
            })
            .eq("id", session.id);
          if (upErr) console.error("[getMetaPortfolio] cache write failed", upErr);
          portfolioStatus = nextStatus;
          portfolioLoadedAt = loadedAt;
          portfolioError = null;
          portfolioRateLimitedUntil = null;
        } catch (err) {
          console.error("[getMetaPortfolio] Graph API failure", err);
          const updateErrorStatus = async (
            status: "error" | "rate_limited",
            message: string,
            until: string | null = null,
          ) => {
            const { error: statusErr } = await context.supabase
              .from("meta_oauth_sessions")
              .update({
                portfolio_load_status: status,
                portfolio_error: message,
                portfolio_rate_limited_until: until,
              })
              .eq("id", session.id);
            if (statusErr) console.error("[getMetaPortfolio] status write failed", statusErr);
          };
          if (isMetaRateLimit(err)) {
            const until = new Date(Date.now() + 15 * 60_000).toISOString();
            await updateErrorStatus(
              "rate_limited",
              "Limite de requisições da Meta atingido.",
              until,
            );
            throw new Error(
              `${RATE_LIMIT_PREFIX} Limite de requisições da Meta atingido. Aguarde alguns minutos antes de tentar novamente.`,
            );
          }
          // A transient Meta failure must not blank a portfolio that was already
          // loaded. Keep serving the last successful snapshot and surface the
          // refresh problem as a non-blocking warning (stale-while-revalidate).
          const cachedAssetCount =
            cachedPages.length +
            cachedStandaloneIg.length +
            cachedThreads.length +
            cachedAds.length;
          if (cachedAssetCount > 0) {
            const detail = err instanceof Error ? err.message : "Falha temporária da Meta.";
            const warning = `Não foi possível atualizar agora: ${detail} As contas da última sincronização continuam disponíveis.`;
            // Keep only the latest refresh diagnostic plus a small snapshot of
            // prior scan warnings. Provider messages can contain dynamic trace
            // IDs, so an unbounded Set still grew after every failed refresh.
            scanWarnings = Array.from(new Set([warning, ...scanWarnings])).slice(0, 8);
            portfolioStatus = "loaded";
            portfolioError = detail;
            await context.supabase
              .from("meta_oauth_sessions")
              .update({
                portfolio_load_status: "loaded",
                portfolio_error: detail,
                pages: {
                  pages: cachedPages,
                  standaloneInstagram: cachedStandaloneIg,
                  warnings: scanWarnings,
                  businessCount,
                  businesses: cachedBusinesses,
                  publishAuthorization,
                } as unknown as import("@/integrations/supabase/types").Json,
              })
              .eq("id", session.id);
          } else if (err instanceof MetaGraphError) {
            await updateErrorStatus("error", err.message);
            throw new Error(`Meta: ${err.message}`);
          } else if (err instanceof Error) {
            await updateErrorStatus("error", err.message);
            throw err;
          } else {
            await updateErrorStatus("error", "Falha ao consultar a Graph API da Meta.");
            throw new Error("Falha ao consultar a Graph API da Meta.");
          }
        }
      } finally {
        discoveryLock.done();
      }
    }

    const pages = cachedPages.map((p) => ({
      pageId: p.pageId,
      pageName: p.pageName,
      category: p.category ?? null,
      pagePictureUrl: p.pagePictureUrl ?? null,
      instagramBusinessId: p.instagramBusinessId ?? null,
      instagramUsername: p.instagramUsername ?? null,
      instagramPictureUrl: p.instagramPictureUrl ?? null,
    }));

    const threadsAccounts = cachedThreads.map((t) => ({
      threadsUserId: t.threadsUserId,
      username: t.username ?? null,
      name: t.name ?? null,
      pictureUrl: t.pictureUrl ?? null,
      linkedViaPageId: t.linkedViaPageId,
    }));

    const adAccounts = cachedAds.map((a) => ({
      adAccountId: a.adAccountId,
      name: a.name ?? null,
      currency: a.currency ?? null,
      timezone: a.timezone ?? null,
      accountStatus: a.accountStatus ?? null,
      businessName: a.businessName ?? null,
    }));

    // Which of these are already bound to this brand?
    const externalIds = [
      ...pages.map((p) => p.pageId),
      ...(pages.map((p) => p.instagramBusinessId).filter(Boolean) as string[]),
      ...cachedStandaloneIg.map((i) => i.instagramId),
      ...threadsAccounts.map((t) => t.threadsUserId),
      ...adAccounts.map((a) => a.adAccountId),
    ];

    const connected: PortfolioResponse["connected"] = {
      facebook: {},
      instagram: {},
      threads: {},
      ads: {},
    };
    if (externalIds.length > 0) {
      const { data: rows } = await context.supabase
        .from("social_connections")
        .select("id, channel, external_id")
        .eq("brand_id", data.brandId)
        .eq("provider", "meta")
        // Conta revogada NÃO é "conectada": ela pode ser reconectada.
        .neq("status", "revoked")
        .in("external_id", externalIds);

      for (const r of rows ?? []) {
        if (r.channel === "facebook") connected.facebook[r.external_id] = r.id;
        if (r.channel === "instagram") connected.instagram[r.external_id] = r.id;
        if (r.channel === "threads") connected.threads[r.external_id] = r.id;
        if (r.channel === "ads") connected.ads[r.external_id] = r.id;
      }
    }

    const requestedScopes = (session.requested_scopes as string[] | null) ?? [];
    const grantedScopes = session.scopes ?? [];
    const missingScopes = requestedScopes.filter((s) => !grantedScopes.includes(s));

    return {
      sessionId: session.id,
      metaUser: {
        id: session.meta_user_id,
        name: session.meta_user_name ?? null,
        email: session.meta_user_email ?? null,
      },
      portfolioStatus,
      portfolioLoadedAt,
      portfolioError,
      portfolioRateLimitedUntil,
      scopes: grantedScopes,
      requestedScopes,
      missingScopes,
      pages,
      pagesCount: pages.length,
      pagesWithIgCount: pages.filter((p) => !!p.instagramBusinessId).length,
      pagesWithoutIgCount: pages.filter((p) => !p.instagramBusinessId).length,
      standaloneInstagram: cachedStandaloneIg,
      standaloneInstagramCount: cachedStandaloneIg.length,
      scanWarnings,
      businessCount,
      publishAuthorization,
      threadsAccounts,
      adAccounts,
      connected,
      expiresAt: session.expires_at,
    };
  });

export const linkMetaAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LinkInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertIntegrationAuthority } = await import("@/lib/access-guard");
    await assertIntegrationAuthority(context.supabase, context.userId, data.brandId);
    const { data: session, error } = await context.supabase
      .from("meta_oauth_sessions")
      .select(
        "id, brand_id, meta_user_id, meta_user_name, meta_user_email, scopes, pages, threads_accounts, ad_accounts, user_token_ciphertext, user_token_expires_at, expires_at",
      )
      .eq("id", data.sessionId)
      .eq("brand_id", data.brandId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    if (!session)
      throw new Error("Autorização da Meta não encontrada ou revogada. Autorize novamente.");
    if (new Date(session.expires_at).getTime() < Date.now()) {
      throw new Error("Sessão da Meta expirou. Refaça o login.");
    }

    if (data.clientId) {
      const { data: client, error: clientErr } = await context.supabase
        .from("clients")
        .select("id")
        .eq("id", data.clientId)
        .eq("brand_id", data.brandId)
        .maybeSingle();
      if (clientErr) throw clientErr;
      if (!client) throw new Error("Cliente não pertence a esta marca.");
    }

    const { encryptCredential } = await import("@/lib/credentials-crypto.server");

    const now = new Date().toISOString();

    /** One social_connections row to create/update. */
    type LinkSpec = {
      channel: "facebook" | "instagram" | "threads" | "ads";
      externalId: string;
      externalName: string;
      accountUsername: string | null;
      /** Plain token to encrypt, or null to reuse the encrypted user token. */
      tokenToStore: string | null;
      metadata: Record<string, unknown>;
    };
    const specs: LinkSpec[] = [];

    const pages = readPagesPayload(session.pages).pages as Array<
      PortfolioPage & { pageAccessToken?: string }
    >;
    const standaloneIg = readPagesPayload(session.pages).standaloneInstagram;

    /**
     * Pages discovered through a Business Portfolio edge may come without a
     * page access token, so fetch it on demand at link time.
     */
    const resolvePageToken = async (page: PortfolioPage & { pageAccessToken?: string }) => {
      if (page.pageAccessToken) return page.pageAccessToken;
      if (!session.user_token_ciphertext) {
        throw new Error("Sessão da Meta sem token. Faça login novamente.");
      }
      const { decryptCredential } = await import("@/lib/credentials-crypto.server");
      const { MetaProvider } = await import("./provider.server");
      const userToken = await decryptCredential(session.user_token_ciphertext);
      return new MetaProvider().getPageAccessToken(userToken, page.pageId);
    };

    if (data.channel === "facebook" || data.channel === "instagram") {
      const page =
        pages.find((p) => p.pageId === data.targetId) ??
        pages.find((p) => p.instagramBusinessId === data.targetId);

      if (!page) {
        // Instagram Business account assigned straight to a portfolio.
        const ig = standaloneIg.find((i) => i.instagramId === data.targetId);
        if (!ig || data.channel !== "instagram") {
          throw new Error("Conta não encontrada no portfólio. Sincronize novamente.");
        }
        specs.push({
          channel: "instagram",
          externalId: ig.instagramId,
          externalName: ig.username ?? ig.name ?? ig.instagramId,
          accountUsername: ig.username,
          tokenToStore: null,
          metadata: {
            instagram_business_id: ig.instagramId,
            instagram_username: ig.username,
            instagram_picture_url: ig.pictureUrl,
            business_name: ig.businessName,
            meta_business_id: null,
            meta_business_name: ig.businessName ?? null,
            standalone_instagram: true,
          },
        });
      } else {
        const pageMeta = {
          category: page.category ?? null,
          page_id: page.pageId,
          page_name: page.pageName,
          instagram_business_id: page.instagramBusinessId ?? null,
          instagram_username: page.instagramUsername ?? null,
          page_picture_url: page.pagePictureUrl ?? null,
          instagram_picture_url: page.instagramPictureUrl ?? null,
          meta_business_id: page.businessId ?? null,
          meta_business_name: page.businessName ?? null,
        };
        const pageToken = await resolvePageToken(page);

        const wantFacebook = data.channel === "facebook" || data.linkPair === true;
        const wantInstagram =
          (data.channel === "instagram" || data.linkPair === true) && !!page.instagramBusinessId;

        if (data.channel === "instagram" && !page.instagramBusinessId) {
          throw new Error("Esta Página não possui Instagram Business vinculado.");
        }

        if (wantFacebook) {
          specs.push({
            channel: "facebook",
            externalId: page.pageId,
            externalName: page.pageName,
            accountUsername: null,
            tokenToStore: pageToken,
            metadata: pageMeta,
          });
        }
        if (wantInstagram) {
          specs.push({
            channel: "instagram",
            externalId: page.instagramBusinessId as string,
            externalName: page.instagramUsername ?? page.pageName,
            accountUsername: page.instagramUsername ?? null,
            tokenToStore: pageToken,
            metadata: pageMeta,
          });
        }
      }
    } else if (data.channel === "threads") {
      const threads =
        (session.threads_accounts as unknown as Array<
          PortfolioThreadsAccount & { accessToken: string }
        >) ?? [];
      const t = threads.find((x) => x.threadsUserId === data.targetId);
      if (!t) throw new Error("Conta do Threads não encontrada no portfólio.");
      specs.push({
        channel: "threads",
        externalId: t.threadsUserId,
        externalName: t.name ?? t.username ?? t.threadsUserId,
        accountUsername: t.username,
        tokenToStore: t.accessToken,
        metadata: {
          threads_username: t.username,
          threads_name: t.name,
          threads_picture_url: t.pictureUrl,
          linked_via_page_id: t.linkedViaPageId ?? null,
        },
      });
    } else {
      // ads — queried with the long-lived user token, so no per-account token.
      const ads = (session.ad_accounts as unknown as PortfolioAdAccount[]) ?? [];
      const a = ads.find((x) => x.adAccountId === data.targetId);
      if (!a) throw new Error("Conta de anúncios não encontrada no portfólio.");
      specs.push({
        channel: "ads",
        externalId: a.adAccountId,
        externalName: a.name ?? a.adAccountId,
        accountUsername: null,
        tokenToStore: null,
        metadata: {
          ad_account_id: a.adAccountId,
          ad_account_name: a.name,
          currency: a.currency,
          timezone: a.timezone,
          account_status: a.accountStatus,
          business_name: a.businessName,
        },
      });
    }

    const connectionIds: string[] = [];

    for (const spec of specs) {
      if (spec.tokenToStore === null && !session.user_token_ciphertext) {
        throw new Error("Sessão da Meta sem token. Faça login novamente.");
      }
      const ciphertext =
        spec.tokenToStore === null
          ? session.user_token_ciphertext!
          : await encryptCredential(spec.tokenToStore);

      // Identidade e vínculos operacionais SEMPRE nas colunas de topo
      // (page_id / instagram_business_id), não só em metadata.
      const md = spec.metadata as Record<string, unknown>;
      const pageIdCol = (md["page_id"] as string | null | undefined) ?? null;
      const igIdCol = (md["instagram_business_id"] as string | null | undefined) ?? null;
      // Identidade do Business Portfolio: separa "usuário Meta que autorizou"
      // de "portfólio empresarial dono do ativo".
      const businessIdCol = (md["meta_business_id"] as string | null | undefined) ?? null;
      const businessNameCol = (md["meta_business_name"] as string | null | undefined) ?? null;

      const { data: upserted, error: upErr } = await context.supabase
        .from("social_connections")
        .upsert(
          {
            brand_id: data.brandId,
            channel: spec.channel,
            provider: "meta",
            external_id: spec.externalId,
            external_name: spec.externalName,
            account_id: spec.externalId,
            account_username: spec.accountUsername,
            page_id: pageIdCol,
            instagram_business_id: igIdCol,
            owner_external_id: session.meta_user_id,
            owner_name: session.meta_user_name ?? null,
            meta_business_id: businessIdCol,
            meta_business_name: businessNameCol,
            access_token_ciphertext: ciphertext,
            scopes: session.scopes ?? [],
            status: "active",
            last_error: null,
            last_synced_at: now,
            token_expires_at: session.user_token_expires_at ?? null,
            metadata: {
              ...spec.metadata,
              linked_at: now,
              user_email: session.meta_user_email ?? null,
              user_access_token_ciphertext: session.user_token_ciphertext,
              user_token_expires_at: session.user_token_expires_at ?? null,
            } as unknown as import("@/integrations/supabase/types").Json,
            created_by: context.userId,
          },
          { onConflict: "brand_id,provider,external_id" },
        )
        .select("id")
        .single();
      if (upErr) throw upErr;
      connectionIds.push(upserted.id);

      if (data.clientId) {
        const { error: assignErr } = await context.supabase.from("client_social_accounts").upsert(
          {
            brand_id: data.brandId,
            client_id: data.clientId,
            connection_id: upserted.id,
            created_by: context.userId,
          },
          { onConflict: "client_id,connection_id" },
        );
        if (assignErr) throw assignErr;
      }
    }

    return {
      ok: true,
      connectionId: connectionIds[0]!,
      connectionIds,
      linkedChannels: specs.map((s) => s.channel),
    };
  });

/** Remoção = revogação lógica (mesma regra de `disconnectMeta`). */
export const unlinkMetaAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UnlinkInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertIntegrationAuthority } = await import("@/lib/access-guard");
    await assertIntegrationAuthority(context.supabase, context.userId, data.brandId);
    const { error: linkErr } = await context.supabase
      .from("client_social_accounts")
      .delete()
      .eq("connection_id", data.connectionId)
      .eq("brand_id", data.brandId);
    if (linkErr) throw linkErr;

    const { error } = await context.supabase
      .from("social_connections")
      .update({
        status: "revoked",
        client_id: null,
        last_error: "Canal removido do workspace pela equipe.",
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", data.connectionId)
      .eq("brand_id", data.brandId)
      .eq("provider", "meta");
    if (error) throw error;
    return { ok: true };
  });
