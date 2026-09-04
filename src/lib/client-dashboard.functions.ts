import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildClientDashboard } from "@/lib/client-dashboard.server";

const input = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  range: z
    .object({ from: z.string().datetime().optional(), to: z.string().datetime().optional() })
    .optional(),
});

export const clientDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => input.parse(i))
  .handler(({ data, context }) =>
    buildClientDashboard(context.supabase, data.brandId, data.clientId, data.range),
  );
