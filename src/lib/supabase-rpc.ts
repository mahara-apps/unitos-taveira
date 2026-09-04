/**
 * Chamada canônica de RPC do Supabase.
 *
 * `SupabaseClient.rpc` é implementado como `return this.rest.rpc(...)`. Extrair
 * o método (`const rpc = supabase.rpc as ...`) o DESANEXA do client e a
 * primeira chamada explode em runtime com:
 *
 *   TypeError: Cannot read properties of undefined (reading 'rest')
 *
 * Esse era o erro real de "Vincular à marca". Todo acesso a RPC no projeto
 * deve passar por aqui — o helper preserva o `this` e mantém a tipagem frouxa
 * necessária para funções que ainda não estão em `types.ts`.
 */

/** Aceita qualquer client Supabase (tipado ou não) — só usamos `rpc`. */
export type RpcCapableClient = { rpc: (fn: never, args?: never) => unknown };

export type RpcResult<T = unknown> = { data: T; error: { message: string } | null };

export async function callRpc<T = unknown>(
  supabase: RpcCapableClient,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<RpcResult<T>> {
  const invoke = supabase.rpc as unknown as (
    f: string,
    a: Record<string, unknown>,
  ) => Promise<RpcResult<T>>;
  // `.call` é obrigatório: sem ele o método perde o client e falha em runtime.
  return invoke.call(supabase, fn, args);
}
