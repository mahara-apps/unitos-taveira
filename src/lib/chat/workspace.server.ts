/**
 * Resolução do workspace (brand) de uma conversa de chat.
 *
 * O chat operacional exige workspace: é ele que define a IA da conta (BYOK),
 * o escopo de dados e as permissões por módulo. Conversas criadas sem
 * workspace ficavam inutilizáveis — este helper é a única fonte autorizada
 * para resolver/backfillar esse vínculo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export const CHAT_WORKSPACE_MISSING = "chat_workspace_missing";

/**
 * Workspaces do usuário, priorizando papéis de maior autoridade. Roda com a
 * sessão do próprio usuário (RLS aplica), nunca com service role.
 */
export async function resolveUserBrandId(
  supabase: Db,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("brand_members")
    .select("brand_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return null;
  const rows = (data ?? []) as Array<{ brand_id: string | null; role: string | null }>;
  const rank = (role: string | null) => {
    switch ((role ?? "").toLowerCase()) {
      case "owner":
        return 0;
      case "admin":
        return 1;
      case "manager":
        return 2;
      default:
        return 3;
    }
  };
  const sorted = rows.filter((r) => !!r.brand_id).sort((a, b) => rank(a.role) - rank(b.role));
  return sorted[0]?.brand_id ?? null;
}

/**
 * Garante que a conversa tenha workspace. Se estiver nula (conversas legadas
 * ou criadas sem contexto), resolve pelo vínculo do usuário e grava.
 * Lança `chat_workspace_missing` quando o usuário não pertence a workspace.
 */
export async function ensureConversationBrandId(
  supabase: Db,
  userId: string,
  conversation: { id: string; brand_id: string | null },
): Promise<string> {
  if (conversation.brand_id) return conversation.brand_id;
  const brandId = await resolveUserBrandId(supabase, userId);
  if (!brandId) throw new Error(CHAT_WORKSPACE_MISSING);
  await supabase
    .from("chat_conversations")
    .update({ brand_id: brandId })
    .eq("id", conversation.id)
    .is("brand_id", null);
  return brandId;
}
