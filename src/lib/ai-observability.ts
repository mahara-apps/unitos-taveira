/**
 * OBSERVABILIDADE DE IA — regras puras (sem provider, sem banco).
 *
 * Motivação (P1.4): uma falha de IA nunca pode virar `null` silencioso nem um
 * registro sem classificação. Este módulo centraliza:
 *   - o que é falha recuperável x terminal;
 *   - como um erro técnico é redigido para log (sem chave de API);
 *   - o envelope estruturado de log que permite reconstruir uma execução.
 *
 * É client-safe de propósito: os testes e a UI podem importar sem arrastar
 * código de servidor.
 */

import type { FailureKind } from "./ai-failures.server";

/** Falhas que podem ser repetidas (mesma chamada) ou trocadas de provider. */
const RETRYABLE_KINDS: ReadonlySet<string> = new Set([
  "provider_quota",
  "provider_rate_limit",
  "provider_unavailable",
]);

export function isTerminalFailure(kind: FailureKind | string): boolean {
  return !RETRYABLE_KINDS.has(kind);
}

export function isRecoverableFailure(kind: FailureKind | string): boolean {
  return RETRYABLE_KINDS.has(kind);
}

/**
 * Remove segredos e ruído do texto técnico antes de logar. Nunca deixa a chave
 * do provider (Authorization/x-goog-api-key/sk-...) chegar ao log.
 */
export function redactAiDetail(text: string, max = 500): string {
  return (text || "")
    .replace(/\b(sk|sk-proj|sk-ant|gsk|AIza)[A-Za-z0-9_\-]{8,}/g, "[redacted-key]")
    .replace(/(bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[redacted]")
    .replace(/("?(api[_-]?key|x-goog-api-key|authorization)"?\s*[:=]\s*)"?[^"\s,}]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export type AiExecutionLog = {
  /** Pipeline/recurso: "briefing.import", "chat", "pauta.suggest"... */
  op: string;
  /** Etapa dentro do pipeline, quando existir. */
  step?: string | null;
  provider?: string | null;
  model?: string | null;
  attempt?: number | null;
  kind?: FailureKind | string | null;
  retryable?: boolean | null;
  brandId?: string | null;
  clientId?: string | null;
  userId?: string | null;
  jobId?: string | null;
  durationMs?: number | null;
  detail?: string | null;
};

function shortId(v?: string | null): string | null {
  return v ? v.slice(0, 8) : null;
}

/**
 * Envelope canônico (uma linha JSON) — é o que torna uma execução
 * problemática reconstruível: op + etapa + provider + modelo + tentativa +
 * classificação + escopo.
 */
export function formatAiLog(at: string, entry: AiExecutionLog): string {
  return JSON.stringify({
    at,
    op: entry.op,
    step: entry.step ?? null,
    provider: entry.provider ?? null,
    model: entry.model ?? null,
    attempt: entry.attempt ?? null,
    kind: entry.kind ?? null,
    retryable: entry.retryable ?? null,
    brand: shortId(entry.brandId),
    client: shortId(entry.clientId),
    user: shortId(entry.userId),
    job: shortId(entry.jobId),
    ms: entry.durationMs ?? null,
    detail: entry.detail ? redactAiDetail(entry.detail, 300) : null,
  });
}

/** Falha de IA: sempre logada com classificação — nunca “erro genérico”. */
export function logAiFailure(entry: AiExecutionLog): void {
  console.error(formatAiLog("ai.failure", entry));
}

/** Tentativa que falhou mas ainda terá retry/fallback. */
export function logAiRetry(entry: AiExecutionLog): void {
  console.warn(formatAiLog("ai.retry", entry));
}

export function logAiSuccess(entry: AiExecutionLog): void {
  console.info(formatAiLog("ai.success", entry));
}
