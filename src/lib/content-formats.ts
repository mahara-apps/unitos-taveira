/**
 * MAPA CANÔNICO DE FORMATOS DE CONTEÚDO — fonte única do projeto.
 *
 * Identificadores técnicos (o que vai ao banco) = os mesmos já usados pelo
 * CHECK de `public.post_placements`: 'feed' | 'stories' | 'reels' | 'carrossel'.
 * A UI apresenta labels amigáveis; o banco continua com as chaves técnicas.
 *
 * Este módulo é isomórfico (cliente + servidor) e substitui o vocabulário
 * antigo `PLAN_FORMATS` ("Reels", "Storie", "Post estático", "Vídeo curto"),
 * que continua sendo aceito na LEITURA para compatibilidade com dados legados.
 */

import { FORMATS_BY_CHANNEL, FORMAT_LABEL, type PlacementFormat } from "@/lib/scheduling-formats";
import { PLAN_CHANNELS, type PlanChannel } from "@/lib/monthly-plan-fields";

/** Formato canônico — idêntico ao enum de placements. */
export type ContentFormat = PlacementFormat;

export const CONTENT_FORMATS: readonly ContentFormat[] = [
  "feed",
  "stories",
  "reels",
  "carrossel",
] as const;

/** Label de UI. Mesma fonte usada pelo wizard de agendamento. */
export const CONTENT_FORMAT_LABEL: Record<ContentFormat, string> = FORMAT_LABEL;

/** Formatos válidos por canal — reaproveita a regra existente do projeto. */
export function formatsForChannel(channel: string): ContentFormat[] {
  return (FORMATS_BY_CHANNEL[channel as PlanChannel] ?? []) as ContentFormat[];
}

/**
 * Aliases aceitos na leitura: vocabulário legado da Pauta, do gerador de
 * ideias e variações de digitação. Nunca cria formato novo — sempre resolve
 * para uma das 4 chaves canônicas.
 */
const ALIASES: Record<string, ContentFormat> = {
  feed: "feed",
  "post estatico": "feed",
  "post estático": "feed",
  post: "feed",
  estatico: "feed",
  imagem: "feed",
  stories: "stories",
  storie: "stories",
  story: "stories",
  stories_frame: "stories",
  reels: "reels",
  reel: "reels",
  "video curto": "reels",
  "vídeo curto": "reels",
  video: "reels",
  vídeo: "reels",
  shorts: "reels",
  tiktok: "reels",
  carrossel: "carrossel",
  carousel: "carrossel",
  carrocel: "carrossel",
};

/** Resolve qualquer grafia (técnica, label ou legado) para a chave canônica. */
export function normalizeContentFormat(raw: unknown): ContentFormat | null {
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (!s) return null;
  if (ALIASES[s]) return ALIASES[s]!;
  if (s.startsWith("reel")) return "reels";
  if (s.startsWith("stor")) return "stories";
  if (s.startsWith("carr") || s.startsWith("carou")) return "carrossel";
  if (s.startsWith("feed") || s.startsWith("post")) return "feed";
  return null;
}

/** Label amigável de qualquer valor armazenado (canônico ou legado). */
export function contentFormatLabel(raw: unknown): string {
  const f = normalizeContentFormat(raw);
  if (f) return CONTENT_FORMAT_LABEL[f];
  const s = (raw ?? "").toString().trim();
  return s || "—";
}

/** Formato padrão de um canal (usado como último recurso na normalização). */
export function defaultFormatForChannel(channel: string): ContentFormat {
  return formatsForChannel(channel)[0] ?? "feed";
}

/* ---------------------------------------------------------------------------
 * VOLUMETRIA POR CANAL + FORMATO
 *
 * Estrutura em `clients.brand_hub.volumetry_breakdown`:
 *   { instagram: { feed: 4, stories: 4, reels: 2 }, tiktok: { reels: 3 } }
 *
 * `volumetry[canal]` continua existindo e passa a ser SEMPRE a soma do
 * breakdown do canal quando o breakdown existir (sincronizados na gravação).
 * ------------------------------------------------------------------------- */

export type VolumetryBreakdown = Partial<
  Record<PlanChannel, Partial<Record<ContentFormat, number>>>
>;

/** Limpa/normaliza um breakdown vindo do banco ou do formulário. */
export function normalizeVolumetryBreakdown(raw: unknown): VolumetryBreakdown {
  const out: VolumetryBreakdown = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [chRaw, formatsRaw] of Object.entries(raw as Record<string, unknown>)) {
    const channel = chRaw.trim().toLowerCase() as PlanChannel;
    if (!PLAN_CHANNELS.includes(channel)) continue;
    if (!formatsRaw || typeof formatsRaw !== "object") continue;
    const allowed = formatsForChannel(channel);
    const bucket: Partial<Record<ContentFormat, number>> = {};
    for (const [fRaw, qtyRaw] of Object.entries(formatsRaw as Record<string, unknown>)) {
      const f = normalizeContentFormat(fRaw);
      if (!f || !allowed.includes(f)) continue;
      const qty = Math.max(0, Math.round(Number(qtyRaw) || 0));
      if (qty > 0) bucket[f] = (bucket[f] ?? 0) + qty;
    }
    if (Object.keys(bucket).length > 0) out[channel] = bucket;
  }
  return out;
}

/** Soma de um canal no breakdown. */
export function sumChannelBreakdown(
  bucket: Partial<Record<ContentFormat, number>> | undefined,
): number {
  if (!bucket) return 0;
  return Object.values(bucket).reduce((s, n) => s + (Number(n) || 0), 0);
}

/** true quando o canal já tem distribuição por formato configurada. */
export function hasChannelBreakdown(breakdown: VolumetryBreakdown, channel: string): boolean {
  return sumChannelBreakdown(breakdown[channel as PlanChannel]) > 0;
}

/**
 * Deriva `volumetry[canal]` a partir do breakdown, preservando o valor antigo
 * dos canais que ainda não possuem breakdown (compatibilidade).
 */
export function deriveVolumetryTotals(
  breakdown: VolumetryBreakdown,
  previous: Record<string, number | undefined> = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of PLAN_CHANNELS) {
    const sum = sumChannelBreakdown(breakdown[c]);
    out[c] = sum > 0 ? sum : Math.max(0, Math.round(Number(previous[c] ?? 0) || 0));
  }
  return out;
}

/**
 * Materializa um breakdown para um canal que só tem total (cliente legado):
 * distribui o total entre os formatos permitidos/preferidos, de forma
 * determinística (sem round-robin aleatório) — usado apenas como FALLBACK de
 * leitura, nunca sobrescreve dados do cliente.
 */
export function breakdownFromTotal(
  channel: string,
  total: number,
  preferredFormats: string[] = [],
): Partial<Record<ContentFormat, number>> {
  const t = Math.max(0, Math.round(Number(total) || 0));
  if (t <= 0) return {};
  const allowed = formatsForChannel(channel);
  const preferred = preferredFormats
    .map((f) => normalizeContentFormat(f))
    .filter((f): f is ContentFormat => !!f && allowed.includes(f));
  const pool = preferred.length ? Array.from(new Set(preferred)) : allowed;
  if (!pool.length) return {};
  const out: Partial<Record<ContentFormat, number>> = {};
  const base = Math.floor(t / pool.length);
  let rest = t - base * pool.length;
  for (const f of pool) {
    const extra = rest > 0 ? 1 : 0;
    rest -= extra;
    const qty = base + extra;
    if (qty > 0) out[f] = qty;
  }
  return out;
}

/** Texto determinístico da distribuição, para prompt/contexto dos agentes. */
export function describeDistribution(
  perChannel: Array<{
    channel: string;
    formats: Partial<Record<ContentFormat, number>>;
    total: number;
  }>,
): string {
  return perChannel
    .filter((c) => c.total > 0)
    .map((c) => {
      const lines = CONTENT_FORMATS.filter((f) => (c.formats[f] ?? 0) > 0).map(
        (f) => `    - ${CONTENT_FORMAT_LABEL[f]}: ${c.formats[f]}`,
      );
      return [`  * ${c.channel} — total ${c.total}:`, ...lines].join("\n");
    })
    .join("\n");
}
