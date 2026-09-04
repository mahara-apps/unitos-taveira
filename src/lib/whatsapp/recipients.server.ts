// Server-only: resolução de destinatários de WhatsApp.
//
// Regra central: o frontend NUNCA envia telefone ou Group ID. Ele envia apenas
// ids de destinatários cadastrados. Aqui a cadeia workspace → cliente →
// destinatário é revalidada e o destino é derivado no servidor:
//   - client_contact / whatsapp_group → destino armazenado no cadastro
//   - account_manager                 → gestor responsável (clients.owner_user_id)
//   - workspace_admin                 → ADMIN (owner) do workspace
//   - workspace_user                  → usuário específico do workspace
// Usuários internos não têm ficha de contato duplicada: o telefone vem sempre
// de `user_profiles`.

import { assertBrandMember, assertClientScope } from "@/lib/access-guard";
import { normalizePhone, parseDestination, type WhatsappDestination } from "./destination";
import { DYNAMIC_RECIPIENT_TYPES, type WhatsappRecipientType } from "./types";

type AnySupabase = Parameters<typeof assertBrandMember>[0] & { from: (table: string) => any };

export type RecipientRecord = {
  id: string;
  brand_id: string;
  client_id: string | null;
  user_id: string | null;
  type: WhatsappRecipientType;
  name: string;
  role_label: string | null;
  destination: string | null;
  is_active: boolean;
};

export type ResolvedRecipient = {
  recipientId: string;
  type: WhatsappRecipientType;
  clientId: string | null;
  label: string;
  destination: WhatsappDestination;
};

export type UnresolvedRecipient = {
  recipientId: string;
  reason:
    | "not_found"
    | "inactive"
    | "out_of_scope"
    | "invalid_destination"
    | "missing_phone"
    | "no_admin";
  label: string | null;
};

export type RecipientResolution = {
  resolved: ResolvedRecipient[];
  unresolved: UnresolvedRecipient[];
};

async function userPhone(supabase: AnySupabase, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("full_name, whatsapp, phone")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return normalizePhone(data.whatsapp) ?? normalizePhone(data.phone);
}

async function userLabel(supabase: AnySupabase, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return (data?.full_name as string | undefined) ?? null;
}

/** Gestor responsável pelo cliente dentro do Unitos. */
async function clientOwner(supabase: AnySupabase, clientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("owner_user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw error;
  return (data?.owner_user_id as string | null) ?? null;
}

/** Owner/Admin ativo do workspace (prioriza o Owner). */
async function workspaceAdmin(supabase: AnySupabase, brandId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("brand_members")
    .select("user_id, role")
    .eq("brand_id", brandId)
    .in("role", ["owner", "admin"])
    .eq("is_active", true)
    .order("role", { ascending: true })
    .order("user_id", { ascending: true })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0]?.user_id as string | undefined) ?? null;
}

async function isBrandMember(
  supabase: AnySupabase,
  brandId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("brand_members")
    .select("user_id")
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * Resolve destinatários por id, validando escopo server-side.
 * `actorUserId` nulo = fluxo de worker/service_role (a relação estrutural
 * brand → cliente → destinatário continua sendo validada).
 */
export async function resolveRecipients(
  supabase: AnySupabase,
  actorUserId: string | null,
  brandId: string,
  recipientIds: string[],
): Promise<RecipientResolution> {
  const ids = Array.from(new Set(recipientIds.filter(Boolean)));
  if (!ids.length) return { resolved: [], unresolved: [] };

  if (actorUserId) await assertBrandMember(supabase, actorUserId, brandId);

  const { data, error } = await supabase
    .from("whatsapp_recipients")
    .select("id, brand_id, client_id, user_id, type, name, role_label, destination, is_active")
    .in("id", ids)
    .eq("brand_id", brandId);
  if (error) throw error;

  const rows = (data ?? []) as RecipientRecord[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const resolved: ResolvedRecipient[] = [];
  const unresolved: UnresolvedRecipient[] = [];

  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      // Fora do workspace, fora do escopo (RLS) ou inexistente.
      unresolved.push({ recipientId: id, reason: "not_found", label: null });
      continue;
    }
    if (!row.is_active) {
      unresolved.push({ recipientId: id, reason: "inactive", label: row.name });
      continue;
    }
    if (row.client_id && actorUserId) {
      try {
        await assertClientScope(supabase, actorUserId, row.client_id);
      } catch {
        unresolved.push({ recipientId: id, reason: "out_of_scope", label: row.name });
        continue;
      }
    }

    let destination: WhatsappDestination | null = null;
    let label = row.name;

    if (row.type === "whatsapp_group") {
      destination = parseDestination("group", row.destination);
      if (!destination) {
        unresolved.push({ recipientId: id, reason: "invalid_destination", label });
        continue;
      }
    } else if (row.type === "client_contact") {
      destination = parseDestination("phone", row.destination);
      if (!destination) {
        unresolved.push({ recipientId: id, reason: "invalid_destination", label });
        continue;
      }
    } else if (DYNAMIC_RECIPIENT_TYPES.includes(row.type)) {
      let targetUserId: string | null = row.user_id;
      if (!targetUserId && row.type === "account_manager" && row.client_id) {
        targetUserId = await clientOwner(supabase, row.client_id);
      }
      if (!targetUserId && row.type === "workspace_admin") {
        targetUserId = await workspaceAdmin(supabase, brandId);
      }
      if (!targetUserId) {
        unresolved.push({ recipientId: id, reason: "no_admin", label });
        continue;
      }
      if (!(await isBrandMember(supabase, brandId, targetUserId))) {
        unresolved.push({ recipientId: id, reason: "out_of_scope", label });
        continue;
      }
      const phone = await userPhone(supabase, targetUserId);
      if (!phone) {
        unresolved.push({ recipientId: id, reason: "missing_phone", label });
        continue;
      }
      destination = { kind: "phone", value: phone };
      label = (await userLabel(supabase, targetUserId)) ?? row.name;
    }

    if (!destination) {
      unresolved.push({ recipientId: id, reason: "invalid_destination", label });
      continue;
    }

    resolved.push({
      recipientId: row.id,
      type: row.type,
      clientId: row.client_id,
      label,
      destination,
    });
  }

  return { resolved, unresolved };
}
