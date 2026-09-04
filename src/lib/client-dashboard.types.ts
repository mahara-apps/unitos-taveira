// Tipos client-safe da central de acompanhamento da conta do cliente.
// Somente leitura: nenhum dado é criado/alterado por este módulo.

export type ClientStageStat = {
  id: string;
  key: string;
  label: string;
  count: number;
  share: number;
};

export type ClientAttentionItem = {
  id: string;
  severity: "critical" | "warning";
  title: string;
  description: string;
  detail: string | null;
  action: { label: string; to: string; search?: Record<string, string> } | null;
};

export type ClientUpcomingItem = {
  id: string;
  title: string;
  scheduledAt: string;
  channels: string[];
  format: string | null;
  status: "scheduled" | "awaiting_approval" | "failed" | "published";
};

export type ClientActivityItem = {
  id: string;
  title: string;
  description: string;
  at: string;
  tone: "neutral" | "positive" | "attention";
};

export type ClientDashboard = {
  generatedAt: string;
  rangeDays: number;
  client: { id: string; name: string; niche: string | null } | null;

  /** Pipeline real (etapas do Kanban do cliente). */
  stages: ClientStageStat[];
  pipelineTotal: number;
  bottleneck: { label: string; count: number; share: number } | null;

  approvalsPending: number;
  approvalsDecided: number;

  publishedInRange: number;
  publishedPreviousRange: number | null;
  /** Série do período atual + série alinhada do período anterior (comparação). */
  publishTrend: Array<{ day: string; count: number; previous: number | null }>;

  avgPerWeek: number | null;
  bestDay: { day: string; count: number } | null;

  /** `label` = plataforma (Instagram, Facebook…); `handle` = @perfil opcional. */
  channelBreakdown: Array<{
    channel: string;
    label?: string;
    handle?: string | null;
    count: number;
    share: number;
  }>;

  scheduledCount: number;
  /** Total de conteúdos com agendamento futuro (independente do horizonte de 7 dias). */
  upcomingTotal: number;
  failedCount: number;
  connectionsNeedingAttention: number;
  /** Conteúdos sem movimentação há muitos dias (gargalo silencioso). */
  stalled: { count: number; days: number; stageLabel: string | null } | null;

  upcoming: ClientUpcomingItem[];
  attention: ClientAttentionItem[];
  activity: ClientActivityItem[];

  /** Métricas de alcance/engajamento só existem quando há coleta real. */
  hasPerformanceData: boolean;
};
