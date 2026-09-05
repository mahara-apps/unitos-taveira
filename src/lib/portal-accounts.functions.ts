import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandAdmin, assertClientInBrand } from "@/lib/access-guard";

/**
 * Contatos de acesso do Portal do Cliente (login).
 *
 * Um cliente pode ter VÁRIOS contatos: cada um recebe conta própria com senha
 * provisória e troca obrigatória no primeiro acesso (`requires_password_change`
 * + `MandatoryPasswordReset`). O contato fica FORA de `brand_members` — o único
 * vínculo é `client_members.role = 'portal_client'`, ignorado pelas policies
 * internas da agência.
 *
 * A senha provisória existe apenas no retorno da função: não é logada nem
 * persistida.
 */

const PORTAL_ROLE = "portal_client";

function randomPassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[arr[i]! % alphabet.length]!;
  return out;
}

const ClientInput = z.object({ clientId: z.string().uuid() });
const ContactInput = ClientInput.extend({ userId: z.string().uuid() });

type ClientRow = {
  id: string;
  brand_id: string;
  name: string;
  contact_email: string | null;
  contact_name: string | null;
};

type AnyClient = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

async function loadClient(supabase: unknown, clientId: string): Promise<ClientRow> {
  const { data, error } = await (supabase as AnyClient)
    .from("clients")
    .select("id, brand_id, name, contact_email, contact_name")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error((error as { message: string }).message);
  if (!data) throw new Error("client_not_found: cliente não encontrado ou sem acesso.");
  return data as ClientRow;
}

async function assertCanManage(
  supabase: unknown,
  brandId: string,
  userId: string,
  clientId?: string,
): Promise<void> {
  await assertBrandAdmin(supabase as never, userId, brandId);
  if (clientId) await assertClientInBrand(supabase as never, userId, brandId, clientId);
}

function isUsableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return z.string().email().safeParse(email.trim()).success;
}

export type PortalContact = {
  userId: string;
  email: string | null;
  fullName: string | null;
  state: "pending_password" | "active";
  lastSeenAt: string | null;
  createdAt: string | null;
};

async function listContacts(clientId: string): Promise<PortalContact[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as AnyClient;
  const { data: rows, error } = await admin
    .from("client_members")
    .select("user_id, last_seen_at, created_at")
    .eq("client_id", clientId)
    .eq("role", PORTAL_ROLE)
    .order("created_at", { ascending: true });
  if (error) throw new Error((error as { message: string }).message);
  const members = (rows ?? []) as Array<{
    user_id: string;
    last_seen_at: string | null;
    created_at: string;
  }>;
  if (!members.length) return [];

  const { data: profiles } = await admin
    .from("user_profiles")
    .select("id, full_name, requires_password_change")
    .in(
      "id",
      members.map((m) => m.user_id),
    );
  const byId = new Map(
    ((profiles ?? []) as Array<{
      id: string;
      full_name: string | null;
      requires_password_change: boolean | null;
    }>).map((p) => [p.id, p]),
  );

  const out: PortalContact[] = [];
  for (const member of members) {
    const { data: authUser } = await (
      supabaseAdmin as unknown as {
        auth: { admin: { getUserById: (id: string) => Promise<{ data: { user?: { email?: string | null } | null } }> } };
      }
    ).auth.admin.getUserById(member.user_id);
    const profile = byId.get(member.user_id);
    out.push({
      userId: member.user_id,
      email: authUser?.user?.email ?? null,
      fullName: profile?.full_name ?? null,
      state: profile?.requires_password_change ? "pending_password" : "active",
      lastSeenAt: member.last_seen_at,
      createdAt: member.created_at,
    });
  }
  return out;
}

export const listPortalContactsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientInput.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ contacts: PortalContact[]; suggestedEmail: string | null; suggestedName: string | null }> => {
      const client = await loadClient(context.supabase, data.clientId);
      await assertCanManage(context.supabase, client.brand_id, context.userId, client.id);
      return {
        contacts: await listContacts(data.clientId),
        suggestedEmail: isUsableEmail(client.contact_email) ? client.contact_email!.trim() : null,
        suggestedName: client.contact_name?.trim() || null,
      };
    },
  );

export const createPortalContactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ClientInput.extend({
      email: z.string().trim().email("E-mail inválido"),
      fullName: z.string().trim().min(1).max(160).optional(),
      /** Enviar convite por e-mail com a senha provisória. */
      sendEmail: z.boolean().optional().default(true),
    }).parse(i),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      email: string;
      tempPassword: string;
      userId: string;
      emailSent: boolean;
      emailError?: string;
    }> => {
      const { supabase, userId } = context;
      const client = await loadClient(supabase, data.clientId);
      await assertCanManage(supabase, client.brand_id, userId, client.id);

      const email = data.email.trim().toLowerCase();
      const fullName = data.fullName?.trim() || client.contact_name?.trim() || client.name;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as AnyClient;

      // Já é contato deste cliente?
      const existing = await admin
        .from("client_members")
        .select("user_id")
        .eq("client_id", data.clientId)
        .eq("role", PORTAL_ROLE);
      const existingIds = ((existing.data ?? []) as Array<{ user_id: string }>).map(
        (r) => r.user_id,
      );

      // E-mail já usado em qualquer conta do sistema (equipe ou outro cliente).
      let duplicated = false;
      for (let page = 1; page <= 20; page++) {
        const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (lErr) throw new Error(lErr.message);
        const users = list?.users ?? [];
        const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
        if (hit) {
          duplicated = true;
          if (existingIds.includes(hit.id))
            throw new Error("contact_exists: este e-mail já é um contato deste cliente.");
          break;
        }
        if (users.length < 200) break;
      }
      if (duplicated) throw new Error("user_exists: já existe conta com este e-mail no sistema.");

      const tempPassword = randomPassword(16);
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: fullName, portal_client_id: data.clientId },
      });
      if (createErr || !created?.user?.id) {
        throw new Error(`provision_failed: ${createErr?.message ?? "sem id de usuário"}`);
      }
      const newUserId = created.user.id;

      await admin
        .from("user_profiles")
        .update({ requires_password_change: true, full_name: fullName })
        .eq("id", newUserId);

      const { error: cmErr } = await admin.from("client_members").insert({
        brand_id: client.brand_id,
        client_id: data.clientId,
        user_id: newUserId,
        role: PORTAL_ROLE,
        created_by: userId,
      });
      if (cmErr) {
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        throw new Error(`link_failed: ${(cmErr as { message: string }).message}`);
      }

      let emailSent = false;
      let emailError: string | undefined;
      if (data.sendEmail) {
        const res = await sendPortalInvite(supabase, {
          brandId: client.brand_id,
          to: email,
          clientName: client.name,
          fullName,
          tempPassword,
          actorUserId: userId,
        });
        emailSent = res.sent;
        if (res.error) emailError = res.error;
      }

      return {
        email,
        tempPassword,
        userId: newUserId,
        emailSent,
        ...(emailError ? { emailError } : {}),
      };
    },
  );

export const resetPortalContactPasswordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ContactInput.extend({ sendEmail: z.boolean().optional().default(false) }).parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ email: string; tempPassword: string; emailSent: boolean }> => {
      const { supabase, userId } = context;
      const client = await loadClient(supabase, data.clientId);
      await assertCanManage(supabase, client.brand_id, userId, client.id);

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as AnyClient;
      const { data: rows } = await admin
        .from("client_members")
        .select("user_id")
        .eq("client_id", data.clientId)
        .eq("role", PORTAL_ROLE)
        .eq("user_id", data.userId);
      if (!((rows ?? []) as unknown[]).length)
        throw new Error("contact_not_found: este contato não pertence ao cliente.");

      const tempPassword = randomPassword(16);
      const { data: updated, error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
        password: tempPassword,
      });
      if (error) throw new Error(`reset_failed: ${error.message}`);

      await admin.from("user_profiles").update({ requires_password_change: true }).eq("id", data.userId);

      const email = updated?.user?.email ?? "";
      let emailSent = false;
      if (data.sendEmail && email) {
        const res = await sendPortalInvite(supabase, {
          brandId: client.brand_id,
          to: email,
          clientName: client.name,
          fullName: updated?.user?.user_metadata?.["full_name"] ?? client.name,
          tempPassword,
          actorUserId: userId,
        });
        emailSent = res.sent;
      }

      return { email, tempPassword, emailSent };
    },
  );

export const removePortalContactFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ContactInput.parse(i))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const client = await loadClient(supabase, data.clientId);
    await assertCanManage(supabase, client.brand_id, userId, client.id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as AnyClient;

    const { error } = await admin
      .from("client_members")
      .delete()
      .eq("client_id", data.clientId)
      .eq("role", PORTAL_ROLE)
      .eq("user_id", data.userId);
    if (error) throw new Error((error as { message: string }).message);

    // Sem nenhum vínculo restante a conta não serve para nada: é removida.
    const { data: left } = await admin
      .from("client_members")
      .select("id")
      .eq("user_id", data.userId);
    const { data: team } = await admin
      .from("brand_members")
      .select("id")
      .eq("user_id", data.userId);
    if (!((left ?? []) as unknown[]).length && !((team ?? []) as unknown[]).length) {
      await supabaseAdmin.auth.admin.deleteUser(data.userId);
    }
    return { ok: true };
  });

/** Convite do contato do cliente — usa o mesmo canal de e-mail da marca. */
async function sendPortalInvite(
  supabase: unknown,
  opts: {
    brandId: string;
    to: string;
    clientName: string;
    fullName: string;
    tempPassword: string;
    actorUserId: string;
  },
): Promise<{ sent: boolean; error?: string }> {
  const { tryAbsoluteUrl } = await import("@/lib/app-url.server");
  const loginUrl = (await tryAbsoluteUrl("/login")) ?? "/login";
  const html = `
    <div style="font-family:ui-sans-serif,system-ui;line-height:1.55;color:#0a0a0a">
      <h2 style="margin:0 0 12px">Seu acesso à área de ${opts.clientName}</h2>
      <p>Olá, ${opts.fullName}. Você já pode acompanhar aprovações, pauta, calendário e arquivos da marca.</p>
      <div style="margin:16px 0;padding:12px 14px;border:1px solid #e4e4e7;border-radius:10px;background:#fafafa">
        <div style="font-size:12px;color:#71717a;margin-bottom:4px">E-mail</div>
        <div style="font-size:14px;font-weight:600">${opts.to}</div>
        <div style="font-size:12px;color:#71717a;margin:10px 0 4px">Senha provisória</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:600">${opts.tempPassword}</div>
        <div style="font-size:11px;color:#a1a1aa;margin-top:8px">Você escolherá uma nova senha no primeiro acesso.</div>
      </div>
      <p><a href="${loginUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Entrar na área do cliente</a></p>
      <p style="color:#71717a;font-size:12px">Se o botão não funcionar, acesse: ${loginUrl}</p>
    </div>`;
  try {
    const { sendBrandEmail } = await import("@/lib/email/resend.server");
    const res = await sendBrandEmail(supabase as never, opts.brandId, {
      to: opts.to,
      subject: `Seu acesso à área de ${opts.clientName}`,
      html,
    });
    return { sent: res.sent, ...(res.error ? { error: res.error } : {}) };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : "email_failed" };
  }
}
