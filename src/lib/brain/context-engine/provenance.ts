// ⚠️ Brain Context Engine — provenance.
// Registra QUAIS fragmentos do contexto foram efetivamente usados em uma
// resposta, com o score de relevância de cada um. É gravado no Event Bus
// (event_type = "context.used") para auditoria e futura calibração de scoring.
import * as events from "../event-bus";
import type { BrainContext } from "../core";
import type { ContextPack } from "./assemble";

export interface ProvenanceInput {
  pack: ContextPack;
  /** ID da mensagem/resposta que consumiu o contexto (opcional). */
  responseId?: string | null;
  /** Módulo consumidor (chat, agent, automation, ...). */
  consumer: string;
  /** Se o LLM foi acionado após o contexto. */
  usedLlm?: boolean;
}

export async function record(ctx: BrainContext, input: ProvenanceInput): Promise<void> {
  const items = input.pack.items.map((i) => ({
    kind: i.kind,
    id: i.id ?? null,
    label: i.label,
    score: i.score,
    confidence: i.confidence ?? null,
  }));
  await events.publish(ctx, {
    brand_id: input.pack.scope.brandId,
    client_id: input.pack.scope.clientId,
    source_module: input.consumer,
    event_type: "context.used",
    payload: {
      response_id: input.responseId ?? null,
      question: input.pack.question.slice(0, 400),
      intent: input.pack.intent.topics,
      keywords: input.pack.intent.keywords.slice(0, 20),
      scope: input.pack.scope,
      used_llm: !!input.usedLlm,
      candidate_count: input.pack.candidateCount,
      items,
      item_count: items.length,
      avg_score:
        items.length > 0
          ? Math.round((items.reduce((a, b) => a + b.score, 0) / items.length) * 1000) / 1000
          : 0,
    },
  });
}
