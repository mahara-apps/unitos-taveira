/**
 * Agenda de publicação no Portal do Cliente (login e token).
 * O cliente vê as datas propostas e pode reservar ou pedir alteração.
 * Aprovar reserva a data — nunca publica.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePortalSessionScope } from "@/lib/portal-permissions.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProposedScheduleItem, ScheduleActionResult } from "@/lib/schedule-approval.server";

const tokenIn = z.object({ token: z.string().min(8) });
const scopeIn = z.object({ clientId: z.string().uuid() });
const windowIn = { from: z.string(), to: z.string() };
const decisionIn = {
  postIds: z.array(z.string().uuid()).min(1).max(200),
  decision: z.enum(["approve", "changes"]),
  comment: z.string().trim().max(1000).optional().default(""),
};

export const listPortalSessionScheduleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scopeIn.extend(windowIn).parse(i))
  .handler(async ({ context, data }): Promise<ProposedScheduleItem[]> => {
    const { resolveSessionScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { listScheduleForClient } = await import("@/lib/schedule-approval.server");
    const scope = await resolvePortalSessionScope(context.supabase, data.clientId, "calendar", "view");
    return listScheduleForClient(await scopedAdmin(), { ...scope, from: data.from, to: data.to });
  });

export const decidePortalSessionScheduleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scopeIn.extend(decisionIn).parse(i))
  .handler(async ({ context, data }): Promise<ScheduleActionResult> => {
    const { resolveSessionScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { clientDecideSchedule } = await import("@/lib/schedule-approval.server");
    const scope = await resolvePortalSessionScope(
      context.supabase,
      data.clientId,
      "calendar",
      "interact",
    );
    const admin = await scopedAdmin();
    const res = await clientDecideSchedule(admin, {
      ...scope,
      postIds: data.postIds,
      decision: data.decision,
      comment: data.comment,
    });
    await notifyDecisionSafely(admin, scope, data, res.updated);
    return res;
  });

export const listPortalScheduleFn = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.extend(windowIn).parse(i))
  .handler(async ({ data }): Promise<ProposedScheduleItem[]> => {
    const { resolveTokenScope, scopedAdmin } = await import("@/lib/portal-scope.server");
    const { listScheduleForClient } = await import("@/lib/schedule-approval.server");
    const scope = await resolveTokenScope(data.token);
    return listScheduleForClient(await scopedAdmin(), { ...scope, from: data.from, to: data.to });
  });

export const decidePortalScheduleFn = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => tokenIn.extend(decisionIn).parse(i))
  .handler(async (): Promise<ScheduleActionResult> => {
    // Link sem senha é somente leitura: confirmar datas exige login do contato.
    throw new Error("portal_token_read_only");
  });

/** Notificação interna da decisão do cliente — best-effort. */
async function notifyDecisionSafely(
  admin: SupabaseClient,
  scope: { brandId: string; clientId: string },
  data: { decision: "approve" | "changes"; comment?: string },
  updated: number,
): Promise<void> {
  if (updated <= 0) return;
  try {
    const { notifyScheduleClientDecision } = await import("@/lib/schedule-notify.server");
    await notifyScheduleClientDecision(admin, {
      brandId: scope.brandId,
      clientId: scope.clientId,
      decision: data.decision,
      count: updated,
      ...(data.comment ? { comment: data.comment } : {}),
    });
  } catch {
    // silencioso: a decisão do cliente prevalece
  }
}
