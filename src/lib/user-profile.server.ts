import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type EnsureUserProfileInput = {
  userId: string;
  email?: string | null;
  fullName?: string | null;
  requiresPasswordChange?: boolean;
};

/**
 * Garante que uma conta de Auth tenha perfil público sem alterar autoridade.
 * O papel nasce sempre como `user`; papéis reais continuam nos vínculos de
 * workspace/cliente e a flag de Super Admin nunca é escrita aqui.
 */
export async function ensureUserProfile(
  supabaseAdmin: SupabaseClient<Database>,
  input: EnsureUserProfileInput,
) {
  const fullName = input.fullName?.trim() || "Usuário";
  const { error: insertError } = await supabaseAdmin.from("user_profiles").upsert(
    {
      id: input.userId,
      full_name: fullName,
      email: input.email?.trim().toLowerCase() || null,
      role: "user",
      requires_password_change: input.requiresPasswordChange ?? false,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (insertError) throw new Error(`profile_create_failed: ${insertError.message}`);

  const changes: Database["public"]["Tables"]["user_profiles"]["Update"] = {};
  if (input.fullName?.trim()) changes.full_name = input.fullName.trim();
  if (input.email?.trim()) changes.email = input.email.trim().toLowerCase();
  if (input.requiresPasswordChange !== undefined) {
    changes.requires_password_change = input.requiresPasswordChange;
  }

  if (Object.keys(changes).length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update(changes)
      .eq("id", input.userId);
    if (updateError) throw new Error(`profile_update_failed: ${updateError.message}`);
  }

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, full_name, email, requires_password_change")
    .eq("id", input.userId)
    .single();
  if (error || !data)
    throw new Error(`profile_verify_failed: ${error?.message ?? "perfil ausente"}`);
  return data;
}
