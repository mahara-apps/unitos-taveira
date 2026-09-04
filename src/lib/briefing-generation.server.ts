import type { SharedV4ProviderOptions } from "@ai-sdk/provider";

/** Limites e opções provider-aware da análise de briefing. */
export const BRIEFING_MAX_OUTPUT_TOKENS = 8_192;

export function briefingProviderOptions(provider: string): SharedV4ProviderOptions {
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

export const BRIEFING_OUTPUT_INSTRUCTIONS = `Regras de tamanho da resposta:
- resumo executivo: no máximo 400 caracteres;
- cada campo textual do briefing: no máximo 700 caracteres;
- no máximo uma evidência curta por campo proposto, com trecho de até 300 caracteres;
- no máximo 20 evidências e 20 participantes;
- seja conciso e não repita informações entre campos.`;