import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  tool,
} from "ai";
import type { z } from "zod";
import {
  getBrandAiCandidates,
  describeProviderAttempts,
  type ProviderAttempt,
} from "@/lib/ai-provider.server";
import { buildBrandContextBlueprint } from "@/lib/ai-agents.functions";
import { salvageStructuredOutput } from "@/lib/ai-output-salvage";
import { PLAN_MAX_OUTPUT_TOKENS, planProviderOptions } from "@/lib/monthly-plan-ai-options";
import {
  BACKOFF_MS,
  SPACING_MS,
  classifyAiError,
  describeFailure,
  sleep,
  unwrapAiError,
  type FailureKind,
} from "@/lib/ai-failures.server";


/**
 * Camada de agente para a Pauta mensal.
 *
 * Mesmo contrato dos agentes de IA do app (`ai-agents.functions.ts`):
 *   1. valida acesso do usuário à marca e do cliente à marca
 *   2. injeta o Brand Context Blueprint (identidade, briefing, concorrentes, docs)
 *   3. checa o orçamento de IA (`check_ai_usage_budget`) antes de gastar tokens
 *   4. usa o provider/modelo configurado pela marca (`getBrandAiModel`)
 *   5. loga uso e custo em `brand_ai_usage`
 *
 * Vive num módulo `.server` para poder ser reaproveitado por
 * `monthly-plans.functions.ts` sem arrastar código de servidor pro bundle.
 */

function tryParseFallback(text: string | undefined) {
  if (!text) return null;
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : cleaned);
  } catch {
    return null;
  }
}

export type PlanAgentResult<T> = {
  output: T;
  modelId: string;
  brandBlueprintUsed: boolean;
  attempts: number;
};

export type PlanAgentAttemptInfo = {
  attempt: number;
  ok: boolean;
  kind?: FailureKind;
  retryable?: boolean;
  message?: string;
};

const MAX_ATTEMPTS = 3;

export async function runPlanAgent<T extends z.ZodTypeAny>(opts: {
  agent: "pauta.suggest" | "content.generate";
  supabase: SupabaseClient;
  brandId: string;
  clientId: string;
  userId: string;
  system?: string;
  prompt: string;
  schema: T;
  /** Contexto extra já montado (estratégia IA, métricas, brain, briefing). */
  extraContext?: string;
  /** Observabilidade por tentativa — mesmo contrato do pipeline de Copy. */
  onAttempt?: (info: PlanAgentAttemptInfo) => Promise<void> | void;
}): Promise<PlanAgentResult<z.infer<T>>> {
  // Autorização — membro da marca.
  const { data: member, error: memberErr } = await opts.supabase
    .from("brand_members")
    .select("role")
    .eq("brand_id", opts.brandId)
    .eq("user_id", opts.userId)
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!member) throw new Error("Você não tem acesso a esta marca");

  // Autorização — cliente pertence à marca.
  const { data: client, error: clientErr } = await opts.supabase
    .from("clients")
    .select("id")
    .eq("id", opts.clientId)
    .eq("brand_id", opts.brandId)
    .maybeSingle();
  if (clientErr) throw clientErr;
  if (!client) throw new Error("Cliente inválido para esta marca");

  let brandBlueprint = "";
  try {
    const { blueprint } = await buildBrandContextBlueprint(
      opts.supabase,
      opts.brandId,
      opts.clientId,
    );
    brandBlueprint = blueprint ?? "";
  } catch (err) {
    console.warn("[runPlanAgent] blueprint failed", err);
  }

  const system = [brandBlueprint, opts.extraContext, opts.system]
    .filter((s): s is string => !!s && s.trim().length > 0)
    .join("\n\n---\n\n");

  // Candidatos BYOK isolados por provedor: assim cada tentativa usa o contrato
  // nativo do provedor (Gemini via tool calling, Groq/OpenAI via structured
  // output estrito) em vez de um payload único que só serve ao primário.
  const candidates = await getBrandAiCandidates(
    opts.supabase,
    opts.brandId,
    "operational",
    { agent: opts.agent, clientId: opts.clientId, userId: opts.userId },
  );

  const providerAttempts: ProviderAttempt[] = [];
  let lastErr: unknown = new Error("ai_provider_not_configured");
  let lastKind: FailureKind = "config";
  let attemptCounter = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (!candidate) continue;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      attemptCounter += 1;
      // Espaçamento único entre chamadas — evita rajadas no provedor.
      await sleep(SPACING_MS);
      try {
        let output: unknown = null;
        try {
          if (candidate.provider === "gemini") {
            const res = await generateText({
              model: candidate.model,
              ...(system ? { system } : {}),
              maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
              tools: {
                emit_plan: tool({
                  description: "Entrega a pauta estruturada no schema contratado.",
                  inputSchema: opts.schema,
                }),
              },
              toolChoice: { type: "tool", toolName: "emit_plan" },
              prompt: opts.prompt,
            });
            output = res.toolCalls.find((call) => call.toolName === "emit_plan")?.input ?? null;
            if (output == null) {
              throw new Error("ai_no_structured_output: Gemini não chamou a ferramenta");
            }
          } else {
            const res = await generateText({
              model: candidate.model,
              ...(system ? { system } : {}),
              maxOutputTokens: PLAN_MAX_OUTPUT_TOKENS,
              providerOptions: planProviderOptions(candidate.provider),
              prompt: opts.prompt,
              output: Output.object({ schema: opts.schema }),
            });
            output = res.output;
          }
        } catch (error) {
          if (
            NoObjectGeneratedError.isInstance(error) ||
            NoOutputGeneratedError.isInstance(error)
          ) {
            const salvaged =
              salvageStructuredOutput(error, opts.schema, (value) => {
                const safe = opts.schema.safeParse(value);
                return safe.success ? safe.data : null;
              }) ??
              (() => {
                const safe = opts.schema.safeParse(
                  tryParseFallback(
                    NoObjectGeneratedError.isInstance(error) ? error.text : undefined,
                  ),
                );
                return safe.success ? safe.data : null;
              })();
            if (salvaged == null) throw error;
            output = salvaged;
          } else {
            throw error;
          }
        }
        const safeOutput = opts.schema.safeParse(output);
        if (!safeOutput.success) {
          throw new Error("ai_invalid_output: a pauta gerada não corresponde ao schema");
        }
        providerAttempts.push(...candidate.providerAttempts);
        const trace = describeProviderAttempts(providerAttempts);
        await opts.onAttempt?.({
          attempt: attemptCounter,
          ok: true,
          ...(trace ? { message: trace } : {}),
        });
        return {
          output: safeOutput.data as z.infer<T>,
          modelId: candidate.modelId,
          brandBlueprintUsed: !!brandBlueprint,
          attempts: attemptCounter,
        };
      } catch (error) {
        lastErr = error;
        const { kind, retryable } = classifyAiError(error);
        lastKind = kind;
        const { text } = unwrapAiError(error);
        const detail = text.replace(/\s+/g, " ").slice(0, 500);
        providerAttempts.push({
          provider: candidate.provider,
          model: candidate.modelId,
          attempt: attemptCounter,
          result: kind,
          detail,
        });
        await opts.onAttempt?.({
          attempt: attemptCounter,
          ok: false,
          kind,
          retryable,
          message: `${candidate.provider}/${candidate.modelId} | ${detail}`.slice(0, 500),
        });
        // Falha permanente (schema/config/truncamento): não repete a mesma
        // chamada no mesmo provedor — apenas multiplicaria custo.
        if (!retryable) break;
        if (attempt === MAX_ATTEMPTS) break;
        await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
      }
    }

    // Só troca de provedor em falha transitória (429/5xx/quota).
    const transient =
      lastKind === "provider_unavailable" ||
      lastKind === "provider_rate_limit" ||
      lastKind === "provider_quota";
    if (!transient) break;
  }

  // Causa acionável para o usuário: se o provedor primário estourou cota/limite,
  // isso é o que precisa ser dito na UI — não o erro derivado do fallback.
  const quotaAttempt = providerAttempts.find(
    (a) => a.result === "provider_quota" || a.result === "provider_rate_limit",
  );
  const reportedKind: FailureKind =
    lastKind === "provider_quota" || lastKind === "provider_rate_limit"
      ? lastKind
      : quotaAttempt
        ? (quotaAttempt.result as FailureKind)
        : lastKind;

  // Erro tipado: o chamador decide o código devolvido à UI.
  const err = new Error(
    `ai_failure:${reportedKind} — ${describeFailure(reportedKind)} | ${describeProviderAttempts(providerAttempts)}`.slice(
      0,
      1200,
    ),
  ) as Error & {
    failureKind: FailureKind;
    cause?: unknown;
  };
  err.failureKind = reportedKind;
  err.cause = lastErr;

  throw err;
}

