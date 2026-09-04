import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  PortalPlanSummary,
  PublicPlanDecisionResult,
  PublicPlanResolve,
} from "@/lib/monthly-plan-client.types";

/**
 * Pauta dentro do portal — mesmo fluxo real de `monthly_plans`, com aprovação
 * item-a-item, nos dois modos:
 *
 * - `*PortalSessionPlan*`: portal autenticado (experiência principal).
 * - `*PortalPlan*`: portal por token (convite/fallback compatível).
 *
 * Regras de negócio e escrita ficam em `monthly-plan-decision.server.ts`; aqui
 * só se resolve o escopo (cliente/marca) validado pelo banco.
 */

const tokenIn = z.object({ token: z.string().min(8) });
const scopeIn = z.object({ clientId: z.string().uuid() });

const decisionShape = {
  decision: z.enum(["approve", "reject", "changes", "per_item"]),
  feedback: z.string().trim().max(2000).optional().default(""),
  items: z
    .array(
      z.object({
        topicId: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "changes"]),
        comment: z.string().trim().max(1000).optional().default(""),
      }),
    )
    .max(200)
    .optional(),
};

/* ------------------------------ modo LOGIN ------------------------------- */

export const listPortalSessionPlansFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scopeIn.parse(i ?? {}))
  .handler(async ({ context, data }): Promise<PortalPlanSummary[]> => {
    const { resolveSessionScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { listPlansForClient } = await import("@/lib/monthly-plan-decision.server");
    const scope = await resolveSessionScope(context.supabase, data.clientId);
    return listPlansForClient(await scopedAdmin(), scope.clientId);
  });

export const getPortalSessionPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scopeIn.extend({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }): Promise<PublicPlanResolve> => {
    const { resolveSessionScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { loadPlanForClient } = await import("@/lib/monthly-plan-decision.server");
    const scope = await resolveSessionScope(context.supabase, data.clientId);
    return loadPlanForClient(await scopedAdmin(), data.planId, scope.clientId);
  });

export const decidePortalSessionPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    scopeIn.extend({ planId: z.string().uuid(), ...decisionShape }).parse(i),
  )
  .handler(async ({ context, data }): Promise<PublicPlanDecisionResult> => {
    const { resolveSessionScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { decidePlanAsClient } = await import("@/lib/monthly-plan-decision.server");
    const scope = await resolveSessionScope(context.supabase, data.clientId);
    return decidePlanAsClient(await scopedAdmin(), {
      planId: data.planId,
      clientId: scope.clientId,
      brandId: scope.brandId,
      decision: data.decision,
      feedback: data.feedback,
      items: data.items,
    });
  });

/* ------------------------------ modo TOKEN ------------------------------- */

export const listPortalPlansFn = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.parse(i))
  .handler(async ({ data }): Promise<PortalPlanSummary[]> => {
    const { resolveTokenScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { listPlansForClient } = await import("@/lib/monthly-plan-decision.server");
    const scope = await resolveTokenScope(data.token);
    return listPlansForClient(await scopedAdmin(), scope.clientId);
  });

export const getPortalPlanFn = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.extend({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data }): Promise<PublicPlanResolve> => {
    const { resolveTokenScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { loadPlanForClient } = await import("@/lib/monthly-plan-decision.server");
    const scope = await resolveTokenScope(data.token);
    return loadPlanForClient(await scopedAdmin(), data.planId, scope.clientId);
  });

export const decidePortalPlanFn = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    tokenIn.extend({ planId: z.string().uuid(), ...decisionShape }).parse(i),
  )
  .handler(async ({ data }): Promise<PublicPlanDecisionResult> => {
    const { resolveTokenScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { decidePlanAsClient } = await import("@/lib/monthly-plan-decision.server");
    const scope = await resolveTokenScope(data.token);
    return decidePlanAsClient(await scopedAdmin(), {
      planId: data.planId,
      clientId: scope.clientId,
      brandId: scope.brandId,
      decision: data.decision,
      feedback: data.feedback,
      items: data.items,
    });
  });
