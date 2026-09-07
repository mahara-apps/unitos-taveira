/**
 * Leitura da Graph API de Anúncios (Meta) — SOMENTE LEITURA.
 *
 * Requer o escopo `ads_read`. Nenhuma função aqui escreve na Meta: não há
 * criação/edição de campanha, orçamento ou status. Toda paginação tem teto de
 * páginas e deadline, no mesmo padrão de `provider.server.ts`.
 */
import { MetaGraphError, MetaProvider } from "@/lib/meta/provider.server";

const MAX_PAGES_PER_EDGE = 20;
const SCAN_DEADLINE_MS = 45_000;

type Paged<T> = { data?: T[]; paging?: { next?: string; cursors?: { after?: string } } };

export type MetaEntityRow = {
  level: "campaign" | "adset" | "ad";
  externalId: string;
  parentExternalId: string | null;
  name: string | null;
  objective: string | null;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  startTime: string | null;
  stopTime: string | null;
};

export type MetaCreativeRow = {
  adExternalId: string;
  creativeExternalId: string | null;
  title: string | null;
  body: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  linkUrl: string | null;
  callToAction: string | null;
};

export type MetaInsightRow = {
  level: "campaign" | "adset" | "ad";
  entityExternalId: string;
  statDate: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  results: number;
  resultKind: string | null;
  raw: Record<string, unknown>;
};

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

/** Percorre uma edge paginada com teto de páginas e deadline. */
async function collect<T>(
  provider: MetaProvider,
  path: string,
  token: string,
  query: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  const deadline = Date.now() + SCAN_DEADLINE_MS;
  let after: string | null = null;
  let page = 0;
  while (page < MAX_PAGES_PER_EDGE && Date.now() < deadline) {
    page += 1;
    const res: Paged<T> = await provider.graph<Paged<T>>(path, {
      accessToken: token,
      query: after ? { ...query, after } : query,
    });
    for (const row of res.data ?? []) out.push(row);
    const next = res.paging?.next ? (res.paging.cursors?.after ?? null) : null;
    if (!next) break;
    after = next;
  }
  return out;
}

/** Campanhas, conjuntos e anúncios da conta (estrutura, sem métricas). */
export async function fetchMetaEntities(
  provider: MetaProvider,
  token: string,
  accountExternalId: string,
): Promise<{ entities: MetaEntityRow[]; creatives: MetaCreativeRow[] }> {
  const acct = accountExternalId.startsWith("act_")
    ? accountExternalId
    : `act_${accountExternalId}`;
  const entities: MetaEntityRow[] = [];
  const creatives: MetaCreativeRow[] = [];

  type Campaign = {
    id: string;
    name?: string;
    objective?: string;
    status?: string;
    effective_status?: string;
    daily_budget?: string;
    lifetime_budget?: string;
    start_time?: string;
    stop_time?: string;
  };
  const campaigns = await collect<Campaign>(provider, `/${acct}/campaigns`, token, {
    fields:
      "id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time",
    limit: "200",
  });
  for (const c of campaigns) {
    entities.push({
      level: "campaign",
      externalId: c.id,
      parentExternalId: null,
      name: c.name ?? null,
      objective: c.objective ?? null,
      status: c.status ?? null,
      effectiveStatus: c.effective_status ?? null,
      dailyBudget: c.daily_budget ? num(c.daily_budget) / 100 : null,
      lifetimeBudget: c.lifetime_budget ? num(c.lifetime_budget) / 100 : null,
      startTime: c.start_time ?? null,
      stopTime: c.stop_time ?? null,
    });
  }

  type AdSet = Campaign & { campaign_id?: string; optimization_goal?: string };
  const adsets = await collect<AdSet>(provider, `/${acct}/adsets`, token, {
    fields:
      "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,optimization_goal",
    limit: "200",
  });
  for (const a of adsets) {
    entities.push({
      level: "adset",
      externalId: a.id,
      parentExternalId: a.campaign_id ?? null,
      name: a.name ?? null,
      objective: a.optimization_goal ?? null,
      status: a.status ?? null,
      effectiveStatus: a.effective_status ?? null,
      dailyBudget: a.daily_budget ? num(a.daily_budget) / 100 : null,
      lifetimeBudget: a.lifetime_budget ? num(a.lifetime_budget) / 100 : null,
      startTime: a.start_time ?? null,
      stopTime: (a as { end_time?: string }).end_time ?? null,
    });
  }

  type Ad = {
    id: string;
    name?: string;
    adset_id?: string;
    status?: string;
    effective_status?: string;
    creative?: {
      id?: string;
      title?: string;
      name?: string;
      body?: string;
      thumbnail_url?: string;
      image_url?: string;
      video_id?: string;
      object_story_spec?: {
        link_data?: {
          link?: string;
          message?: string;
          name?: string;
          call_to_action?: { type?: string };
        };
        video_data?: {
          message?: string;
          title?: string;
          video_id?: string;
          call_to_action?: { type?: string; value?: { link?: string } };
        };
      };
    };
  };
  const ads = await collect<Ad>(provider, `/${acct}/ads`, token, {
    fields:
      "id,name,adset_id,status,effective_status,creative{id,name,title,body,thumbnail_url,image_url,video_id,object_story_spec}",
    limit: "100",
  });
  for (const ad of ads) {
    entities.push({
      level: "ad",
      externalId: ad.id,
      parentExternalId: ad.adset_id ?? null,
      name: ad.name ?? null,
      objective: null,
      status: ad.status ?? null,
      effectiveStatus: ad.effective_status ?? null,
      dailyBudget: null,
      lifetimeBudget: null,
      startTime: null,
      stopTime: null,
    });
    const cr = ad.creative;
    if (!cr) continue;
    const link = cr.object_story_spec?.link_data;
    const video = cr.object_story_spec?.video_data;
    creatives.push({
      adExternalId: ad.id,
      creativeExternalId: cr.id ?? null,
      title: cr.title ?? link?.name ?? video?.title ?? cr.name ?? null,
      body: cr.body ?? link?.message ?? video?.message ?? null,
      thumbnailUrl: cr.thumbnail_url ?? null,
      imageUrl: cr.image_url ?? null,
      videoId: cr.video_id ?? video?.video_id ?? null,
      linkUrl: link?.link ?? video?.call_to_action?.value?.link ?? null,
      callToAction: link?.call_to_action?.type ?? video?.call_to_action?.type ?? null,
    });
  }

  return { entities, creatives };
}

/** Ordem de preferência do "resultado" principal de um anúncio. */
const RESULT_PRIORITY = [
  "purchase",
  "omni_purchase",
  "lead",
  "onsite_conversion_lead_grouped",
  "onsite_conversion_messaging_conversation_started_7d",
  "landing_page_view",
  "link_click",
  "post_engagement",
  "video_view",
];

function pickResult(actions: Array<{ action_type?: string; value?: string }> | undefined): {
  results: number;
  kind: string | null;
} {
  if (!actions?.length) return { results: 0, kind: null };
  for (const kind of RESULT_PRIORITY) {
    const hit = actions.find((a) => a.action_type === kind);
    if (hit) return { results: num(hit.value), kind };
  }
  const first = actions[0];
  return { results: num(first?.value), kind: first?.action_type ?? null };
}

/** Métricas diárias por nível, no período fechado informado. */
export async function fetchMetaInsights(
  provider: MetaProvider,
  token: string,
  accountExternalId: string,
  level: "campaign" | "adset" | "ad",
  since: string,
  until: string,
): Promise<MetaInsightRow[]> {
  const acct = accountExternalId.startsWith("act_")
    ? accountExternalId
    : `act_${accountExternalId}`;
  type Row = {
    date_start?: string;
    campaign_id?: string;
    adset_id?: string;
    ad_id?: string;
    spend?: string;
    impressions?: string;
    reach?: string;
    clicks?: string;
    inline_link_clicks?: string;
    actions?: Array<{ action_type?: string; value?: string }>;
  };
  const rows = await collect<Row>(provider, `/${acct}/insights`, token, {
    level,
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: "spend,impressions,reach,clicks,inline_link_clicks,actions",
    limit: "500",
  });
  const out: MetaInsightRow[] = [];
  for (const r of rows) {
    const entityId =
      level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : r.ad_id;
    if (!entityId || !r.date_start) continue;
    const { results, kind } = pickResult(r.actions);
    out.push({
      level,
      entityExternalId: entityId,
      statDate: r.date_start,
      spend: num(r.spend),
      impressions: num(r.impressions),
      reach: num(r.reach),
      clicks: num(r.clicks),
      linkClicks: num(r.inline_link_clicks),
      results,
      resultKind: kind,
      raw: { actions: r.actions ?? [] },
    });
  }
  return out;
}

export { MetaGraphError, MetaProvider };
