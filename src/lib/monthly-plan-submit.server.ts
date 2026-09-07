/**
 * Encaminhamento da pauta para a etapa seguinte — ponto ÚNICO da regra.
 *
 * Reusado pelo fluxo completo ("Enviar ao cliente") e pela rota rápida
 * (mini-pauta expressa). A política de aprovação do cliente é sempre
 * consultada aqui: quando o cliente não aprova pauta, o time segue direto e as
 * peças nascem em Produção (com a legenda escrita pelos agentes); quando
 * aprova, gera/reaproveita o link do portal e nada entra em produção.
 *
 * Nada é privilegiado: todas as escritas usam o client do usuário (RLS).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type SubmitPlanResult = {
  /** Nulo quando o cliente não aprova pauta (etapa dispensada na regra dele). */
  token: string | null;
  url: string | null;
  expires_at: string | null;
  /** true = seguiu direto para produção, sem espera pelo cliente. */
  waived?: boolean;
  /** Cards criados no Kanban quando a etapa é dispensada. */
  cardsCreated?: number;
};

function randomToken(len = 40): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

/** Item só pode virar card com plataforma e formato definidos. */
function topicReady(t: { channel: string | null; content_format: string | null }): boolean {
  return !!(t.channel && t.channel.trim() && t.content_format && t.content_format.trim());
}

export async function submitPlanForApproval(
  sb: SupabaseClient,
  args: { planId: string; userId: string | null; expiresInDays?: number },
): Promise<SubmitPlanResult> {
  const expiresInDays = args.expiresInDays ?? 14;

  const { data: planRow } = await sb
    .from("monthly_plans")
    .select("id, brand_id, client_id, status, title, project_id")
    .eq("id", args.planId)
    .maybeSingle();
  if (!planRow) throw new Error("plan_not_found");
  const plan = planRow as unknown as {
    id: string;
    brand_id: string;
    client_id: string;
    project_id: string | null;
  };

  // Projeto é obrigatório e explícito: nada é gravado antes dessa checagem.
  if (!plan.project_id) throw new Error("project_required");

  const { data: topics } = await sb
    .from("monthly_plan_topics")
    .select("id, status, channel, content_format")
    .eq("monthly_plan_id", plan.id);
  const list = (topics ?? []) as unknown as Array<{
    id: string;
    status: string;
    channel: string | null;
    content_format: string | null;
  }>;
  if (list.length === 0) throw new Error("plan_has_no_topics");
  if (list.some((t) => t.status === "pending")) throw new Error("topics_pending_decision");
  const approved = list.filter((t) => t.status === "approved");
  if (approved.length === 0) throw new Error("no_approved_topics");
  if (approved.some((t) => !topicReady(t))) throw new Error("topics_incomplete");

  // Regra do cliente: se a pauta não exige aprovação do cliente, o time
  // avança direto — sem link, sem pendência no portal, sem espera.
  const { requiresClientApproval } = await import("@/lib/client-policy.server");
  const needsClient = await requiresClientApproval(
    sb,
    { brandId: plan.brand_id, clientId: plan.client_id },
    "plan",
  );
  if (!needsClient) {
    const now = new Date().toISOString();
    await sb
      .from("monthly_plans")
      .update({
        internal_approved_at: now,
        client_decision_at: now,
        client_decision_mode: "internal_waived",
      } as never)
      .eq("id", plan.id);
    const { materializePlanToKanban } = await import("@/lib/monthly-plan-kanban.server");
    const res = await materializePlanToKanban(sb, {
      planId: plan.id,
      brandId: plan.brand_id,
      clientId: plan.client_id,
      userId: args.userId,
    });
    return { token: null, url: null, expires_at: null, waived: true, cardsCreated: res.created };
  }

  // Reaproveita um link válido, se existir.
  const { data: existing } = await sb
    .from("monthly_plan_tokens")
    .select("token, expires_at, revoked_at")
    .eq("monthly_plan_id", plan.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const found = (existing ?? [])[0] as { token: string; expires_at: string | null } | undefined;

  let token = found?.token ?? null;
  let expiresAt = found?.expires_at ?? null;
  if (!token || (expiresAt && new Date(expiresAt).getTime() < Date.now())) {
    token = randomToken(40);
    expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
    const { error: insErr } = await sb.from("monthly_plan_tokens").insert({
      monthly_plan_id: plan.id,
      brand_id: plan.brand_id,
      client_id: plan.client_id,
      token,
      expires_at: expiresAt,
      created_by: args.userId,
    } as never);
    if (insErr) throw insErr;
  }

  const { error: upErr } = await sb
    .from("monthly_plans")
    .update({
      status: "pending_client",
      internal_approved_at: new Date().toISOString(),
      internal_approved_by: args.userId,
      client_decision_at: null,
      client_feedback: null,
      client_decision_mode: null,
    } as never)
    .eq("id", plan.id);
  if (upErr) throw upErr;

  // Reenvio: limpa decisões anteriores dos itens que ainda não viraram card.
  await sb
    .from("monthly_plan_topics")
    .update({ client_status: "pending", client_comment: null, client_decision_at: null } as never)
    .eq("monthly_plan_id", plan.id)
    .neq("client_status", "approved");

  // Reconcilia o vínculo do projeto já escolhido (nunca cria projeto sozinho).
  const { reconcilePlanProjectLink } = await import("@/lib/monthly-plan-project.server");
  await reconcilePlanProjectLink(sb as never, { planId: plan.id, projectId: plan.project_id });

  return { token, url: `/pauta/${plan.id}?token=${token}`, expires_at: expiresAt };
}
