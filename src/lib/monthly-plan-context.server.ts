import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PLAN_CHANNELS,
  WEEKS_PER_MONTH,
  normalizeVolumetryBasis,
  resolveQuota,
  type PlanChannel,
  type VolumetryBasis,
} from "@/lib/monthly-plan-fields";
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABEL,
  breakdownFromTotal,
  normalizeVolumetryBreakdown,
  sumChannelBreakdown,
  type ContentFormat,
  type VolumetryBreakdown,
} from "@/lib/content-formats";

/**
 * Contexto de briefing consolidado do cliente (sempre usado pela IA na Pauta).
 * Monta o texto a partir de `clients` + `clients.brand_hub` + resumos de
 * `client_documents.ai_summary`, no mesmo espírito do pipeline de Estratégia IA.
 */

export type FormatQuota = Partial<Record<ContentFormat, number>>;

export type BriefingContext = {
  text: string;
  clientName: string | null;
  niche: string | null;
  weekly: Record<PlanChannel, number>;
  monthlyQuota: Record<PlanChannel, number>;
  /** Base informada no briefing: volume por semana ou por mês. */
  volumetryBasis: VolumetryBasis;
  totalTarget: number;
  /** Formatos preferidos por canal, conforme briefing (pode vir vazio). */
  formatsByChannel: Record<PlanChannel, string[]>;
  /**
   * Distribuição canal → formato → quantidade MENSAL (fonte operacional).
   * Quando `clients.brand_hub.volumetry_breakdown` existe, vem dele;
   * senão é derivada do total + formatos preferidos (compatibilidade).
   */
  formatQuota: Record<PlanChannel, FormatQuota>;
  /** Distribuição na base informada (semanal ou mensal), sem conversão. */
  formatBreakdownRaw: VolumetryBreakdown;
  /** Canais que já possuem breakdown explícito salvo pelo gestor. */
  channelsWithBreakdown: PlanChannel[];
};

function pushLine(lines: string[], label: string, value: unknown) {
  if (value == null) return;
  if (Array.isArray(value)) {
    const arr = value.map((v) => (typeof v === "string" ? v.trim() : v)).filter(Boolean);
    if (arr.length) lines.push(`${label}: ${arr.join(", ")}`);
    return;
  }
  if (typeof value === "number") {
    lines.push(`${label}: ${value}`);
    return;
  }
  if (typeof value === "string" && value.trim()) lines.push(`${label}: ${value.trim()}`);
}

export async function loadBriefingContext(
  supabase: SupabaseClient,
  clientId: string,
  opts: { briefingId?: string | null; weeksPerMonth?: number } = {},
): Promise<BriefingContext> {
  const weeksPerMonth =
    opts.weeksPerMonth && opts.weeksPerMonth > 0 ? opts.weeksPerMonth : WEEKS_PER_MONTH;
  const [clientRes, docsRes, briefingRes] = await Promise.all([
    supabase
      .from("clients")
      .select("name, niche, color, tone_of_voice, socials, brand_hub")
      .eq("id", clientId)
      .maybeSingle(),
    supabase
      .from("client_documents")
      .select("name, ai_summary")
      .eq("client_id", clientId)
      .not("ai_summary", "is", null)
      .limit(12),
    opts.briefingId
      ? supabase
          .from("brand_briefing_versions")
          .select("snapshot")
          .eq("id", opts.briefingId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const row = (clientRes.data ?? {}) as {
    name?: string | null;
    niche?: string | null;
    color?: string | null;
    tone_of_voice?: string | null;
    socials?: Record<string, string | null> | null;
    brand_hub?: Record<string, unknown> | null;
  };
  const hub = (row.brand_hub ?? {}) as Record<string, unknown>;
  const lines: string[] = [];

  // Identidade
  pushLine(lines, "Marca/Cliente", row.name);
  pushLine(lines, "Nicho", row.niche);
  pushLine(lines, "Tom de voz", (hub.tone_text as string | undefined) ?? row.tone_of_voice);
  pushLine(lines, "Missão", hub.mission);
  pushLine(lines, "Posicionamento", hub.positioning);
  pushLine(lines, "Valores", hub.values);

  // Produto
  pushLine(lines, "Oferta / produtos", hub.offer);
  pushLine(lines, "Faixa de preço", hub.price_range);
  pushLine(lines, "Diferenciais", hub.differentials);
  pushLine(lines, "Objeções", hub.objections);

  // Público
  pushLine(lines, "Público", hub.audience);
  pushLine(lines, "Jornada", hub.journey);
  pushLine(lines, "Dores", hub.pain_points);
  pushLine(lines, "Desejos", hub.desires);

  // Concorrentes / inspirações
  const competitors = Array.isArray(hub.competitors)
    ? (hub.competitors as Array<Record<string, unknown>>)
    : [];
  pushLine(
    lines,
    "Concorrentes / referências",
    competitors.map((c) => (typeof c.handle === "string" ? c.handle : "")).filter(Boolean),
  );
  pushLine(lines, "Inspirações", hub.inspirations);

  // Estética
  const palette = Array.isArray(hub.palette) ? (hub.palette as Array<Record<string, unknown>>) : [];
  pushLine(
    lines,
    "Paleta",
    palette.map((p) => (typeof p.hex === "string" ? p.hex : "")).filter(Boolean),
  );
  pushLine(lines, "Cor da marca", row.color);
  const hashtags = hub.hashtags as string[] | undefined;
  pushLine(
    lines,
    "Hashtags",
    hashtags?.map((h) => (h.startsWith("#") ? h : `#${h}`)),
  );
  const doDont = (hub.do_dont ?? {}) as { do?: string; dont?: string };
  pushLine(lines, "Do", doDont.do);
  pushLine(lines, "Don't", doDont.dont);

  // Metas & volumetria (canal → formato → quantidade)
  const vol = (hub.volumetry ?? {}) as Record<string, number | undefined>;
  const volumetryBasis = normalizeVolumetryBasis(hub.volumetry_basis);
  const formats = (hub.formats ?? {}) as Record<string, string[] | undefined>;
  const breakdownRaw = normalizeVolumetryBreakdown(hub.volumetry_breakdown);
  const channelsWithBreakdown = PLAN_CHANNELS.filter(
    (c) => sumChannelBreakdown(breakdownRaw[c]) > 0,
  );

  const weekly = {} as Record<PlanChannel, number>;
  const monthlyQuota = {} as Record<PlanChannel, number>;
  const formatQuota = {} as Record<PlanChannel, FormatQuota>;
  for (const c of PLAN_CHANNELS) {
    const bucketRaw = breakdownRaw[c];
    const hasBreakdown = sumChannelBreakdown(bucketRaw) > 0;
    // Total do canal: soma do breakdown quando existir; senão o total legado.
    const rawTotal = hasBreakdown ? sumChannelBreakdown(bucketRaw) : Number(vol[c] ?? 0) || 0;
    const q = resolveQuota(rawTotal, volumetryBasis, weeksPerMonth);
    weekly[c] = q.perWeek;
    monthlyQuota[c] = q.perMonth;

    // Quotas por formato já convertidas para o mês.
    const monthlyBucket: FormatQuota = {};
    if (hasBreakdown) {
      for (const f of CONTENT_FORMATS) {
        const v = bucketRaw?.[f] ?? 0;
        if (v > 0) monthlyBucket[f] = resolveQuota(v, volumetryBasis, weeksPerMonth).perMonth;
      }
      // Garante que a soma por formato feche com o total mensal do canal.
      const sum = sumChannelBreakdown(monthlyBucket);
      const diff = monthlyQuota[c] - sum;
      if (diff !== 0) {
        const first = CONTENT_FORMATS.find((f) => (monthlyBucket[f] ?? 0) > 0);
        if (first) monthlyBucket[first] = Math.max(0, (monthlyBucket[first] ?? 0) + diff);
      }
    } else if (monthlyQuota[c] > 0) {
      // Compatibilidade: cliente sem breakdown → deriva do total + preferidos.
      Object.assign(monthlyBucket, breakdownFromTotal(c, monthlyQuota[c], formats[c] ?? []));
    }
    formatQuota[c] = monthlyBucket;
  }
  const totalTarget = PLAN_CHANNELS.reduce((s, c) => s + monthlyQuota[c], 0);

  pushLine(
    lines,
    volumetryBasis === "monthly" ? "Volumetria mensal" : "Volumetria semanal",
    PLAN_CHANNELS.filter((c) => monthlyQuota[c] > 0)
      .map((c) =>
        volumetryBasis === "monthly"
          ? `${c}: ${monthlyQuota[c]}/mês`
          : `${c}: ${weekly[c]}/sem (${monthlyQuota[c]}/mês)`,
      )
      .join(", "),
  );
  pushLine(
    lines,
    "Volumetria por formato (mês)",
    PLAN_CHANNELS.filter((c) => sumChannelBreakdown(formatQuota[c]) > 0)
      .map(
        (c) =>
          `${c}: ${CONTENT_FORMATS.filter((f) => (formatQuota[c]![f] ?? 0) > 0)
            .map((f) => `${CONTENT_FORMAT_LABEL[f]} ${formatQuota[c]![f]}`)
            .join(", ")}`,
      )
      .join("; "),
  );
  pushLine(
    lines,
    "Formatos por rede",
    Object.entries(formats)
      .filter(([, v]) => Array.isArray(v) && v.length > 0)
      .map(([k, v]) => `${k}: ${(v as string[]).join("/")}`)
      .join("; "),
  );

  pushLine(lines, "Metas", hub.goals);

  const socials = (row.socials ?? {}) as Record<string, string | null>;
  pushLine(
    lines,
    "Canais sociais",
    Object.entries(socials)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `${k}: ${v}`),
  );

  // Documentos analisados
  const docs = (docsRes.data ?? []) as Array<{ name: string | null; ai_summary: unknown }>;
  for (const d of docs) {
    const summary =
      typeof d.ai_summary === "string" ? d.ai_summary : JSON.stringify(d.ai_summary ?? "");
    if (summary && summary !== '""') {
      lines.push(`Documento "${d.name ?? "sem nome"}": ${summary.slice(0, 800)}`);
    }
  }

  // Versão de briefing escolhida explicitamente (opcional)
  const versioned = (briefingRes as { data?: { snapshot?: unknown } | null } | null)?.data
    ?.snapshot;
  if (versioned) {
    const raw = typeof versioned === "string" ? versioned : JSON.stringify(versioned);
    lines.push(`Briefing selecionado (versão): ${raw.slice(0, 3000)}`);
  }

  const formatsByChannel = PLAN_CHANNELS.reduce<Record<PlanChannel, string[]>>(
    (acc, c) => {
      const v = formats[c];
      acc[c] = Array.isArray(v) ? v.filter((f) => typeof f === "string" && f.trim()) : [];
      return acc;
    },
    {} as Record<PlanChannel, string[]>,
  );

  return {
    text: lines.join("\n"),
    clientName: row.name ?? null,
    niche: row.niche ?? null,
    weekly,
    monthlyQuota,
    volumetryBasis,
    totalTarget,
    formatsByChannel,
    formatQuota,
    formatBreakdownRaw: breakdownRaw,
    channelsWithBreakdown,
  };
}
