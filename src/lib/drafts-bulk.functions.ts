/**
 * Server function da aplicação em massa sobre rascunhos do calendário.
 * RLS aplica-se como o usuário autenticado — nenhuma escrita privilegiada.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { bulkApplyToDrafts, type BulkApplyResult } from "@/lib/drafts-bulk.server";

const DestinationSchema = z.object({
  connectionId: z.string().uuid(),
  channel: z.enum(["instagram", "facebook", "linkedin", "tiktok", "youtube", "x", "threads"]),
  format: z.enum(["feed", "stories", "reels", "carrossel"]),
});

const BulkInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  postIds: z.array(z.string().uuid()).min(1).max(100),
  destinations: z
    .object({ mode: z.enum(["replace", "add"]), list: z.array(DestinationSchema).max(20) })
    .nullable()
    .optional(),
  schedule: z
    .object({
      mode: z.enum(["suggest", "fixed"]),
      weekday: z.number().int().min(0).max(6).nullable().optional(),
      time: z
        .string()
        .regex(/^\d{2}:\d{2}$/)
        .nullable()
        .optional(),
      overwrite: z.boolean().optional(),
      monthAnchor: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  hashtags: z.array(z.string().max(60)).max(30).nullable().optional(),
  firstComment: z.string().max(2200).nullable().optional(),
  sendToProduction: z.boolean().optional(),
});

export const bulkUpdateDraftsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BulkInput.parse(i))
  .handler(
    ({ data, context }): Promise<BulkApplyResult> =>
      bulkApplyToDrafts(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId,
        postIds: data.postIds,
        userId: context.userId,
        destinations: data.destinations ?? null,
        schedule: data.schedule ?? null,
        hashtags: data.hashtags ?? null,
        firstComment: data.firstComment ?? null,
        sendToProduction: data.sendToProduction ?? false,
      }),
  );
