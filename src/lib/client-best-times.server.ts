/**
 * Resumo de HORÁRIOS com histórico real do cliente, usado como evidência para a
 * IA sugerir dia/hora de cada item da pauta.
 *
 * Fonte: publicações efetivamente publicadas do próprio cliente
 * (`social_posts.published_at` e `posts.published_at`), agregadas por dia da
 * semana e faixa horária no fuso oficial. Sem histórico suficiente, devolve
 * confiança "low" e nenhum dado inventado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { zonedParts } from "@/lib/timezone";

const LOOKBACK_DAYS = 120;
const WEEKDAY_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export type BestTimesContext = {
  markdown: string;
  confidence: "low" | "medium" | "high";
  sample: number;
  /** Top combinações dia da semana + hora, mais frequentes primeiro. */
  top: Array<{ weekday: number; hour: number; count: number; label: string }>;
};

export async function loadBestTimesContext(
  supabase: SupabaseClient,
  args: { brandId: string; clientId: string; now?: Date },
): Promise<BestTimesContext> {
  const since = new Date((args.now ?? new Date()).getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const stamps: string[] = [];

  try {
    const { data } = await supabase
      .from("social_posts")
      .select("published_at")
      .eq("brand_id", args.brandId)
      .eq("client_id", args.clientId)
      .not("published_at", "is", null)
      .gte("published_at", since)
      .limit(500);
    for (const row of (data ?? []) as unknown as Array<{ published_at: string | null }>) {
      if (row.published_at) stamps.push(row.published_at);
    }
  } catch {
    // Histórico é evidência opcional: falha nunca interrompe a geração.
  }

  try {
    const { data } = await supabase
      .from("posts")
      .select("published_at")
      .eq("brand_id", args.brandId)
      .eq("client_id", args.clientId)
      .not("published_at", "is", null)
      .gte("published_at", since)
      .limit(500);
    for (const row of (data ?? []) as unknown as Array<{ published_at: string | null }>) {
      if (row.published_at) stamps.push(row.published_at);
    }
  } catch {
    // idem
  }

  const buckets = new Map<string, { weekday: number; hour: number; count: number }>();
  for (const iso of stamps) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const p = zonedParts(d);
    const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
    const key = `${weekday}-${p.hour}`;
    const hit = buckets.get(key);
    if (hit) hit.count += 1;
    else buckets.set(key, { weekday, hour: p.hour, count: 1 });
  }

  const top = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count || a.weekday - b.weekday || a.hour - b.hour)
    .slice(0, 6)
    .map((b) => ({
      ...b,
      label: `${WEEKDAY_LABEL[b.weekday]} ${String(b.hour).padStart(2, "0")}:00`,
    }));

  const sample = stamps.length;
  const confidence: BestTimesContext["confidence"] =
    sample >= 20 ? "high" : sample >= 6 ? "medium" : "low";

  const markdown = top.length
    ? [
        `## Histórico de publicação do cliente (últimos ${LOOKBACK_DAYS} dias, fuso Brasília)`,
        `Amostra: ${sample} publicações.`,
        ...top.map((t) => `- ${t.label} — ${t.count} publicação(ões)`),
      ].join("\n")
    : `## Histórico de publicação do cliente\nSem histórico suficiente nos últimos ${LOOKBACK_DAYS} dias — baseie o horário na persona e no briefing.`;

  return { markdown, confidence, sample, top };
}
