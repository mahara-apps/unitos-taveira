// ⚠️ Server-only: registro central de consumo de IA (tokens + custo).
// Toda chamada que passa por getBrandAiModel é medida aqui, sem depender de
// cada ponto de chamada lembrar de gravar.

import { redactAiDetail } from "./ai-observability";


export type AiUsageContext = {
  /** Rótulo do recurso que originou a chamada (ex.: "chat.brain"). */
  agent?: string;
  clientId?: string | null;
  userId?: string | null;
};

/**
 * Preço aproximado em USD por 1M de tokens. Chaves normalizadas (sem prefixo
 * de vendor, minúsculas). Aliases `*-latest` apontam para a geração atual.
 */
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  // ---- Google Gemini ----
  "gemini-pro-latest": { input: 1.25, output: 10 },
  "gemini-3.1-pro-preview": { input: 1.25, output: 10 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-flash-latest": { input: 0.3, output: 2.5 },
  "gemini-3.7-flash": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.3, output: 2.5 },
  "gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-flash-lite-latest": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  // ---- OpenAI ----
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  // ---- Anthropic ----
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-3-7-sonnet-latest": { input: 3, output: 15 },
  "claude-3-5-haiku-latest": { input: 0.8, output: 4 },
  // ---- Groq (ids normalizados, sem prefixo de vendor) ----
  "gpt-oss-120b": { input: 0.15, output: 0.75 },
  "gpt-oss-20b": { input: 0.1, output: 0.5 },
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "kimi-k2-instruct-0905": { input: 1, output: 3 },
};

/** Fallback conservador quando o modelo não está tabelado. */
const DEFAULT_PRICE = { input: 0.3, output: 2.5 };

export function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^[a-z0-9-]+\//, "");
}

export function estimateCost(model: string, inTok: number, outTok: number): number {
  const key = normalizeModelId(model);
  const price =
    PRICE_PER_MTOK[key] ??
    // aproxima variantes datadas (ex.: gemini-2.5-flash-preview-09-2025)
    Object.entries(PRICE_PER_MTOK).find(([k]) => key.startsWith(k))?.[1] ??
    DEFAULT_PRICE;
  return (inTok * price.input + outTok * price.output) / 1_000_000;
}

export type RecordAiUsageArgs = {
  brandId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  errorMessage?: string | null;
  /** Classificação da falha — obrigatória sempre que `success` é false. */
  errorKind?: string | null;
  provider?: string | null;
  /** Etapa/pipeline (reconstrução da execução). */
  step?: string | null;
  attempt?: number | null;
} & AiUsageContext;

/**
 * Monta a linha de consumo. Puro e exportado para teste: garante que uma falha
 * NUNCA seja gravada sem classificação (`error_kind`), o que tornaria o
 * registro impossível de diagnosticar — e é exatamente o que o CHECK
 * `brand_ai_usage_failure_kind_chk` proíbe no banco.
 */
export function buildAiUsageRow(args: RecordAiUsageArgs) {
  const failed = args.success === false;
  return {
    brand_id: args.brandId,
    client_id: args.clientId ?? null,
    agent: args.agent ?? "ai.call",
    model: args.model,
    provider: args.provider ?? null,
    step: args.step ?? null,
    attempt: args.attempt ?? null,
    input_tokens: Math.max(0, Math.round(args.inputTokens || 0)),
    output_tokens: Math.max(0, Math.round(args.outputTokens || 0)),
    cost_usd: estimateCost(args.model, args.inputTokens || 0, args.outputTokens || 0),
    success: args.success,
    error_message: redactAiDetail(args.errorMessage ?? "") || null,
    error_kind: failed ? (args.errorKind ?? "unknown") : null,
    // Rastreabilidade: consumo humano guarda o autor; rotina automática é
    // marcada como `system` (o CHECK no banco impede 'user' sem actor_id).
    actor_id: args.userId ?? null,
    actor_kind: args.userId ? "user" : "system",
  };
}

/**
 * Grava uma linha de consumo — inclusive quando a chamada FALHOU: o token/custo
 * pode ser zero, mas a tentativa precisa aparecer no histórico.
 * Best-effort: nunca lança, para não derrubar a geração por causa do log.
 */
export async function recordAiUsage(args: RecordAiUsageArgs): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("brand_ai_usage")
      .insert(buildAiUsageRow(args) as never);
    if (error) console.warn("[ai-usage] insert failed", error.message);
  } catch (err) {
    console.warn("[ai-usage] insert threw", err);
  }
}
