import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reconcilia o vínculo entre a pauta e o projeto que o usuário escolheu.
 * NÃO cria projeto: a escolha do projeto é sempre explícita na criação da pauta.
 */
export async function reconcilePlanProjectLink(
  sb: SupabaseClient,
  args: { planId: string; projectId: string },
): Promise<{ projectId: string; created: false }> {
  await sb
    .from("monthly_plans")
    .update({ project_id: args.projectId } as never)
    .eq("id", args.planId)
    .is("project_id", null);

  await sb
    .from("projects")
    .update({ monthly_plan_id: args.planId } as never)
    .eq("id", args.projectId)
    .is("monthly_plan_id", null);

  return { projectId: args.projectId, created: false };
}
