/**
 * Enforcement das permissões do Portal (servidor).
 *
 * A fonte é `public.portal_permissions(_client_id)`, que só responde para quem
 * tem vínculo com o cliente (contato do portal ou equipe com escopo). Nenhuma
 * tela decide sozinha: toda leitura/decisão do portal passa por aqui.
 */

import {
  normalizePortalPermissions,
  portalCanInteract,
  portalCanView,
  type PortalModuleId,
  type PortalPermissions,
} from "@/lib/portal-permissions";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function readPortalPermissions(
  supabase: unknown,
  clientId: string,
): Promise<PortalPermissions> {
  const { data, error } = await (supabase as RpcClient).rpc("portal_permissions", {
    _client_id: clientId,
  });
  if (error) throw new Error(error.message);
  return normalizePortalPermissions(data);
}

/** Bloqueia com erro tipado para o portal exibir mensagem clara. */
export async function assertPortalAccess(
  supabase: unknown,
  clientId: string,
  moduleId: PortalModuleId,
  need: "view" | "interact" = "view",
): Promise<PortalPermissions> {
  const perms = await readPortalPermissions(supabase, clientId);
  const ok = need === "interact" ? portalCanInteract(perms, moduleId) : portalCanView(perms, moduleId);
  if (!ok) throw new Error(`portal_permission_denied:${moduleId}:${need}`);
  return perms;
}

/**
 * Escopo do portal por sessão JÁ validado pela permissão do módulo.
 * Único caminho usado pelas server functions do portal autenticado.
 */
export async function resolvePortalSessionScope(
  supabase: unknown,
  clientId: string,
  moduleId: PortalModuleId,
  need: "view" | "interact" = "view",
): Promise<{ clientId: string; brandId: string }> {
  const { resolveSessionScope } = await import("@/lib/portal-scope.server");
  const scope = await resolveSessionScope(supabase, clientId);
  await assertPortalAccess(supabase, scope.clientId, moduleId, need);
  return scope;
}
