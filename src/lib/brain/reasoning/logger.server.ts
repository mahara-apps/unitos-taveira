// ⚠️ Brain Reasoning Engine — Execution Log (server-only).
// Persiste cada raciocínio em `brain_reasoning_logs` usando o admin client
// (a tabela concede apenas SELECT a authenticated). Fire-and-forget.
import { waitUntil } from "@/lib/wait-until.server";
import type { BrainContext } from "../core";
import type { IntentDetection } from "./intent";
import type { ReasoningPlan } from "./planner";
import type { ToolResult } from "./tools.server";
import type { DecisionOutcome } from "./decision";

export interface LogInput {
  ctx: BrainContext;
  conversationId?: string | null;
  question: string;
  intent: IntentDetection;
  plan: ReasoningPlan;
  results: ToolResult[];
  decision: DecisionOutcome;
  usedLlm: boolean;
  latencyMs: number;
  answerPreview: string;
}

export function logReasoning(input: LogInput): void {
  waitUntil(
    (async () => {
      try {
        // Sem workspace o registro não é rastreável (e a coluna é NOT NULL).
        if (!input.ctx.brandId) return;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const memoryHits = input.results.reduce((acc, r) => acc + (r.count ?? 0), 0);
        await supabaseAdmin.from("brain_reasoning_logs").insert({
          brand_id: input.ctx.brandId,
          client_id: input.ctx.clientId ?? null,
          user_id: input.ctx.userId ?? null,
          conversation_id: input.conversationId ?? null,
          question: input.question.slice(0, 2000),
          intent: input.intent.intent,
          intent_confidence: input.intent.confidence,
          plan: input.plan.steps.map((s) => ({ tool: s.tool, description: s.description })),
          tools_used: input.results.map((r) => ({
            tool: r.tool,
            ok: r.ok,
            count: r.count ?? null,
            ms: r.ms,
          })),
          decision: input.decision.decision,
          used_llm: input.usedLlm,
          answer_confidence: input.decision.confidence,
          latency_ms: input.latencyMs,
          memory_hits: memoryHits,
          answer_preview: input.answerPreview.slice(0, 500),
        });
      } catch (err) {
        console.error("[brain.reasoning.log]", err);
      }
    })(),
  );
}
