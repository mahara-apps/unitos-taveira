// ⚠️ Brain Reasoning Engine — Decision Layer.
// Decide se conseguimos responder de forma determinística ou se precisamos
// escalar para o LLM. Nunca chama LLM aqui.
import type { ReasoningPlan } from "./planner";
import type { ToolResult } from "./tools.server";

export type Decision = "deterministic" | "hybrid" | "llm";

export interface DecisionOutcome {
  decision: Decision;
  reason: string;
  confidence: number;
  totalHits: number;
}

export function decide(plan: ReasoningPlan, results: ToolResult[]): DecisionOutcome {
  const okResults = results.filter((r) => r.ok);
  const totalHits = okResults.reduce((acc, r) => acc + (r.count ?? (r.data ? 1 : 0)), 0);
  const hasStructural = okResults.some((r) => r.count !== undefined && r.count > 0);

  if (plan.needsLlm === "no" && hasStructural) {
    return {
      decision: "deterministic",
      reason: "Dados suficientes para resposta objetiva.",
      confidence: 0.9,
      totalHits,
    };
  }
  if (plan.needsLlm === "no" && !hasStructural) {
    return {
      decision: "deterministic",
      reason: "Sem dados no escopo — resposta objetiva de ausência.",
      confidence: 0.75,
      totalHits,
    };
  }
  if (plan.needsLlm === "maybe" && hasStructural) {
    return {
      decision: "hybrid",
      reason: "Dados presentes: resposta com síntese via LLM opcional.",
      confidence: 0.7,
      totalHits,
    };
  }
  return {
    decision: "llm",
    reason: "Pergunta aberta ou dependente de raciocínio — LLM necessário.",
    confidence: 0.5,
    totalHits,
  };
}
