import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_CHANNELS } from "@/lib/monthly-plan-fields";

/** Conta peças de pauta já geradas no mês corrente, por canal. */
export async function countGeneratedThisMonth(
  supabase: SupabaseClient,
  clientId: string,
  monthStartOrPeriod: string,
): Promise<Record<string, number>> {
  const monthStart =
    monthStartOrPeriod.length === 10
      ? new Date(`${monthStartOrPeriod}T00:00:00.000Z`).toISOString()
      : monthStartOrPeriod;
  const out = PLAN_CHANNELS.reduce<Record<string, number>>((acc, c) => {
    acc[c] = 0;
    return acc;
  }, {});
  const { data: planRows } = await supabase
    .from("monthly_plans" as never)
    .select("id")
    .eq("client_id", clientId)
    .gte("created_at", monthStart);
  const planIds = ((planRows ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (!planIds.length) return out;
  const { data: topicRows } = await supabase
    .from("monthly_plan_topics" as never)
    .select("channel")
    .in("monthly_plan_id", planIds);
  for (const t of (topicRows ?? []) as Array<{ channel: string | null }>) {
    const c = (t.channel ?? "").toLowerCase();
    if (c in out) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}
