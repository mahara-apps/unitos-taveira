import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertBrandAdmin,
  assertCanManageBrandMember,
  resolveAuthorityRole,
} from "@/lib/access-guard";

/**
 * Gestão de Equipe & Acessos (Configurações) — CRUD real sobre o modelo
 * existente. Não cria tabelas paralelas:
 *  - pessoas  → `brand_members` (papel + is_active) + `user_profiles` (perfil)
 *  - convites → `brand_invites` (fluxo já existente, ver team.functions.ts)
 *  - portal   → `portal_tokens` (1 link ativo por cliente, índice único)
 *
 * Autoridade: `assertBrandAdmin` (app_access_role) — MANAGER não mexe em
 * owner/admin nem promove a owner. Escrita usa service role só depois da
 * checagem, para não depender das nuances das policies de brand_members.
 */

/** Papéis oficiais: owner (proprietário), admin, manager, user. `client` é só Portal. */
const BRAND_ROLES = ["owner", "admin", "manager", "user", "client"] as const;
/** Papéis atribuíveis a um membro interno da equipe (owner só por super admin). */
const INTERNAL_ROLES = ["owner", "admin", "manager", "user"] as const;
export type BrandRole = (typeof BRAND_ROLES)[number];

const BrandInput = z.object({ brandId: z.string().uuid() });

export type TeamMember = {
  userId: string;
  role: BrandRole;
  isActive: boolean;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  createdAt: string;
  deactivatedAt: string | null;
  lastSignInAt: string | null;
  pendingFirstAccess: boolean;
  isSuperAdmin: boolean;
  status: "active" | "pending" | "inactive";
};

type MemberRow = {
  user_id: string;
  role: BrandRole;
  created_at: string;
  is_active: boolean | null;
  deactivated_at: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;

  avatar_url: string | null;
  phone: string | null;
  job_title: string | null;
  requires_password_change: boolean | null;
  is_super_admin: boolean | null;
};

export const listTeamMembersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandInput.parse(i))
  .handler(async ({ data, context }): Promise<{ members: TeamMember[]; myRole: string | null }> => {
    const { supabase, userId } = context;
    // Tela administrativa: expõe e-mail/telefone/flags — exige autoridade admin.
    const myRole = await assertBrandAdmin(supabase as never, userId, data.brandId);

    const { data: rows, error } = await supabase
      .from("brand_members")
      .select("user_id, role, created_at, is_active, deactivated_at")
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const members = (rows ?? []) as unknown as MemberRow[];
    if (members.length === 0) return { members: [], myRole };

    const ids = members.map((m) => m.user_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profs } = await supabaseAdmin
      .from("user_profiles")
      .select(
        "id, full_name, email, avatar_url, phone, job_title, requires_password_change, is_super_admin",
      )
      .in("id", ids);
    const profiles = (profs ?? []) as unknown as ProfileRow[];

    // E-mail e último acesso só existem em auth.users — leitura pontual por id.
    const auth = await Promise.all(
      ids.map(async (id) => {
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
          return {
            id,
            email: u?.user?.email ?? null,
            lastSignInAt: (u?.user?.last_sign_in_at as string | null | undefined) ?? null,
          };
        } catch {
          return { id, email: null, lastSignInAt: null };
        }
      }),
    );

    return {
      myRole,
      members: members.map((m) => {
        const p = profiles.find((x) => x.id === m.user_id);
        const a = auth.find((x) => x.id === m.user_id);
        const isActive = m.is_active !== false;
        const pendingFirstAccess = Boolean(p?.requires_password_change) || !a?.lastSignInAt;
        return {
          userId: m.user_id,
          role: m.role,
          isActive,
          fullName: p?.full_name ?? null,
          email: p?.email ?? a?.email ?? null,
          phone: p?.phone ?? null,
          jobTitle: p?.job_title ?? null,
          avatarUrl: p?.avatar_url ?? null,
          createdAt: m.created_at,
          deactivatedAt: m.deactivated_at,
          lastSignInAt: a?.lastSignInAt ?? null,
          pendingFirstAccess,
          isSuperAdmin: Boolean(p?.is_super_admin),
          status: !isActive ? "inactive" : pendingFirstAccess ? "pending" : "active",
        } satisfies TeamMember;
      }),
    };
  });

/** Impede deixar a marca sem nenhum owner ativo. */
async function assertKeepsOwner(
  brandId: string,
  targetUserId: string,
  next: { role?: BrandRole; isActive?: boolean; removing?: boolean },
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("brand_members")
    .select("user_id, role, is_active")
    .eq("brand_id", brandId);
  const rows = (data ?? []) as unknown as Array<{
    user_id: string;
    role: string;
    is_active: boolean | null;
  }>;
  const stillOwner = rows.some((r) => {
    const isTarget = r.user_id === targetUserId;
    if (isTarget && next.removing) return false;
    const role = isTarget && next.role ? next.role : r.role;
    const active = isTarget && next.isActive !== undefined ? next.isActive : r.is_active !== false;
    return role === "owner" && active;
  });
  if (!stillOwner) {
    throw new Error("last_owner: a marca precisa manter ao menos um owner ativo.");
  }
}

async function guardTarget(
  supabase: never,
  actorId: string,
  brandId: string,
  targetUserId: string,
  nextRole?: BrandRole,
): Promise<void> {
  await assertBrandAdmin(supabase as never, actorId, brandId);
  const targetAuthority = await resolveAuthorityRole(supabase as never, targetUserId, brandId);
  if (targetAuthority === "super_admin") {
    const actorAuthority = await resolveAuthorityRole(supabase as never, actorId, brandId);
    if (actorAuthority !== "super_admin") {
      throw new Error("forbidden: somente super admin altera super admins.");
    }
    return;
  }
  // Matriz canônica (owner ≠ admin): Admin não altera Owner; Manager só User.
  await assertCanManageBrandMember(
    supabase as never,
    actorId,
    brandId,
    targetUserId,
    (nextRole ?? null) as never,
  );
}

const SaveMemberInput = z.object({
  brandId: z.string().uuid(),
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(160).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  jobTitle: z.string().trim().max(120).nullable().optional(),
  role: z.enum(INTERNAL_ROLES).optional(),
  isActive: z.boolean().optional(),
});

export const saveTeamMemberFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveMemberInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await guardTarget(supabase as never, userId, data.brandId, data.userId, data.role);

    if (data.userId === userId && data.isActive === false) {
      throw new Error("self_deactivate: você não pode desativar seu próprio acesso.");
    }
    if (data.role !== undefined || data.isActive !== undefined) {
      await assertKeepsOwner(data.brandId, data.userId, {
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      });
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const membership: Record<string, unknown> = {};
    if (data.role !== undefined) membership["role"] = data.role;
    if (data.isActive !== undefined) {
      membership["is_active"] = data.isActive;
      membership["deactivated_at"] = data.isActive ? null : new Date().toISOString();
      membership["deactivated_by"] = data.isActive ? null : userId;
    }
    if (Object.keys(membership).length > 0) {
      const { error } = await supabaseAdmin
        .from("brand_members")
        .update(membership as never)
        .eq("brand_id", data.brandId)
        .eq("user_id", data.userId);
      if (error) throw new Error(error.message);
    }

    const profile: Record<string, unknown> = {};
    if (data.fullName !== undefined) profile["full_name"] = data.fullName;
    if (data.phone !== undefined) profile["phone"] = data.phone || null;
    if (data.jobTitle !== undefined) profile["job_title"] = data.jobTitle || null;
    if (Object.keys(profile).length > 0) {
      const { error } = await supabaseAdmin
        .from("user_profiles")
        .update(profile as never)
        .eq("id", data.userId);
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

const RemoveInput = z.object({ brandId: z.string().uuid(), userId: z.string().uuid() });

export const removeTeamMemberFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RemoveInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await guardTarget(supabase as never, userId, data.brandId, data.userId);
    if (data.userId === userId) {
      throw new Error("self_remove: você não pode remover seu próprio acesso.");
    }
    await assertKeepsOwner(data.brandId, data.userId, { removing: true });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Remove também os vínculos por projeto desta marca (escopo operacional).
    await supabaseAdmin
      .from("client_members")
      .delete()
      .eq("brand_id", data.brandId)
      .eq("user_id", data.userId);
    const { error } = await supabaseAdmin
      .from("brand_members")
      .delete()
      .eq("brand_id", data.brandId)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/* Acessos do portal do cliente                                               */
/* -------------------------------------------------------------------------- */

export type PortalAccess = {
  id: string;
  token: string;
  label: string | null;
  clientId: string;
  clientName: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  createdByName: string | null;
  status: "active" | "revoked" | "expired" | "pending";
};

function portalStatus(t: {
  revoked_at: string | null;
  expires_at: string | null;
  last_seen_at: string | null;
}) {
  if (t.revoked_at) return "revoked" as const;
  if (t.expires_at && new Date(t.expires_at).getTime() < Date.now()) return "expired" as const;
  return t.last_seen_at ? ("active" as const) : ("pending" as const);
}

export const listPortalAccessesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => BrandInput.parse(i))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ accesses: PortalAccess[]; clients: Array<{ id: string; name: string }> }> => {
      const { supabase } = context;
      const { data: clientRows, error: cErr } = await supabase
        .from("clients")
        .select("id, name")
        .eq("brand_id", data.brandId)
        .order("name");
      if (cErr) throw new Error(cErr.message);
      const clients = (clientRows ?? []) as Array<{ id: string; name: string }>;
      if (clients.length === 0) return { accesses: [], clients: [] };

      const { data: tokens, error } = await supabase
        .from("portal_tokens")
        .select(
          "id, token, label, client_id, expires_at, revoked_at, last_seen_at, created_at, created_by",
        )
        .in(
          "client_id",
          clients.map((c) => c.id),
        )
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (tokens ?? []) as unknown as Array<{
        id: string;
        token: string;
        label: string | null;
        client_id: string;
        expires_at: string | null;
        revoked_at: string | null;
        last_seen_at: string | null;
        created_at: string;
        created_by: string | null;
      }>;

      const creatorIds = [
        ...new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v)),
      ];
      let creators: Array<{ id: string; full_name: string | null }> = [];
      if (creatorIds.length > 0) {
        const { data: profs } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", creatorIds);
        creators = (profs ?? []) as typeof creators;
      }
      const nameOf = new Map(clients.map((c) => [c.id, c.name]));

      return {
        clients,
        accesses: rows.map((t) => ({
          id: t.id,
          token: t.token,
          label: t.label,
          clientId: t.client_id,
          clientName: nameOf.get(t.client_id) ?? "—",
          expiresAt: t.expires_at,
          revokedAt: t.revoked_at,
          lastSeenAt: t.last_seen_at,
          createdAt: t.created_at,
          createdByName: creators.find((c) => c.id === t.created_by)?.full_name ?? null,
          status: portalStatus(t),
        })),
      };
    },
  );

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function assertClientOfBrand(
  supabase: { from: (t: string) => never },
  brandId: string,
  clientId: string,
): Promise<void> {
  const q = supabase.from("clients") as unknown as {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => {
        maybeSingle: () => Promise<{
          data: { brand_id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  const { data, error } = await q.select("brand_id").eq("id", clientId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.brand_id !== brandId) throw new Error("forbidden: cliente fora desta marca.");
}

const CreateAccessInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  label: z.string().trim().min(1).max(80).default("Portal do cliente"),
  expiresInDays: z.number().int().min(1).max(365).nullable().default(null),
  /** Revoga o link ativo do cliente antes de criar (1 ativo por cliente). */
  replaceActive: z.boolean().default(false),
});

export const createPortalAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateAccessInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBrandAdmin(supabase as never, userId, data.brandId);
    await assertClientOfBrand(supabase as never, data.brandId, data.clientId);

    const { data: active } = await supabase
      .from("portal_tokens")
      .select("id")
      .eq("client_id", data.clientId)
      .is("revoked_at", null);
    if ((active ?? []).length > 0) {
      if (!data.replaceActive) {
        throw new Error(
          "active_access_exists: este cliente já tem um acesso ativo. Revogue-o ou use “substituir”.",
        );
      }
      const { error: rErr } = await supabase
        .from("portal_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("client_id", data.clientId)
        .is("revoked_at", null);
      if (rErr) throw new Error(rErr.message);
    }

    const expires_at = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString()
      : null;
    const { data: row, error } = await supabase
      .from("portal_tokens")
      .insert({
        client_id: data.clientId,
        token: randomToken(),
        label: data.label,
        expires_at,
        created_by: userId,
      })
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const UpdateAccessInput = z.object({
  brandId: z.string().uuid(),
  tokenId: z.string().uuid(),
  label: z.string().trim().min(1).max(80).optional(),
  /** undefined = mantém; null = sem expiração. */
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

export const updatePortalAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateAccessInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBrandAdmin(supabase as never, userId, data.brandId);

    const { data: token, error: tErr } = await supabase
      .from("portal_tokens")
      .select("id, client_id")
      .eq("id", data.tokenId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!token) throw new Error("portal_access_not_found");
    await assertClientOfBrand(supabase as never, data.brandId, token.client_id as string);

    const patch: Record<string, unknown> = {};
    if (data.label !== undefined) patch["label"] = data.label;
    if (data.expiresInDays !== undefined) {
      patch["expires_at"] = data.expiresInDays
        ? new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString()
        : null;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase
      .from("portal_tokens")
      .update(patch as never)
      .eq("id", data.tokenId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const AccessActionInput = z.object({ brandId: z.string().uuid(), tokenId: z.string().uuid() });

export const revokePortalAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AccessActionInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBrandAdmin(supabase as never, userId, data.brandId);
    const { data: token } = await supabase
      .from("portal_tokens")
      .select("id, client_id")
      .eq("id", data.tokenId)
      .maybeSingle();
    if (!token) throw new Error("portal_access_not_found");
    await assertClientOfBrand(supabase as never, data.brandId, token.client_id as string);
    const { error } = await supabase
      .from("portal_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.tokenId)
      .is("revoked_at", null);
    if (error) throw new Error(error.message);
    return { ok: true, clientId: token.client_id as string };
  });

/** Reativa via RPC (checa "1 ativo por cliente" e autoridade no banco). */
export const reactivatePortalAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AccessActionInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc(
      "reactivate_portal_token" as never,
      {
        _token_id: data.tokenId,
      } as never,
    );
    if (error) {
      if (/active_token_exists/.test(error.message)) {
        throw new Error(
          "active_access_exists: este cliente já tem um acesso ativo. Revogue-o antes de reativar.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const deletePortalAccessFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AccessActionInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertBrandAdmin(supabase as never, userId, data.brandId);
    const { data: token } = await supabase
      .from("portal_tokens")
      .select("id, client_id")
      .eq("id", data.tokenId)
      .maybeSingle();
    if (!token) throw new Error("portal_access_not_found");
    await assertClientOfBrand(supabase as never, data.brandId, token.client_id as string);
    const { error } = await supabase.from("portal_tokens").delete().eq("id", data.tokenId);
    if (error) throw new Error(error.message);
    return { ok: true, clientId: token.client_id as string };
  });
