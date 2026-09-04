import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PortalClient, PortalPost } from "@/lib/portal-types";
import type { SessionContext } from "@/lib/portal-data.server";

export type PortalClientLink = {
  client_id: string;
  brand_id: string;
  client_name: string | null;
  brand_name: string | null;
};

export const listMyPortalClientsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortalClientLink[]> => {
    const { data, error } = await context.supabase.rpc("portal_my_clients");
    if (error) throw new Error(error.message);
    return (data ?? []) as PortalClientLink[];
  });

export const resolvePortalSessionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ context, data }) =>
    (await import("@/lib/portal-data.server")).resolveSessionPortal(
      context as unknown as SessionContext,
      data.clientId,
    ),
  );

export const getPortalSessionMetricsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ context, data }) =>
    (await import("@/lib/portal-data.server")).sessionMetrics(
      context as unknown as SessionContext,
      data.clientId,
    ),
  );

export const listPortalSessionApprovalsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        status: z.enum(["all", "pending", "approved", "adjust"]).default("all"),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) =>
    (await import("@/lib/portal-data.server")).sessionApprovals(
      context as unknown as SessionContext,
      data.clientId,
      data.status,
    ),
  );

export const getPortalSessionPostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), postId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) =>
    (await import("@/lib/portal-data.server")).sessionPost(
      context as unknown as SessionContext,
      data.clientId,
      data.postId,
    ),
  );

export const decidePortalSessionApprovalFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        postId: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "adjust", "comment"]),
        note: z.string().max(4000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) =>
    (await import("@/lib/portal-data.server")).sessionDecide(
      context as unknown as SessionContext,
      data.clientId,
      data.postId,
      data.decision,
      data.note,
    ),
  );

export const listPortalSessionCalendarFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) =>
    (await import("@/lib/portal-data.server")).sessionCalendar(
      context as unknown as SessionContext,
      data.clientId,
      data.month,
    ),
  );

export const listPortalSessionFilesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), search: z.string().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) =>
    (await import("@/lib/portal-data.server")).sessionFiles(
      context as unknown as SessionContext,
      data.clientId,
      data.search,
    ),
  );

export const listPortalSessionBriefingsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ context, data }) =>
    (await import("@/lib/portal-data.server")).sessionBriefings(
      context as unknown as SessionContext,
      data.clientId,
    ),
  );

export type PortalSessionClient = PortalClient;
export type PortalSessionPost = PortalPost;
