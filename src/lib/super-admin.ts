import { callRpc } from "@/lib/supabase-rpc";
import type { RpcClient } from "@/lib/access-guard";

/**
 * Fonte ÚNICA de verdade de Super Admin no servidor.
 *
 * Não existe verificação por e-mail/ID espalhada no código: tudo passa por
 * `public.is_super_admin()` (allowlist via JWT) ou
 * `public.is_super_admin(_user_id)` (`user_profiles.is_super_admin`).
 */
export async function resolveIsSuperAdmin(supabase: RpcClient, userId: string): Promise<boolean> {
  // IMPORTANTE: manter o `this` do client — chamar `supabase.rpc` desanexado
  // quebra em runtime ("Cannot read properties of undefined (reading 'rest')").
  const [byJwt, byProfile] = await Promise.all([
    callRpc(supabase, "is_super_admin", {}),
    callRpc(supabase, "is_super_admin", { _user_id: userId }),
  ]);
  if (byJwt.error && byProfile.error) throw byJwt.error;
  return !!byJwt.data || !!byProfile.data;
}

/** Exige Super Admin — usado por toda escrita administrativa de ambiente. */
export async function assertSuperAdmin(supabase: RpcClient, userId: string): Promise<void> {
  const ok = await resolveIsSuperAdmin(supabase, userId);
  if (!ok) throw new Error("Forbidden: super admin required");
}
