import type { SupabaseClient } from "@supabase/supabase-js";
import { insertNotificationsDeduped, notificationDedupeKey } from "@/lib/notifications-dedupe";
import { PLAN_CHANNEL_LABEL, type PlanChannel } from "@/lib/monthly-plan-fields";

/**
 * Notificações do fluxo de excedente de volumetria.
 *
 * - Solicitação → avisa os aprovadores (Owner/Admin do workspace + responsáveis
 *   internos do cliente).
 * - Decisão → avisa quem solicitou.
 *
 * Best-effort: falha aqui nunca invalida a solicitação/decisão.
 */

const APPROVER_BRAND_ROLES = ["owner", "admin"];
const PORTAL_ROLE = "portal_client";

export type OverageNotifyItem = {
  channel: PlanChannel | string;
  quota: number;
  requested: number;
  overage: number;
};

const channelLabel = (c: string) => PLAN_CHANNEL_LABEL[c as PlanChannel] ?? c;

function summarize(items: OverageNotifyItem[]) {
  return items
    .map(
      (it) =>
        `${channelLabel(String(it.channel))}: ${it.requested} pedidas · ${it.quota} disponíveis · +${it.overage} excedente`,
    )
    .join("\n");
}

/** Aprovadores: Owner/Admin do workspace + membros internos do cliente. */
async function resolveApprovers(
  sb: SupabaseClient,
  args: { brandId: string; clientId: string; exclude?: string | null },
): Promise<string[]> {
  const recipients = new Set<string>();
  const [{ data: brandMembers }, { data: clientMembers }] = await Promise.all([
    sb
      .from("brand_members")
      .select("user_id, role")
      .eq("brand_id", args.brandId)
      .in("role", APPROVER_BRAND_ROLES),
    sb.from("client_members").select("user_id, role").eq("client_id", args.clientId),
  ]);
  for (const m of (brandMembers ?? []) as Array<{ user_id: string }>) {
    if (m.user_id) recipients.add(m.user_id);
  }
  for (const m of (clientMembers ?? []) as Array<{ user_id: string; role: string | null }>) {
    if (m.user_id && m.role !== PORTAL_ROLE) recipients.add(m.user_id);
  }
  if (args.exclude) recipients.delete(args.exclude);
  return [...recipients];
}

export async function notifyOverageRequested(
  sb: SupabaseClient,
  input: {
    brandId: string;
    clientId: string;
    clientName?: string | null;
    requestedBy: string;
    requesterName?: string | null;
    items: OverageNotifyItem[];
    justification?: string | null;
    periodMonth: string;
  },
): Promise<number> {
  const recipients = await resolveApprovers(sb, {
    brandId: input.brandId,
    clientId: input.clientId,
    exclude: input.requestedBy,
  });
  if (!recipients.length) return 0;

  const who = input.requesterName ? ` · pedido por ${input.requesterName}` : "";
  const body = [
    `${input.clientName ?? "Cliente"}${who}`,
    summarize(input.items),
    input.justification || null,
  ]
    .filter(Boolean)
    .join("\n");

  const dedupeKey = notificationDedupeKey(
    "approval_requested",
    "plan_overage",
    input.clientId,
    input.periodMonth,
  );

  return insertNotificationsDeduped(
    sb as never,
    recipients.map((userId) => ({
      user_id: userId,
      brand_id: input.brandId,
      kind: "approval_requested",
      title: "Liberação de volumetria solicitada",
      body,
      href: `/customers/${input.clientId}?tab=trabalho`,
      dedupe_key: dedupeKey,
      payload: {
        client_id: input.clientId,
        period_month: input.periodMonth,
        items: input.items,
        justification: input.justification || null,
        requested_by: input.requestedBy,
      },
    })),
  );
}

export async function notifyOverageDecided(
  sb: SupabaseClient,
  input: {
    requestId: string;
    brandId: string;
    clientId: string;
    clientName?: string | null;
    requestedBy: string | null;
    decision: "approved" | "rejected";
    item: OverageNotifyItem;
  },
): Promise<number> {
  if (!input.requestedBy) return 0;
  const approved = input.decision === "approved";
  return insertNotificationsDeduped(sb as never, [
    {
      user_id: input.requestedBy,
      brand_id: input.brandId,
      kind: "approval_decision",
      title: approved ? "Excedente autorizado" : "Excedente recusado",
      body: [`${input.clientName ?? "Cliente"}`, summarize([input.item])].join("\n"),
      href: `/customers/${input.clientId}?tab=trabalho`,
      dedupe_key: notificationDedupeKey("approval_decision", "plan_overage", input.requestId),
      payload: {
        client_id: input.clientId,
        overage_request_id: input.requestId,
        decision: input.decision,
        item: input.item,
      },
    },
  ]);
}
