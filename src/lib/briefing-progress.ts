import type { BrandHubClient, BrandHubData } from "@/lib/brand-hub.functions";

/**
 * Canonical checklist used to score the Briefing completion. Kept in sync
 * with the fields the Briefing Workspace exposes and with the inputs the
 * `generateMonthlyPlanFn` (pipeline canônico de pauta) expects.
 */
const CHECKS: Array<
  (hub: BrandHubData, client?: Pick<BrandHubClient, "tone_of_voice">) => boolean
> = [
  (h, c) => nonEmpty(h.tone_text) || nonEmpty(c?.tone_of_voice ?? null),
  (h) => nonEmpty(h.mission),
  (h) => nonEmpty(h.positioning),
  (h) => nonEmpty(h.values),
  (h) => nonEmpty(h.offer),
  (h) => nonEmpty(h.price_range),
  (h) => nonEmpty(h.differentials),
  (h) => nonEmpty(h.objections),
  (h) => nonEmpty(h.audience),
  (h) => nonEmpty(h.journey),
  (h) => nonEmpty(h.pain_points),
  (h) => nonEmpty(h.desires),
  (h) => (h.competitors?.length ?? 0) > 0,
  (h) => (h.inspirations?.length ?? 0) > 0,
  (h) => (h.hashtags?.length ?? 0) > 0,
  (h) => (h.palette?.length ?? 0) > 0,
  (h) => nonEmpty(h.do_dont?.do) || nonEmpty(h.do_dont?.dont),
  (h) => Object.values(h.volumetry ?? {}).some((v) => (v ?? 0) > 0),
  (h) => nonEmpty(h.goals),
];

function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export function computeBriefingCompletion(
  hub: BrandHubData | null | undefined,
  client?: Pick<BrandHubClient, "tone_of_voice">,
): number {
  const h = hub ?? {};
  const filled = CHECKS.reduce((acc, fn) => acc + (fn(h, client) ? 1 : 0), 0);
  return Math.round((filled / CHECKS.length) * 100);
}

export function briefingProgressLabel(pct: number): string {
  if (pct === 0) return "Inicial";
  if (pct < 40) return "Em progresso";
  if (pct < 80) return "Avançado";
  if (pct < 100) return "Quase completo";
  return "Completo";
}
