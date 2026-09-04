// ⚠️ Brain — Social Metrics Sync Worker.
//
// Baixa/roll-up de métricas de publicações sociais (últimos 30 dias) para
// dentro do Brain como eventos `social.metrics_sync`. Assim, quando um agente
// (ex.: Pauta Mensal) chamar `brain.getContext`, as métricas JÁ ESTÃO no
// banco do Brain — sem chamada síncrona à API da Meta na hora de gerar.
//
// Fonte primária: tabela `social_posts` (posts publicados pela plataforma).
// Roll-up: por (brand_id, client_id, provider) contamos publicações, taxa de
// sucesso, formatos mais usados e IDs dos posts recentes. É o mínimo útil e
// escala sem chamadas externas. Provedores específicos (Meta insights) podem
// ser adicionados aqui incrementalmente sem quebrar consumidores.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LOOKBACK_DAYS = 30;
const MAX_GROUPS = 200;

type Row = {
  brand_id: string;
  client_id: string | null;
  provider: string;
  status: string;
  placement: string | null;
  external_permalink: string | null;
  published_at: string | null;
};

export type MetricsSyncReport = {
  posts_scanned: number;
  groups_published: number;
};

export async function runSocialMetricsSync(): Promise<MetricsSyncReport> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .select("brand_id, client_id, provider, status, placement, external_permalink, published_at")
    .gte("created_at", since)
    .limit(5000);
  if (error) throw error;

  const posts = (data ?? []) as Row[];
  const buckets = new Map<
    string,
    {
      brand_id: string;
      client_id: string | null;
      provider: string;
      total: number;
      published: number;
      failed: number;
      scheduled: number;
      formats: Record<string, number>;
      recent_permalinks: string[];
    }
  >();

  for (const p of posts) {
    const key = `${p.brand_id}::${p.client_id ?? "-"}::${p.provider}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        brand_id: p.brand_id,
        client_id: p.client_id,
        provider: p.provider,
        total: 0,
        published: 0,
        failed: 0,
        scheduled: 0,
        formats: {},
        recent_permalinks: [],
      };
      buckets.set(key, b);
    }
    b.total += 1;
    if (p.status === "published") b.published += 1;
    else if (p.status === "failed") b.failed += 1;
    else if (p.status === "scheduled") b.scheduled += 1;
    const fmt = p.placement || "unknown";
    b.formats[fmt] = (b.formats[fmt] ?? 0) + 1;
    if (p.external_permalink && b.recent_permalinks.length < 5) {
      b.recent_permalinks.push(p.external_permalink);
    }
  }

  let published = 0;
  const events: Array<Record<string, unknown>> = [];
  for (const b of buckets.values()) {
    if (published >= MAX_GROUPS) break;
    const successRate = b.total > 0 ? Math.round((b.published / b.total) * 100) / 100 : 0;
    events.push({
      brand_id: b.brand_id,
      client_id: b.client_id,
      source_module: "analytics",
      event_type: "social.metrics_sync",
      payload: {
        provider: b.provider,
        window_days: LOOKBACK_DAYS,
        total: b.total,
        published: b.published,
        failed: b.failed,
        scheduled: b.scheduled,
        success_rate: successRate,
        top_formats: Object.entries(b.formats)
          .sort((a, b2) => b2[1] - a[1])
          .slice(0, 5)
          .map(([format, count]) => ({ format, count })),
        recent_permalinks: b.recent_permalinks,
      },
    });
    published += 1;
  }

  if (events.length) {
    const { error: insErr } = await supabaseAdmin.from("brain_events").insert(events as never);
    if (insErr) throw insErr;
  }

  return { posts_scanned: posts.length, groups_published: events.length };
}
