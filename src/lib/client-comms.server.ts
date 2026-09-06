/**
 * Comunicação de mão dupla entre a Área do Cliente e a equipe interna.
 *
 * Um único lugar decide QUEM recebe cada aviso:
 *  - equipe interna: responsável pelo cliente + quem está ligado ao cliente +
 *    todos os integrantes internos do workspace (owner, admin, manager, user...);
 *    contatos do portal NUNCA recebem aviso interno.
 *  - cliente: contatos de portal ligados ao cliente, respeitando
 *    `portal_notification_prefs`.
 *
 * Avisos são acessórios: qualquer falha aqui não invalida a ação principal.
 */

import { insertNotificationsDeduped, notificationDedupeKey } from "@/lib/notifications-dedupe";

const PORTAL_ROLE = "portal_client";

export type NotificationKind =
  | "mention"
  | "assignment"
  | "approval_requested"
  | "approval_decision"
  | "deadline"
  | "system";

/** Preferências de aviso do contato do portal (`portal_notification_prefs.kinds`). */
export type PortalPrefKind = "approvals" | "deadlines" | "requests" | "comments";

type AnyClient = { from: (table: string) => any };

type BaseInput = {
  brandId: string;
  clientId: string;
  kind?: NotificationKind;
  title: string;
  body?: string | null;
  href?: string | null;
  /** Partes que identificam o evento (post, pedido, comentário...). */
  dedupeParts: Array<string | null | undefined>;
  payload?: Record<string, unknown>;
};

export type Member = { user_id: string | null; role: string | null };

/**
 * Destinatários internos de um aviso do cliente: responsável pelo cliente,
 * quem está ligado ao cliente e todos os integrantes internos do workspace.
 * Contato de portal nunca entra, mesmo se estiver ligado ao cliente.
 */
export function internalRecipients(input: {
  brandMembers: Member[];
  clientMembers: Member[];
  ownerUserId: string | null;
}): Set<string> {
  const internal = new Set<string>();
  for (const m of input.brandMembers) {
    if (m.user_id && m.role !== PORTAL_ROLE) internal.add(m.user_id);
  }
  const recipients = new Set<string>(internal);
  for (const m of input.clientMembers) {
    if (m.user_id && m.role !== PORTAL_ROLE && internal.has(m.user_id)) recipients.add(m.user_id);
  }
  if (input.ownerUserId && internal.has(input.ownerUserId)) recipients.add(input.ownerUserId);
  return recipients;
}

/** Avisa a equipe interna sobre uma ação do cliente. */
export async function notifyInternalTeam(input: BaseInput): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as unknown as AnyClient;
    const [{ data: brandMembers }, { data: clientMembers }, { data: clientRow }] =
      await Promise.all([
        sb.from("brand_members").select("user_id, role").eq("brand_id", input.brandId),
        sb.from("client_members").select("user_id, role").eq("client_id", input.clientId),
        sb.from("clients").select("name, owner_user_id").eq("id", input.clientId).maybeSingle(),
      ]);

    const client = (clientRow ?? {}) as { name?: string | null; owner_user_id?: string | null };
    const recipients = internalRecipients({
      brandMembers: (brandMembers ?? []) as Member[],
      clientMembers: (clientMembers ?? []) as Member[],
      ownerUserId: client.owner_user_id ?? null,
    });
    if (!recipients.size) return;

    const who = client.name ?? "Cliente";
    await insertNotificationsDeduped(
      supabaseAdmin as never,
      [...recipients].map((userId) => ({
        user_id: userId,
        brand_id: input.brandId,
        kind: input.kind ?? "system",
        title: input.title,
        body: input.body ? `${who} · ${input.body}` : who,
        href: input.href ?? `/inbox?cliente=${input.clientId}`,
        dedupe_key: notificationDedupeKey("client_inbox", ...input.dedupeParts),
        payload: {
          scope: "client_inbox",
          client_id: input.clientId,
          ...(input.payload ?? {}),
        },
      })),
    );
  } catch {
    // avisos nunca derrubam a ação do cliente
  }
}

/** Avisa os contatos do portal (cliente) sobre uma ação da equipe. */
export async function notifyPortalContacts(
  input: BaseInput & { prefKind: PortalPrefKind },
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as unknown as AnyClient;
    const [{ data: members }, { data: prefs }] = await Promise.all([
      sb
        .from("client_members")
        .select("user_id, role")
        .eq("client_id", input.clientId)
        .eq("role", PORTAL_ROLE),
      sb.from("portal_notification_prefs").select("user_id, kinds").eq("client_id", input.clientId),
    ]);

    const prefsByUser = new Map<string, Record<string, unknown>>();
    for (const p of (prefs ?? []) as Array<{ user_id: string; kinds: unknown }>) {
      prefsByUser.set(
        p.user_id,
        typeof p.kinds === "object" && p.kinds !== null ? (p.kinds as Record<string, unknown>) : {},
      );
    }

    const recipients = ((members ?? []) as Array<{ user_id: string }>)
      .map((m) => m.user_id)
      .filter((id): id is string => Boolean(id))
      .filter((id) => {
        const kinds = prefsByUser.get(id);
        // Sem preferência salva = recebe tudo (padrão do portal).
        return !kinds || kinds[input.prefKind] !== false;
      });
    if (!recipients.length) return;

    await insertNotificationsDeduped(
      supabaseAdmin as never,
      recipients.map((userId) => ({
        user_id: userId,
        brand_id: input.brandId,
        kind: input.kind ?? "system",
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? `/area/inicio?cliente=${input.clientId}`,
        dedupe_key: notificationDedupeKey("portal_inbox", ...input.dedupeParts),
        payload: {
          scope: "portal_inbox",
          client_id: input.clientId,
          ...(input.payload ?? {}),
        },
      })),
    );
  } catch {
    // avisos nunca derrubam a ação da equipe
  }
}

/** Decide, pelas preferências, se um usuário do portal recebe um tipo de aviso. */
export function portalPrefAllows(kinds: unknown, prefKind: PortalPrefKind): boolean {
  if (typeof kinds !== "object" || kinds === null) return true;
  return (kinds as Record<string, unknown>)[prefKind] !== false;
}
