import type { SupabaseClient } from "@supabase/supabase-js";
import { callRpc } from "@/lib/supabase-rpc";

/**
 * Exclusão definitiva de pauta.
 *
 * Regras de negócio (não são de UI):
 * - Só Owner/Admin do workspace e Super Admin excluem (`app_access_role`
 *   mapeia owner→admin; manager/user ficam apenas com o arquivamento).
 * - Pauta que já materializou peças de conteúdo NUNCA é excluída: o histórico
 *   de produção prevalece e o usuário é orientado a arquivar.
 * - O projeto vinculado é preservado; só o vínculo pauta↔projeto é desfeito.
 */

/** Autoridade administrativa no workspace (owner/admin/super admin). */
export async function isBrandAdmin(
  supabase: SupabaseClient,
  userId: string,
  brandId: string,
): Promise<boolean> {
  const { data, error } = await callRpc<string | null>(supabase, "app_access_role", {
    _user_id: userId,
    _brand_id: brandId,
  });
  if (error) return false;
  return data === "super_admin" || data === "admin";
}

export async function deletePlanHard(
  supabase: SupabaseClient,
  args: { planId: string; brandId: string; clientId: string; userId: string },
): Promise<{ ok: true }> {
  const { data: planRow, error: planErr } = await supabase
    .from("monthly_plans")
    .select("id, brand_id, client_id, project_id")
    .eq("id", args.planId)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .maybeSingle();
  if (planErr) throw planErr;
  if (!planRow) throw new Error("plan_not_found");
  const plan = planRow as unknown as { id: string; project_id: string | null };

  if (!(await isBrandAdmin(supabase, args.userId, args.brandId))) {
    throw new Error("forbidden");
  }

  // Peças já materializadas bloqueiam a exclusão (FK sem cascade + histórico).
  const { data: topicRows, error: topicErr } = await supabase
    .from("monthly_plan_topics")
    .select("id")
    .eq("monthly_plan_id", args.planId);
  if (topicErr) throw topicErr;
  const topicIds = ((topicRows ?? []) as unknown as Array<{ id: string }>).map((t) => t.id);

  if (topicIds.length > 0) {
    const { count, error: postErr } = await supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .in("monthly_plan_topic_id", topicIds);
    if (postErr) throw postErr;
    if ((count ?? 0) > 0) throw new Error("plan_has_content");
  }

  // Desfaz o vínculo do projeto (FK sem cascade): o projeto é preservado.
  if (plan.project_id) {
    const { error: unlinkErr } = await supabase
      .from("projects")
      .update({ monthly_plan_id: null } as never)
      .eq("monthly_plan_id", args.planId);
    if (unlinkErr) throw unlinkErr;
  }

  const { error: delErr } = await supabase
    .from("monthly_plans")
    .delete()
    .eq("id", args.planId)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId);
  if (delErr) throw delErr;

  return { ok: true };
}
