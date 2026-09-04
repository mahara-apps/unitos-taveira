import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, tool } from "ai";
import type { ModelMessage } from "ai";
import { classifyAiError, unwrapAiError } from "./ai-failures.server";
import {
  describeProviderAttempts,
  getBrandAiCandidatesAdmin,
  type AiUsageContext,
  type ProviderAttempt,
} from "./ai-provider.server";
import {
  BriefingAnalysisSchema,
  normalizeBriefingAnalysis,
  type BriefingAnalysis,
} from "./briefing-analysis-schema";
import {
  BRIEFING_MAX_OUTPUT_TOKENS,
  briefingProviderOptions,
} from "./briefing-generation.server";
import { salvageStructuredOutput } from "./ai-output-salvage";

export type BriefingGenerationResult = {
  analysis: BriefingAnalysis;
  provider: string;
  model: string;
  attempts: ProviderAttempt[];
};

export async function generateBriefingAnalysis(input: {
  brandId: string;
  usage: AiUsageContext;
  system: string;
  messages: ModelMessage[];
  /** Cancela a chamada quando a etapa estoura o deadline. */
  abortSignal?: AbortSignal;
}): Promise<BriefingGenerationResult> {
  const candidates = await getBrandAiCandidatesAdmin(input.brandId, "operational", input.usage);
  const attempts: ProviderAttempt[] = [];
  let lastError: unknown = new Error("ai_provider_not_configured");

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    try {
      let rawAnalysis: unknown;
      if (candidate.provider === "gemini") {
        const result = await generateText({
          model: candidate.model,
          system: input.system,
          maxOutputTokens: BRIEFING_MAX_OUTPUT_TOKENS,
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          tools: {
            extract_client_fields: tool({
              description: "Entrega a análise estruturada do briefing para revisão humana.",
              inputSchema: BriefingAnalysisSchema,
            }),
          },
          toolChoice: { type: "tool", toolName: "extract_client_fields" },
          messages: input.messages,
        });
        rawAnalysis = result.toolCalls.find(
          (call) => call.toolName === "extract_client_fields",
        )?.input;
        if (!rawAnalysis) throw new Error("ai_no_structured_output: Gemini não chamou a ferramenta");
      } else {
        const result = await generateText({
          model: candidate.model,
          system: input.system,
          maxOutputTokens: BRIEFING_MAX_OUTPUT_TOKENS,
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          providerOptions: briefingProviderOptions(candidate.provider),
          output: Output.object({ schema: BriefingAnalysisSchema }),
          messages: input.messages,
        });
        rawAnalysis = result.output;
      }
      attempts.push(...candidate.providerAttempts);
      const analysis = normalizeBriefingAnalysis(rawAnalysis);
      if (!analysis) throw new Error("ai_invalid_output: briefing analysis did not validate");
      return { analysis, provider: candidate.provider, model: candidate.modelId, attempts };
    } catch (error) {
      lastError = error;
      attempts.push(...candidate.providerAttempts);
      if (!candidate.providerAttempts.length) {
        const failure = classifyAiError(error);
        attempts.push({
          provider: candidate.provider,
          model: candidate.modelId,
          attempt: attempts.length + 1,
          result: failure.kind,
          detail: unwrapAiError(error).text.replace(/\s+/g, " ").slice(0, 500),
        });
      }

      const salvaged = salvageStructuredOutput(
        error,
        BriefingAnalysisSchema,
        normalizeBriefingAnalysis,
      );
      if (salvaged) {
        return { analysis: salvaged, provider: candidate.provider, model: candidate.modelId, attempts };
      }

      const { kind, retryable } = classifyAiError(error);
      const canFallback =
        index + 1 < candidates.length &&
        retryable &&
        (kind === "provider_unavailable" ||
          kind === "provider_rate_limit" ||
          kind === "provider_quota");
      if (!canFallback) {
        if (
          NoOutputGeneratedError.isInstance(error) ||
          NoObjectGeneratedError.isInstance(error)
        ) {
          throw new Error(
            `ai_no_structured_output: a IA não produziu uma análise estruturada. Provider attempts: ${describeProviderAttempts(attempts)}`,
            { cause: error },
          );
        }
        throw error;
      }
    }
  }

  throw lastError;
}