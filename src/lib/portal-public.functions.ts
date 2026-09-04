import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  PortalApproval,
  PortalBrand,
  PortalBriefing,
  PortalClient,
  PortalFile,
  PortalMetrics,
  PortalPost,
} from "@/lib/portal-types";

export type {
  PortalApproval,
  PortalBrand,
  PortalBriefing,
  PortalClient,
  PortalFile,
  PortalMetrics,
  PortalPost,
};

export const resolvePortalTokenFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8) }).parse(input))
  .handler(async ({ data }) =>
    (await import("@/lib/portal-data.server")).resolveTokenPortal(data.token),
  );

export const getPortalMetricsFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8) }).parse(input))
  .handler(async ({ data }) => (await import("@/lib/portal-data.server")).tokenMetrics(data.token));

export const listPortalApprovalsFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(8),
        status: z.enum(["all", "pending", "approved", "adjust"]).default("all"),
      })
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("@/lib/portal-data.server")).tokenApprovals(data.token, data.status),
  );

export const getPortalPostFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(8), postId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) =>
    (await import("@/lib/portal-data.server")).tokenPost(data.token, data.postId),
  );

export const decidePortalApprovalFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(8),
        postId: z.string().uuid(),
        decision: z.enum(["approved", "rejected", "adjust", "comment"]),
        note: z.string().max(4000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("@/lib/portal-data.server")).tokenDecide(
      data.token,
      data.postId,
      data.decision,
      data.note,
    ),
  );

export const listPortalCalendarFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        token: z.string().min(8),
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) =>
    (await import("@/lib/portal-data.server")).tokenCalendar(data.token, data.month),
  );

export const listPortalFilesFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(8), search: z.string().optional() }).parse(input),
  )
  .handler(async ({ data }) =>
    (await import("@/lib/portal-data.server")).tokenFiles(data.token, data.search),
  );

export const listPortalBriefingsFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8) }).parse(input))
  .handler(async ({ data }) =>
    (await import("@/lib/portal-data.server")).tokenBriefings(data.token),
  );
