import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandAdmin, assertClientInBrand } from "@/lib/access-guard";

/**
 * Fase C — contas de acesso por login do portal do cliente.
 *
 * Espelha o padrão de `inviteBrandMembers` (team.functions.ts): senha
 * provisória gerada pelo sistema, `email_confirm: true`,
 * `requires_password_change = true` e `MandatoryPasswordReset` na primeira
 * entrada. Diferença: o usuário de portal fica FORA de `brand_members` — o
 * vínculo é só `client_members.role = 'portal_client'`, que as policies
 * internas ignoram (ver `can_access_client`).
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

type ClientRow = {
  id: string;
  brand_id: string;
  name: string;
  contact_email: string | null;
  contact_name: string | null;
};

async function loadClient(
  supabase: { from: (t: string) => never },
  clientId: string,
): Promise<ClientRow> {
  const q = supabase.from("clients") as unknown as {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => {
        maybeSingle: () => Promise<{ data: ClientRow | null; error: { message: string } | null }>;
      };
    };
  };
  const { data, error } = await q
    .select("id, brand_id, name, contact_email, contact_name")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("client_not_found: cliente não encontrado ou sem acesso.");
  return data;
}

async function assertCanManage(
  context: {
    supabase: {
      rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown }>;
      from: unknown;
    };
  },
  brandId: string,
  userId: string,
  clientId?: string,
): Promise<void> {
  // Fonte canônica (Fase 3): `app_access_role` — reconhece SUPER ADMIN e não
  // cria hierarquia paralela via `has_brand_role`. Escopo de cliente é
  // validado à parte porque MANAGER só alcança clientes atribuídos.
  await assertBrandAdmin(context.supabase as never, userId, brandId);
  if (clientId) {
    await assertClientInBrand(context.supabase as never, userId, brandId, clientId);
  }
}

export type PortalAccountStatus = {
  state: "none" | "pending_password" | "active";
  email: string | null;
  suggestedEmail: string | null;
  userId: string | null;
  fullName: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  /** true quando o e-mail cadastrado não serve para criar conta (vazio ou formato inválido). */
  emailBlocked: boolean;
};

function isUsableEmail(email: string | null): boolean {
  if (!email) return false;
  // Domínios fictícios são aceitos: o ciclo de acesso é feito por convite dentro do cadastro do cliente.
  return z.string().email().safeParse(email.trim()).success;
}

export const getPortalAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientInput.parse(i))
  .handler(async ({ data, context }): Promise<PortalAccountStatus> => {
    const { supabase } = context;
    const client = await loadClient(supabase as never, data.clientId);

    const members = supabase.from("client_members") as unknown as {
      select: (c: string) => {
        eq: (
          k: string,
          v: string,
        ) => {
          eq: (
            k: string,
            v: string,
          ) => Promise<{
            data: Array<{
              user_id: string;
              last_seen_at: string | null;
              created_at: string;
            }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    const { data: rows, error } = await members
      .select("user_id, last_seen_at, created_at")
      .eq("client_id", data.clientId)
      .eq("role", PORTAL_ROLE);
    if (error) throw new Error(error.message);

    const suggestedEmail = isUsableEmail(client.contact_email)
      ? client.contact_email!.trim()
      : null;
    const row = (rows ?? [])[0];
    if (!row) {
      return {
        state: "none",
        email: null,
        suggestedEmail,
        userId: null,
        fullName: null,
        lastSeenAt: null,
        createdAt: null,
        emailBlocked: !suggestedEmail,
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("full_name, requires_password_change")
      .eq("id", row.user_id)
      .maybeSingle();
    const p = profile as {
      full_name: string | null;
      requires_password_change: boolean | null;
    } | null;

    return {
      state: p?.requires_password_change ? "pending_password" : "active",
      email: authUser?.user?.email ?? null,
      suggestedEmail,
      userId: row.user_id,
      fullName: p?.full_name ?? null,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      emailBlocked: false,
    };
  });

export const createPortalAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ClientInput.extend({
      email: z.string().trim().email("E-mail inválido").optional(),
      fullName: z.string().trim().min(1).max(160).optional(),
    }).parse(i),
  )
  .handler(
    async ({ data, context }): Promise<{ email: string; tempPassword: string; userId: string }> => {
      const { supabase, userId } = context;
      const client = await loadClient(supabase as never, data.clientId);
      await assertCanManage(context as never, client.brand_id, userId, client.id);

      const email = (data.email ?? client.contact_email ?? "").trim().toLowerCase();
      if (!isUsableEmail(email)) {
        throw new Error("invalid_email: informe um e-mail válido para o contato do cliente.");
      }

      const fullName = data.fullName?.trim() || client.contact_name?.trim() || client.name;

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Já existe acesso de portal para este cliente?
      const existing = (
        await (
          supabaseAdmin.from("client_members") as unknown as {
            select: (c: string) => {
              eq: (
                k: string,
                v: string,
              ) => {
                eq: (k: string, v: string) => Promise<{ data: Array<{ user_id: string }> | null }>;
              };
            };
          }
        )
          .select("user_id")
          .eq("client_id", data.clientId)
          .eq("role", PORTAL_ROLE)
      ).data;
      if ((existing ?? []).length > 0) {
        throw new Error("portal_account_exists: este cliente já tem acesso por login.");
      }

      // E-mail já usado em qualquer conta do sistema (equipe ou outro cliente)
      for (let page = 1; page <= 20; page++) {
        const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (lErr) throw new Error(lErr.message);
        const users = list?.users ?? [];
        if (users.some((u) => (u.email ?? "").toLowerCase() === email)) {
          throw new Error("user_exists: já existe conta com este e-mail no sistema.");
        }
        if (users.length < 200) break;
      }

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

      await supabaseAdmin
        .from("user_profiles")
        .update({ requires_password_change: true, full_name: fullName } as never)
        .eq("id", newUserId);

      const { error: cmErr } = await (
        supabaseAdmin.from as unknown as (t: string) => {
          insert: (v: unknown) => Promise<{ error: { message: string } | null }>;
        }
      )("client_members").insert({
        brand_id: client.brand_id,
        client_id: data.clientId,
        user_id: newUserId,
        role: PORTAL_ROLE,
        created_by: userId,
      });
      if (cmErr) {
        // rollback: sem vínculo a conta não serve para nada
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        throw new Error(`link_failed: ${cmErr.message}`);
      }

      return { email, tempPassword, userId: newUserId };
    },
  );

export const resetPortalAccountPasswordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientInput.parse(i))
  .handler(async ({ data, context }): Promise<{ email: string; tempPassword: string }> => {
    const { supabase, userId } = context;
    const client = await loadClient(supabase as never, data.clientId);
    await assertCanManage(context as never, client.brand_id, userId, client.id);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await (
      supabaseAdmin.from("client_members") as unknown as {
        select: (c: string) => {
          eq: (
            k: string,
            v: string,
          ) => {
            eq: (k: string, v: string) => Promise<{ data: Array<{ user_id: string }> | null }>;
          };
        };
      }
    )
      .select("user_id")
      .eq("client_id", data.clientId)
      .eq("role", PORTAL_ROLE);
    const target = (rows ?? [])[0];
    if (!target)
      throw new Error("portal_account_missing: este cliente ainda não tem acesso por login.");

    const tempPassword = randomPassword(16);
    const { data: updated, error } = await supabaseAdmin.auth.admin.updateUserById(target.user_id, {
      password: tempPassword,
    });
    if (error) throw new Error(`reset_failed: ${error.message}`);

    await supabaseAdmin
      .from("user_profiles")
      .update({ requires_password_change: true } as never)
      .eq("id", target.user_id);

    return { email: updated?.user?.email ?? "", tempPassword };
  });
