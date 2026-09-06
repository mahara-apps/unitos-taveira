// Leitura/gravação das regras por cliente. Só Owner/Admin (e Super Admin)
// podem alterar — o banco também garante isso por trigger.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandAdmin } from "@/lib/access-guard";
import {
  APPROVAL_STAGES,
  SCOPE_FRONTS,
  type ApprovalPolicy,
  type ScopePolicy,
} from "@/lib/client-policy";

const approvalSchema = z.object({
  plan: z.enum(["client", "internal"]),
  content: z.enum(["client", "internal"]),
  schedule: z.enum(["client", "internal"]),
});

const scopeSchema = z.object({
  mode: z.enum(["warn", "block"]),
  applies: z.array(z.enum(SCOPE_FRONTS)).max(SCOPE_FRONTS.length),
});

export type ClientPolicies = {
  approval: ApprovalPolicy;
  scope: ScopePolicy;
  /** Pendências que ficariam órfãs se uma etapa for dispensada agora. */
  pending: { plan: number; content: number; schedule: number };
};

export const getClientPoliciesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<ClientPolicies> => {
    const { resolveClientApprovalPolicy, resolveClientScopePolicy } = await import(
      "@/lib/client-policy.server"
    );
    const [approval, scope, plans, posts, schedule] = await Promise.all([
      resolveClientApprovalPolicy(context.supabase, data),
      resolveClientScopePolicy(context.supabase, data),
      context.supabase
        .from("monthly_plans")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("status", "pending_client"),
      context.supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .is("deleted_at", null)
        .eq("visible_in_portal", true)
        .eq("review_status", "pending"),
      context.supabase
        .from("posts")
        .select("id", { count: "exact", head: true })
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .is("deleted_at", null)
        .eq("schedule_status", "client_pending"),
    ]);
    return {
      approval,
      scope,
      pending: {
        plan: plans.count ?? 0,
        content: posts.count ?? 0,
        schedule: schedule.count ?? 0,
      },
    };
  });

export const setClientPoliciesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        approval: approvalSchema.optional(),
        scope: scopeSchema.optional(),
        /** O que fazer com o que já está aguardando o cliente. */
        pendingAction: z.enum(["keep", "release"]).default("keep"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAdmin(context.supabase, context.userId, data.brandId);

    const patch: Record<string, unknown> = {};
    if (data.approval) patch["approval_policy"] = data.approval;
    if (data.scope) patch["scope_policy"] = data.scope;
    if (Object.keys(patch).length > 0) {
      const { error } = await context.supabase
        .from("clients")
        .update(patch as never)
        .eq("id", data.clientId)
        .eq("brand_id", data.brandId);
      if (error) throw error;
    }

    // Nada é liberado sem decisão explícita da operação.
    const released = { plan: 0, content: 0, schedule: 0 };
    if (data.approval && data.pendingAction === "release") {
      const now = new Date().toISOString();
      const waived = APPROVAL_STAGES.filter((s) => data.approval?.[s] === "internal");

      if (waived.includes("plan")) {
        const { data: rows } = await context.supabase
          .from("monthly_plans")
          .update({
            status: "approved",
            client_decision_at: now,
            client_decision_mode: "internal_waived",
          } as never)
          .eq("brand_id", data.brandId)
          .eq("client_id", data.clientId)
          .eq("status", "pending_client")
          .select("id");
        released.plan = (rows ?? []).length;
        const { materializePlanToKanban } = await import("@/lib/monthly-plan-kanban.server");
        for (const row of (rows ?? []) as Array<{ id: string }>) {
          try {
            await materializePlanToKanban(context.supabase, {
              planId: row.id,
              brandId: data.brandId,
              clientId: data.clientId,
              userId: context.userId,
            });
          } catch {
            // A equipe reprocessa na tela da pauta; não invalida a mudança de regra.
          }
        }
      }

      if (waived.includes("content")) {
        const { data: rows } = await context.supabase
          .from("posts")
          .update({ review_status: "approved" } as never)
          .eq("brand_id", data.brandId)
          .eq("client_id", data.clientId)
          .is("deleted_at", null)
          .eq("visible_in_portal", true)
          .eq("review_status", "pending")
          .select("id");
        released.content = (rows ?? []).length;
      }

      if (waived.includes("schedule")) {
        const { data: rows } = await context.supabase
          .from("posts")
          .update({ schedule_status: "reserved", schedule_client_decision_at: now } as never)
          .eq("brand_id", data.brandId)
          .eq("client_id", data.clientId)
          .is("deleted_at", null)
          .eq("schedule_status", "client_pending")
          .select("id");
        released.schedule = (rows ?? []).length;
      }
    }

    return { ok: true as const, released };
  });
