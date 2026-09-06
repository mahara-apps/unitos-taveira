import type { SupabaseClient } from "@supabase/supabase-js";
import { insertNotificationsDeduped, notificationDedupeKey } from "@/lib/notifications-dedupe";

/**
 * Avisa a equipe interna quando o cliente decide sobre a pauta mensal.
 *
 * Destinatários: quem criou a pauta + owners/admins/managers do workspace +
 * membros internos atribuídos àquele cliente (`client_members`, exceto contas
 * de portal, que são o próprio cliente).
 *
 * Best-effort: a decisão do cliente nunca é invalidada por falha aqui.
 */

const INTERNAL_BRAND_ROLES = ["owner", "admin", "manager"];
const PORTAL_ROLE = "portal_client";

export type PlanDecisionNotifyInput = {
  planId: string;
  planTitle: string | null;
  clientId: string;
  clientName: string | null;
  brandId: string;
  createdBy: string | null;
  status: "client_approved" | "changes_requested" | "client_rejected";
  approved: number;
  changes: number;
  rejected: number;
  feedback: string;
};

const TITLE: Record<PlanDecisionNotifyInput["status"], string> = {
  client_approved: "Cliente aprovou a pauta",
  changes_requested: "Cliente pediu ajustes na pauta",
  client_rejected: "Cliente rejeitou a pauta",
};

export async function notifyPlanClientDecision(
  sb: SupabaseClient,
  input: PlanDecisionNotifyInput,
): Promise<number> {
  const recipients = new Set<string>();
  if (input.createdBy) recipients.add(input.createdBy);

  const [{ data: brandMembers }, { data: clientMembers }] = await Promise.all([
    sb
      .from("brand_members")
      .select("user_id, role")
      .eq("brand_id", input.brandId)
      .in("role", INTERNAL_BRAND_ROLES),
    sb.from("client_members").select("user_id, role").eq("client_id", input.clientId),
  ]);

  for (const m of (brandMembers ?? []) as Array<{ user_id: string }>) {
    if (m.user_id) recipients.add(m.user_id);
  }
  for (const m of (clientMembers ?? []) as Array<{ user_id: string; role: string | null }>) {
    if (m.user_id && m.role !== PORTAL_ROLE) recipients.add(m.user_id);
  }
  if (recipients.size === 0) return 0;

  const who = input.clientName ? `${input.clientName}` : "Cliente";
  const plan = input.planTitle ? `“${input.planTitle}”` : "pauta do mês";
  const parts = [
    `${input.approved} aprovada(s)`,
    `${input.changes} com ajuste`,
    `${input.rejected} rejeitada(s)`,
  ];
  const body = [`${who} · ${plan} — ${parts.join(" · ")}`, input.feedback || null]
    .filter(Boolean)
    .join("\n");

  const dedupeKey = notificationDedupeKey("approval_decision", "monthly_plan", input.planId);

  return insertNotificationsDeduped(
    sb as never,
    [...recipients].map((userId) => ({
      user_id: userId,
      brand_id: input.brandId,
      kind: "approval_decision",
      title: TITLE[input.status],
      body,
      href: `/customers/${input.clientId}?tab=pauta`,
      dedupe_key: dedupeKey,
      payload: {
        monthly_plan_id: input.planId,
        client_id: input.clientId,
        status: input.status,
        approved: input.approved,
        changes: input.changes,
        rejected: input.rejected,
        feedback: input.feedback || null,
      },
    })),
  );
}
