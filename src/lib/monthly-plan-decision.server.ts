import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLAN_PENDING_CLIENT_STATUS,
  type PlanClientDecision,
  type PlanDecisionItem,
  type PortalPlanSummary,
  type PublicPlanDecisionResult,
  type PublicPlanResolve,
  type PublicPlanTopic,
} from "@/lib/monthly-plan-client.types";

/**
 * Núcleo único da aprovação de pauta pelo cliente.
 *
 * Tanto o link público por token (`/pauta/$planId`) quanto o portal autenticado
 * chamam estas funções. As regras de negócio (feedback obrigatório, decisão
 * item-a-item completa, status resultante, materialização no Kanban) existem
 * só aqui — os dois modos apenas resolvem o escopo (cliente/marca) antes.
 */

const TOPIC_SELECT =
  "id, topic_title, channel, content_format, angle, target_audience, rationale, client_status, client_comment, position";

const PLAN_SELECT =
  "id, title, description, objectives, status, client_decision_at, client_feedback, client_decision_mode, created_at";

/** Pautas que o cliente pode ver: já liberadas para ele em algum momento. */
const CLIENT_VISIBLE_STATUS = [
  PLAN_PENDING_CLIENT_STATUS,
  "client_approved",
  "changes_requested",
  "client_rejected",
  // Histórico: pauta que o cliente aprovou e seguiu para produção (`approved`).
  // Só entra na visão do cliente se houver decisão dele registrada (ver filtro
  // `hasClientHistory`), e a decisão continua bloqueada por `plan_not_pending`.
  "approved",
];

/** `approved` só é visível como histórico quando o cliente decidiu de fato. */
const hasClientHistory = (row: { status: string; client_decision_at: string | null }) =>
  row.status !== "approved" || !!row.client_decision_at;

export async function listPlansForClient(
  sb: SupabaseClient,
  clientId: string,
): Promise<PortalPlanSummary[]> {
  const { data: plans, error } = await sb
    .from("monthly_plans")
    .select("id, title, status, created_at, client_decision_at")
    .eq("client_id", clientId)
    .in("status", CLIENT_VISIBLE_STATUS)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("plan_list_failed");

  const rows = (
    (plans ?? []) as Array<{
      id: string;
      title: string;
      status: string;
      created_at: string;
      client_decision_at: string | null;
    }>
  ).filter(hasClientHistory);
  if (rows.length === 0) return [];

  const { data: topics } = await sb
    .from("monthly_plan_topics")
    .select("monthly_plan_id, client_status")
    .in(
      "monthly_plan_id",
      rows.map((r) => r.id),
    )
    .eq("status", "approved");

  const counts = new Map<string, { topics: number; pending: number }>();
  for (const t of (topics ?? []) as Array<{
    monthly_plan_id: string;
    client_status: string | null;
  }>) {
    const c = counts.get(t.monthly_plan_id) ?? { topics: 0, pending: 0 };
    c.topics += 1;
    if (!t.client_status || t.client_status === "pending") c.pending += 1;
    counts.set(t.monthly_plan_id, c);
  }

  return rows.map((r) => {
    const c = counts.get(r.id) ?? { topics: 0, pending: 0 };
    return {
      ...r,
      topics: c.topics,
      // Só é "pendência do cliente" enquanto a pauta aguarda a decisão dele.
      pending: r.status === PLAN_PENDING_CLIENT_STATUS ? c.pending : 0,
    };
  });
}

export async function loadPlanForClient(
  sb: SupabaseClient,
  planId: string,
  clientId: string,
): Promise<PublicPlanResolve> {
  const [{ data: plan }, { data: client }, { data: topics }] = await Promise.all([
    sb
      .from("monthly_plans")
      .select(PLAN_SELECT)
      .eq("id", planId)
      .eq("client_id", clientId)
      .in("status", CLIENT_VISIBLE_STATUS)
      .maybeSingle(),
    sb.from("clients").select("id, name").eq("id", clientId).maybeSingle(),
    sb
      .from("monthly_plan_topics")
      .select(TOPIC_SELECT)
      .eq("monthly_plan_id", planId)
      .eq("status", "approved")
      .order("position", { ascending: true }),
  ]);
  if (!plan) throw new Error("plan_not_found");
  if (!hasClientHistory(plan as { status: string; client_decision_at: string | null })) {
    throw new Error("plan_not_found");
  }

  return {
    plan: plan as PublicPlanResolve["plan"],
    client: (client ?? { id: clientId, name: "Cliente" }) as PublicPlanResolve["client"],
    topics: (topics ?? []) as unknown as PublicPlanTopic[],
  };
}

type DecideInput = {
  planId: string;
  clientId: string;
  brandId: string;
  decision: PlanClientDecision;
  feedback?: string;
  items?: PlanDecisionItem[];
};

export async function decidePlanAsClient(
  sb: SupabaseClient,
  input: DecideInput,
): Promise<PublicPlanDecisionResult> {
  const feedback = (input.feedback ?? "").trim();
  if ((input.decision === "changes" || input.decision === "reject") && !feedback) {
    throw new Error("feedback_required");
  }

  const { data: planRow } = await sb
    .from("monthly_plans")
    .select("id, title, status, created_by, client_id, brand_id")
    .eq("id", input.planId)
    .eq("client_id", input.clientId)
    .maybeSingle();
  if (!planRow) throw new Error("plan_not_found");
  const plan = planRow as unknown as {
    id: string;
    title: string | null;
    status: string;
    created_by: string | null;
    client_id: string;
    brand_id: string;
  };

  if (plan.status !== PLAN_PENDING_CLIENT_STATUS) throw new Error("plan_not_pending");

  const { data: topicRows } = await sb
    .from("monthly_plan_topics")
    .select("id, topic_title, channel, content_format, angle, target_audience, rationale, position")
    .eq("monthly_plan_id", plan.id)
    .eq("status", "approved")
    .order("position", { ascending: true });
  const topics = (topicRows ?? []) as unknown as Array<{
    id: string;
    topic_title: string;
    channel: string | null;
    content_format: string | null;
    angle: string | null;
    target_audience: string | null;
    rationale: string | null;
    position: number;
  }>;
  if (topics.length === 0) throw new Error("plan_has_no_topics");

  const now = new Date().toISOString();
  const perItem = new Map<
    string,
    { decision: "approved" | "rejected" | "changes"; comment: string }
  >();

  if (input.decision === "per_item") {
    const valid = new Set(topics.map((t) => t.id));
    for (const it of input.items ?? []) {
      if (!valid.has(it.topicId)) throw new Error("invalid_topic");
      const comment = (it.comment ?? "").trim();
      if (it.decision !== "approved" && !comment) throw new Error("item_comment_required");
      perItem.set(it.topicId, { decision: it.decision, comment });
    }
    if (perItem.size !== topics.length) throw new Error("items_incomplete");
  } else {
    const mapped =
      input.decision === "approve"
        ? "approved"
        : input.decision === "reject"
          ? "rejected"
          : "changes";
    for (const t of topics) perItem.set(t.id, { decision: mapped, comment: "" });
  }

  const topicResults = await Promise.all(
    [...perItem.entries()].map(([topicId, v]) =>
      sb
        .from("monthly_plan_topics")
        .update({
          client_status: v.decision,
          client_comment: v.comment || null,
          client_decision_at: now,
        } as never)
        .eq("id", topicId)
        .eq("monthly_plan_id", plan.id),
    ),
  );
  // Falha silenciosa aqui deixaria a pauta em estado parcial: aborta explícito.
  const topicErr = topicResults.find((r) => r.error)?.error;
  if (topicErr) {
    console.error("[plan-decision] falha ao gravar decisão dos temas", {
      planId: plan.id,
      code: topicErr.code,
      message: topicErr.message,
    });
    throw new Error("decision_items_failed");
  }


  const decisions = [...perItem.values()];
  const approvedIds = [...perItem.entries()]
    .filter(([, v]) => v.decision === "approved")
    .map(([id]) => id);
  const counts = {
    approved: approvedIds.length,
    changes: decisions.filter((d) => d.decision === "changes").length,
    rejected: decisions.filter((d) => d.decision === "rejected").length,
  };

  // Status do plano: ajustes > rejeição total > aprovação.
  let status: string;
  if (counts.changes > 0) status = "changes_requested";
  else if (counts.approved === 0) status = "client_rejected";
  else status = "client_approved";

  const { error: upErr } = await sb
    .from("monthly_plans")
    .update({
      status,
      client_decision_at: now,
      client_feedback: feedback || null,
      client_decision_mode: input.decision === "per_item" ? "per_item" : "bulk",
    } as never)
    .eq("id", plan.id)
    .eq("status", PLAN_PENDING_CLIENT_STATUS);
  if (upErr) {
    console.error("[plan-decision] falha ao registrar decisão da pauta", {
      planId: plan.id,
      status,
      code: upErr.code,
      message: upErr.message,
    });
    throw new Error("decision_failed");
  }


  // Itens aprovados pelo cliente vão automaticamente para o Kanban.
  let cardsCreated = 0;
  if (counts.approved > 0) {
    const { materializePlanToKanban } = await import("@/lib/monthly-plan-kanban.server");
    const ready = topics.filter((t) => approvedIds.includes(t.id));
    try {
      const res = await materializePlanToKanban(sb, {
        planId: plan.id,
        brandId: input.brandId || plan.brand_id,
        clientId: input.clientId,
        userId: plan.created_by,
        topics: ready,
        markPlanApproved: status === "client_approved",
      });
      cardsCreated = res.created;
    } catch {
      // Não bloqueia a decisão do cliente; a equipe reprocessa na tela da pauta.
      cardsCreated = 0;
    }
  }

  // Avisa a equipe (sino + /notifications). Best-effort.
  try {
    const { notifyPlanClientDecision } = await import("@/lib/monthly-plan-decision-notify.server");
    const { data: clientRow } = await sb
      .from("clients")
      .select("name")
      .eq("id", input.clientId)
      .maybeSingle();
    await notifyPlanClientDecision(sb, {
      planId: plan.id,
      planTitle: plan.title,
      clientId: input.clientId,
      clientName: (clientRow as { name?: string } | null)?.name ?? null,
      brandId: input.brandId || plan.brand_id,
      createdBy: plan.created_by,
      status: status as "client_approved" | "changes_requested" | "client_rejected",
      ...counts,
      feedback,
    });
  } catch (err) {
    console.error("[plan-decision] falha ao notificar equipe", {
      planId: plan.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, status, ...counts, cardsCreated };

}
