/**
 * Mensagens e detecção de conflito de fila de publicação.
 *
 * O banco garante UM único item ativo por destino (peça + conexão + placement)
 * pelo índice único `social_posts_active_dest_key`. Quando o operador tenta
 * reagendar/republicar um destino que ainda tem item aguardando (por exemplo,
 * adiado por limite de requisições da Meta), o Postgres recusa a inserção.
 *
 * Este módulo traduz esse erro técnico para linguagem operacional em pt-BR.
 */

export const isActiveDestConflict = (message: string | null | undefined): boolean =>
  !!message && /duplicate key|social_posts_active_dest_key|23505/i.test(message);

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
};

const FORMAT_LABEL: Record<string, string> = {
  feed: "Feed",
  reels: "Reels",
  stories: "Stories",
  story: "Stories",
  carousel: "Carrossel",
};

/** Mensagem única para conflito de destino ativo na fila. */
export function activeDestConflictMessage(channel?: string | null, format?: string | null): string {
  const parts = [
    channel ? (CHANNEL_LABEL[channel] ?? channel) : null,
    format ? (FORMAT_LABEL[format] ?? format) : null,
  ].filter(Boolean);
  const target = parts.length ? ` para ${parts.join("/")}` : "";
  return (
    `Já existe uma publicação na fila${target}. ` +
    "Ela está aguardando nova tentativa (normalmente limite de requisições da rede social). " +
    "Cancele o item da fila para reagendar agora, ou aguarde a próxima tentativa."
  );
}

/** Converte o erro do banco em mensagem amigável quando for conflito de fila. */
export function describeQueueInsertError(
  message: string,
  channel?: string | null,
  format?: string | null,
): string {
  return isActiveDestConflict(message) ? activeDestConflictMessage(channel, format) : message;
}
