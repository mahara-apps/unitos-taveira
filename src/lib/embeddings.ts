/**
 * Regras puras da camada de embeddings/RAG (sem I/O — testável).
 *
 * Dimensão fixa em 1536 porque é o tipo da coluna `brain_embeddings.embedding`
 * (public.vector(1536)). Vetor com outra dimensão é output inválido: gravar
 * deixaria a tabela em estado inconsistente (INSERT falha ou índice HNSW
 * inutilizável), então rejeitamos antes de persistir.
 */
export const EMBED_DIMS = 1536;

/** Timeout por tentativa de embedding (provider pendurado não trava o job). */
export const EMBED_TIMEOUT_MS = 15_000;

/** Tentativas por provider antes de trocar de provider. */
export const EMBED_MAX_ATTEMPTS = 2;

/** Falha transitória: vale repetir/fazer fallback. 4xx de request, não. */
export function isRetryableEmbeddingStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function isRetryableEmbeddingError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? "";
  const msg = String((err as { message?: string } | null)?.message ?? err ?? "");
  if (name === "AbortError" || name === "TimeoutError") return true;
  return /timeout|network|fetch failed|ECONNRESET|socket|502|503|504|429/i.test(msg);
}

/** Backoff progressivo curto (embedding é caminho de background). */
export function embeddingBackoffMs(attempt: number): number {
  return Math.min(4_000, 400 * 2 ** Math.max(0, attempt - 1));
}

/** Normaliza texto para embedding; string vazia significa "não embedar". */
export function normalizeEmbeddingInput(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 8000);
}

/** Vetor utilizável: array numérico finito com a dimensão exata da coluna. */
export function isValidEmbedding(vec: unknown): vec is number[] {
  return (
    Array.isArray(vec) &&
    vec.length === EMBED_DIMS &&
    vec.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}
