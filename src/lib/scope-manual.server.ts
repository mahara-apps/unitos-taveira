// ⚠️ Server-only: limite de produção aplicado à CRIAÇÃO MANUAL de peças.
//
// Vale apenas quando a regra do cliente inclui a frente "manual". A volumetria
// em si continua vindo do briefing (escopo do contrato).
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadApprovedOverage, canBypassOverage, currentPeriodMonth } from "@/lib/plan-overage.server";
import { scopeBlocksFront } from "@/lib/client-policy.server";

export type ManualScopeCheck = {
  blocked: boolean;
  quota: number;
  used: number;
};

/** Peças criadas no mês corrente (exclui as excluídas). */
async function countPostsThisMonth(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string },
): Promise<number> {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await sb
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .is("deleted_at", null)
    .gte("created_at", from);
  return count ?? 0;
}

/**
 * Verifica se a criação manual pode seguir. Nunca bloqueia quando:
 * a regra é "só avisar", a frente manual está fora do bloqueio, o contrato não
 * tem volumetria definida, ou o usuário tem autoridade (Owner/Admin/Super).
 */
export async function checkManualScope(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string; userId: string },
): Promise<ManualScopeCheck> {
  const blocks = await scopeBlocksFront(sb, args, "manual");
  if (!blocks) return { blocked: false, quota: 0, used: 0 };

  const { loadBriefingContext } = await import("@/lib/monthly-plan-context.server");
  const ctx = await loadBriefingContext(sb, args.clientId, {});
  const base = Object.values(ctx.monthlyQuota ?? {}).reduce(
    (s: number, v) => s + (Number(v) || 0),
    0,
  );
  if (base <= 0) return { blocked: false, quota: 0, used: 0 };

  const overage = await loadApprovedOverage(sb, {
    brandId: args.brandId,
    clientId: args.clientId,
    periodMonth: currentPeriodMonth(),
  });
  const extra = Object.values(overage ?? {}).reduce((s: number, v) => s + (Number(v) || 0), 0);
  const quota = base + extra;

  const used = await countPostsThisMonth(sb, args);
  if (used < quota) return { blocked: false, quota, used };

  const bypass = await canBypassOverage(sb, args.userId, args.brandId);
  return { blocked: !bypass, quota, used };
}
