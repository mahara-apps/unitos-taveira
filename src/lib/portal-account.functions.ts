import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveSessionScope } from "@/lib/portal-scope.server";

/**
 * "Minha conta" do contato do portal: nome, foto, e-mail, senha e preferências
 * de aviso por cliente.
 *
 * Tudo é escopado ao próprio usuário autenticado (`context.userId`) e, no caso
 * das preferências, ao cliente ao qual ele está vinculado (`resolveSessionScope`
 * recusa cliente sem vínculo). Nenhum campo aceita id de outro usuário.
 */

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;

type AnyClient = { from: (table: string) => any };

export type PortalAccount = {
  userId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  requiresPasswordChange: boolean;
};

export type PortalNotificationPrefs = {
  emailEnabled: boolean;
  dailyDigest: boolean;
  kinds: { approvals: boolean; deadlines: boolean; requests: boolean; comments: boolean };
};

const DEFAULT_PREFS: PortalNotificationPrefs = {
  emailEnabled: true,
  dailyDigest: false,
  kinds: { approvals: true, deadlines: true, requests: true, comments: true },
};

const KindsIn = z.object({
  approvals: z.boolean(),
  deadlines: z.boolean(),
  requests: z.boolean(),
  comments: z.boolean(),
});

function normalizeKinds(raw: unknown): PortalNotificationPrefs["kinds"] {
  const parsed = KindsIn.partial().safeParse(raw ?? {});
  return { ...DEFAULT_PREFS.kinds, ...(parsed.success ? parsed.data : {}) };
}

export const getPortalAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PortalAccount> => {
    const { data } = await (context.supabase as AnyClient)
      .from("user_profiles")
      .select("full_name, avatar_url, phone, requires_password_change")
      .eq("id", context.userId)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    const email =
      (context.claims as { email?: string | null } | undefined)?.email ??
      null;
    return {
      userId: context.userId,
      email,
      fullName: (row["full_name"] as string | null) ?? null,
      avatarUrl: (row["avatar_url"] as string | null) ?? null,
      phone: (row["phone"] as string | null) ?? null,
      requiresPasswordChange: Boolean(row["requires_password_change"]),
    };
  });

export const updatePortalAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        fullName: z.string().trim().min(2, "Informe seu nome").max(160).optional(),
        phone: z.string().trim().max(40).nullish(),
        avatar: z
          .object({
            name: z.string().trim().min(1).max(180),
            mime: z.string().trim().max(160).nullish(),
            dataBase64: z.string().min(1),
          })
          .nullish(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; avatarUrl: string | null }> => {
    const patch: Record<string, unknown> = {};
    if (data.fullName !== undefined) patch["full_name"] = data.fullName;
    if (data.phone !== undefined) patch["phone"] = data.phone?.trim() || null;

    let avatarUrl: string | null = null;
    if (data.avatar) {
      const raw = data.avatar.dataBase64;
      const payload =
        raw.includes(",") && raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      if (bytes.byteLength > MAX_AVATAR_BYTES) throw new Error("avatar_too_large");

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const path = `${context.userId}/${Date.now()}-${data.avatar.name.replace(/[^\w.-]+/g, "_").slice(-80)}`;
      const up = await supabaseAdmin.storage
        .from("avatars")
        .upload(path, bytes, {
          contentType: data.avatar.mime ?? "image/jpeg",
          upsert: true,
        });
      if (up.error) throw new Error(up.error.message);
      const signed = await supabaseAdmin.storage
        .from("avatars")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      avatarUrl = signed.data?.signedUrl ?? null;
      if (avatarUrl) patch["avatar_url"] = avatarUrl;
    }

    if (Object.keys(patch).length) {
      const { error } = await (context.supabase as AnyClient)
        .from("user_profiles")
        .update(patch)
        .eq("id", context.userId);
      if (error) throw new Error((error as { message: string }).message);
    }
    return { ok: true, avatarUrl };
  });

export const changePortalPasswordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        password: z
          .string()
          .min(8, "Use pelo menos 8 caracteres")
          .max(72)
          .regex(/[A-Za-z]/, "Inclua ao menos uma letra")
          .regex(/[0-9]/, "Inclua ao menos um número"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    await (context.supabase as AnyClient)
      .from("user_profiles")
      .update({ requires_password_change: false })
      .eq("id", context.userId);
    return { ok: true };
  });

export const changePortalEmailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ email: z.string().trim().email("E-mail inválido").max(255) }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; email: string }> => {
    const email = data.email.trim().toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true, email };
  });

export const getPortalPrefsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ clientId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<PortalNotificationPrefs> => {
    const scope = await resolveSessionScope(context.supabase, data.clientId);
    const { data: row } = await (context.supabase as AnyClient)
      .from("portal_notification_prefs")
      .select("email_enabled, daily_digest, kinds")
      .eq("client_id", scope.clientId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!row) return DEFAULT_PREFS;
    const r = row as Record<string, unknown>;
    return {
      emailEnabled: r["email_enabled"] !== false,
      dailyDigest: Boolean(r["daily_digest"]),
      kinds: normalizeKinds(r["kinds"]),
    };
  });

export const savePortalPrefsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        emailEnabled: z.boolean(),
        dailyDigest: z.boolean(),
        kinds: KindsIn,
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const scope = await resolveSessionScope(context.supabase, data.clientId);
    const { error } = await (context.supabase as AnyClient)
      .from("portal_notification_prefs")
      .upsert(
        {
          client_id: scope.clientId,
          user_id: context.userId,
          email_enabled: data.emailEnabled,
          daily_digest: data.dailyDigest,
          kinds: data.kinds,
        },
        { onConflict: "client_id,user_id" },
      );
    if (error) throw new Error((error as { message: string }).message);
    return { ok: true };
  });
