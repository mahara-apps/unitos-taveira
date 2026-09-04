/**
 * CLASSIFICAÇÃO DE FALHAS DE IA — fonte única.
 *
 * Extraído de `post-agents.server.ts` (pipeline de Copy, já validado) para ser
 * reutilizado também pelo pipeline de Estratégia. A Copy continua consumindo
 * exatamente estas funções — não existe lógica duplicada nem paralela.
 */

export type FailureKind =
  | "provider_quota"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "invalid_output"
  | "output_truncated"
  | "invalid_request"
  | "config"
  | "unknown";

/** Espaçamento único entre chamadas de agentes — evita rajadas no provedor. */
export const SPACING_MS = 4000;
/** Backoff progressivo entre tentativas do MESMO agente. */
export const BACKOFF_MS = [15_000, 45_000];
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ErrLike = {
  name?: unknown;
  message?: unknown;
  cause?: unknown;
  statusCode?: unknown;
  status?: unknown;
  responseBody?: unknown;
  data?: unknown;
  text?: unknown;
};

/**
 * Percorre a cadeia de `cause` acumulando mensagens e status HTTP.
 *
 * Isso é o que impede o `NoOutputGeneratedError` do pacote `ai` de mascarar a
 * causa real: o SDK descarta o erro do provedor na mensagem, mas o mantém em
 * `cause` (e às vezes em `responseBody`/`data`).
 */
export function unwrapAiError(err: unknown): {
  text: string;
  status?: number;
  hadNoOutput: boolean;
} {
  const parts: string[] = [];
  let status: number | undefined;
  let hadNoOutput = false;
  const seen = new Set<unknown>();
  let node: unknown = err;

  for (let depth = 0; depth < 8 && node != null; depth++) {
    if (seen.has(node)) break;
    seen.add(node);

    if (typeof node === "string") {
      parts.push(node);
      break;
    }
    const e = node as ErrLike;
    const name = typeof e.name === "string" ? e.name : "";
    const message = typeof e.message === "string" ? e.message : "";
    if (name) parts.push(name);
    if (message) parts.push(message);
    if (/nooutputgenerated|no output generated/i.test(`${name} ${message}`)) hadNoOutput = true;

    for (const raw of [e.statusCode, e.status]) {
      if (typeof raw === "number" && status == null) status = raw;
    }
    // Corpo bruto da resposta do provedor, quando o SDK o anexa.
    for (const extra of [e.responseBody, e.data, e.text]) {
      if (typeof extra === "string" && extra) parts.push(extra.slice(0, 2000));
      else if (extra && typeof extra === "object") {
        try {
          parts.push(JSON.stringify(extra).slice(0, 2000));
        } catch {
          /* ignora */
        }
      }
    }

    node = e.cause;
  }

  if (parts.length === 0) parts.push(String(err));
  const text = parts.join(" ");
  // Status embutido no texto do provedor ("[429 Too Many Requests]", "status: 503").
  if (status == null) {
    const m = text.match(/\b(4\d{2}|5\d{2})\b/);
    if (m) status = Number(m[1]);
  }
  return { text, hadNoOutput, ...(status != null ? { status } : {}) };
}

/**
 * Classifica a falha do provedor. Quota/rate limit/sobrecarga são sempre
 * retryable; problemas de configuração são permanentes.
 *
 * `NoOutputGeneratedError` NUNCA é classificado como `unknown`: a causa real é
 * inspecionada e, na ausência de pistas, o caso vira `invalid_output`
 * (terminal) em vez de falha permanente sem explicação.
 */
export function classifyAiError(err: unknown): { kind: FailureKind; retryable: boolean } {
  const { text, status, hadNoOutput } = unwrapAiError(err);
  const msg = text.toLowerCase();

  // Configuração/credencial: permanente — checado antes dos transitórios para
  // não confundir "invalid api key" (401) com indisponibilidade.
  if (
    msg.includes("ai_provider_not_configured") ||
    msg.includes("ai_provider_key_missing") ||
    msg.includes("ai_model_unavailable") ||
    msg.includes("prompt_missing") ||
    msg.includes("api_key") ||
    msg.includes("api key not valid") ||
    msg.includes("invalid api key") ||
    msg.includes("credential") ||
    status === 401 ||
    status === 403
  ) {
    return { kind: "config", retryable: false };
  }

  // Payload/schema inválido é permanente. Não deve trocar de provider nem
  // repetir a mesma chamada: isso apenas multiplica custo sem chance de êxito.
  if (
    msg.includes("max completion tokens") ||
    msg.includes("maximum context length") ||
    msg.includes("finish_reason\":\"length")
  ) {
    return { kind: "output_truncated", retryable: false };
  }

  if (
    status === 400 ||
    msg.includes("invalid json schema") ||
    msg.includes("invalid_request_error") ||
    msg.includes("response_format") ||
    msg.includes("jsonschema")
  ) {
    return { kind: "invalid_request", retryable: false };
  }

  if (
    status === 402 ||
    msg.includes("quota") ||
    msg.includes("free_tier") ||
    msg.includes("insufficient_quota") ||
    msg.includes("billing") ||
    msg.includes("credit")
  ) {
    return { kind: "provider_quota", retryable: true };
  }
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many requests")) {
    return { kind: "provider_rate_limit", retryable: true };
  }
  if (
    (status != null && status >= 500) ||
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("unavailable") ||
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return { kind: "provider_unavailable", retryable: true };
  }
  // Saída ausente/malformada não é indisponibilidade do provider: repetir em
  // outro provider pode multiplicar custo sem corrigir o contrato da saída.
  if (
    msg.includes("ai_invalid_output") ||
    msg.includes("empty_caption") ||
    msg.includes("json")
  ) {
    return { kind: "invalid_output", retryable: false };
  }
  if (hadNoOutput) return { kind: "invalid_output", retryable: false };

  return { kind: "unknown", retryable: false };
}

/** Mensagens em pt-BR exibidas ao usuário para cada classificação. */
export const FAILURE_MESSAGE_PT: Record<FailureKind, { title: string; body: string }> = {
  provider_quota: {
    title: "Limite de IA atingido",
    body: "O provedor de IA atingiu o limite de uso disponível no momento. Sua estratégia está preservada. Tente novamente mais tarde.",
  },
  provider_rate_limit: {
    title: "Muitas solicitações",
    body: "A IA recebeu muitas solicitações em sequência. Aguarde alguns instantes e tente novamente.",
  },
  provider_unavailable: {
    title: "IA temporariamente indisponível",
    body: "O provedor está temporariamente sobrecarregado. Tente novamente em alguns instantes.",
  },
  invalid_output: {
    title: "A IA não conseguiu concluir esta etapa",
    body: "Nenhum conteúdo inválido foi salvo. Tente gerar novamente.",
  },
  output_truncated: {
    title: "A resposta da IA excedeu o limite",
    body: "O material foi preservado, mas a resposta terminou antes de concluir a análise.",
  },
  invalid_request: {
    title: "A IA não aceitou o formato da solicitação",
    body: "O material foi preservado, mas a análise não pôde ser iniciada. Tente novamente após a correção da integração.",
  },
  config: {
    title: "Configuração de IA necessária",
    body: "Verifique a configuração da IA deste cliente antes de tentar novamente.",
  },
  unknown: {
    title: "Não foi possível concluir a geração",
    body: "Ocorreu um erro inesperado. Nenhum conteúdo inválido foi salvo.",
  },
};

export function describeFailure(kind: FailureKind): string {
  const m = FAILURE_MESSAGE_PT[kind];
  return `${m.title} — ${m.body}`;
}

/**
 * Mensagem para a UI a partir do erro cru. É o único caminho autorizado para
 * exibir uma falha de IA ao usuário: classifica e devolve texto em pt-BR, sem
 * status HTTP, sem nome de provider e sem trecho da resposta do modelo.
 */
export function userFacingAiError(err: unknown): {
  kind: FailureKind;
  retryable: boolean;
  title: string;
  body: string;
} {
  const { kind, retryable } = classifyAiError(err);
  const m = FAILURE_MESSAGE_PT[kind];
  return { kind, retryable, title: m.title, body: m.body };
}
