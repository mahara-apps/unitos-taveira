import { createServerFn } from "@tanstack/react-start";
import type { SupabaseLike } from "@/lib/email/resend-types";
import { z } from "zod";
import { callRpc } from "@/lib/supabase-rpc";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ALL_PERMISSION_IDS, normalizePermissions, type PermissionId } from "@/lib/permissions";
import { normalizeModulePermissions } from "@/lib/module-permissions";
import {
  assertBrandAdmin,
  assertCanGrantBrandRole,
  assertCanManageBrandMember,
  resolveAuthorityRole,
} from "@/lib/access-guard";

const ROLES = ["owner", "admin", "manager", "user", "client"] as const;
/**
 * Papéis atribuíveis a membros internos (Portal usa `client`).
 * A autoridade real é da matriz canônica do banco (`can_invite_brand_role`):
 * OWNER só pode ser concedido por SUPER ADMIN.
 */
const ASSIGNABLE = ["owner", "admin", "manager", "user"] as const;

const BrandIdInput = z.object({ brandId: z.string().uuid() });

export const listBrandTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [membersRes, invitesRes, clientsRes] = await Promise.all([
      supabase
        .from("brand_members")
        .select("brand_id, user_id, role, permissions, created_at, access_profile_id, module_permissions")
        .eq("brand_id", data.brandId),
      supabase
        .from("brand_invites")
        .select(
          "id, email, role, permissions, token, invited_by, accepted_at, expires_at, created_at, revoked_at, temp_password_sent",
        )
        .eq("brand_id", data.brandId)
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("id, name").eq("brand_id", data.brandId),
    ]);
    if (membersRes.error) throw membersRes.error;
    if (invitesRes.error) throw invitesRes.error;
    if (clientsRes.error) throw clientsRes.error;

    const clients = clientsRes.data ?? [];
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));
    let portalTokens: Array<{
      id: string;
      token: string;
      label: string | null;
      client_id: string;
      client_name: string;
      expires_at: string | null;
      revoked_at: string | null;
      last_seen_at: string | null;
      created_at: string;
    }> = [];
    if (clients.length > 0) {
      const { data: tokens, error: tErr } = await supabase
        .from("portal_tokens")
        .select("id, token, label, client_id, expires_at, revoked_at, last_seen_at, created_at")
        .in(
          "client_id",
          clients.map((c) => c.id),
        )
        .order("created_at", { ascending: false });
      if (tErr) throw tErr;
      portalTokens = (tokens ?? []).map((t) => ({
        ...t,
        client_name: clientMap.get(t.client_id) ?? "—",
      }));
    }

    const members = membersRes.data ?? [];
    const userIds = members.map((m) => m.user_id);
    let profiles: Array<{
      id: string;
      full_name: string | null;
      email: string | null;
      avatar_url: string | null;
    }> = [];
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from("user_profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", userIds);
      profiles = (profs ?? []) as typeof profiles;
    }
    return {
      members: members.map((m) => {
        const p = profiles.find((x) => x.id === m.user_id);
        return {
          user_id: m.user_id,
          role: m.role as (typeof ROLES)[number],
          permissions: normalizePermissions(m.permissions),
          access_profile_id: m.access_profile_id ?? null,
          module_permissions: normalizeModulePermissions(m.module_permissions),
          created_at: m.created_at,
          full_name: p?.full_name ?? null,
          email: p?.email ?? null,
          avatar_url: p?.avatar_url ?? null,
        };
      }),
      invites: ((invitesRes.data ?? []) as Array<Record<string, unknown>>).map((i) => ({
        ...i,
        permissions: normalizePermissions(i.permissions as never),
      })) as Array<{
        id: string;
        email: string;
        role: string;
        permissions: PermissionId[];
        token: string;
        invited_by: string | null;
        accepted_at: string | null;
        expires_at: string;
        created_at: string;
        revoked_at: string | null;
        temp_password_sent: boolean;
      }>,
      portalTokens,
    };
  });

const InviteInput = z.object({
  brandId: z.string().uuid(),
  emails: z.array(z.string().trim().toLowerCase().email()).min(1).max(20),
  role: z.enum(ASSIGNABLE).default("user"),
  permissions: z.array(z.enum(ALL_PERMISSION_IDS as [PermissionId, ...PermissionId[]])).default([]),
  expiresAt: z.string().datetime().optional(),
  /** Perfil de acesso aplicado quando o convite for aceito. */
  accessProfileId: z.string().uuid().nullable().optional(),
});

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomPassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

async function sendInviteEmail(opts: {
  supabase: SupabaseLike;
  brandId: string;
  to: string;
  brandName: string;
  inviterName: string;
  acceptUrl: string;
  tempPassword?: string;
  inviteRole?: string;
  actorUserId?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  // 1) Caminho canônico: template `team_invite` (da marca ou default do catálogo)
  //    renderizado com contexto REAL. A senha temporária vem só do evento atual.
  const { sendEventEmail } = await import("@/lib/message-templates/dispatch.server");
  const viaTemplate = await sendEventEmail(opts.supabase as never, {
    eventKey: "team_invite",
    to: opts.to,
    actorUserId: opts.actorUserId ?? null,
    context: {
      brandId: opts.brandId,
      user: { fullName: opts.inviterName, email: opts.to, role: opts.inviteRole ?? null },
      invite: {
        url: opts.acceptUrl,
        role: opts.inviteRole ?? null,
        ...(opts.tempPassword ? { password: opts.tempPassword } : {}),
      },
    },
  });
  if (viaTemplate.sent) return { sent: true };

  // 2) Fallback: template exige variável que este convite não possui (ex.: convite
  //    sem senha temporária). Mantém o envio funcionando com o layout mínimo.
  const credsBlock = opts.tempPassword
    ? `
      <div style="margin:16px 0;padding:12px 14px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa">
        <div style="font-size:12px;color:#71717a;margin-bottom:4px">Senha temporária</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:600;color:#0a0a0a">${opts.tempPassword}</div>
        <div style="font-size:11px;color:#a1a1aa;margin-top:8px">Você precisará escolher uma nova senha no primeiro acesso.</div>
      </div>`
    : "";
  const html = `
    <div style="font-family:ui-sans-serif,system-ui;line-height:1.5;color:#0a0a0a">
      <h2 style="margin:0 0 12px">Convite para ${opts.brandName}</h2>
      <p>${opts.inviterName} convidou você para colaborar na marca <strong>${opts.brandName}</strong> no Unitos.</p>
      ${credsBlock}
      <p><a href="${opts.acceptUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Aceitar convite</a></p>
      <p style="color:#71717a;font-size:12px">Se o botão não funcionar, copie o link: ${opts.acceptUrl}</p>
    </div>`;
  const { sendBrandEmail } = await import("@/lib/email/resend.server");
  const res = await sendBrandEmail(opts.supabase, opts.brandId, {
    to: opts.to,
    subject: `Convite para ${opts.brandName}`,
    html,
  });
  if (!res.sent) console.error(`[invite email] não enviado: ${res.error ?? viaTemplate.error}`);
  return { sent: res.sent, ...(res.error ? { error: res.error } : {}) };
}


export const inviteBrandMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InviteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Authorize: caller must be owner or manager of the brand
    // Autorização canônica: super_admin, ADMIN (owner) ou MANAGER do workspace.
    // `user_profiles.role='admin'` não concede autoridade global.
    try {
      await assertBrandAdmin(supabase, userId, data.brandId);
    } catch {
      throw new Error("forbidden");
    }

    const { data: brand } = await supabase
      .from("brands")
      .select("name, nome_fantasia")
      .eq("id", data.brandId)
      .single();
    const { data: inviterProfile } = await supabase
      .from("user_profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const inviterName = inviterProfile?.full_name || "Alguém do time";
    // Nome da agência SEMPRE da marca do convite (nunca placeholder/sample).
    const brandName = (brand?.nome_fantasia || brand?.name || "").trim();
    if (!brandName) throw new Error("brand_sem_nome");

    // Perfil de acesso do convite: validado contra o workspace, gravado por
    // `key` para ser reaplicado quando o convite for aceito.
    let inviteProfileKey: string | null = null;
    if (data.accessProfileId) {
      const { data: prof, error: pErr } = await supabase
        .from("access_profiles")
        .select("key")
        .eq("id", data.accessProfileId)
        .eq("brand_id", data.brandId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!prof) throw new Error("invalid_access_profile");
      inviteProfileKey = prof.key;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const results: Array<{
      email: string;
      status: "invited" | "linked" | "already_member" | "error";
      link?: string;
      error?: string;
      emailSent?: boolean;
      provisioned?: boolean;
    }> = [];

    for (const email of data.emails) {
      const token = randomToken();

      // 1. Check if an auth user already exists for this email; if not, provision one
      //    with a random temporary password and force a password change on first login.
      let provisioned = false;
      let tempPassword: string | undefined;
      try {
        const { data: existing } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        const alreadyExists = existing?.users?.some((u) => (u.email ?? "").toLowerCase() === email);
        if (!alreadyExists) {
          tempPassword = randomPassword(16);
          const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
            // Sem nome inventado: a pessoa confirma o nome real no primeiro acesso.
          });
          if (createErr) {
            results.push({ email, status: "error", error: `provision_${createErr.message}` });
            continue;
          }
          if (created?.user?.id) {
            // Force password change on first login
            await supabaseAdmin
              .from("user_profiles")
              .update({ requires_password_change: true })
              .eq("id", created.user.id);
            provisioned = true;
          }
        }
      } catch (e) {
        console.error("[invite provision] failed", e);
      }

      const insertPayload = {
        brand_id: data.brandId,
        ...(inviteProfileKey ? { access_profile_key: inviteProfileKey } : {}),
        email,
        role: data.role,
        permissions: data.permissions,
        token,
        invited_by: userId,
        temp_password_sent: provisioned,
        ...(data.expiresAt ? { expires_at: data.expiresAt } : {}),
      };
      const { error: inviteErr } = await supabase.from("brand_invites").insert(insertPayload);
      if (inviteErr) {
        console.error("[brand_invites] insert failed", { email, error: inviteErr });
        results.push({ email, status: "error", error: inviteErr.message });
        continue;
      }
      // URL canônica da instalação ATUAL (host da requisição) — nunca link relativo
      // nem domínio herdado de env de outra instalação.
      const { tryInstallationAbsoluteUrl } = await import("@/lib/installation-url.server");
      const link = await tryInstallationAbsoluteUrl(supabase, data.brandId, `/invite/${token}`);
      if (!link) {
        console.error(
          "[invite email] URL da instalação do workspace desconhecida; convite não enviado",
        );
      }
      const emailRes = link
        ? await sendInviteEmail({
            supabase: supabase as unknown as SupabaseLike,
            brandId: data.brandId,
            to: email,
            brandName,
            inviterName,
            acceptUrl: link,
            ...(tempPassword ? { tempPassword } : {}),
            inviteRole: data.role,
            actorUserId: userId,
          })
        : { sent: false, error: "instalacao_url_desconhecida" };

      results.push({
        email,
        status: "invited",
        link: link ?? undefined,

        emailSent: emailRes.sent,
        error: emailRes.error,
        provisioned,
      });
    }

    return { results };
  });

const UpdateMemberInput = z.object({
  brandId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(ASSIGNABLE).optional(),
  permissions: z.array(z.enum(ALL_PERMISSION_IDS as [PermissionId, ...PermissionId[]])).optional(),
});

export const updateBrandMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    // Autorização explícita no servidor (não confiar na UI nem só na RLS).
    await assertBrandAdmin(context.supabase, context.userId, data.brandId);
    // Matriz canônica única (owner ≠ admin): valida papel do ator, papel atual
    // do alvo e papel pretendido. Somente SUPER ADMIN concede/altera OWNER.
    await assertCanManageBrandMember(
      context.supabase,
      context.userId,
      data.brandId,
      data.userId,
      data.role ?? null,
    );
    const patch: { role?: (typeof ROLES)[number]; permissions?: PermissionId[] } = {};
    if (data.role) patch.role = data.role;
    if (data.permissions) patch.permissions = data.permissions;
    const { error } = await context.supabase
      .from("brand_members")
      .update(patch)
      .eq("brand_id", data.brandId)
      .eq("user_id", data.userId);
    if (error) throw error;
    return { ok: true };
  });

const RemoveMemberInput = z.object({ brandId: z.string().uuid(), userId: z.string().uuid() });
export const removeBrandMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveMemberInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertBrandAdmin(context.supabase, context.userId, data.brandId);
    await assertCanManageBrandMember(
      context.supabase,
      context.userId,
      data.brandId,
      data.userId,
    );
    const { error } = await context.supabase
      .from("brand_members")
      .delete()
      .eq("brand_id", data.brandId)
      .eq("user_id", data.userId);
    if (error) throw error;
    return { ok: true };
  });

const RevokeInviteInput = z.object({ brandId: z.string().uuid(), inviteId: z.string().uuid() });
export const revokeBrandInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RevokeInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("brand_invites")
      .update({ revoked_at: new Date().toISOString(), revoked_by: context.userId })
      .eq("id", data.inviteId)
      .eq("brand_id", data.brandId)
      .is("accepted_at", null);
    if (error) throw error;
    return { ok: true };
  });

const RevokePortalInput = z.object({ brandId: z.string().uuid(), tokenId: z.string().uuid() });
/**
 * @deprecated Fase 2 — use `revokePortalTokenFn` (src/lib/customer-dashboard.functions.ts),
 * que opera por cliente e cobre os modos `revoke` / `revokeAndCreate`.
 * Mantida apenas por compatibilidade; nenhuma tela do app a utiliza.
 */
export const revokePortalTokenFromTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RevokePortalInput.parse(input))
  .handler(async ({ data, context }) => {
    // Ensure the token belongs to a client of this brand
    const { data: token, error: tErr } = await context.supabase
      .from("portal_tokens")
      .select("id, client_id, clients:clients(brand_id)")
      .eq("id", data.tokenId)
      .maybeSingle();
    if (tErr) throw tErr;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brandOfToken = (token as any)?.clients?.brand_id;
    if (!token || brandOfToken !== data.brandId) throw new Error("forbidden");
    const { error } = await context.supabase
      .from("portal_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.tokenId);
    if (error) throw error;
    return { ok: true };
  });

const AcceptInput = z.object({ token: z.string().min(10) });
export const acceptBrandInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AcceptInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: brandId, error } = await context.supabase.rpc("accept_brand_invite", {
      _token: data.token,
    });
    if (error) throw error;

    // Aplica o perfil de acesso escolhido no convite (permissões por módulo).
    // Best-effort: nunca impede a entrada do usuário no workspace.
    if (typeof brandId === "string" && brandId) {
      try {
        const { data: invite } = await context.supabase
          .from("brand_invites")
          .select("access_profile_key")
          .eq("token", data.token)
          .maybeSingle();
        const key = invite?.access_profile_key ?? null;
        if (key) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: prof } = await supabaseAdmin
            .from("access_profiles")
            .select("id")
            .eq("brand_id", brandId)
            .eq("key", key)
            .maybeSingle();
          if (prof?.id) {
            await supabaseAdmin
              .from("brand_members")
              .update({ access_profile_id: prof.id })
              .eq("brand_id", brandId)
              .eq("user_id", context.userId);
          }
        }
      } catch (e) {
        console.error("[accept invite] perfil de acesso não aplicado", e);
      }
    }
    return { brandId };
  });

const AddExistingInput = z.object({
  brandId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ASSIGNABLE).default("user"),
  permissions: z.array(z.enum(ALL_PERMISSION_IDS as [PermissionId, ...PermissionId[]])).default([]),
});

// ============================================================================
// Provisionamento manual de usuários com senha temporária e escopo por projeto
// ============================================================================

const AssignmentInput = z.object({
  brandId: z.string().uuid(),
  role: z.enum(ASSIGNABLE).default("user"),
  permissions: z.array(z.enum(ALL_PERMISSION_IDS as [PermissionId, ...PermissionId[]])).default([]),
  clientIds: z.array(z.string().uuid()).default([]),
});

const ProvisionUserInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(1).max(120),
  assignments: z.array(AssignmentInput).min(1).max(20),
  sendEmail: z.boolean().default(true),
});

async function sendCredentialsEmail(opts: {
  supabase: SupabaseLike;
  brandId: string;
  to: string;
  fullName: string;
  tempPassword: string;
  loginUrl: string;
  workspaces: Array<{ name: string; clients: string[] }>;
}): Promise<{ sent: boolean; error?: string }> {
  const workspacesHtml = opts.workspaces
    .map(
      (w) => `
      <div style="margin-bottom:8px">
        <div style="font-size:13px;font-weight:600;color:#0a0a0a">${w.name}</div>
        <div style="font-size:12px;color:#71717a">${
          w.clients.length === 0 ? "Todos os projetos" : `Projetos: ${w.clients.join(", ")}`
        }</div>
      </div>`,
    )
    .join("");
  const html = `
    <div style="font-family:ui-sans-serif,system-ui;line-height:1.5;color:#0a0a0a">
      <h2 style="margin:0 0 12px">Sua conta no Unitos está pronta</h2>
      <p>Olá ${opts.fullName || opts.to}, uma conta foi criada para você no Unitos.</p>
      <div style="margin:16px 0;padding:12px 14px;border:1px solid #e4e4e7;border-radius:8px;background:#fafafa">
        <div style="font-size:12px;color:#71717a;margin-bottom:4px">E-mail</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:600;color:#0a0a0a">${opts.to}</div>
        <div style="font-size:12px;color:#71717a;margin:10px 0 4px">Senha temporária</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:600;color:#0a0a0a">${opts.tempPassword}</div>
        <div style="font-size:11px;color:#a1a1aa;margin-top:8px">Você será solicitado a definir uma nova senha no primeiro acesso.</div>
      </div>
      <div style="margin:16px 0">
        <div style="font-size:12px;color:#71717a;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em">Acessos liberados</div>
        ${workspacesHtml}
      </div>
      <p><a href="${opts.loginUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Acessar Unitos</a></p>
      <p style="color:#71717a;font-size:12px">Este e-mail é apenas informativo — o acesso já está ativo, você pode entrar imediatamente.</p>
    </div>`;
  const { sendBrandEmail } = await import("@/lib/email/resend.server");
  const res = await sendBrandEmail(opts.supabase, opts.brandId, {
    to: opts.to,
    subject: "Sua conta no Unitos está pronta",
    html,
  });
  if (!res.sent) console.error(`[credentials email] não enviado: ${res.error}`);
  return { sent: res.sent, ...(res.error ? { error: res.error } : {}) };
}

export const provisionUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProvisionUserInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Autorização: autoridade admin em TODAS as marcas alvo (super_admin e
    // ADMIN e MANAGER passam via app_access_role no workspace).
    const brandIds = Array.from(new Set(data.assignments.map((a) => a.brandId)));
    for (const brandId of brandIds) {
      try {
        await assertBrandAdmin(supabase, userId, brandId);
      } catch {
        throw new Error(
          "forbidden: você precisa ser administrador ou gerente de todos os workspaces selecionados",
        );
      }
    }

    // V1 — Autoridade canônica do papel concedido (can_invite_brand_role).
    // Vale para TODAS as marcas alvo e roda ANTES de qualquer uso de service role.
    for (const a of data.assignments) {
      await assertCanGrantBrandRole(supabase, userId, a.brandId, a.role, data.email);
    }

    // Validar clientIds pertencem à marca correta
    const allClientIds = data.assignments.flatMap((a) => a.clientIds);
    if (allClientIds.length > 0) {
      const { data: clientRows, error: cErr } = await supabase
        .from("clients")
        .select("id, brand_id, name")
        .in("id", allClientIds);
      if (cErr) throw cErr;
      const clientBrand = new Map((clientRows ?? []).map((c) => [c.id, c.brand_id]));
      for (const a of data.assignments) {
        for (const cid of a.clientIds) {
          if (clientBrand.get(cid) !== a.brandId) {
            throw new Error(
              `invalid_client: projeto ${cid} não pertence ao workspace ${a.brandId}`,
            );
          }
        }
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Verifica se já existe usuário com esse e-mail
    const email = data.email;
    let existingId: string | null = null;
    for (let page = 1; page <= 20 && !existingId; page++) {
      const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (lErr) throw lErr;
      const users = list?.users ?? [];
      const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (hit) existingId = hit.id;
      if (users.length < 200) break;
    }
    if (existingId) {
      throw new Error("user_exists: já existe conta com este e-mail. Use 'Adicionar existente'.");
    }

    const tempPassword = randomPassword(16);
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (createErr || !created?.user?.id) {
      throw new Error(`provision_failed: ${createErr?.message ?? "sem id de usuário"}`);
    }
    const newUserId = created.user.id;

    // Marca reset obrigatório + garante nome no perfil
    await supabaseAdmin
      .from("user_profiles")
      .update({ requires_password_change: true, full_name: data.fullName } as never)
      .eq("id", newUserId);

    // Atribui workspaces e projetos
    const workspaceInfo: Array<{ name: string; clients: string[] }> = [];
    for (const assignment of data.assignments) {
      const { error: bmErr } = await supabaseAdmin.from("brand_members").upsert(
        {
          brand_id: assignment.brandId,
          user_id: newUserId,
          role: assignment.role,
          permissions: assignment.permissions,
        },
        { onConflict: "brand_id,user_id" },
      );
      if (bmErr) throw bmErr;

      if (assignment.clientIds.length > 0) {
        const rows = assignment.clientIds.map((cid) => ({
          brand_id: assignment.brandId,
          client_id: cid,
          user_id: newUserId,
          role: assignment.role,
          created_by: userId,
        }));
        const { error: cmErr } = await (
          supabaseAdmin.from as never as (t: string) => {
            upsert: (v: unknown, o: { onConflict: string }) => Promise<{ error: unknown }>;
          }
        )("client_members").upsert(rows, { onConflict: "client_id,user_id" });
        if (cmErr) throw cmErr as Error;
      }

      const { data: brand } = await supabase
        .from("brands")
        .select("name")
        .eq("id", assignment.brandId)
        .maybeSingle();
      let clientNames: string[] = [];
      if (assignment.clientIds.length > 0) {
        const { data: cRows } = await supabase
          .from("clients")
          .select("id, name")
          .in("id", assignment.clientIds);
        clientNames = (cRows ?? []).map((c) => c.name as string);
      }
      workspaceInfo.push({ name: brand?.name ?? "Workspace", clients: clientNames });
    }

    let emailStatus: { sent: boolean; error?: string } = { sent: false, error: "skipped" };
    if (data.sendEmail) {
      const { tryInstallationAbsoluteUrl } = await import("@/lib/installation-url.server");
      const loginUrl = await tryInstallationAbsoluteUrl(
        supabase,
        data.assignments[0]!.brandId,
        "/auth",
      );

      // Sem URL da instalação não existe link válido: falha explícita em vez
      // de enviar um e-mail com link vazio ou de outra instalação.
      emailStatus = loginUrl
        ? await sendCredentialsEmail({
            supabase: supabase as unknown as SupabaseLike,
            brandId: data.assignments[0]!.brandId,
            to: email,
            fullName: data.fullName,
            tempPassword,
            loginUrl,
            workspaces: workspaceInfo,
          })
        : { sent: false, error: "instalacao_url_desconhecida" };
    }

    return {
      userId: newUserId,
      email,
      tempPassword,
      emailStatus,
    };
  });

// Lista workspaces onde o usuário atual pode provisionar novos usuários
export const listProvisionableBrands = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: adminFlag } = await supabase
      .from("user_profiles")
      .select("is_super_admin")
      .eq("id", userId)
      .maybeSingle();
    const isSuper = Boolean((adminFlag as { is_super_admin?: boolean } | null)?.is_super_admin);
    // Somente SUPER ADMIN é autoridade de plataforma. ADMIN provisiona apenas
    // nos workspaces em que é membro (`user_profiles.role='admin'` não escala).
    const globalRole = await resolveAuthorityRole(supabase, userId, null);
    const isGlobalAuthority = isSuper || globalRole === "super_admin";

    let brandsQuery = supabase.from("brands").select("id, name").order("name");
    if (!isGlobalAuthority) {
      const { data: memberships, error: mErr } = await supabase
        .from("brand_members")
        .select("brand_id, role")
        .eq("user_id", userId)
        .eq("is_active", true)
        .in("role", ["owner", "admin", "manager"]);
      if (mErr) throw mErr;

      const ids = (memberships ?? []).map((m) => m.brand_id);
      if (ids.length === 0)
        return {
          brands: [] as Array<{
            id: string;
            name: string;
            clients: Array<{ id: string; name: string }>;
          }>,
          isSuperAdmin: false,
        };
      brandsQuery = brandsQuery.in("id", ids);
    }
    const { data: brands, error: bErr } = await brandsQuery;
    if (bErr) throw bErr;
    const brandIds = (brands ?? []).map((b) => b.id);
    const { data: clients } = brandIds.length
      ? await supabase
          .from("clients")
          .select("id, name, brand_id")
          .in("brand_id", brandIds)
          .order("name")
      : { data: [] };
    const clientsByBrand = new Map<string, Array<{ id: string; name: string }>>();
    for (const c of clients ?? []) {
      const arr = clientsByBrand.get(c.brand_id) ?? [];
      arr.push({ id: c.id, name: c.name as string });
      clientsByBrand.set(c.brand_id, arr);
    }
    return {
      isSuperAdmin: isSuper,
      brands: (brands ?? []).map((b) => ({
        id: b.id,
        name: b.name as string,
        clients: clientsByBrand.get(b.id) ?? [],
      })),
    };
  });

/**
 * Erros do RPC `link_existing_user_to_brand` chegam como mensagens do Postgres.
 * Traduzimos para causas reais e compreensíveis — sem fallback silencioso.
 */
function mapLinkError(message: string): string {
  if (/not_authenticated/.test(message)) return "Sessão expirada. Entre novamente.";
  if (/forbidden/.test(message)) return "Apenas Admin, Manager ou Super Admin podem vincular contas.";
  if (/role_authority_invalid/.test(message))
    return "Seu papel não permite conceder esse papel nesta marca.";
  if (/self_promotion_blocked/.test(message))
    return "Não é possível alterar o seu próprio papel.";
  return message;
}

export const addExistingUserToBrand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddExistingInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Autorização canônica (super_admin, owner/ADMIN, manager do workspace).
    try {
      await assertBrandAdmin(supabase, userId, data.brandId);
    } catch {
      throw new Error("forbidden");
    }

    type LinkExistingUserRow = {
      status: "added" | "updated" | "already_member" | "not_found";
      email: string;
      user_id: string | null;
      full_name: string | null;
    };

    const { data: linkedRows, error: linkErr } = await callRpc<
      LinkExistingUserRow[] | LinkExistingUserRow | null
    >(supabase, "link_existing_user_to_brand", {
      _brand_id: data.brandId,
      _email: data.email,
      _role: data.role,
      _permissions: data.permissions,
    });
    if (linkErr) throw new Error(mapLinkError(linkErr.message));

    const linked = Array.isArray(linkedRows) ? linkedRows[0] : linkedRows;
    if (!linked || linked.status === "not_found") {
      return { status: "not_found" as const, email: data.email };
    }

    return {
      status: linked.status,
      email: linked.email,
      userId: linked.user_id,
      fullName: linked.full_name,
    };
  });

const PreviewInput = z.object({ token: z.string().min(10) });
export const previewInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PreviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: invite } = await context.supabase
      .from("brand_invites")
      .select("email, role, permissions, accepted_at, expires_at, brand_id")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite)
      return { invite: null, brand: null as null | { name: string; color: string | null } };
    const { data: brand } = await context.supabase
      .from("brands")
      .select("name, color")
      .eq("id", invite.brand_id)
      .maybeSingle();
    return {
      invite: { ...invite, permissions: normalizePermissions(invite.permissions) },
      brand: brand ?? null,
    };
  });

// ============================================================================
// Fluxo unificado: adicionar pessoa (vincula se existe, provisiona se não)
// ============================================================================

const AddPersonInput = z.object({
  brandId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().max(120).optional().default(""),
  role: z.enum(ASSIGNABLE).default("user"),
  permissions: z.array(z.enum(ALL_PERMISSION_IDS as [PermissionId, ...PermissionId[]])).default([]),
  clientIds: z.array(z.string().uuid()).default([]),
  sendEmail: z.boolean().default(true),
  /** Perfil de acesso (permissões por módulo) aplicado ao membro. */
  accessProfileId: z.string().uuid().nullable().optional(),
});

export const addPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AddPersonInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Autorização canônica: super_admin, owner/ADMIN ou manager do workspace.
    try {
      await assertBrandAdmin(supabase, userId, data.brandId);
    } catch {
      throw new Error("forbidden: apenas administradores e gerentes podem adicionar pessoas");
    }

    // V1 — Autoridade canônica do papel concedido (can_invite_brand_role).
    // Executa ANTES de qualquer operação com service role; não confia no client.
    await assertCanGrantBrandRole(supabase, userId, data.brandId, data.role, data.email);

    // Validar clientIds pertencem à marca
    if (data.clientIds.length > 0) {
      const { data: cRows, error: cErr } = await supabase
        .from("clients")
        .select("id, brand_id")
        .in("id", data.clientIds);
      if (cErr) throw cErr;
      for (const c of cRows ?? []) {
        if (c.brand_id !== data.brandId) {
          throw new Error("invalid_client: projeto não pertence a este workspace");
        }
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Procura usuário existente
    let existingId: string | null = null;
    for (let page = 1; page <= 20 && !existingId; page++) {
      const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (lErr) throw lErr;
      const users = list?.users ?? [];
      const hit = users.find((u) => (u.email ?? "").toLowerCase() === data.email);
      if (hit) existingId = hit.id;
      if (users.length < 200) break;
    }

    let tempPassword: string | null = null;
    let mode: "linked" | "provisioned" = "linked";
    let targetId: string;
    let fullName = data.fullName;

    if (existingId) {
      targetId = existingId;
      const { data: prof } = await supabase
        .from("user_profiles")
        .select("full_name")
        .eq("id", existingId)
        .maybeSingle();
      fullName = fullName || (prof?.full_name ?? "");
    } else {
      if (!data.fullName || data.fullName.length < 1) {
        throw new Error("name_required: informe o nome completo para criar a conta");
      }
      tempPassword = randomPassword(16);
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (createErr || !created?.user?.id) {
        throw new Error(`provision_failed: ${createErr?.message ?? "sem id de usuário"}`);
      }
      targetId = created.user.id;
      mode = "provisioned";
      await supabaseAdmin
        .from("user_profiles")
        .update({ requires_password_change: true, full_name: data.fullName } as never)
        .eq("id", targetId);
    }

    // Vincula ao workspace (upsert brand_members)
    const { data: existingMember } = await supabase
      .from("brand_members")
      .select("role, permissions")
      .eq("brand_id", data.brandId)
      .eq("user_id", targetId)
      .maybeSingle();

    const { error: upErr } = await supabaseAdmin.from("brand_members").upsert(
      {
        brand_id: data.brandId,
        user_id: targetId,
        role: data.role,
        permissions: data.permissions,
        ...(data.accessProfileId !== undefined
          ? { access_profile_id: data.accessProfileId }
          : {}),
      },
      { onConflict: "brand_id,user_id" },
    );
    if (upErr) throw upErr;

    // Restrições por projeto (opcional)
    if (data.clientIds.length > 0) {
      const rows = data.clientIds.map((cid) => ({
        brand_id: data.brandId,
        client_id: cid,
        user_id: targetId,
        role: data.role,
        created_by: userId,
      }));
      const { error: cmErr } = await (
        supabaseAdmin.from as never as (t: string) => {
          upsert: (v: unknown, o: { onConflict: string }) => Promise<{ error: unknown }>;
        }
      )("client_members").upsert(rows, { onConflict: "client_id,user_id" });
      if (cmErr) throw cmErr as Error;
    }

    // Status para o toast
    let linkStatus: "added" | "updated" | "already_member" = "added";
    if (mode === "linked" && existingMember) {
      const samePerms =
        Array.isArray(existingMember.permissions) &&
        existingMember.permissions.length === data.permissions.length &&
        (existingMember.permissions as string[]).every((p) =>
          (data.permissions as string[]).includes(p),
        );
      linkStatus = existingMember.role === data.role && samePerms ? "already_member" : "updated";
    }

    // E-mail de credenciais (apenas para conta nova)
    let emailStatus: { sent: boolean; error?: string } = { sent: false, error: "skipped" };
    if (mode === "provisioned" && data.sendEmail && tempPassword) {
      const { data: brand } = await supabase
        .from("brands")
        .select("name")
        .eq("id", data.brandId)
        .maybeSingle();
      let clientNames: string[] = [];
      if (data.clientIds.length > 0) {
        const { data: cRows } = await supabase
          .from("clients")
          .select("name")
          .in("id", data.clientIds);
        clientNames = (cRows ?? []).map((c) => c.name as string);
      }
      const { tryInstallationAbsoluteUrl } = await import("@/lib/installation-url.server");
      const loginUrl = await tryInstallationAbsoluteUrl(supabase, data.brandId, "/auth");

      emailStatus = loginUrl
        ? await sendCredentialsEmail({
            supabase: supabase as unknown as SupabaseLike,
            brandId: data.brandId,
            to: data.email,
            fullName,
            tempPassword,
            loginUrl,
            workspaces: [{ name: brand?.name ?? "Workspace", clients: clientNames }],
          })
        : { sent: false, error: "instalacao_url_desconhecida" };
    }

    return {
      mode,
      status: linkStatus,
      email: data.email,
      fullName,
      userId: targetId,
      tempPassword,
      emailStatus,
    };
  });
