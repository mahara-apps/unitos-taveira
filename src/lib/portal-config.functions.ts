import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandAdmin, assertClientInBrand } from "@/lib/access-guard";
import {
  DEFAULT_PORTAL_PERMISSIONS,
  normalizePortalPermissions,
  PORTAL_MODULES,
  PORTAL_PERMISSION_LEVELS,
  type PortalPermissions,
} from "@/lib/portal-permissions";

/**
 * Configuração do acesso do cliente ao Portal: permissões por módulo (valem
 * para todos os contatos daquele cliente) e responsável do atendimento.
 *
 * A escrita é restrita a ADMIN/OWNER/SUPER ADMIN do workspace com escopo no
 * cliente — a RLS de `client_portal_access` repete a mesma regra.
 */

const ClientInput = z.object({ clientId: z.string().uuid() });

type AnyClient = {
  from: (table: string) => any;
};

async function loadClient(
  supabase: unknown,
  clientId: string,
): Promise<{ id: string; brand_id: string; name: string }> {
  const { data, error } = await (supabase as AnyClient)
    .from("clients")
    .select("id, brand_id, name")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error((error as { message: string }).message);
  if (!data) throw new Error("client_not_found: cliente não encontrado ou sem acesso.");
  return data as { id: string; brand_id: string; name: string };
}

export type PortalTeamOption = { userId: string; name: string; role: string };

export type PortalAccessConfig = {
  clientId: string;
  clientName: string;
  permissions: PortalPermissions;
  ownerUserId: string | null;
  updatedAt: string | null;
  team: PortalTeamOption[];
};

export const getPortalAccessConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ClientInput.parse(i))
  .handler(async ({ data, context }): Promise<PortalAccessConfig> => {
    const { supabase, userId } = context;
    const client = await loadClient(supabase, data.clientId);
    await assertBrandAdmin(supabase, userId, client.brand_id);
    await assertClientInBrand(supabase, userId, client.brand_id, client.id);

    const [configRes, membersRes] = await Promise.all([
      supabase
        .from("client_portal_access")
        .select("permissions, owner_user_id, updated_at")
        .eq("client_id", client.id)
        .maybeSingle(),
      supabase.from("brand_members").select("user_id, role").eq("brand_id", client.brand_id),
    ]);
    if (configRes.error) throw configRes.error;
    if (membersRes.error) throw membersRes.error;

    const members = (membersRes.data ?? []) as Array<{ user_id: string; role: string }>;
    let team: PortalTeamOption[] = [];
    if (members.length) {
      const { data: profiles } = await supabase
        .from("user_profiles")
        .select("id, full_name")
        .in(
          "id",
          members.map((m) => m.user_id),
        );
      const names = new Map(
        ((profiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [
          p.id,
          p.full_name,
        ]),
      );
      team = members
        .map((m) => ({
          userId: m.user_id,
          name: names.get(m.user_id) || "Sem nome",
          role: String(m.role),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    }

    const row = configRes.data as {
      permissions: unknown;
      owner_user_id: string | null;
      updated_at: string | null;
    } | null;

    return {
      clientId: client.id,
      clientName: client.name,
      permissions: row ? normalizePortalPermissions(row.permissions) : DEFAULT_PORTAL_PERMISSIONS,
      ownerUserId: row?.owner_user_id ?? null,
      updatedAt: row?.updated_at ?? null,
      team,
    };
  });

const LevelEnum = z.enum(PORTAL_PERMISSION_LEVELS as unknown as [string, ...string[]]);

export const savePortalAccessConfigFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    ClientInput.extend({
      permissions: z.record(z.string(), LevelEnum),
      ownerUserId: z.string().uuid().nullable().optional(),
    }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ permissions: PortalPermissions }> => {
    const { supabase, userId } = context;
    const client = await loadClient(supabase, data.clientId);
    await assertBrandAdmin(supabase, userId, client.brand_id);
    await assertClientInBrand(supabase, userId, client.brand_id, client.id);

    const permissions = normalizePortalPermissions(data.permissions);
    // Módulos sem interação possível nunca gravam "interact".
    for (const mod of PORTAL_MODULES) {
      if (mod.viewOnly && permissions[mod.id] === "interact") permissions[mod.id] = "view";
    }

    const { error } = await supabase.from("client_portal_access").upsert(
      {
        client_id: client.id,
        brand_id: client.brand_id,
        permissions,
        owner_user_id: data.ownerUserId ?? null,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      } as never,
      { onConflict: "client_id" },
    );
    if (error) throw new Error(error.message);
    return { permissions };
  });
