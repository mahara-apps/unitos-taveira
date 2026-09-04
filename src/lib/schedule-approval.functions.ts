/**
 * Ações internas sobre a AGENDA proposta (calendário da operação).
 * RLS aplica-se como o usuário autenticado — nenhuma escrita privilegiada aqui.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  internalApproveSchedule,
  updateProposedSlot,
  clearProposedSlot,
  ensureClientScheduleLink,
  reserveScheduleDirect,
  type ClientScheduleLink,
  type ScheduleActionResult,
} from "@/lib/schedule-approval.server";

const scope = z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() });

export const approveScheduleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    scope.extend({ postIds: z.array(z.string().uuid()).min(1).max(200) }).parse(i),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<ScheduleActionResult & { link: ClientScheduleLink | null }> => {
      const res = await internalApproveSchedule(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId,
        postIds: data.postIds,
        userId: context.userId,
      });
      let link: ClientScheduleLink | null = null;
      try {
        link = await ensureClientScheduleLink(context.supabase, {
          brandId: data.brandId,
          clientId: data.clientId,
          userId: context.userId,
        });
      } catch {
        link = null;
      }
      return { ...res, link };
    },
  );

/** Link do Portal para o cliente conferir a agenda (copiar e enviar à mão). */
export const getClientScheduleLinkFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scope.parse(i))
  .handler(
    ({ data, context }): Promise<ClientScheduleLink | null> =>
      ensureClientScheduleLink(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId,
        userId: context.userId,
      }),
  );

/** Reserva a data sem o cliente — apenas Owner/Admin. */
export const reserveScheduleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    scope.extend({ postIds: z.array(z.string().uuid()).min(1).max(200) }).parse(i),
  )
  .handler(
    ({ data, context }): Promise<ScheduleActionResult> =>
      reserveScheduleDirect(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId,
        postIds: data.postIds,
        userId: context.userId,
      }),
  );


export const updateScheduleSlotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    scope.extend({ postId: z.string().uuid(), proposedAt: z.string().datetime() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await updateProposedSlot(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      postId: data.postId,
      proposedAt: data.proposedAt,
    });
    return { ok: true as const };
  });

export const clearScheduleSlotFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => scope.extend({ postId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await clearProposedSlot(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      postId: data.postId,
    });
    return { ok: true as const };
  });

/** Peças sem nenhuma data — alimentam a faixa "Sem data" do calendário. */
export const listUndatedPostsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { listUndatedPosts } = await import("@/lib/schedule-suggest.server");
    return listUndatedPosts(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId ?? null,
    });
  });

/** Sugere dia/hora em massa para as peças sem data do cliente. */
export const suggestSchedulesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    scope.extend({ monthAnchor: z.string().datetime().optional() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { suggestSchedulesForUndated } = await import("@/lib/schedule-suggest.server");
    return suggestSchedulesForUndated(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      monthAnchor: data.monthAnchor ? new Date(data.monthAnchor) : undefined,
      userId: context.userId,
    });
  });
