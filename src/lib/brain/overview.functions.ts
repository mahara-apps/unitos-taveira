// ⚠️ Brain API boundary — leitura agregada para o painel de inteligência.
// Wrapper fino: nenhuma lógica no escopo do módulo.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BrainLearningDetail, BrainOverview } from "./overview.types";

const OverviewInput = z.object({
  brandId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  scope: z.enum(["global", "brand", "client"]).optional(),
  days: z.number().int().min(7).max(365).optional(),
});

export const brainOverviewFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => OverviewInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<BrainOverview> => {
    const { buildBrainOverview } = await import("./overview.server");
    return buildBrainOverview(context.supabase, {
      brandId: data.brandId ?? null,
      clientId: data.clientId ?? null,
      scope: data.scope ?? "brand",
      days: data.days ?? 30,
    });
  });

export const brainLearningDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ memoryId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<BrainLearningDetail | null> => {
    const { buildLearningDetail } = await import("./overview.server");
    return buildLearningDetail(context.supabase, data.memoryId);
  });
