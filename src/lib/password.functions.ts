import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyPasswordFlag = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_profiles")
      .select("requires_password_change")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { requiresChange: Boolean((data as any)?.requires_password_change) };
  });

export const clearMyPasswordFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("user_profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ requires_password_change: false } as any)
      .eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
