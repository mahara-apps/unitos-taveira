/**
 * Classificação de limite temporário (throttling) da Graph API.
 *
 * Motivação real: um agendamento com Facebook + Instagram publicou no Facebook
 * e falhou no Instagram com `Application request limit reached (code 4)`. Como
 * o worker roda a cada minuto e tratava isso como falha comum, as 5 tentativas
 * foram consumidas em ~4 minutos e a peça virou `failed` definitivo — mesmo
 * sendo um erro transitório.
 *
 * Regra: limite temporário NÃO é falha. O destino volta para a fila com espera
 * progressiva (`mark_social_post_deferred`), sem consumir tentativa.
 */

/** Códigos de throttling da Graph API (app / usuário / página / conta de anúncio). */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);

/** Subcódigos usados pela Meta para limite de publicação/ação. */
const RATE_LIMIT_SUBCODES = new Set([1349174, 1349210, 2207051]);

export type MetaErrorLike = {
  graph?: { code?: number; error_subcode?: number } | null;
  message?: string;
};

/**
 * true quando a Meta ainda não terminou de processar a mídia
 * (`Media ID is not available`, code 9007). É transitório: adiar, não falhar.
 */
export function isMediaNotReady(err: unknown): boolean {
  const e = err as MetaErrorLike | null;
  if (e?.graph?.code === 9007) return true;
  const msg = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  return msg.includes("media id is not available") || msg.includes("code 9007");
}

/** true quando o erro é limite temporário da Meta (deve ser adiado, não falhado). */
export function isMetaRateLimit(err: unknown): boolean {
  const e = err as MetaErrorLike | null;
  const code = e?.graph?.code;
  if (typeof code === "number" && RATE_LIMIT_CODES.has(code)) return true;
  const sub = e?.graph?.error_subcode;
  if (typeof sub === "number" && RATE_LIMIT_SUBCODES.has(sub)) return true;
  if (isMediaNotReady(err)) return true;
  const msg = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  if (!msg) return false;
  return (
    msg.includes("request limit reached") ||
    msg.includes("rate limit") ||
    msg.includes("too many calls") ||
    msg.includes("please retry your request later") ||
    msg.includes("user request limit") ||
    msg.includes("ainda está sendo processada pela meta")
  );
}


/** Espera progressiva por número de adiamentos já feitos (minutos). */
const BACKOFF_MINUTES = [2, 5, 15, 30, 60, 60, 120, 120];

/** Instante da próxima tentativa para um item adiado por limite. */
export function nextRateLimitRetryAt(previousRetries: number, now: Date = new Date()): Date {
  const idx = Math.min(Math.max(previousRetries, 0), BACKOFF_MINUTES.length - 1);
  const minutes = BACKOFF_MINUTES[idx] ?? 60;
  return new Date(now.getTime() + minutes * 60_000);
}

/** Mensagem em pt-BR mostrada na UI enquanto o destino aguarda nova tentativa. */
export function rateLimitMessage(retryAt: Date, detail?: string, err?: unknown): string {
  const hhmm = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(retryAt);
  const cause = isMediaNotReady(err)
    ? "A Meta ainda está processando a mídia"
    : "Limite temporário da Meta";
  const base = `${cause} — nova tentativa automática às ${hhmm}.`;
  return detail ? `${base} Detalhe: ${detail}` : base;

}
