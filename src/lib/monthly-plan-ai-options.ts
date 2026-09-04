import type { SharedV4ProviderOptions } from "@ai-sdk/provider";

/**
 * Limites e opções provider-aware da geração de Pauta mensal.
 *
 * Mesmo contrato já validado na Importação de Briefing: orçamento de saída
 * explícito (sem isso o Groq trunca antes de fechar o JSON) e `reasoningEffort`
 * válido para GPT-OSS (nunca `"none"`, que é rejeitado com HTTP 400).
 */
export const PLAN_MAX_OUTPUT_TOKENS = 8_192;

export function planProviderOptions(provider: string): SharedV4ProviderOptions {
  if (provider === "groq") {
    return {
      groq: {
        reasoningEffort: "low",
        structuredOutputs: true,
        strictJsonSchema: true,
      },
    };
  }
  return {};
}
