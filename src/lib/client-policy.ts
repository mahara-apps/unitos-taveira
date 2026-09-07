/**
 * Regras por cliente — tipos e normalização compartilhados (client-safe).
 *
 * Duas regras distintas e independentes:
 * 1) `approval_policy`: quais etapas exigem aprovação DO CLIENTE. Etapa em
 *    "internal" = o time avança direto, sem espera e sem pendência no portal.
 * 2) `scope_policy`: o que o limite de produção (volumetria do contrato) faz
 *    quando é estourado — apenas avisa ou bloqueia — e em quais frentes.
 *
 * Escopo de contrato (volumetria do briefing) continua sendo outra coisa:
 * ele define o tamanho do contrato; a política aqui define se isso trava.
 */

export const APPROVAL_STAGES = ["plan", "content", "schedule"] as const;
export type ApprovalStage = (typeof APPROVAL_STAGES)[number];

/** "client" = cliente aprova (histórico). "internal" = time avança direto. */
export type ApprovalMode = "client" | "internal";

export type ApprovalPolicy = Record<ApprovalStage, ApprovalMode>;

export const APPROVAL_STAGE_LABEL: Record<ApprovalStage, string> = {
  plan: "Pauta",
  content: "Conteúdo",
  schedule: "Agenda/data",
};

/** Padrão histórico: o cliente aprova tudo. */
export function defaultApprovalPolicy(): ApprovalPolicy {
  return { plan: "client", content: "client", schedule: "client" };
}

const isMode = (v: unknown): v is ApprovalMode => v === "client" || v === "internal";

/** Mescla cliente → workspace → padrão histórico (cliente vence por etapa). */
export function normalizeApprovalPolicy(
  client: unknown,
  brand?: unknown,
  base: ApprovalPolicy = defaultApprovalPolicy(),
): ApprovalPolicy {
  const pick = (src: unknown, stage: ApprovalStage): ApprovalMode | null => {
    if (!src || typeof src !== "object") return null;
    const v = (src as Record<string, unknown>)[stage];
    return isMode(v) ? v : null;
  };
  const out = { ...base };
  for (const stage of APPROVAL_STAGES) {
    out[stage] = pick(client, stage) ?? pick(brand, stage) ?? base[stage];
  }
  return out;
}

/** Etapa dispensada = ninguém espera pelo cliente nela. */
export const clientApprovalRequired = (policy: ApprovalPolicy, stage: ApprovalStage): boolean =>
  policy[stage] === "client";

/* ------------------------------------------------------------------ */
/* Limite de produção                                                  */
/* ------------------------------------------------------------------ */

/** `warn` = só avisa (volumetria livre). `block` = excedente exige liberação. */
export type ScopeMode = "warn" | "block";
/** Frentes onde o bloqueio vale. */
export const SCOPE_FRONTS = ["ai", "manual"] as const;
export type ScopeFront = (typeof SCOPE_FRONTS)[number];

export type ScopePolicy = { mode: ScopeMode; applies: ScopeFront[] };

export const SCOPE_FRONT_LABEL: Record<ScopeFront, string> = {
  ai: "Pauta por IA",
  manual: "Criação manual",
};

/** Padrão histórico: bloqueia, mas somente na geração de pauta por IA. */
export function defaultScopePolicy(): ScopePolicy {
  return { mode: "block", applies: ["ai"] };
}

const isScopeMode = (v: unknown): v is ScopeMode => v === "warn" || v === "block";

function readScope(src: unknown): Partial<ScopePolicy> | null {
  if (!src || typeof src !== "object") return null;
  const obj = src as Record<string, unknown>;
  const out: Partial<ScopePolicy> = {};
  if (isScopeMode(obj["mode"])) out.mode = obj["mode"];
  const applies = obj["applies"];
  if (Array.isArray(applies)) {
    const fronts = applies.filter((f): f is ScopeFront =>
      SCOPE_FRONTS.includes(f as ScopeFront),
    );
    out.applies = Array.from(new Set(fronts));
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Mescla cliente → workspace → `overage_policy` legado → padrão histórico.
 * O campo legado continua valendo para quem já o configurou.
 */
export function normalizeScopePolicy(args: {
  clientScope?: unknown;
  brandScope?: unknown;
  clientLegacy?: unknown;
  brandLegacy?: unknown;
}): ScopePolicy {
  const legacy = isScopeMode(args.clientLegacy)
    ? args.clientLegacy
    : isScopeMode(args.brandLegacy)
      ? args.brandLegacy
      : null;
  const base: ScopePolicy = legacy
    ? { mode: legacy, applies: defaultScopePolicy().applies }
    : defaultScopePolicy();
  const brand = readScope(args.brandScope);
  const client = readScope(args.clientScope);
  return {
    mode: client?.mode ?? brand?.mode ?? base.mode,
    applies: client?.applies ?? brand?.applies ?? base.applies,
  };
}

/** O limite bloqueia nesta frente? `warn` nunca bloqueia. */
export const scopeBlocks = (policy: ScopePolicy, front: ScopeFront): boolean =>
  policy.mode === "block" && policy.applies.includes(front);
