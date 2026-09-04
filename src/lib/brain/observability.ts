// ⚠️ Brain Observability — falhas do Brain NUNCA viram silenciosamente "vazio".
//
// Regra: uma leitura que falha é um ERRO observável, não uma lista vazia. Isso
// evita o cenário mais perigoso do Brain: parecer "sem memória" quando na
// verdade a query quebrou (foi exatamente o que aconteceu com `topic/summary`).
//
// Nunca logamos conteúdo de memória/insight — apenas operação, escopo (ids
// truncados) e mensagem do banco.

export class BrainOperationError extends Error {
  readonly op: string;
  readonly cause?: unknown;
  constructor(op: string, message: string, cause?: unknown) {
    super(`[brain:${op}] ${message}`);
    this.name = "BrainOperationError";
    this.op = op;
    this.cause = cause;
  }
}

function shortId(v?: string | null): string {
  return v ? v.slice(0, 8) : "-";
}

/** Loga de forma estruturada e lança. Use em toda leitura/escrita do Brain. */
export function brainFail(
  op: string,
  error: { message: string; code?: string } | Error,
  scope?: { brandId?: string | null; clientId?: string | null },
): never {
  const message = error.message;
  const code = (error as { code?: string }).code;
  console.error(
    JSON.stringify({
      at: "brain.failure",
      op,
      code: code ?? null,
      message,
      brand: shortId(scope?.brandId),
      client: shortId(scope?.clientId),
    }),
  );
  throw new BrainOperationError(op, message, error);
}

export interface BucketResult<T> {
  data: T;
  /** Preenchido quando o bucket falhou — o consumidor deve SINALIZAR, não fingir vazio. */
  failure: string | null;
}

/**
 * Executa um bucket de contexto de forma resiliente: se falhar, o pacote de
 * contexto continua sendo montado, mas a falha é reportada explicitamente
 * (aparece no markdown e no painel de diagnóstico).
 */
export async function bucket<T>(
  op: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<BucketResult<T>> {
  try {
    return { data: await fn(), failure: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ at: "brain.bucket_failure", op, message }));
    return { data: fallback, failure: `${op}: ${message}` };
  }
}
