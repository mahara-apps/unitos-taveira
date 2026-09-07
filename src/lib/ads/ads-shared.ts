import { z } from "zod";

/**
 * Tipos e contratos compartilhados do Relatório de Anúncios (Mídia Paga).
 *
 * Este arquivo é client-safe: nunca importe nada de `*.server.ts` aqui.
 */

export type AdsLevel = "account" | "campaign" | "adset" | "ad";

export const AdsLevelSchema = z.enum(["account", "campaign", "adset", "ad"]);

export type AdAccountRow = {
  id: string;
  provider: "meta" | "google";
  externalId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  accountStatus: number | null;
  businessName: string | null;
  lastSyncedAt: string | null;
  syncStatus: "not_loaded" | "loaded" | "empty" | "error" | "rate_limited";
  syncError: string | null;
  /** Clientes vinculados a esta conta de anúncio. */
  clients: Array<{ linkId: string; clientId: string; clientName: string | null }>;
};

export type AdsMetrics = {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  results: number;
  /** Métricas derivadas — calculadas, nunca somadas. */
  ctr: number;
  cpc: number;
  cpm: number;
  costPerResult: number;
  frequency: number;
};

export const EMPTY_METRICS: AdsMetrics = {
  spend: 0,
  impressions: 0,
  reach: 0,
  clicks: 0,
  linkClicks: 0,
  results: 0,
  ctr: 0,
  cpc: 0,
  cpm: 0,
  costPerResult: 0,
  frequency: 0,
};

export type AdsSeriesPoint = { date: string } & AdsMetrics;

export type AdsRowItem = {
  level: AdsLevel;
  externalId: string;
  parentExternalId: string | null;
  name: string;
  status: string | null;
  objective: string | null;
  metrics: AdsMetrics;
  creative?: {
    title: string | null;
    body: string | null;
    thumbnailUrl: string | null;
    imageUrl: string | null;
    linkUrl: string | null;
    callToAction: string | null;
    videoId: string | null;
  } | null;
};

export type AdsReport = {
  account: {
    id: string;
    externalId: string;
    name: string | null;
    currency: string;
    lastSyncedAt: string | null;
    syncStatus: AdAccountRow["syncStatus"];
    syncError: string | null;
  } | null;
  range: { since: string; until: string };
  totals: AdsMetrics;
  /** Totais do período anterior equivalente, quando a comparação é pedida. */
  previous: AdsMetrics | null;
  series: AdsSeriesPoint[];
  rows: AdsRowItem[];
  /** Resultado predominante do período, em linguagem simples. */
  resultLabel: string | null;
  hasData: boolean;
};

// --------------------------------------------------------------- Validators

export const ListAccountsInput = z.object({ brandId: z.string().uuid() });

export const DiscoverAccountsInput = z.object({ brandId: z.string().uuid() });

export const LinkAccountInput = z.object({
  brandId: z.string().uuid(),
  adAccountId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export const UnlinkAccountInput = z.object({
  brandId: z.string().uuid(),
  linkId: z.string().uuid(),
});

export const SyncAccountInput = z.object({
  brandId: z.string().uuid(),
  adAccountId: z.string().uuid(),
  /** Janela de dias sincronizada (padrão 90). */
  days: z.number().int().min(1).max(365).optional(),
});

export const ReportInput = z.object({
  brandId: z.string().uuid(),
  adAccountId: z.string().uuid(),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  level: AdsLevelSchema.default("campaign"),
  /** Filtra pelo pai (campanha -> conjuntos; conjunto -> anúncios). */
  parentExternalId: z.string().min(1).nullable().optional(),
  compare: z.boolean().optional(),
});

// ------------------------------------------------------------------ Helpers

/** Deriva as métricas calculadas a partir dos totais somados. */
export function withDerived(base: {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  results: number;
}): AdsMetrics {
  const div = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    ...base,
    ctr: div(base.clicks, base.impressions) * 100,
    cpc: div(base.spend, base.clicks),
    cpm: div(base.spend, base.impressions) * 1000,
    costPerResult: div(base.spend, base.results),
    frequency: div(base.impressions, base.reach),
  };
}

/** Nome amigável dos resultados vindos da Meta (sem jargão de API). */
export const RESULT_LABELS: Record<string, string> = {
  purchase: "Compras",
  omni_purchase: "Compras",
  lead: "Cadastros",
  onsite_conversion_lead_grouped: "Cadastros",
  onsite_conversion_messaging_conversation_started_7d: "Conversas iniciadas",
  onsite_conversion_messaging_first_reply: "Conversas iniciadas",
  link_click: "Cliques no link",
  landing_page_view: "Visitas na página",
  post_engagement: "Interações",
  video_view: "Visualizações de vídeo",
  page_engagement: "Interações na página",
};

export function resultLabelFor(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return RESULT_LABELS[kind] ?? "Resultados";
}

/** Objetivos da Meta em linguagem de negócio. */
export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: "Vendas",
  OUTCOME_LEADS: "Cadastros",
  OUTCOME_ENGAGEMENT: "Engajamento",
  OUTCOME_TRAFFIC: "Tráfego",
  OUTCOME_AWARENESS: "Reconhecimento",
  OUTCOME_APP_PROMOTION: "Aplicativo",
  CONVERSIONS: "Conversões",
  LINK_CLICKS: "Tráfego",
  LEAD_GENERATION: "Cadastros",
  MESSAGES: "Mensagens",
  REACH: "Alcance",
  BRAND_AWARENESS: "Reconhecimento",
  VIDEO_VIEWS: "Vídeo",
  POST_ENGAGEMENT: "Engajamento",
};

export function objectiveLabel(objective: string | null | undefined): string | null {
  if (!objective) return null;
  return OBJECTIVE_LABELS[objective] ?? objective.replace(/_/g, " ").toLowerCase();
}

/** Situação da entidade em português, sem siglas da Meta. */
export function statusLabel(status: string | null | undefined): string {
  switch ((status ?? "").toUpperCase()) {
    case "ACTIVE":
      return "Ativo";
    case "PAUSED":
    case "ADSET_PAUSED":
    case "CAMPAIGN_PAUSED":
      return "Pausado";
    case "ARCHIVED":
      return "Arquivado";
    case "DELETED":
      return "Excluído";
    case "IN_PROCESS":
    case "PENDING_REVIEW":
      return "Em revisão";
    case "DISAPPROVED":
      return "Reprovado";
    case "WITH_ISSUES":
      return "Com pendência";
    default:
      return status ? status.replace(/_/g, " ").toLowerCase() : "—";
  }
}

export const LEVEL_LABELS: Record<AdsLevel, string> = {
  account: "Conta",
  campaign: "Campanha",
  adset: "Conjunto",
  ad: "Anúncio",
};
