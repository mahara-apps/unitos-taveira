// Server-only: cliente HTTP mínimo da Evolution API.
// Responsabilidades: montar a request com header `apikey`, aplicar timeout e
// retry em falhas transitórias, e traduzir erros para mensagens seguras
// (sem vazar chave, URL interna ou corpo bruto do provedor).

import type { EvolutionConfig } from "./config.server";
import { EvolutionConfigError } from "./config.server";
import {
  backoffDelayMs,
  classifyWhatsappFailure,
  cooldownRemainingMs,
  isRecoverableWhatsappFailure,
  logWhatsappAttempt,
  MAX_ATTEMPTS_PER_MESSAGE,
  REQUEST_TIMEOUT_MS,
  startCooldown,
} from "@/lib/whatsapp/budget";


export type EvolutionErrorCode =
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "provider_error"
  | "network_error"
  | "timeout"
  | "invalid_response"
  | "config_error";

export class EvolutionApiError extends Error {
  readonly code: EvolutionErrorCode;
  readonly status: number | null;
  /** Erros transitórios podem ser tentados novamente mais tarde. */
  readonly retryable: boolean;

  constructor(
    code: EvolutionErrorCode,
    message: string,
    options: { status?: number | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "EvolutionApiError";
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

const DEFAULT_TIMEOUT_MS = REQUEST_TIMEOUT_MS;
const MAX_ATTEMPTS = MAX_ATTEMPTS_PER_MESSAGE;


function messageForStatus(status: number): { code: EvolutionErrorCode; message: string } {
  if (status === 401 || status === 403) {
    return {
      code: "unauthorized",
      message: "Chave de API da Evolution inválida ou sem permissão.",
    };
  }
  if (status === 404) {
    return { code: "not_found", message: "Recurso não encontrado no servidor Evolution." };
  }
  if (status === 429) {
    return { code: "rate_limited", message: "O servidor Evolution está limitando as requisições." };
  }
  return {
    code: "provider_error",
    message: "O servidor Evolution respondeu com erro. Tente novamente em instantes.",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type EvolutionRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Caminho relativo, ex.: "/instance/fetchInstances". */
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  /** Nº máximo de tentativas (inclui a primeira). */
  attempts?: number;
  /** Rótulo estável para telemetria (nunca contém dado sensível). */
  operation?: string;
  /**
   * Chave de cooldown (ex.: `cooldownKey(brandId, instanceName)`).
   * Quando presente: a chamada é bloqueada durante o cooldown e um 429 do
   * provedor abre uma nova janela de cooldown.
   */
  cooldownKey?: string;
  /** Reserva de budget por operação; `false` interrompe antes de chamar a API. */
  budget?: { take: () => boolean };
};

export type EvolutionResponse<T> = {
  status: number;
  data: T;
};

/**
 * Executa uma chamada autenticada na Evolution API.
 * Lança sempre `EvolutionApiError` com mensagem apresentável ao usuário;
 * o detalhe técnico fica apenas no log do servidor.
 */
export async function evolutionRequest<T = unknown>(
  config: EvolutionConfig,
  options: EvolutionRequestOptions,
): Promise<EvolutionResponse<T>> {
  const attempts = Math.max(1, Math.min(options.attempts ?? MAX_ATTEMPTS, 5));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const method = options.method ?? "GET";
  const operation = options.operation ?? `${method} ${options.path.split("/")[1] ?? "request"}`;

  const url = new URL(
    `${config.baseUrl}${options.path.startsWith("/") ? options.path : `/${options.path}`}`,
  );
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  if (options.cooldownKey) {
    const remaining = cooldownRemainingMs(options.cooldownKey);
    if (remaining > 0) {
      logWhatsappAttempt({
        operation,
        attempt: 0,
        attempts,
        outcome: "failed",
        kind: "rate_limited",
      });
      throw new EvolutionApiError(
        "rate_limited",
        `Envio em espera: o servidor Evolution limitou as requisições. Tente novamente em ${Math.ceil(
          remaining / 1000,
        )}s.`,
        { status: 429, retryable: false },
      );
    }
  }

  let lastError: EvolutionApiError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.budget && !options.budget.take()) {
      logWhatsappAttempt({ operation, attempt, attempts, outcome: "failed", kind: "terminal" });
      throw (
        lastError ??
        new EvolutionApiError(
          "provider_error",
          "Limite de requisições da operação atingido. Nada mais foi enviado.",
          { retryable: false },
        )
      );
    }
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          apikey: config.apiKey,
          accept: "application/json",
          ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
        redirect: "manual",
      });

      const text = await response.text();
      let parsed: unknown = null;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      if (!response.ok) {
        const { code, message } = messageForStatus(response.status);
        // Detalhe técnico só no servidor; a chave nunca é logada.
        console.error(
          `[Evolution] ${method} ${options.path} -> ${response.status} ${text.slice(0, 300)}`,
        );
        const httpError = new EvolutionApiError(code, message, {
          status: response.status,
          retryable: isRecoverableWhatsappFailure({ code, status: response.status }),
        });
        lastError = httpError;
        const kind = classifyWhatsappFailure(httpError);
        if (kind === "rate_limited" && options.cooldownKey) {
          startCooldown(options.cooldownKey);
        }
        if (!httpError.retryable || attempt === attempts) {
          logWhatsappAttempt({
            operation,
            attempt,
            attempts,
            outcome: "failed",
            kind,
            status: response.status,
            durationMs: Date.now() - startedAt,
          });
          throw httpError;
        }
        const delayMs = backoffDelayMs(attempt);
        logWhatsappAttempt({
          operation,
          attempt,
          attempts,
          outcome: "retrying",
          kind,
          status: response.status,
          durationMs: Date.now() - startedAt,
          delayMs,
        });
        clearTimeout(timer);
        await sleep(delayMs);
        continue;
      }

      if (parsed === null && text.length > 0) {
        throw new EvolutionApiError(
          "invalid_response",
          "Resposta inesperada do servidor Evolution.",
          { status: response.status },
        );
      }

      logWhatsappAttempt({
        operation,
        attempt,
        attempts,
        outcome: "ok",
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return { status: response.status, data: (parsed ?? null) as T };
    } catch (error) {
      if (error instanceof EvolutionApiError) {
        if (classifyWhatsappFailure(error) === "rate_limited" && options.cooldownKey) {
          startCooldown(options.cooldownKey);
        }
        if (!error.retryable || attempt === attempts) {
          logWhatsappAttempt({
            operation,
            attempt,
            attempts,
            outcome: "failed",
            kind: classifyWhatsappFailure(error),
            status: error.status,
            durationMs: Date.now() - startedAt,
          });
          throw error;
        }
        lastError = error;
      } else {
        const aborted = error instanceof Error && error.name === "AbortError";
        console.error(
          `[Evolution] ${method} ${options.path} falhou: ${
            error instanceof Error ? error.message : "erro desconhecido"
          }`,
        );
        lastError = aborted
          ? new EvolutionApiError(
              "timeout",
              "O servidor Evolution não respondeu no tempo limite.",
              {
                retryable: true,
              },
            )
          : new EvolutionApiError(
              "network_error",
              "Não foi possível alcançar o servidor Evolution.",
              { retryable: true },
            );
        if (attempt === attempts) {
          logWhatsappAttempt({
            operation,
            attempt,
            attempts,
            outcome: "failed",
            kind: classifyWhatsappFailure(lastError),
            durationMs: Date.now() - startedAt,
          });
          throw lastError;
        }
      }
      const delayMs = backoffDelayMs(attempt);
      logWhatsappAttempt({
        operation,
        attempt,
        attempts,
        outcome: "retrying",
        kind: classifyWhatsappFailure(lastError),
        status: lastError?.status ?? null,
        durationMs: Date.now() - startedAt,
        delayMs,
      });
      clearTimeout(timer);
      await sleep(delayMs);
    } finally {
      clearTimeout(timer);
    }
  }


  throw (
    lastError ?? new EvolutionApiError("network_error", "Falha ao contatar o servidor Evolution.")
  );
}

export type EvolutionConnectivity = {
  ok: boolean;
  code: EvolutionErrorCode | null;
  message: string;
  /** Quantidade de instâncias visíveis para a chave (0 é válido). */
  instances: number | null;
  checkedAt: string;
};

/**
 * Teste de conectividade: chamada de leitura, barata e idempotente.
 * Nunca lança — devolve sempre um resultado apresentável.
 */
export async function checkEvolutionConnectivity(
  config: EvolutionConfig,
): Promise<EvolutionConnectivity> {
  const checkedAt = new Date().toISOString();
  try {
    const { data } = await evolutionRequest<unknown>(config, {
      method: "GET",
      path: "/instance/fetchInstances",
      timeoutMs: 8_000,
      attempts: 2,
    });
    const instances = Array.isArray(data) ? data.length : null;
    return {
      ok: true,
      code: null,
      message:
        instances === null
          ? "Conexão com a Evolution estabelecida."
          : `Conexão estabelecida — ${instances} instância(s) visível(is).`,
      instances,
      checkedAt,
    };
  } catch (error) {
    if (error instanceof EvolutionApiError) {
      return { ok: false, code: error.code, message: error.message, instances: null, checkedAt };
    }
    if (error instanceof EvolutionConfigError) {
      return {
        ok: false,
        code: "config_error",
        message: error.message,
        instances: null,
        checkedAt,
      };
    }
    console.error("[Evolution] erro inesperado no teste de conectividade", error);
    return {
      ok: false,
      code: "provider_error",
      message: "Não foi possível testar a conexão com a Evolution.",
      instances: null,
      checkedAt,
    };
  }
}
