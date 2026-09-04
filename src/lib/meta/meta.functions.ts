import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

/**
 * Meta Integration — server functions backed by the unified `social_connections`
 * table. All Meta-specific data (Page ID, IG Business ID, tokens, scopes)
 * lives in that single row per Page.
 */

const BrandInput = z.object({ brandId: z.string().uuid() });

export type SocialConnectionRow = {
  id: string;
  brandId: string;
  provider: string;
  channel: string;
  externalId: string;
  externalName: string | null;
  accountId: string | null;
  accountUsername: string | null;
  ownerName: string | null;
  scopes: string[];
  status: string;
  tokenExpiresAt: string | null;
  lastError: string | null;
  metadata: Json;
  createdAt: string;
  updatedAt: string;
};

export const listMetaConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }): Promise<SocialConnectionRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("social_connections")
      .select(
        "id, brand_id, provider, channel, external_id, external_name, account_id, account_username, owner_name, scopes, status, token_expires_at, last_error, metadata, created_at, updated_at",
      )
      .eq("brand_id", data.brandId)
      .eq("provider", "meta")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      id: r.id,
      brandId: r.brand_id,
      provider: r.provider,
      channel: r.channel,
      externalId: r.external_id,
      externalName: r.external_name,
      accountId: r.account_id,
      accountUsername: r.account_username,
      ownerName: r.owner_name,
      scopes: r.scopes ?? [],
      status: r.status,
      tokenExpiresAt: r.token_expires_at,
      lastError: r.last_error,
      metadata: (r.metadata as Json) ?? {},
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  });

const StartInput = z.object({
  brandId: z.string().uuid(),
  redirectTo: z.string().max(500).optional(),
  channel: z.enum(["facebook", "instagram", "threads", "ads"]).optional(),
  /**
   * When true, appends `auth_type=reauthenticate` to force Meta to re-prompt
   * for login (used to switch the Meta user, or by explicit reconnect
   * actions). Default flow uses `rerequest`, which reuses the existing
   * Facebook session cookie and re-prompts only declined scopes.
   */
  forceReauth: z.boolean().optional(),
});

/**
 * Kicks off Meta OAuth. State is a signed HMAC token carrying brand + user
 * (no auxiliary state table needed) so it survives the round-trip safely.
 *
 * RBAC: autorizar a Meta é uma ação administrativa do workspace
 * (Owner/Admin/Super Admin). Qualquer administrador pode autorizar — a
 * autorização pertence ao WORKSPACE, não ao usuário que a criou.
 */
export const startMetaOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => StartInput.parse(input))
  .handler(async ({ data, context }) => {
    const { hasIntegrationAuthority } = await import("@/lib/access-guard");
    if (!(await hasIntegrationAuthority(context.supabase, context.userId, data.brandId))) {
      throw new Error("Apenas Owner, Admin ou Super Admin podem autorizar a Meta neste workspace.");
    }
    const { MetaProvider, getMetaScopesForChannel, signOAuthState, validateBusinessConfig } =
      await import("./provider.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    let origin: string | null = null;
    try {
      origin = new URL(getRequest().url).origin;
    } catch {
      origin = null;
    }
    const provider = new MetaProvider({ origin });
    const state = await signOAuthState({
      brandId: data.brandId,
      userId: context.userId,
      redirectTo: data.redirectTo ?? null,
      channel: data.channel ?? null,
    });
    const scopes = getMetaScopesForChannel(data.channel ?? null);
    // `config_id` inválido gera consentimento recusado pela Meta com
    // "This app needs at least one supported permission". Validamos antes e,
    // se a configuração não servir, caímos para `scope` SEM esconder o motivo.
    const { resolveMetaAppCredentials } = await import("./app-config.server");
    const creds = await resolveMetaAppCredentials();
    const check = await validateBusinessConfig({
      appId: creds.appId,
      appSecret: creds.appSecret,
      configId: creds.businessConfigId,
    });
    const configId = check.valid ? check.configId : null;
    return {
      authorizeUrl: await provider.buildAuthorizeUrl({
        state,
        scopes,
        display: "popup",
        authType: data.forceReauth ? "reauthenticate" : "rerequest",
        configId,
      }),
      redirectUri: provider.redirectUri,
      /** Modo do consentimento: com `config_id` a Meta pede escolha de portfólio. */
      businessLogin: !!configId,
      /** Escopos efetivamente pedidos quando o modo legado é usado. */
      scopes: configId ? [] : scopes,
      /** Motivo do fallback (null quando não houve). */
      configWarning: check.configId && !check.valid ? check.reason : null,
    };
  });


/**
 * Reuses the most recent unexpired Meta user-token session OF THE WORKSPACE and
 * hands back its id, so the account-selector dialog can open without triggering
 * a new OAuth popup. Returns `null` when no valid session exists (caller should
 * fall back to `startMetaOAuth`).
 *
 * A autorização pertence ao WORKSPACE: um Admin da agência usa a autorização
 * concedida por outro administrador do mesmo Business Portfolio (era exatamente
 * o bloqueio de `jose@` × contas já disponíveis). Somente Owner/Admin/Super
 * Admin podem reutilizá-la.
 */
export const getActiveMetaSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }) => {
    const { hasIntegrationAuthority } = await import("@/lib/access-guard");
    if (!(await hasIntegrationAuthority(context.supabase, context.userId, data.brandId))) {
      return { sessionId: null as string | null };
    }
    const nowIso = new Date().toISOString();
    const { data: rows, error } = await context.supabase
      .from("meta_oauth_sessions")
      .select("id, user_token_ciphertext, user_token_expires_at, expires_at")
      .eq("brand_id", data.brandId)
      .is("revoked_at", null)
      .or(`user_token_expires_at.is.null,user_token_expires_at.gt.${nowIso}`)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) throw error;

    if (!rows?.length) return { sessionId: null as string | null };

    const { decryptCredential } = await import("@/lib/credentials-crypto.server");

    // A session whose token cannot be decrypted anymore (e.g. it was stored
    // under a previous encryption key) is useless — expire it and keep looking
    // instead of handing the dialog a dead session.
    for (const row of rows) {
      let usable = false;
      try {
        usable = !!(row.user_token_ciphertext
          ? await decryptCredential(row.user_token_ciphertext)
          : null);
      } catch {
        usable = false;
      }
      if (!usable) {
        await context.supabase
          .from("meta_oauth_sessions")
          .update({ expires_at: nowIso, user_token_expires_at: nowIso })
          .eq("id", row.id);
        continue;
      }
      // Bump the session's short-lived expiry so the dialog can consume it.
      const nextExpiry = new Date(Date.now() + 30 * 60_000).toISOString();
      await context.supabase
        .from("meta_oauth_sessions")
        .update({ expires_at: nextExpiry, consumed_at: null })
        .eq("id", row.id);
      return { sessionId: row.id };
    }
    return { sessionId: null as string | null };
  });

const ConnIdInput = z.object({
  connectionId: z.string().uuid(),
  brandId: z.string().uuid(),
});

/**
 * Remoção de canal = revogação lógica (histórico preservado).
 * Apaga apenas o vínculo com clientes e invalida credenciais; a linha
 * permanece em `social_connections` com status "revoked", de modo que ela
 * apareça no Histórico e NÃO volte para "Contas disponíveis".
 */
export const disconnectMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { hasIntegrationAuthority } = await import("@/lib/access-guard");
    if (!(await hasIntegrationAuthority(context.supabase, context.userId, data.brandId))) {
      throw new Error("Apenas Owner, Admin ou Super Admin podem remover canais Meta.");
    }
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

/**
 * Re-fetches Page + Instagram metadata using the stored page access token
 * and refreshes status/last_error on the row.
 */
export const refreshMetaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("social_connections")
      .select("id, external_id, access_token_ciphertext")
      .eq("id", data.connectionId)
      .eq("brand_id", data.brandId)
      .eq("provider", "meta")
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Meta connection not found");

    const { decryptCredential } = await import("@/lib/credentials-crypto.server");
    const { MetaProvider, MetaGraphError } = await import("./provider.server");
    const provider = new MetaProvider();
    const pageToken = await decryptCredential(row.access_token_ciphertext);

    try {
      const page = await provider.graph<{
        id: string;
        name: string;
        instagram_business_account?: { id: string; username?: string };
      }>(`/${row.external_id}`, {
        accessToken: pageToken,
        query: { fields: "id,name,instagram_business_account{id,username}" },
      });
      await context.supabase
        .from("social_connections")
        .update({
          external_name: page.name,
          account_id: page.instagram_business_account?.id ?? null,
          account_username: page.instagram_business_account?.username ?? null,
          status: "active",
          last_error: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof MetaGraphError ? err.message : String(err);
      await context.supabase
        .from("social_connections")
        .update({ status: "error", last_error: msg })
        .eq("id", row.id);
      return { ok: false, error: msg };
    }
  });
