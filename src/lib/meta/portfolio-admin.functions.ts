import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Gestão dos PORTFÓLIOS Meta no nível do workspace.
 *
 * Modelo conceitual (três coisas distintas):
 * - AUTORIZAÇÃO: `meta_oauth_sessions` — cada administrador Meta que consentiu.
 * - BUSINESS PORTFOLIO: `meta_business_id` — dono dos ativos; um workspace pode
 *   ter vários, e vários administradores podem autorizar o mesmo portfólio.
 * - CANAL CONECTADO: `social_connections` (+ `client_social_accounts`).
 *
 * - Adicionar/trocar portfólio = novo OAuth (`startMetaOAuth`) e nova seleção
 *   de contas. Nada é gravado até a seleção: a conexão atual permanece intacta
 *   se a nova autorização falhar.
 * - Desconectar portfólio = revoga os canais daquele portfólio, remove os
 *   vínculos com clientes e revoga só as autorizações que não alcançam mais
 *   nenhum portfólio ativo.
 *
 * Todas as leituras/escritas são filtradas por `brand_id` e passam pelo cliente
 * autenticado (RLS). Ações de escrita exigem Owner/Admin/Super Admin.
 */

const BrandInput = z.object({ brandId: z.string().uuid() });

const DisconnectInput = z.object({
  brandId: z.string().uuid(),
  /** Identidade real do Business Portfolio. */
  businessId: z.string().max(120).nullable().optional(),
  /** Compatibilidade com linhas antigas agrupadas pelo usuário Meta. */
  ownerExternalId: z.string().max(120).nullable().optional(),
});

const RevokeAuthInput = z.object({
  brandId: z.string().uuid(),
  metaUserId: z.string().min(1).max(120),
});

export type {
  MetaPortfolioSummary,
  MetaPortfolioStatus,
  MetaAuthorizationSummary,
} from "@/lib/meta/authorization-state";

export const getMetaPortfolioStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }) => {
    const { buildMetaPortfolioStatus } = await import("@/lib/meta/authorization-state");

    // Autorização (meta_oauth_sessions) e canais (social_connections) são
    // fontes de verdade DISTINTAS. O painel reconhece a autorização mesmo com
    // zero conexões — o mesmo filtro usado na descoberta de contas. Sessões de
    // QUALQUER administrador do workspace contam (não filtramos por user_id).
    const [connRes, sessRes] = await Promise.all([
      context.supabase
        .from("social_connections")
        .select(
          "channel, status, owner_external_id, owner_name, client_id, created_at, meta_business_id, meta_business_name",
        )
        .eq("brand_id", data.brandId)
        .eq("provider", "meta")
        .order("created_at", { ascending: true }),
      context.supabase
        .from("meta_oauth_sessions")
        .select(
          "meta_user_id, meta_user_name, meta_user_email, user_token_ciphertext, user_token_expires_at, revoked_at, created_at, businesses",
        )
        .eq("brand_id", data.brandId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (connRes.error) throw connRes.error;
    if (sessRes.error) throw sessRes.error;

    return buildMetaPortfolioStatus((connRes.data ?? []) as never, (sessRes.data ?? []) as never);
  });

/** Diagnóstico do modo de login Meta (Business Login × escopos legados). */
export const getMetaOAuthModeFn = createServerFn({ method: "GET" }).handler(async () => {
  const { metaOAuthModeDiagnostics, validateBusinessConfig } = await import(
    "@/lib/meta/provider.server"
  );
  const { resolveMetaAppCredentials } = await import("./app-config.server");
  // Modo/credenciais do App Meta EM USO nesta instalação (oficial ou do cliente).
  let creds: { appId: string; appSecret: string; businessConfigId: string | null } | null = null;
  try {
    creds = await resolveMetaAppCredentials();
  } catch {
    creds = null;
  }
  const diag = metaOAuthModeDiagnostics(creds?.businessConfigId ?? null);
  const check = await validateBusinessConfig({
    ...(creds ? { appId: creds.appId, appSecret: creds.appSecret } : {}),
    configId: creds?.businessConfigId ?? null,
  });
  // Modo efetivo: um `config_id` inválido cai para escopos legados em runtime,
  // então o diagnóstico precisa mostrar exatamente isso (sem mascarar o erro).
  return {
    ...diag,
    mode: diag.mode === "business_login" && !check.valid ? ("legacy_scopes" as const) : diag.mode,
    configValid: check.valid,
    configError: check.reason,
    note:
      diag.mode === "business_login" && !check.valid
        ? `Configuração de login inválida — usando escopos legados. ${check.reason ?? ""}`.trim()
        : diag.note,
  };
});

export const disconnectMetaPortfolioFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DisconnectInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; removed: number; message: string }> => {
    const { hasIntegrationAuthority } = await import("@/lib/access-guard");
    if (!(await hasIntegrationAuthority(context.supabase, context.userId, data.brandId))) {
      return {
        ok: false,
        removed: 0,
        message: "Apenas Owner, Admin ou Super Admin podem desconectar um portfólio Meta.",
      };
    }

    // A autorização é revogada mesmo sem canais vinculados (senão as contas
    // descobertas continuariam "disponíveis"), mas somente quando ela não serve
    // outro portfólio. Histórico preservado (linhas marcadas, nunca apagadas).
    const { revokeMetaPortfolio } = await import("@/lib/meta/authorization.server");
    const { removed, sessionsRevoked, sessionsKept } = await revokeMetaPortfolio(
      context.supabase,
      {
        brandId: data.brandId,
        businessId: data.businessId ?? null,
        ownerExternalId: data.ownerExternalId ?? null,
      },
    );

    const authNote = sessionsRevoked
      ? "Autorização Meta revogada."
      : sessionsKept
        ? "Autorização mantida para os demais portfólios."
        : "Nenhuma autorização ativa restava.";

    return {
      ok: true,
      removed,
      message: removed
        ? `${removed} canal(is) desconectado(s). ${authNote}`
        : `Portfólio desconectado. ${authNote}`,
    };
  });

/** Revoga a autorização de UM administrador Meta, sem afetar os demais. */
export const revokeMetaAuthorizationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RevokeAuthInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; message: string }> => {
    const { hasIntegrationAuthority } = await import("@/lib/access-guard");
    if (!(await hasIntegrationAuthority(context.supabase, context.userId, data.brandId))) {
      return {
        ok: false,
        message: "Apenas Owner, Admin ou Super Admin podem revogar autorizações Meta.",
      };
    }
    const { revokeMetaAuthorization } = await import("@/lib/meta/authorization.server");
    const { sessionsRevoked } = await revokeMetaAuthorization(context.supabase, {
      brandId: data.brandId,
      metaUserId: data.metaUserId,
    });
    return {
      ok: true,
      message: sessionsRevoked
        ? "Autorização revogada. Os canais já conectados permanecem, mas novas descobertas exigem nova autorização."
        : "Nenhuma autorização ativa encontrada para este usuário Meta.",
    };
  });

