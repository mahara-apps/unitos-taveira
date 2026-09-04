/**
 * Fonte da verdade dos formatos suportados por cada rede social no wizard
 * de agendamento. Isomórfico — pode ser importado no cliente e no servidor.
 *
 * Os valores de `format` devem casar com o CHECK constraint de
 * public.post_placements: 'feed' | 'stories' | 'reels' | 'carrossel'.
 */

import type { SocialChannel } from "@/lib/social-core/capabilities";

export type PlacementFormat = "feed" | "stories" | "reels" | "carrossel";

/**
 * Tipo derivado da mídia selecionada. Usado para inferir automaticamente
 * quais formatos são publicáveis com o conteúdo que o usuário escolheu.
 */
export type MediaKind = "none" | "single_image" | "multi_image" | "video" | "mixed"; // imagem + vídeo — combinação inválida no Feed da Meta

export const FORMAT_LABEL: Record<PlacementFormat, string> = {
  feed: "Feed",
  stories: "Stories",
  reels: "Reels",
  carrossel: "Carrossel",
};

/** Formatos válidos por canal — regra de negócio local (sem tabela). */
export const FORMATS_BY_CHANNEL: Record<SocialChannel, PlacementFormat[]> = {
  instagram: ["feed", "stories", "reels", "carrossel"],
  facebook: ["feed"],
  linkedin: ["feed"],
  tiktok: ["reels"],
  youtube: ["reels"],
  x: ["feed"],
  threads: ["feed"],
};

/**
 * Matriz de compatibilidade formato × tipo de mídia. Um formato só aparece
 * como opção quando a mídia selecionada suporta.
 *
 * - `feed`      → imagem única ou vídeo curto (FB aceita ambos; IG só imagem)
 * - `stories`   → imagem única OU vídeo curto
 * - `reels`     → SOMENTE vídeo
 * - `carrossel` → 2+ imagens
 *
 * `none` = nenhuma mídia ainda; permitimos todos para que o usuário possa
 * escolher a intenção antes de anexar. `mixed` = combinação proibida.
 */
const FORMAT_MEDIA_MATRIX: Record<PlacementFormat, MediaKind[]> = {
  feed: ["none", "single_image", "video"],
  // Stories aceita imagem única, vídeo curto, OU múltiplas mídias (cada
  // arquivo vira 1 frame na sequência publicada).
  stories: ["none", "single_image", "video", "multi_image"],
  reels: ["none", "video"],
  carrossel: ["none", "multi_image"],
};

export function inferMediaKind(items: { kind: string }[]): MediaKind {
  if (!items.length) return "none";
  const images = items.filter((m) => m.kind === "image").length;
  const videos = items.filter((m) => m.kind === "video").length;
  if (images && videos) return "mixed";
  if (videos === 1 && images === 0) return "video";
  if (videos > 1) return "video"; // tratamos multi-vídeo como vídeo (usaremos o 1º)
  if (images === 1) return "single_image";
  if (images > 1) return "multi_image";
  return "none";
}

export function isFormatCompatibleWithMedia(format: PlacementFormat, media: MediaKind): boolean {
  if (media === "mixed") return false;
  return FORMAT_MEDIA_MATRIX[format].includes(media);
}

export function formatIncompatibilityReason(
  format: PlacementFormat,
  media: MediaKind,
): string | null {
  if (isFormatCompatibleWithMedia(format, media)) return null;
  if (media === "mixed") return "Combinação imagem + vídeo não é aceita na mesma publicação.";
  if (format === "reels") return "Reels exige um arquivo de vídeo.";
  if (format === "carrossel") return "Carrossel exige 2 ou mais imagens selecionadas.";
  if (format === "feed" && media === "multi_image")
    return "Feed com múltiplas imagens vira Carrossel automaticamente.";
  return "Mídia atual não é compatível com este formato.";
}

/** Sugere o(s) formato(s) padrão para cada canal dado o tipo de mídia. */
export function suggestFormatsForMedia(
  channel: SocialChannel,
  media: MediaKind,
): PlacementFormat[] {
  const allowed = (FORMATS_BY_CHANNEL[channel] ?? []).filter((f) =>
    isFormatCompatibleWithMedia(f, media),
  );
  if (media === "none" || !allowed.length) return [];
  // Ordem de preferência: reels > carrossel > feed > stories
  const rank: Record<PlacementFormat, number> = {
    reels: 0,
    carrossel: 1,
    feed: 2,
    stories: 3,
  };
  return [allowed.sort((a, b) => rank[a] - rank[b])[0]];
}

/** Limite conservador de caracteres por rede, usado como aviso de UI. */
export const CAPTION_LIMIT: Record<SocialChannel, number> = {
  instagram: 2200,
  facebook: 5000,
  linkedin: 3000,
  tiktok: 2200,
  youtube: 5000,
  x: 280,
  threads: 500,
};

export function isValidPair(channel: SocialChannel, format: PlacementFormat): boolean {
  return FORMATS_BY_CHANNEL[channel]?.includes(format) ?? false;
}

/** Menor limite de caption entre um conjunto de destinos. */
export function tightestCaptionLimit(channels: SocialChannel[]): number {
  if (!channels.length) return 2200;
  return channels.reduce((min, c) => Math.min(min, CAPTION_LIMIT[c] ?? 2200), Infinity);
}
