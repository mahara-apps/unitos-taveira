import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolução de escopo do portal (cliente + marca), única para os dois modos.
 *
 * - LOGIN: `portal_resolve` chamado com o client autenticado do usuário; o
 *   banco valida `client_members.role = 'portal_client'` e recusa cliente
 *   não vinculado (`client_not_allowed`).
 * - TOKEN: `portal_resolve` chamado com a chave publishable e `_token`; a RPC
 *   SECURITY DEFINER valida existência, revogação e expiração do token.
 *
 * Nenhum consumidor decide escopo por conta própria: quem chama recebe apenas
 * `clientId`/`brandId` já validados pelo banco.
 */

export type PortalScope = { clientId: string; brandId: string };

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function publishableClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing Supabase environment variable(s): SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY.",
    );
  }
  const isOpaque = key.startsWith("sb_publishable_") || key.startsWith("sb_secret_");
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isOpaque && headers.get("Authorization") === `Bearer ${key}`)
          headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

async function scopeFrom(client: RpcClient, args: Record<string, unknown>): Promise<PortalScope> {
  const { data, error } = await client.rpc("portal_resolve", args);
  if (error) throw new Error(error.message);
  const res = data as { clientId?: string | null; brandId?: string | null } | null;
  if (!res?.clientId || !res?.brandId) throw new Error("invalid_token");
  return { clientId: res.clientId, brandId: res.brandId };
}

/** Escopo a partir de um token de portal (modo convite/fallback). */
export async function resolveTokenScope(token: string): Promise<PortalScope> {
  return scopeFrom(publishableClient() as unknown as RpcClient, { _token: token });
}

/**
 * Escopo a partir da sessão autenticada do cliente (modo principal).
 *
 * `clientId` é OBRIGATÓRIO: sem ele o banco escolheria o "último cliente visto",
 * o que produziria dados de outro tenant. Ausência = erro explícito.
 */
export async function resolveSessionScope(
  supabase: unknown,
  clientId?: string | null,
): Promise<PortalScope> {
  if (!clientId) throw new Error("portal_client_context_required");
  const scope = await scopeFrom(supabase as RpcClient, { _client_id: clientId });
  if (scope.clientId !== clientId) throw new Error("portal_client_context_mismatch");
  return scope;
}

/** True quando a chave de serviço está configurada no ambiente. */
export function hasServiceKey(): boolean {
  return Boolean(
    process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim() || process.env["SB_SERVICE_ROLE_KEY"]?.trim(),
  );
}

/** Client privilegiado usado depois do escopo estar resolvido e validado. */
export async function scopedAdmin(): Promise<SupabaseClient> {
  // Erro tipado (em vez da mensagem genérica do client) para o portal exibir
  // orientação clara e não abrir tela branca.
  if (!hasServiceKey()) throw new Error("portal_service_key_missing");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}
