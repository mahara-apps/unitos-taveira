/**
 * FASE 2 — guard de escopo de cliente para rotas HTTP (`src/routes/api/*`).
 *
 * As rotas de job autenticam por bearer token e usam o client do próprio
 * usuário (RLS aplicada), mas parte do trabalho roda depois com
 * `supabaseAdmin`/config administrativa de IA. Este guard falha cedo,
 * ANTES de qualquer bypass, usando a mesma fonte canônica da RLS
 * (`public.can_access_client`).
 */
import { callRpc } from "@/lib/supabase-rpc";

type RpcClient = { rpc: (fn: never, args?: never) => unknown };

export async function isClientInScope(
  supabase: RpcClient,
  userId: string,
  clientId: string,
): Promise<boolean> {
  const { data, error } = await callRpc(supabase, "can_access_client", {
    _client_id: clientId,
    _user_id: userId,
  });
  if (error) return false;
  return data === true;
}

/** Resposta padrão (403) quando o cliente está fora do escopo do usuário. */
export const forbiddenClientScope = () =>
  new Response(JSON.stringify({ error: "client_out_of_scope" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });

/** Atalho: valida e devolve a Response de erro, ou `null` quando liberado. */
export async function guardClientScope(
  supabase: RpcClient,
  userId: string,
  clientId: string | null | undefined,
): Promise<Response | null> {
  if (!clientId) return null;
  return (await isClientInScope(supabase, userId, clientId)) ? null : forbiddenClientScope();
}
