// ⚠️ Brain Context Engine — scoring de relevância.
// Combina overlap textual + confiança armazenada + recência.

export interface Scorable {
  text: string;
  confidence?: number | null;
  updatedAt?: string | null;
}

/**
 * Score de relevância normalizado 0..1.
 *   0.5 * overlap_de_keywords
 * + 0.3 * confiança (default 0.5)
 * + 0.2 * recência exponencial (meia-vida 14 dias)
 */
export function relevanceScore(item: Scorable, keywords: string[]): number {
  const overlap = keywordOverlap(item.text, keywords);
  const conf = clamp01(item.confidence ?? 0.5);
  const rec = recencyDecay(item.updatedAt);
  return round3(0.5 * overlap + 0.3 * conf + 0.2 * rec);
}

function keywordOverlap(text: string, keywords: string[]): number {
  if (!keywords.length) return 0.3; // baseline quando pergunta é genérica
  const norm = (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  let hits = 0;
  for (const k of keywords) if (norm.includes(k)) hits++;
  return clamp01(hits / keywords.length);
}

function recencyDecay(updatedAt?: string | null): number {
  if (!updatedAt) return 0.4;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return 0.4;
  const days = (Date.now() - t) / (1000 * 60 * 60 * 24);
  return clamp01(Math.exp(-Math.log(2) * (days / 14)));
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const round3 = (n: number) => Math.round(n * 1000) / 1000;
