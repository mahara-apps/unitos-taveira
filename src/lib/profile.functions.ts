import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeNotificationPrefs } from "@/lib/notification-prefs";

const UpdateSchema = z.object({
  full_name: z.string().trim().min(1, "Nome obrigatório").max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  job_title: z.string().trim().max(120).optional().nullable(),
  bio: z.string().trim().max(600).optional().nullable(),
  timezone: z.string().trim().min(1).max(64),
  locale: z.string().trim().min(2).max(10),
  avatar_url: z.string().trim().url().max(500).optional().nullable(),
  whatsapp: z.string().trim().max(40).optional().nullable(),
  notify_whatsapp: z.boolean().optional(),
});

export type ProfileUpdateInput = z.infer<typeof UpdateSchema>;

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_profiles")
      .select(
        "id, full_name, role, avatar_url, phone, job_title, bio, timezone, locale, whatsapp, notify_whatsapp, notification_prefs, created_at, updated_at",
      )
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw error;
    const email = (context.claims as { email?: string } | undefined)?.email ?? null;
    return {
      id: context.userId,
      email,
      full_name: (data?.full_name ?? "") as string,
      role: (data?.role ?? "member") as string,
      avatar_url: (data?.avatar_url ?? null) as string | null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      phone: ((data as any)?.phone ?? null) as string | null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      job_title: ((data as any)?.job_title ?? null) as string | null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bio: ((data as any)?.bio ?? null) as string | null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      timezone: ((data as any)?.timezone ?? "America/Sao_Paulo") as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      locale: ((data as any)?.locale ?? "pt-BR") as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      whatsapp: ((data as any)?.whatsapp ?? null) as string | null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      notify_whatsapp: Boolean((data as any)?.notify_whatsapp ?? false),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      notification_prefs: normalizeNotificationPrefs((data as any)?.notification_prefs) as Record<
        string,
        boolean
      >,
    };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const payload = {
      full_name: data.full_name,
      phone: data.phone ?? null,
      job_title: data.job_title ?? null,
      bio: data.bio ?? null,
      timezone: data.timezone,
      locale: data.locale,
      avatar_url: data.avatar_url ?? null,
      whatsapp: data.whatsapp ?? null,
      // `notify_whatsapp` é preferência de notificação: fonte única em
      // /settings/notifications. Só é gravado aqui se explicitamente enviado.
      ...(typeof data.notify_whatsapp === "boolean"
        ? { notify_whatsapp: data.notify_whatsapp }
        : {}),
    };
    const { error } = await context.supabase
      .from("user_profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update(payload as any)
      .eq("id", context.userId);
    if (error) throw error;
    // Keep auth.user_metadata in sync so UI reading `user_metadata.full_name`
    // (sidebar, cards, etc.) reflects updates immediately after next getUser().
    await context.supabase.auth.updateUser({
      data: {
        full_name: data.full_name,
        name: data.full_name,
        avatar_url: data.avatar_url ?? null,
        phone: data.phone ?? null,
        job_title: data.job_title ?? null,
      },
    });
    return { ok: true };
  });

const PasswordSchema = z.object({
  newPassword: z.string().min(8, "Mínimo 8 caracteres").max(72),
});

export const changeMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PasswordSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.auth.updateUser({ password: data.newPassword });
    if (error) throw error;
    await context.supabase
      .from("user_profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ requires_password_change: false } as any)
      .eq("id", context.userId);
    return { ok: true };
  });

/* ----------------------- Notification preferences ----------------------- */

/**
 * Só existem preferências para eventos com emissor real; a fonte única do
 * mapa kind → preferência é `src/lib/notification-prefs.ts` (espelhada em SQL
 * por `public.notification_prefs_allows`).
 */
const NotificationPrefsSchema = z.object({
  comments: z.boolean(),
  assignments: z.boolean(),
  approvals: z.boolean(),
  deadlines: z.boolean(),
  ai_jobs: z.boolean(),
});

export type NotificationPrefs = z.infer<typeof NotificationPrefsSchema>;

export const updateNotificationPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ prefs: NotificationPrefsSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("user_profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ notification_prefs: data.prefs } as any)
      .eq("id", context.userId);
    if (error) throw error;
    return { ok: true };
  });
