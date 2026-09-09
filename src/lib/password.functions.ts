import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { needsRealName } from "@/lib/identity";

export const getMyPasswordFlag = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_profiles")
      .select("requires_password_change, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = (data ?? {}) as any;
    return {
      requiresChange: Boolean(row?.requires_password_change),
      fullName: (row?.full_name as string | null) ?? null,
      email: (row?.email as string | null) ?? null,
      /** Primeiro acesso precisa confirmar o nome completo real. */
      requiresName: needsRealName({ full_name: row?.full_name ?? null }),
    };
  });

/** Grava o nome completo confirmado no primeiro acesso. */
export const setMyFullName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        fullName: z
          .string()
          .trim()
          .min(3, "Informe seu nome completo")
          .max(120)
          .refine((v) => /\s/.test(v), "Informe nome e sobrenome"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    try {
      // O login pode existir sem `user_profiles` quando uma instalação antiga
      // engoliu a falha do trigger. Repara somente o próprio usuário autenticado.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { ensureUserProfile } = await import("@/lib/user-profile.server");
      const { data: authUser } = await context.supabase.auth.getUser();
      const updated = await ensureUserProfile(supabaseAdmin, {
        userId: context.userId,
        email: authUser.user?.email ?? null,
        fullName: data.fullName,
      });
      return {
        ok: true as const,
        id: updated.id,
        fullName: updated.full_name,
      };
    } catch (error) {
      console.error("[first-access] failed to save profile name", {
        userId: context.userId,
        error: error instanceof Error ? error.message : "unknown",
      });
      throw new Error("Não foi possível salvar seu nome. Tente novamente.");
    }
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
