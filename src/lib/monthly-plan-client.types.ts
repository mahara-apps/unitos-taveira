/**
 * Tipos compartilhados da aprovação de pauta pelo cliente.
 *
 * Vivem fora dos arquivos `*.server.ts` / `*.functions.ts` porque são usados
 * pelas duas pontas (portal por login e link por token) e também pela UI.
 */

export type PublicTopicClientStatus = "pending" | "approved" | "rejected" | "changes";

export type PublicPlanTopic = {
  id: string;
  topic_title: string;
  channel: string | null;
  content_format: string | null;
  angle: string | null;
  target_audience: string | null;
  rationale: string | null;
  client_status: PublicTopicClientStatus;
  client_comment: string | null;
  position: number;
};

export type PublicPlanHeader = {
  id: string;
  title: string;
  description: string | null;
  objectives: string | null;
  status: string;
  client_decision_at: string | null;
  client_feedback: string | null;
  client_decision_mode: string | null;
  created_at: string;
};

export type PublicPlanResolve = {
  plan: PublicPlanHeader;
  client: { id: string; name: string };
  topics: PublicPlanTopic[];
};

export type PublicPlanDecisionResult = {
  ok: true;
  status: string;
  approved: number;
  changes: number;
  rejected: number;
  cardsCreated: number;
};

/** Resumo usado nas listas de pauta do portal (login e token). */
export type PortalPlanSummary = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  client_decision_at: string | null;
  topics: number;
  pending: number;
};

export type PlanClientDecision = "approve" | "reject" | "changes" | "per_item";

export type PlanDecisionItem = {
  topicId: string;
  decision: "approved" | "rejected" | "changes";
  comment: string;
};

/** Pauta só aceita decisão do cliente neste status. */
export const PLAN_PENDING_CLIENT_STATUS = "pending_client";
