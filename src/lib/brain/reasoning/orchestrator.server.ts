// ⚠️ Brain Reasoning Engine v1 — orquestrador.
// Pipeline: Intent → Plan → Tool exec → Decision → Response → Log.
// Server-only: usa supabase autenticado do BrainContext + Admin p/ log.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainContext } from "../core";
import { classifyIntent, type IntentDetection } from "./intent";
import { buildPlan, type ReasoningPlan } from "./planner";
import { executePlan, type ToolResult } from "./tools.server";
import { decide, type DecisionOutcome } from "./decision";
import { renderAnswer } from "./response";
import { logReasoning } from "./logger.server";

export interface ReasoningOutcome {
  intent: IntentDetection;
  plan: ReasoningPlan;
  toolResults: ToolResult[];
  decision: DecisionOutcome;
  /** Resposta determinística já pronta (pode ser vazia se decision=llm). */
  deterministicAnswer: string;
  /** Sinal para o gateway: se deve chamar o LLM. */
  shouldCallLlm: boolean;
  /** Contexto textual que o LLM pode usar como base factual. */
  llmContextMarkdown: string;
  latencyMs: number;
}

export async function reason(
  ctx: BrainContext,
  supabase: SupabaseClient,
  args: { question: string; conversationId?: string | null },
): Promise<ReasoningOutcome> {
  const t0 = Date.now();
  const intent = classifyIntent(args.question);
  const plan = buildPlan(intent.intent, args.question);
  const toolResults = await executePlan(ctx, supabase, plan.steps);
  const decision = decide(plan, toolResults);

  let deterministicAnswer = "";
  let shouldCallLlm = false;
  if (decision.decision === "deterministic") {
    deterministicAnswer = renderAnswer(intent.intent, args.question, toolResults);
  } else if (decision.decision === "hybrid") {
    deterministicAnswer = renderAnswer(intent.intent, args.question, toolResults);
    shouldCallLlm = true;
  } else {
    shouldCallLlm = true;
  }

  const outcome: ReasoningOutcome = {
    intent,
    plan,
    toolResults,
    decision,
    deterministicAnswer,
    shouldCallLlm,
    llmContextMarkdown: buildLlmContext(toolResults, deterministicAnswer),
    latencyMs: Date.now() - t0,
  };

  logReasoning({
    ctx,
    conversationId: args.conversationId ?? null,
    question: args.question,
    intent,
    plan,
    results: toolResults,
    decision,
    usedLlm: shouldCallLlm,
    latencyMs: outcome.latencyMs,
    answerPreview: deterministicAnswer || `[LLM] ${args.question}`.slice(0, 200),
  });

  return outcome;
}

function buildLlmContext(results: ToolResult[], deterministic: string): string {
  const parts: string[] = [];
  if (deterministic) parts.push("### Resposta determinística preliminar\n" + deterministic);
  const ok = results.filter((r) => r.ok);
  if (ok.length) {
    parts.push("### Sinais coletados pelo Brain");
    for (const r of ok) parts.push(`- **${r.tool}** (${r.ms}ms): ${r.summary}`);
  }
  return parts.join("\n\n");
}
