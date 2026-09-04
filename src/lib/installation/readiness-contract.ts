/**
 * "Mínimo Operacional Primeiro" — regras puras de prontidão de uma instalação.
 *
 * Módulo PURO: sem rede, sem SQL, sem secrets. Ele define, de forma testável,
 * a diferença entre o NÚCLEO da instalação (obrigatório) e a CONFIGURAÇÃO
 * OPCIONAL (integrações externas), e é a única fonte da definição de READY.
 *
 * Invariantes:
 *  - READY depende SOMENTE do núcleo: banco, schema, RLS, Storage, seeds,
 *    secrets próprios, cron, deploy, health check, primeiro Super Admin e
 *    exatamente 1 workspace;
 *  - integrações externas (Meta, Resend, Evolution, IA, branding) e o domínio
 *    definitivo NUNCA bloqueiam a instalação;
 *  - a URL temporária do deploy é uma URL operacional válida;
 *  - trocar a URL depois exige que app_url, cron e redirect Meta apontem para a
 *    MESMA origem — divergência é recusada;
 *  - 1 instalação = 1 aplicação = 1 Supabase = 1 workspace = 1 domínio.
 */

import { containsMasterReference, validatePublicAppUrl } from "./bootstrap-contract";

/* ------------------------------------------------------------------ núcleo */

export const CORE_REQUIREMENTS = [
  { id: "database", label: "Banco" },
  { id: "schema", label: "Schema" },
  { id: "rls", label: "RLS" },
  { id: "storage", label: "Storage" },
  { id: "seeds", label: "Seeds" },
  { id: "secrets", label: "Secrets" },
  { id: "cron", label: "Cron" },
  { id: "deploy", label: "Deploy" },
  { id: "health_check", label: "Health check" },
  { id: "super_admin", label: "Super Admin" },
  { id: "workspace", label: "Workspace único" },
] as const;

export type CoreRequirementId = (typeof CORE_REQUIREMENTS)[number]["id"];

/**
 * Itens de PRIMEIRO ACESSO: criados pelo cliente no /setup da própria
 * instalação. Aparecem no núcleo como informação, mas não bloqueiam READY
 * quando ainda não foram reportados.
 */
export const FIRST_ACCESS_REQUIREMENTS: readonly CoreRequirementId[] = ["super_admin", "workspace"];


/** Estado de um item do núcleo. `pending` = obrigatório ainda não comprovado. */
export type CoreState = "ok" | "attention" | "pending" | "running" | "error";

export const CORE_STATE_LABEL: Record<CoreState, string> = {
  ok: "OK",
  attention: "Atenção",
  pending: "Pendente",
  running: "Provisionando",
  error: "Falha",
};

/* --------------------------------------------------------------- opcional */

export const OPTIONAL_CONFIG = [
  { id: "custom_domain", label: "Domínio definitivo" },
  { id: "meta", label: "Meta" },
  { id: "resend", label: "Resend" },
  { id: "evolution", label: "Evolution / WhatsApp" },
  { id: "ai", label: "IA" },
  { id: "branding", label: "Branding" },
] as const;

export type OptionalConfigId = (typeof OPTIONAL_CONFIG)[number]["id"];

/** Nenhum destes estados bloqueia a instalação. */
export type OptionalState = "configured" | "pending" | "not_configured";

export const OPTIONAL_STATE_LABEL: Record<OptionalState, string> = {
  configured: "Configurado",
  pending: "Pendente",
  not_configured: "Não configurado",
};

export function optionalStateFrom(configured: boolean | null | undefined): OptionalState {
  return configured === true ? "configured" : configured === false ? "not_configured" : "pending";
}

/* ---------------------------------------------------- leitura dos estados */

function isCoreState(value: unknown): value is CoreState {
  return (
    value === "ok" ||
    value === "attention" ||
    value === "pending" ||
    value === "running" ||
    value === "error"
  );
}

/**
 * Mapeamento dos checks legados (`health_checks` jsonb já persistido) para os
 * itens do núcleo. Nada é inventado: o que não foi reportado fica `pending`.
 */
const LEGACY_SOURCE: Record<CoreRequirementId, readonly string[]> = {
  database: ["database"],
  schema: ["schema", "database"],
  rls: ["rls", "database"],
  seeds: ["seeds", "database"],
  storage: ["storage"],
  secrets: ["secrets"],
  cron: ["cron"],
  deploy: ["deploy", "frontend"],
  health_check: ["health_check", "connectivity"],
  super_admin: ["super_admin"],
  workspace: ["workspace"],
};

export type CoreCheck = { state: CoreState; detail?: string | null };

/** Normaliza o jsonb reportado — desconhecido vira `pending`, nunca `ok`. */
export function normalizeCoreChecks(raw: unknown): Record<CoreRequirementId, CoreCheck> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<CoreRequirementId, CoreCheck>;
  for (const req of CORE_REQUIREMENTS) {
    let found: CoreCheck = { state: "pending", detail: null };
    for (const key of LEGACY_SOURCE[req.id]) {
      const value = source[key] as CoreCheck | undefined;
      if (isCoreState(value?.state)) {
        found = {
          state: value.state,
          detail: typeof value.detail === "string" ? value.detail : null,
        };
        break;
      }
    }
    out[req.id] = found;
  }
  return out;
}

/* ------------------------------------------------------------ estado geral */

export type InstallationOverallState =
  | "operational"
  | "attention"
  | "failure"
  | "provisioning"
  | "blocked";

export const OVERALL_STATE_LABEL: Record<InstallationOverallState, string> = {
  operational: "OPERACIONAL",
  attention: "ATENÇÃO",
  failure: "FALHA",
  provisioning: "PROVISIONANDO",
  blocked: "BLOQUEADA",
};

export const OVERALL_STATE_ICON: Record<InstallationOverallState, string> = {
  operational: "🟢",
  attention: "🟡",
  failure: "🔴",
  provisioning: "⏳",
  blocked: "⚪",
};

export type ReadinessInput = {
  core: Partial<Record<CoreRequirementId, CoreCheck>> | unknown;
  optional?: Partial<Record<OptionalConfigId, OptionalState>>;
  /** Existe operação de provisionamento/validação em execução. */
  operationRunning?: boolean;
};

export type ReadinessReport = {
  /** READY = todo o núcleo comprovado. Integrações externas não contam. */
  ready: boolean;
  state: InstallationOverallState;
  core: Record<CoreRequirementId, CoreCheck>;
  optional: Record<OptionalConfigId, OptionalState>;
  /** Itens obrigatórios ainda não comprovados (motivo de BLOCKED). */
  missingCore: CoreRequirementId[];
  /** Itens obrigatórios em falha (motivo de FALHA). */
  failedCore: CoreRequirementId[];
  /** Configuração opcional ainda ausente — nunca bloqueia. */
  pendingOptional: OptionalConfigId[];
};

/**
 * Estado definitivo da instalação.
 *
 * Ordem de precedência: falha do núcleo > provisionamento em curso > núcleo
 * incompleto (BLOQUEADA) > ressalva no núcleo (ATENÇÃO) > OPERACIONAL.
 * Integrações opcionais ausentes mantêm a instalação OPERACIONAL.
 */
export function computeReadiness(input: ReadinessInput): ReadinessReport {
  const core = normalizeCoreChecks(input.core);
  const optional = {} as Record<OptionalConfigId, OptionalState>;
  for (const item of OPTIONAL_CONFIG) {
    optional[item.id] = input.optional?.[item.id] ?? "not_configured";
  }

  // Primeiro acesso: informativo. O Super Admin e o workspace são criados pelo
  // próprio cliente em /setup, então "ainda não reportado" NUNCA bloqueia a
  // instalação — só uma falha real (ex.: mais de um workspace) bloqueia.
  const blocking = CORE_REQUIREMENTS.filter((r) => !FIRST_ACCESS_REQUIREMENTS.includes(r.id));

  const failedCore = CORE_REQUIREMENTS.filter((r) => core[r.id].state === "error").map((r) => r.id);
  const runningCore = CORE_REQUIREMENTS.some((r) => core[r.id].state === "running");
  const missingCore = blocking
    .filter((r) => core[r.id].state === "pending" || core[r.id].state === "running")
    .map((r) => r.id);
  const attentionCore = blocking.some((r) => core[r.id].state === "attention");
  const pendingOptional = OPTIONAL_CONFIG.filter((o) => optional[o.id] !== "configured").map(
    (o) => o.id,
  );

  const ready = failedCore.length === 0 && missingCore.length === 0;

  let state: InstallationOverallState;
  if (failedCore.length) state = "failure";
  else if (input.operationRunning || runningCore) state = "provisioning";
  else if (missingCore.length) state = "blocked";
  else if (attentionCore) state = "attention";
  else state = "operational";

  return { ready, state, core, optional, missingCore, failedCore, pendingOptional };
}


/* ----------------------------------------------------------- URL operacional */

/** Domínios de deploy temporário aceitos como URL operacional inicial. */
export const TEMPORARY_DEPLOY_HOSTS = [
  "vercel.app",
  "lovable.app",
  "netlify.app",
  "pages.dev",
  "onrender.com",
  "fly.dev",
] as const;

export type OperationalUrlKind = "temporary" | "custom";

export type OperationalUrl =
  | { ok: true; origin: string; kind: OperationalUrlKind }
  | { ok: false; reason: string };

/** True quando o host é de deploy temporário (ex.: unitos-pitada-abc.vercel.app). */
export function isTemporaryDeployUrl(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim();
  if (!value) return false;
  try {
    const host = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase();
    return TEMPORARY_DEPLOY_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Classifica a URL da instalação. A URL temporária do deploy é VÁLIDA: nenhuma
 * instalação fica bloqueada esperando domínio definitivo.
 */
export function classifyOperationalUrl(raw: string | null | undefined): OperationalUrl {
  const validated = validatePublicAppUrl(raw);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  return {
    ok: true,
    origin: validated.value,
    kind: isTemporaryDeployUrl(validated.value) ? "temporary" : "custom",
  };
}

/** Domínio definitivo é opcional: só é "configurado" quando não é temporário. */
export function customDomainState(raw: string | null | undefined): OptionalState {
  const url = classifyOperationalUrl(raw);
  if (!url.ok) return (raw ?? "").trim() ? "pending" : "not_configured";
  return url.kind === "custom" ? "configured" : "pending";
}

/* --------------------------------------------------- troca de URL definitiva */

export type UrlSwitchInput = {
  /** Nova origem https (domínio definitivo ou nova URL de deploy). */
  newUrl: string | null | undefined;
  /** Valor atual de `installation.app_url`, se já registrado. */
  installationAppUrl?: string | null;
  /** URLs efetivamente usadas pelos jobs de cron. */
  cronUrls?: readonly string[] | null;
  /** META_REDIRECT_URI, quando a instalação usa Meta. */
  metaRedirectUri?: string | null;
};

export type UrlSwitchResult =
  | { ok: true; origin: string; kind: OperationalUrlKind }
  | { ok: false; errors: string[] };

function originOf(raw: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

/**
 * Troca controlada da URL operacional. Só passa quando PUBLIC_APP_URL,
 * `installation.app_url`, cron e redirect Meta apontam para a MESMA instalação.
 */
export function validateAppUrlSwitch(input: UrlSwitchInput): UrlSwitchResult {
  const target = classifyOperationalUrl(input.newUrl);
  if (!target.ok) return { ok: false, errors: [target.reason] };

  const errors: string[] = [];
  const origin = target.origin;

  const app = (input.installationAppUrl ?? "").trim();
  if (app && originOf(app) !== origin) {
    errors.push("installation.app_url ainda aponta para outra origem — atualize junto com a troca");
  }

  for (const url of input.cronUrls ?? []) {
    if (containsMasterReference(url)) {
      errors.push("cron aponta para o MASTER");
      continue;
    }
    if (originOf(url) !== origin) errors.push(`cron fora da origem da instalação: ${url}`);
  }

  const meta = (input.metaRedirectUri ?? "").trim();
  if (meta && originOf(meta) !== origin) {
    errors.push("META_REDIRECT_URI aponta para outra origem");
  }

  return errors.length ? { ok: false, errors: Array.from(new Set(errors)) } : { ok: true, origin, kind: target.kind };
}
