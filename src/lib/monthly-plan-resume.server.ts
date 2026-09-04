import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Retomada idempotente da geração de pauta.
 *
 * Se uma execução anterior do mesmo brand + client + período morreu depois de
 * criar a pauta (checkpoint em `ai_jobs.result`), a nova execução reaproveita
 * o rascunho e gera SOMENTE as vagas que faltam — sem duplicar tópicos nem
 * gastar tokens de novo com o que já existe.
 */

export type PlanResumeState = {
  planId: string;
  topicsSaved: number;
  maxPosition: number;
  existingTitles: string[];
  /** Tópicos já salvos por canal — evita contá-los duas vezes na volumetria. */
  channelCounts: Record<string, number>;
};

export async function findResumableGeneration(
  supabase: SupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    period: string;
    briefingVersionId?: string | null;
  },
): Promise<PlanResumeState | null> {
  const { data: jobs, error } = await supabase
    .from("ai_jobs")
    .select("id, result, status, created_at")
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .eq("kind", "monthly_plan")
    .in("status", ["failed", "running"])
    .order("created_at", { ascending: false })
    .limit(10);
  if (error || !jobs?.length) return null;

  for (const job of jobs) {
    const result = (job as { result: unknown }).result as {
      monthly_plan_id?: string;
      period?: string;
    } | null;
    const planId = result?.monthly_plan_id;
    if (!planId || (result?.period && result.period !== args.period)) continue;

    const { data: plan } = await supabase
      .from("monthly_plans" as never)
      .select("id, status, brand_id, client_id, context_sources")
      .eq("id", planId)
      .maybeSingle();
    const row = plan as {
      id: string;
      status: string;
      brand_id: string;
      client_id: string;
      context_sources: Record<string, unknown> | null;
    } | null;
    // Só é retomável enquanto ninguém aprovou/arquivou o rascunho.
    if (
      !row ||
      row.brand_id !== args.brandId ||
      row.client_id !== args.clientId ||
      row.status !== "draft"
    ) {
      continue;
    }
    const savedVersion = row.context_sources?.["briefing_version_id"];
    const savedVersionId = typeof savedVersion === "string" ? savedVersion : null;
    if (savedVersionId !== (args.briefingVersionId ?? null)) continue;

    const { data: topics } = await supabase
      .from("monthly_plan_topics" as never)
      .select("id, topic_title, position, channel")
      .eq("monthly_plan_id", planId);
    const list = (topics ?? []) as unknown as Array<{
      topic_title: string;
      position: number;
      channel: string | null;
    }>;
    const channelCounts: Record<string, number> = {};
    for (const t of list) {
      const c = (t.channel ?? "").trim();
      if (c) channelCounts[c] = (channelCounts[c] ?? 0) + 1;
    }
    return {
      planId,
      topicsSaved: list.length,
      maxPosition: list.reduce((m, t) => Math.max(m, t.position ?? 0), -1),
      existingTitles: list.map((t) => t.topic_title),
      channelCounts,
    };
  }
  return null;
}
