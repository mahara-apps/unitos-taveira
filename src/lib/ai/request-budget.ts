/**
 * Budget DURO de requisições aos provedores BYOK de IA por operação.
 *
 * Módulo PURO e testável: não faz I/O, não conhece Supabase e não conhece o
 * AI SDK. Segue `docs/PADRAO_INTEGRACOES_EXTERNAS.md`.
 *
 * Por quê: o limite de tentativas (`MAX_ATTEMPTS`, cadeia de modelos do
 * catálogo e fallback de provedor) limita cada eixo isoladamente, mas o
 * produto deles não é limitado — uma operação podia multiplicar chamadas
 * reais (retry × troca de modelo × troca de provedor). Este budget é o teto
 * único e final da operação, verificado ANTES de cada chamada real.
 *
 * NÃO substitui o teto de custo mensal (`check_ai_usage_budget`): aquele é
 * financeiro e por marca; este é operacional e por execução.
 */

/** Teto de chamadas reais ao provedor em UMA operação de IA. */
export const MAX_AI_REQUESTS_PER_OPERATION = 12;

export class AiRequestBudgetExceededError extends Error {
  readonly failureKind = "request_budget" as const;
  readonly limit: number;
  readonly used: number;
  constructor(limit: number, used: number, op?: string) {
    super(
      `ai_request_budget_exceeded:${limit}: a operação${op ? ` ${op}` : ""} atingiu o teto de ${limit} chamadas ao provedor de IA e foi interrompida.`,
    );
    this.name = "AiRequestBudgetExceededError";
    this.limit = limit;
    this.used = used;
  }
}

export type AiRequestBudget = {
  /** Reserva 1 chamada; `false` significa budget esgotado (não chamar o provedor). */
  take: () => boolean;
  used: () => number;
  remaining: () => number;
  readonly limit: number;
};

export function createAiRequestBudget(limit = MAX_AI_REQUESTS_PER_OPERATION): AiRequestBudget {
  const max = Math.max(1, Math.floor(limit));
  let used = 0;
  return {
    limit: max,
    take: () => {
      if (used >= max) return false;
      used += 1;
      return true;
    },
    used: () => used,
    remaining: () => Math.max(0, max - used),
  };
}

/**
 * Reserva uma chamada ou interrompe a operação. Telemetria estruturada é
 * emitida apenas quando o budget estoura — nunca contém chave, prompt ou
 * conteúdo gerado.
 */
export function takeAiRequest(
  budget: AiRequestBudget,
  ctx: { op?: string; provider?: string; model?: string },
): void {
  if (budget.take()) return;
  logAiBudgetExceeded({
    op: ctx.op ?? "ai.call",
    ...(ctx.provider ? { provider: ctx.provider } : {}),
    ...(ctx.model ? { model: ctx.model } : {}),
    limit: budget.limit,
    used: budget.used(),
  });
  throw new AiRequestBudgetExceededError(budget.limit, budget.used(), ctx.op);
}

export type AiBudgetTelemetry = {
  op: string;
  provider?: string;
  model?: string;
  limit: number;
  used: number;
};

/** Log estruturado do budget excedido (sem segredos e sem conteúdo). */
export function logAiBudgetExceeded(entry: AiBudgetTelemetry): void {
  const parts = [
    `op=${entry.op}`,
    "outcome=request_budget_exceeded",
    `limit=${entry.limit}`,
    `used=${entry.used}`,
  ];
  if (entry.provider) parts.push(`provider=${entry.provider}`);
  if (entry.model) parts.push(`model=${entry.model}`);
  console.error(`[ai-budget] ${parts.join(" ")}`);
}

export function isAiRequestBudgetError(error: unknown): boolean {
  if (error instanceof AiRequestBudgetExceededError) return true;
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return msg.startsWith("ai_request_budget_exceeded");
}
