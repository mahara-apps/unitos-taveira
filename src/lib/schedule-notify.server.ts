import type { SupabaseClient } from "@supabase/supabase-js";
import { insertNotificationsDeduped, notificationDedupeKey } from "@/lib/notifications-dedupe";

/**
 * Avisa a equipe interna quando o cliente decide sobre a AGENDA de publicação.
 *
 * Destinatários: owners/admins/managers do workspace + membros internos
 * atribuídos ao cliente (contas de portal ficam de fora).
 *
 * Best-effort: a decisão do cliente nunca é invalidada por falha aqui.
 */

const INTERNAL_BRAND_ROLES = ["owner", "admin", "manager"];
const PORTAL_ROLE = "portal_client";

export async function notifyScheduleClientDecision(
  sb: SupabaseClient,
  input: {
    brandId: string;
    clientId: string;
    decision: "approve" | "changes";
    count: number;
    comment?: string;
    firstProposedAt?: string | null;
  },
): Promise<number> {
  if (input.count <= 0) return 0;

  const recipients = new Set<string>();
  const [{ data: brandMembers }, { data: clientMembers }, { data: clientRow }] = await Promise.all([
    sb
      .from("brand_members")
      .select("user_id, role")
      .eq("brand_id", input.brandId)
      .in("role", INTERNAL_BRAND_ROLES),
    sb.from("client_members").select("user_id, role").eq("client_id", input.clientId),
    sb.from("clients").select("name").eq("id", input.clientId).maybeSingle(),
  ]);

  for (const m of (brandMembers ?? []) as Array<{ user_id: string }>) {
    if (m.user_id) recipients.add(m.user_id);
  }
  for (const m of (clientMembers ?? []) as Array<{ user_id: string; role: string | null }>) {
    if (m.user_id && m.role !== PORTAL_ROLE) recipients.add(m.user_id);
  }
  if (recipients.size === 0) return 0;

  const who = (clientRow as { name?: string | null } | null)?.name ?? "Cliente";
  const title =
    input.decision === "approve"
      ? "Cliente confirmou a agenda de publicação"
      : "Cliente pediu outra data na agenda";
  const when = input.firstProposedAt
    ? new Date(input.firstProposedAt).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const body = [
    `${who} · ${input.count} data(s)${when ? ` a partir de ${when}` : ""}`,
    (input.comment ?? "").trim() || null,
  ]
    .filter(Boolean)
    .join("\n");

  const dedupeKey = notificationDedupeKey(
    "approval_decision",
    "publication_schedule",
    input.clientId,
    input.decision,
    input.firstProposedAt ?? null,
    String(input.count),
  );

  return insertNotificationsDeduped(
    sb as never,
    [...recipients].map((userId) => ({
      user_id: userId,
      brand_id: input.brandId,
      kind: "approval_decision",
      title,
      body,
      href: `/calendar`,
      dedupe_key: dedupeKey,
      payload: {
        scope: "publication_schedule",
        client_id: input.clientId,
        decision: input.decision,
        count: input.count,
        comment: (input.comment ?? "").trim() || null,
      },
    })),
  );
}
