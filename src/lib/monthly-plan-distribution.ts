/**
 * Distribuição determinística de tópicos da Pauta por canal + formato.
 * Sem round-robin arbitrário: cada tópico consome uma vaga real da volumetria.
 */

import {
  CONTENT_FORMATS,
  normalizeContentFormat,
  formatsForChannel,
  defaultFormatForChannel,
  type ContentFormat,
} from "@/lib/content-formats";

export type ChannelFormatQuota = Record<string, Partial<Record<ContentFormat, number>>>;

/** Total de vagas de um mapa canal → formato → quantidade. */
export function totalSlots(quota: ChannelFormatQuota): number {
  return Object.values(quota).reduce(
    (sum, bucket) => sum + Object.values(bucket ?? {}).reduce((s, n) => s + (Number(n) || 0), 0),
    0,
  );
}

/** Total por canal. */
export function channelTotals(quota: ChannelFormatQuota): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [c, bucket] of Object.entries(quota)) {
    out[c] = Object.values(bucket ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);
  }
  return out;
}

/**
 * Cria um alocador que resolve (canal, formato) para cada tópico gerado pela IA,
 * respeitando as vagas restantes. Quando a IA sugere algo fora da cota, a vaga
 * com maior saldo é usada — de forma estável e previsível.
 */
export function createSlotAllocator(quota: ChannelFormatQuota) {
  // Cópia mutável das vagas restantes.
  const remaining: ChannelFormatQuota = {};
  for (const [c, bucket] of Object.entries(quota)) {
    const copy: Partial<Record<ContentFormat, number>> = {};
    for (const f of CONTENT_FORMATS) {
      const v = Number(bucket?.[f] ?? 0) || 0;
      if (v > 0) copy[f] = v;
    }
    if (Object.keys(copy).length) remaining[c] = copy;
  }

  const channelRemaining = (c: string) =>
    Object.values(remaining[c] ?? {}).reduce((s, n) => s + (Number(n) || 0), 0);

  const channelsInOrder = Object.keys(remaining);

  /** Formato com maior saldo dentro do canal (empate → ordem canônica). */
  const bestFormat = (c: string): ContentFormat | null => {
    let best: ContentFormat | null = null;
    let bestQty = 0;
    for (const f of CONTENT_FORMATS) {
      const qty = remaining[c]?.[f] ?? 0;
      if (qty > bestQty) {
        best = f;
        bestQty = qty;
      }
    }
    return best;
  };

  const nextChannel = (): string =>
    channelsInOrder.find((c) => channelRemaining(c) > 0) ?? channelsInOrder[0] ?? "instagram";

  return {
    remaining,
    /** Vagas ainda não consumidas. */
    left: () => totalSlots(remaining),
    /** Aloca uma vaga a partir da sugestão da IA. */
    allocate(rawChannel: unknown, rawFormat: unknown): { channel: string; format: ContentFormat } {
      const suggested = (rawChannel ?? "").toString().trim().toLowerCase();
      const channel = suggested && channelRemaining(suggested) > 0 ? suggested : nextChannel();

      const allowed = formatsForChannel(channel);
      const wanted = normalizeContentFormat(rawFormat);
      let format: ContentFormat | null = null;
      if (wanted && allowed.includes(wanted) && (remaining[channel]?.[wanted] ?? 0) > 0) {
        format = wanted;
      } else {
        format = bestFormat(channel);
      }
      if (!format)
        format = wanted && allowed.includes(wanted) ? wanted : defaultFormatForChannel(channel);

      const bucket = remaining[channel];
      if (bucket && (bucket[format] ?? 0) > 0) {
        bucket[format] = (bucket[format] ?? 0) - 1;
        if ((bucket[format] ?? 0) <= 0) delete bucket[format];
      }
      return { channel, format };
    },
  };
}
