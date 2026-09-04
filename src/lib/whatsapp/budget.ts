/**
 * Orçamento, cooldown e classificação de erros do canal WhatsApp (Evolution).
 *
 * Módulo PURO e testável: não faz I/O, não conhece Supabase e não conhece a
 * Evolution API. Os consumidores server-only injetam relógio e transporte.
 *
 * Segue `docs/PADRAO_INTEGRACOES_EXTERNAS.md`:
 *  - budget duro de requisições por operação (um disparo = uma operação);
 *  - teto de destinatários por lote (fan-out nunca ilimitado);
 *  - retry apenas para falhas recuperáveis, com backoff + jitter;
 *  - cooldown persistente (por processo) quando o provedor sinaliza 429;
 *  - telemetria estruturada por tentativa, sem segredos.
 */

// --------------------------------------------------------------- Limites ---

/** Máximo de destinatários processados em UM disparo. O excedente é `skipped`. */
export const MAX_RECIPIENTS_PER_BATCH = 100;

/**
 * Teto DURO de requisições reais à Evolution em UMA operação de envio.
 * Cada destinatário consome pelo menos 1 request; retries também contam.
 */
export const MAX_REQUESTS_PER_DISPATCH = 150;

/** Tentativas máximas por mensagem (inclui a primeira). */
export const MAX_ATTEMPTS_PER_MESSAGE = 3;

/** Timeout por request (mantém o valor já praticado pelo cliente). */
export const REQUEST_TIMEOUT_MS = 8_000;

/** Janela de cooldown aplicada após um rate limit do provedor. */
export const RATE_LIMIT_COOLDOWN_MS = 60_000;

/** Motivo pelo qual um disparo parou antes de percorrer todos os elegíveis. */
export type WhatsappStopReason = "request_budget" | "recipient_limit" | "cooldown" | null;

// ---------------------------------------------------------------- Budget ---

export type WhatsappBudget = {
  /** Reserva 1 request; `false` significa budget esgotado (não chamar a API). */
  take: () => boolean;
  used: () => number;
  remaining: () => number;
  readonly limit: number;
};

export function createDispatchBudget(limit = MAX_REQUESTS_PER_DISPATCH): WhatsappBudget {
  const max = Math.max(1, Math.floor(limit));
  let used = 0;
  return {
    limit: max,
    take: () => {
      if (used >= max) return false;
      used += 1;
      return true;
    },
    used: () => used,
    remaining: () => Math.max(0, max - used),
  };
}

/**
 * Divide a lista de destinatários no teto do lote.
 * `accepted` é processado; `overflow` volta como `skipped` — nunca é silenciado.
 */
export function splitBatch<T>(
  recipients: readonly T[],
  limit = MAX_RECIPIENTS_PER_BATCH,
): { accepted: T[]; overflow: T[] } {
  const max = Math.max(1, Math.floor(limit));
  return { accepted: recipients.slice(0, max), overflow: recipients.slice(max) };
}

// ------------------------------------------------------- Classificação ---

export type WhatsappFailureKind =
  | "rate_limited"
  | "timeout"
  | "network"
  | "provider_error"
  | "terminal";

type ErrorLike = {
  code?: unknown;
  status?: unknown;
  retryable?: unknown;
  name?: unknown;
};

/** Classifica a falha em uma categoria estável para retry/telemetria. */
export function classifyWhatsappFailure(error: unknown): WhatsappFailureKind {
  if (!error || typeof error !== "object") return "terminal";
  const e = error as ErrorLike;
  const status = typeof e.status === "number" ? e.status : null;
  const code = typeof e.code === "string" ? e.code : null;

  if (code === "rate_limited" || status === 429) return "rate_limited";
  if (code === "timeout" || e.name === "AbortError") return "timeout";
  if (code === "network_error") return "network";
  if (status !== null && status >= 500) return "provider_error";
  if (code === "provider_error" && status === null) return "provider_error";
  return "terminal";
}

/** Somente rate limit, timeout, rede e 5xx são recuperáveis. */
export function isRecoverableWhatsappFailure(error: unknown): boolean {
  const kind = classifyWhatsappFailure(error);
  return kind !== "terminal";
}

/** Backoff exponencial com jitter (ms) para a próxima tentativa. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 250 * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(base, 4_000);
  return Math.round(capped + random() * 250);
}

// -------------------------------------------------------------- Cooldown ---

type CooldownStore = Map<string, number>;

const cooldowns: CooldownStore = new Map();

/** Milissegundos restantes de cooldown para a chave (0 = liberado). */
export function cooldownRemainingMs(key: string, now = Date.now()): number {
  const until = cooldowns.get(key);
  if (until === undefined) return 0;
  if (until <= now) {
    cooldowns.delete(key);
    return 0;
  }
  return until - now;
}

export function isInCooldown(key: string, now = Date.now()): boolean {
  return cooldownRemainingMs(key, now) > 0;
}

/** Registra cooldown para a chave. Mantém o prazo mais longo já existente. */
export function startCooldown(
  key: string,
  durationMs = RATE_LIMIT_COOLDOWN_MS,
  now = Date.now(),
): number {
  const until = now + Math.max(0, durationMs);
  const current = cooldowns.get(key) ?? 0;
  const next = Math.max(current, until);
  cooldowns.set(key, next);
  return next - now;
}

export function clearCooldown(key: string): void {
  cooldowns.delete(key);
}

/** Apenas para testes: zera todo o estado de cooldown do processo. */
export function resetCooldowns(): void {
  cooldowns.clear();
}

/** Chave estável de cooldown por instância (nunca inclui chave de API). */
export function cooldownKey(brandId: string, instanceName: string): string {
  return `whatsapp:${brandId}:${instanceName}`;
}

// ----------------------------------------------------------- Telemetria ---

export type WhatsappAttemptTelemetry = {
  operation: string;
  attempt: number;
  attempts: number;
  outcome: "ok" | "retrying" | "failed";
  kind?: WhatsappFailureKind;
  status?: number | null;
  durationMs?: number;
  delayMs?: number;
};

/**
 * Log estruturado por tentativa. Nunca recebe número de destino completo,
 * chave de API, URL do servidor ou corpo bruto do provedor.
 */
export function logWhatsappAttempt(entry: WhatsappAttemptTelemetry): void {
  const parts = [
    `op=${entry.operation}`,
    `attempt=${entry.attempt}/${entry.attempts}`,
    `outcome=${entry.outcome}`,
  ];
  if (entry.kind) parts.push(`kind=${entry.kind}`);
  if (entry.status !== undefined && entry.status !== null) parts.push(`status=${entry.status}`);
  if (entry.durationMs !== undefined) parts.push(`duration_ms=${entry.durationMs}`);
  if (entry.delayMs !== undefined) parts.push(`retry_in_ms=${entry.delayMs}`);
  const line = `[whatsapp] ${parts.join(" ")}`;
  if (entry.outcome === "failed") console.error(line);
  else console.info(line);
}
