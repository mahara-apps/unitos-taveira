/**
 * Salvaguarda de saída estruturada de IA.
 *
 * Alguns provedores (ex.: modelos servidos via OpenRouter) validam o JSON
 * gerado contra o response_schema ANTES de devolver a resposta. Quando o
 * modelo omite campos exigidos, a chamada falha com `json_validate_failed`
 * mesmo que o conteúdo gerado esteja perfeito em `failed_generation`.
 * Este helper recupera esse conteúdo em vez de descartar a análise.
 */
import { APICallError, NoObjectGeneratedError, NoOutputGeneratedError } from "ai";
import type { z } from "zod";

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Candidatos de texto onde a geração descartada pode estar preservada. */
function candidateTexts(error: unknown, seen = new Set<unknown>()): string[] {
  const out: string[] = [];
  if (error == null || seen.has(error)) return out;
  seen.add(error);
  if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
    const text = (error as { text?: unknown }).text;
    if (typeof text === "string" && text) out.push(text);
    const cause = (error as { cause?: unknown }).cause;
    if (cause) out.push(...candidateTexts(cause, seen));
  }
  if (APICallError.isInstance(error)) {
    const body = (error as { responseBody?: unknown }).responseBody;
    if (typeof body === "string" && body) {
      try {
        const parsed = JSON.parse(body) as {
          error?: { failed_generation?: unknown; data?: { failed_generation?: unknown } };
          failed_generation?: unknown;
        };
        const failed =
          parsed?.error?.failed_generation ??
          parsed?.error?.data?.failed_generation ??
          parsed?.failed_generation;
        if (typeof failed === "string" && failed) out.push(failed);
      } catch {
        /* responseBody não é JSON — ignora */
      }
    }
  }
  if (typeof error === "object") {
    const value = error as { cause?: unknown; text?: unknown; responseBody?: unknown };
    if (typeof value.text === "string" && value.text) out.push(value.text);
    if (value.cause) out.push(...candidateTexts(value.cause, seen));
  }
  return out;
}

/**
 * Tenta recuperar uma saída estruturada válida a partir do erro do provider.
 * Retorna o objeto validado pelo schema ou null quando não há o que salvar.
 */
export function salvageStructuredOutput<S extends z.ZodTypeAny>(
  error: unknown,
  schema: S,
  normalize?: (value: unknown) => z.infer<S> | null,
): z.infer<S> | null {
  for (const text of candidateTexts(error)) {
    const parsed = extractJsonObject(text);
    if (parsed == null) continue;
    const normalized = normalize?.(parsed);
    if (normalized != null) {
      console.warn("[ai-output-salvage] saída normalizada de failed_generation");
      return normalized;
    }
    const result = schema.safeParse(parsed);
    if (result.success) {
      console.warn("[ai-output-salvage] saída recuperada de failed_generation");
      return result.data as z.infer<S>;
    }
  }
  return null;
}
