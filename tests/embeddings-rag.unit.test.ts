import { describe, expect, it } from "vitest";
import {
  EMBED_DIMS,
  EMBED_MAX_ATTEMPTS,
  EMBED_TIMEOUT_MS,
  embeddingBackoffMs,
  isRetryableEmbeddingError,
  isRetryableEmbeddingStatus,
  isValidEmbedding,
  normalizeEmbeddingInput,
} from "@/lib/embeddings";

const vec = (n: number, fill: number = 0.1) => Array.from({ length: n }, () => fill);

describe("embeddings / RAG — regras de resiliência", () => {
  it("tem timeout por tentativa e mais de uma tentativa", () => {
    expect(EMBED_TIMEOUT_MS).toBeGreaterThan(0);
    expect(EMBED_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
    expect(EMBED_MAX_ATTEMPTS).toBeGreaterThanOrEqual(2);
  });

  it("repete/faz fallback só em falha transitória", () => {
    expect(isRetryableEmbeddingStatus(429)).toBe(true);
    expect(isRetryableEmbeddingStatus(503)).toBe(true);
    expect(isRetryableEmbeddingStatus(400)).toBe(false);
    expect(isRetryableEmbeddingStatus(401)).toBe(false);
    expect(isRetryableEmbeddingError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(
      true,
    );
    expect(isRetryableEmbeddingError(new Error("ai_embedding_invalid_output:gemini"))).toBe(false);
  });

  it("aplica backoff progressivo e limitado", () => {
    expect(embeddingBackoffMs(1)).toBeLessThan(embeddingBackoffMs(3));
    expect(embeddingBackoffMs(10)).toBeLessThanOrEqual(4_000);
  });

  it("rejeita vetor com dimensão errada ou valores inválidos (não persiste)", () => {
    expect(isValidEmbedding(vec(EMBED_DIMS))).toBe(true);
    expect(isValidEmbedding(vec(768))).toBe(false);
    expect(isValidEmbedding([...vec(EMBED_DIMS - 1), Number.NaN])).toBe(false);
    expect(isValidEmbedding(null)).toBe(false);
    expect(isValidEmbedding("[0.1,0.2]")).toBe(false);
  });

  it("não embeda texto vazio e limita o tamanho da entrada", () => {
    expect(normalizeEmbeddingInput("   \n  ")).toBe("");
    expect(normalizeEmbeddingInput("a  b\n c")).toBe("a b c");
    expect(normalizeEmbeddingInput("x".repeat(20_000)).length).toBe(8_000);
  });
});
