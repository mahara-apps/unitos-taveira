/** Campos obrigatórios da Pauta — compartilhados entre UI e servidor. */

export const PLAN_CHANNELS = [
  "instagram",
  "tiktok",
  "linkedin",
  "youtube",
  "facebook",
  "x",
  "threads",
] as const;
export type PlanChannel = (typeof PLAN_CHANNELS)[number];

export const PLAN_CHANNEL_LABEL: Record<PlanChannel, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "Twitter/X",
  threads: "Threads",
};

/** Canais exibidos por padrão na volumetria do briefing. */
export const PLAN_CHANNELS_DEFAULT: PlanChannel[] = [
  "instagram",
  "tiktok",
  "linkedin",
  "youtube",
  "facebook",
];

/**
 * Formatos: NÃO declarar aqui. O mapa canônico único vive em
 * `@/lib/content-formats` (chaves técnicas feed/stories/reels/carrossel,
 * labels de UI e aliases legados). O antigo `PLAN_FORMATS` foi removido para
 * eliminar o vocabulário duplicado.
 */

/**
 * Mês contábil da pauta. Não é mais um valor fixo — depende do calendário real
 * do mês-alvo, pois alguns meses abrangem 5 semanas de produção.
 * Mantido como fallback (4) para chamadas que não informam o período.
 */
export const WEEKS_PER_MONTH = 4;

/**
 * Calcula quantas semanas de produção (segunda→domingo) cabem no mês.
 * Conta o número de segundas-feiras no mês — cada uma inicia um ciclo de produção.
 * Retorna no mínimo 4.
 *
 * Ex.: 2026-02 (fev, 28 dias, começa domingo) → 4 segundas → 4
 *      2026-03 (mar, 31 dias, começa domingo) → 5 segundas → 5
 */
export function getWeeksInMonth(year: number, monthIndex: number): number {
  const d = new Date(year, monthIndex, 1);
  const dow = d.getDay(); // 0=dom, 1=seg
  // Avança para a primeira segunda-feira do mês.
  d.setDate(d.getDate() + (dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow));
  let count = 0;
  while (d.getMonth() === monthIndex) {
    count++;
    d.setDate(d.getDate() + 7);
  }
  return Math.max(count, 4);
}

/**
 * Soma as semanas de produção de `months` meses a partir do próximo mês
 * (ou do mês corrente quando `fromCurrent` for true).
 */
export function getWeeksForPeriod(
  months: number,
  opts: { fromCurrent?: boolean; from?: Date; override?: number } = {},
): number {
  if (opts.override) return opts.override * months;
  const base = opts.from ?? new Date();
  const startOffset = opts.fromCurrent ? 0 : 1;
  let total = 0;
  for (let i = 0; i < months; i++) {
    const target = new Date(base.getFullYear(), base.getMonth() + startOffset + i, 1);
    total += getWeeksInMonth(target.getFullYear(), target.getMonth());
  }
  return total;
}

/* ---------------------------------------------------------------------------
 * Base da volumetria: o gestor pode definir o volume por semana (padrão) ou
 * direto por mês. `resolveQuota` é a fonte única para derivar os dois números.
 * ------------------------------------------------------------------------- */

export const VOLUMETRY_BASIS = ["weekly", "monthly"] as const;
export type VolumetryBasis = (typeof VOLUMETRY_BASIS)[number];
export const DEFAULT_VOLUMETRY_BASIS: VolumetryBasis = "weekly";

export function normalizeVolumetryBasis(v: unknown): VolumetryBasis {
  return v === "monthly" ? "monthly" : "weekly";
}

/** Limite do stepper conforme a base escolhida. */
export function volumetryMax(basis: VolumetryBasis): number {
  return basis === "monthly" ? 90 : 21;
}

/**
 * Converte o valor informado no briefing em `{ perWeek, perMonth }`.
 * - basis "weekly": valor = posts/semana → mês = valor × semanas reais do mês
 * - basis "monthly": valor = posts/mês → semana = mês ÷ semanas (informativo)
 */
export function resolveQuota(
  value: number,
  basis: VolumetryBasis,
  weeksInMonth: number = WEEKS_PER_MONTH,
): { perWeek: number; perMonth: number } {
  const v = Math.max(0, Number(value) || 0);
  const weeks = weeksInMonth > 0 ? weeksInMonth : WEEKS_PER_MONTH;
  if (basis === "monthly") {
    return { perWeek: Math.round((v / weeks) * 10) / 10, perMonth: Math.round(v) };
  }
  return { perWeek: v, perMonth: Math.round(v * weeks) };
}
