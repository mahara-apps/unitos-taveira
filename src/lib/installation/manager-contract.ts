/**
 * Installation Manager — regras puras (sem rede, sem SQL, sem secrets).
 *
 * Este módulo existe SOMENTE para a instalação MASTER: é ela que registra,
 * provisiona, valida e acompanha instalações independentes do Unitos.
 *
 * Invariantes garantidos aqui (e testados):
 * - o módulo só existe no MASTER (`isMasterInstallation`); instalações cliente
 *   não têm o módulo habilitado nem conseguem usar as server functions;
 * - nenhum segredo/credencial do destino é aceito no cadastro
 *   (`SENSITIVE_FIELD_HINTS` + `findSensitiveInput`);
 * - cada instalação é um registro isolado: nada de dado de negócio, nada de
 *   herança entre instalações;
 * - a máquina de estados de provisionamento/validação/atualização é explícita.
 */

import { MASTER_FORBIDDEN_TOKENS } from "./bootstrap-contract";

/** Versão do baseline/release que o MASTER distribui para as instalações. */
export const MASTER_RELEASE_VERSION = "1.0.0";

/* ------------------------------------------------------------------ MASTER */

export type MasterDetectionInput = {
  /** `SUPABASE_URL` da instalação onde o código está rodando. */
  supabaseUrl?: string | null;
  /** URL pública canônica desta instalação. */
  appUrl?: string | null;
  /** `UNITOS_INSTALLATION_ROLE` — `master` | `client`. */
  role?: string | null;
};

/**
 * MASTER = instalação de origem. Detecção fail-closed:
 * - `UNITOS_INSTALLATION_ROLE=client` desliga o módulo mesmo no MASTER;
 * - `UNITOS_INSTALLATION_ROLE=master` liga explicitamente;
 * - caso contrário, só é MASTER quando o Supabase/domínio é o do MASTER.
 */
export function isMasterInstallation(input: MasterDetectionInput): boolean {
  const role = (input.role ?? "").trim().toLowerCase();
  if (role === "client") return false;
  if (role === "master") return true;

  const haystack = `${input.supabaseUrl ?? ""} ${input.appUrl ?? ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  return MASTER_FORBIDDEN_TOKENS.some((token) => haystack.includes(token.toLowerCase()));
}

/* ------------------------------------------------------------------ status */

export const INSTALLATION_STATUSES = [
  "preparing",
  "provisioning",
  "validating",
  "update_available",
  "up_to_date",
  "attention",
  "error",
] as const;

export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];

export const INSTALLATION_STATUS_LABEL: Record<InstallationStatus, string> = {
  preparing: "Preparando",
  provisioning: "Provisionando",
  validating: "Validando",
  update_available: "Atualização disponível",
  up_to_date: "Atualizada",
  attention: "Atenção",
  error: "Erro",
};

export type InstallationHealth = "unknown" | "healthy" | "degraded" | "failing";

export const INSTALLATION_HEALTH_LABEL: Record<InstallationHealth, string> = {
  unknown: "Não verificada",
  healthy: "Saudável",
  degraded: "Com ressalvas",
  failing: "Falhando",
};

export function isInstallationStatus(value: unknown): value is InstallationStatus {
  return (
    typeof value === "string" && (INSTALLATION_STATUSES as readonly string[]).includes(value)
  );
}

export type InstallationOperationKind = "register" | "provision" | "validate" | "update";

export const OPERATION_KIND_LABEL: Record<InstallationOperationKind, string> = {
  register: "Cadastro",
  provision: "Provisionamento",
  validate: "Validação",
  update: "Atualização",
};

export type InstallationOperationStatus = "pending" | "running" | "success" | "failed";

export const OPERATION_STATUS_LABEL: Record<InstallationOperationStatus, string> = {
  pending: "Na fila",
  running: "Em execução",
  success: "Concluída",
  failed: "Falhou",
};

/** Status que aceita iniciar cada operação. Fora disso, a ação é recusada. */
const ALLOWED_START: Record<InstallationOperationKind, readonly InstallationStatus[]> = {
  register: ["preparing"],
  provision: ["preparing", "attention", "error"],
  validate: ["preparing", "up_to_date", "update_available", "attention", "error"],
  update: ["up_to_date", "update_available", "attention"],
};

export function canStartOperation(
  kind: InstallationOperationKind,
  status: InstallationStatus,
): boolean {
  return ALLOWED_START[kind].includes(status);
}

/** Status enquanto a operação está em execução. */
export function runningStatusFor(kind: InstallationOperationKind): InstallationStatus {
  if (kind === "validate") return "validating";
  return "provisioning";
}

export type OperationOutcome = {
  ok: boolean;
  /** Validação passou com ressalvas (avisos não bloqueantes). */
  warnings?: boolean;
  /** Versão reportada pela instalação após a operação. */
  version?: string | null;
};

/** Status final após uma operação — determinístico, sem efeito colateral. */
export function statusAfterOperation(
  kind: InstallationOperationKind,
  outcome: OperationOutcome,
  availableVersion: string = MASTER_RELEASE_VERSION,
): InstallationStatus {
  if (!outcome.ok) return "error";
  if (outcome.warnings) return "attention";
  const version = (outcome.version ?? "").trim();
  if (kind === "register") return "preparing";
  if (!version) return "attention";
  return version === availableVersion.trim() ? "up_to_date" : "update_available";
}

export function healthAfterOperation(outcome: OperationOutcome): InstallationHealth {
  if (!outcome.ok) return "failing";
  return outcome.warnings ? "degraded" : "healthy";
}

/** Comparação simples de versão `AAAA.MM.N` — só igualdade/desatualização. */
export function isUpdateAvailable(
  currentVersion: string | null | undefined,
  availableVersion: string = MASTER_RELEASE_VERSION,
): boolean {
  const current = (currentVersion ?? "").trim();
  if (!current) return false;
  return current !== availableVersion.trim();
}

/* -------------------------------------------------------------- validação */

export type InstallationInput = {
  name: string;
  domain?: string | null;
  supabaseUrl?: string | null;
  supabaseProjectRef?: string | null;
  gitRepoUrl?: string | null;
  deployProject?: string | null;
  notes?: string | null;
};

/** Campos que NUNCA podem ser cadastrados: o MASTER não guarda credenciais. */
export const SENSITIVE_FIELD_HINTS = [
  "service_role",
  "service-role",
  "sb_secret",
  "anon_key",
  "app_secret",
  "client_secret",
  "password",
  "private_key",
  "cron_secret",
  "bearer ",
] as const;

/** Detecta segredo colado em qualquer campo textual do cadastro. */
export function findSensitiveInput(input: InstallationInput): string | null {
  const blob = [
    input.name,
    input.domain,
    input.supabaseUrl,
    input.supabaseProjectRef,
    input.gitRepoUrl,
    input.deployProject,
    input.notes,
  ]
    .filter((v): v is string => typeof v === "string")
    .join("\n")
    .toLowerCase();
  return SENSITIVE_FIELD_HINTS.find((hint) => blob.includes(hint)) ?? null;
}

export function slugifyInstallation(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeHost(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    if (url.username || url.password) return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export type ValidationResult = { ok: true; slug: string } | { ok: false; error: string };

/**
 * Valida o cadastro de uma instalação nova.
 * Regra dura: nada pode apontar para o MASTER (Supabase, domínio, deploy).
 */
export function validateInstallationInput(input: InstallationInput): ValidationResult {
  const name = input.name.trim();
  if (name.length < 3) return { ok: false, error: "Informe um nome com pelo menos 3 caracteres." };
  if (name.length > 80) return { ok: false, error: "O nome deve ter no máximo 80 caracteres." };

  const slug = slugifyInstallation(name);
  if (!slug) return { ok: false, error: "O nome precisa conter letras ou números." };

  const sensitive = findSensitiveInput(input);
  if (sensitive) {
    return {
      ok: false,
      error:
        "Nenhum segredo ou credencial da instalação de destino pode ser cadastrado aqui. Remova o valor sensível e mantenha apenas metadados.",
    };
  }

  if (input.domain?.trim() && !normalizeHost(input.domain)) {
    return { ok: false, error: "Informe um domínio válido (ex.: app.cliente.com.br)." };
  }
  if (input.supabaseUrl?.trim() && !normalizeHost(input.supabaseUrl)) {
    return { ok: false, error: "Informe a URL do Supabase da instalação de destino." };
  }
  if (!input.gitRepoUrl?.trim()) {
    return {
      ok: false,
      error:
        "Informe o repositório Git da instalação: o provisionamento publica o código do MASTER nele antes de conectar o deploy.",
    };
  }
  if (!normalizeHost(input.gitRepoUrl)) {
    return { ok: false, error: "Informe a URL do repositório Git da instalação." };
  }


  const blob = [
    input.domain,
    input.supabaseUrl,
    input.supabaseProjectRef,
    input.deployProject,
    input.gitRepoUrl,
  ]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();

  const master = MASTER_FORBIDDEN_TOKENS.find((token) => blob.includes(token.toLowerCase()));
  if (master) {
    return {
      ok: false,
      error:
        "A instalação precisa ter Supabase e domínio próprios — nenhum recurso do MASTER pode ser reutilizado.",
    };
  }

  return { ok: true, slug };
}

/**
 * Etapas do provisionamento — mesma sequência executada por
 * `supabase/install/bootstrap.sh`. O módulo NÃO reimplementa o bootstrap:
 * ele apenas acompanha o progresso reportado pelo script.
 */
export const PROVISION_STEPS = [
  { id: "supabase", label: "Supabase", script: "supabase/install/bootstrap.sh" },
  { id: "code", label: "Código no GitHub", script: "github: POST /repos/{template}/generate" },
  { id: "deploy_link", label: "Deploy conectado", script: "vercel: POST /v10/projects/{id}/link" },
  { id: "secrets", label: "Secrets próprios", script: "supabase/install/bootstrap.sh" },
  { id: "deploy", label: "Variáveis + publicação", script: "supabase/install/010_installation_identity.sql" },
  { id: "database", label: "Banco + RLS + funções", script: "supabase/baseline-snapshot/001_initial_schema.sql" },
  { id: "storage", label: "Storage", script: "supabase/baseline-snapshot/003_storage_buckets.sql" },
  { id: "seeds", label: "Seeds de catálogo", script: "supabase/baseline-snapshot/004_seeds.sql" },
  { id: "brain", label: "Brain stats", script: "supabase/install/011_brain_stats_init.sql" },
  { id: "cron", label: "Cron na própria origem", script: "supabase/install/020_cron.sql" },
  { id: "validation", label: "Validação final", script: "supabase/install/verify-installation.sql" },
] as const;


export const VALIDATE_STEPS = [
  { id: "isolation", label: "Isolamento do Supabase", script: "supabase/install/verify-installation.sql" },
  { id: "database", label: "Contagens do baseline", script: "supabase/install/verify-installation.sql" },
  { id: "rls", label: "RLS, funções e triggers", script: "supabase/install/verify-installation.sql" },
  { id: "storage", label: "Buckets e policies", script: "supabase/install/verify-installation.sql" },
  { id: "cron", label: "Cron e URL própria", script: "supabase/install/verify-installation.sql" },
] as const;

/**
 * Etapas da ATUALIZAÇÃO: puxa o código mais recente do MASTER para o deploy da
 * instalação (novo build a partir do repositório) e registra a versão.
 */
export const UPDATE_STEPS = [
  { id: "code", label: "Novo deployment do código do MASTER", script: "vercel: POST /v13/deployments" },
  { id: "build", label: "Build e publicação", script: "vercel: GET /v13/deployments/{id}" },
  { id: "version", label: "Versão registrada", script: "installations.current_version" },
] as const;

export type StepDefinition = { id: string; label: string; script: string };

export function stepsFor(kind: InstallationOperationKind): readonly StepDefinition[] {
  if (kind === "validate") return VALIDATE_STEPS;
  if (kind === "update") return UPDATE_STEPS;
  return PROVISION_STEPS;
}

/* ------------------------------------------------------- etapas / progresso */

export type StepState = "pending" | "running" | "done" | "error";

export const STEP_STATE_LABEL: Record<StepState, string> = {
  pending: "Pendente",
  running: "Em execução",
  done: "Concluído",
  error: "Erro",
};

export type OperationStep = {
  id: string;
  label: string;
  script: string;
  state: StepState;
  detail?: string | null;
  /** Progresso interno da etapa em % (0–100). Ausente = sem medição. */
  percent?: number | null;
};

export function initialSteps(kind: InstallationOperationKind): OperationStep[] {
  return stepsFor(kind).map((s) => ({
    id: s.id,
    label: s.label,
    script: s.script,
    state: "pending" as StepState,
    percent: null,
  }));
}

export function isStepState(value: unknown): value is StepState {
  return value === "pending" || value === "running" || value === "done" || value === "error";
}

/** Normaliza um percentual reportado: inteiro entre 0 e 100 ou `null`. */
export function normalizeStepPercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Aplica um report de etapa vindo do script de instalação.
 * Etapa desconhecida é IGNORADA (nunca cria etapa fantasma) e resultado
 * parcial já obtido nunca é descartado.
 */
export function applyStepReport(
  steps: OperationStep[],
  report: { step: string; state: StepState; detail?: string | null; percent?: number | null },
): OperationStep[] {
  const reported = normalizeStepPercent(report.percent);
  return steps.map((s) => {
    if (s.id !== report.step) return s;
    const percent =
      report.state === "done"
        ? 100
        : report.state === "pending"
          ? null
          : (reported ?? s.percent ?? (report.state === "running" ? 0 : null));
    return {
      ...s,
      state: report.state,
      detail: report.detail ?? s.detail ?? null,
      percent,
    };
  });
}


export type StepProgress = {
  total: number;
  done: number;
  running: number;
  failed: number;
  pending: number;
  percent: number;
};

export function stepsProgress(steps: OperationStep[]): StepProgress {
  const total = steps.length;
  const done = steps.filter((s) => s.state === "done").length;
  const running = steps.filter((s) => s.state === "running").length;
  const failed = steps.filter((s) => s.state === "error").length;
  return {
    total,
    done,
    running,
    failed,
    pending: total - done - running - failed,
    // O progresso interno da etapa em execução conta como fração de etapa,
    // então a barra avança em tempo real mesmo em etapas longas.
    percent:
      total === 0
        ? 0
        : Math.min(
            100,
            Math.round(
              ((done +
                failed +
                steps
                  .filter((s) => s.state === "running")
                  .reduce((acc, s) => acc + (normalizeStepPercent(s.percent) ?? 0) / 100, 0)) /
                total) *
                100,
            ),
          ),

  };
}

/** Status da operação derivado exclusivamente das etapas reportadas. */
export function operationStatusFromSteps(steps: OperationStep[]): InstallationOperationStatus {
  const p = stepsProgress(steps);
  if (p.failed > 0) return "failed";
  if (p.total > 0 && p.done === p.total) return "success";
  if (p.running > 0 || p.done > 0) return "running";
  return "pending";
}

/* --------------------------------------------------------------- saúde */

export type CheckState = "ok" | "attention" | "error" | "pending";

export const CHECK_STATE_LABEL: Record<CheckState, string> = {
  ok: "OK",
  attention: "Atenção",
  error: "Erro",
  pending: "Pendente",
};

export const HEALTH_CHECKS = [
  { id: "connectivity", label: "Conectividade" },
  { id: "supabase", label: "Supabase" },
  { id: "code", label: "Código publicado" },

  { id: "database", label: "Banco" },
  { id: "storage", label: "Storage" },
  { id: "cron", label: "Cron" },
  { id: "frontend", label: "Frontend" },
  { id: "secrets", label: "Secrets" },
  { id: "configuration", label: "Configuração" },
  // Reportados pelo MASTER a partir do estado real do destino: sem eles o
  // núcleo nunca ficava comprovado e a instalação não aparecia como PRONTA.
  { id: "super_admin", label: "Super Admin" },
  { id: "workspace", label: "Workspace único" },
] as const;


export type HealthCheckId = (typeof HEALTH_CHECKS)[number]["id"];

export type HealthCheckResult = { state: CheckState; detail?: string | null };
export type HealthChecks = Partial<Record<HealthCheckId, HealthCheckResult>>;

export function isCheckState(value: unknown): value is CheckState {
  return value === "ok" || value === "attention" || value === "error" || value === "pending";
}

/** Normaliza o jsonb do banco — tudo desconhecido vira `pending`. */
export function normalizeHealthChecks(raw: unknown): Record<HealthCheckId, HealthCheckResult> {
  const source = (raw ?? {}) as Record<string, unknown>;
  const out = {} as Record<HealthCheckId, HealthCheckResult>;
  for (const check of HEALTH_CHECKS) {
    const value = source[check.id] as HealthCheckResult | undefined;
    out[check.id] = {
      state: isCheckState(value?.state) ? value.state : "pending",
      detail: typeof value?.detail === "string" ? value.detail : null,
    };
  }
  return out;
}

/** Checks de infraestrutura que definem a SAÚDE medida da instalação. */
export const INFRA_HEALTH_CHECK_IDS = [
  "connectivity",
  "supabase",
  "database",
  "storage",
  "cron",
  "frontend",
  "secrets",
  "configuration",
] as const;

/**
 * Saúde agregada: erro manda, depois atenção, depois pendente.
 * Primeiro acesso (Super Admin/workspace) não é infraestrutura e por isso não
 * degrada a saúde medida — ele aparece no núcleo de prontidão.
 */
export function healthFromChecks(raw: unknown): InstallationHealth {
  const checks = normalizeHealthChecks(raw);
  const states = INFRA_HEALTH_CHECK_IDS.map((id) => checks[id].state);
  if (states.includes("error")) return "failing";
  if (states.includes("attention")) return "degraded";
  if (states.every((s) => s === "ok")) return "healthy";
  return "unknown";
}


/* ------------------------------------------------- alvo da operação */

export type TargetCheck = { ok: true } | { ok: false; error: string };

/**
 * Toda operação exige identidade completa e própria. Sem domínio/Supabase da
 * instalação, ou apontando para o MASTER, nada é executado.
 */
export function assertOperationTarget(input: {
  domain?: string | null;
  supabaseUrl?: string | null;
  supabaseProjectRef?: string | null;
}): TargetCheck {
  const domain = (input.domain ?? "").trim();
  const supabaseUrl = (input.supabaseUrl ?? "").trim();
  if (!domain) return { ok: false, error: "Informe o domínio da instalação antes de operar." };
  if (!supabaseUrl)
    return { ok: false, error: "Informe a URL do Supabase da instalação antes de operar." };
  if (!normalizeHost(domain)) return { ok: false, error: "Domínio da instalação inválido." };
  if (!normalizeHost(supabaseUrl)) return { ok: false, error: "URL do Supabase inválida." };

  const blob = `${domain} ${supabaseUrl} ${input.supabaseProjectRef ?? ""}`.toLowerCase();
  if (MASTER_FORBIDDEN_TOKENS.some((t) => blob.includes(t.toLowerCase()))) {
    return {
      ok: false,
      error: "A operação aponta para o MASTER — bloqueada. Use o Supabase e o domínio da instalação.",
    };
  }
  return { ok: true };
}

/**
 * Comando que o operador roda NA INSTALAÇÃO DE DESTINO. Reutiliza os scripts
 * existentes de `supabase/install/` — o MASTER apenas acompanha o progresso
 * reportado pelo token de execução (uso único, nunca armazenado em claro).
 */
export function buildRunCommand(input: {
  kind: InstallationOperationKind;
  masterUrl: string;
  operationId: string;
  runToken: string;
  appUrl?: string | null;
}): string {
  const master = input.masterUrl.replace(/\/+$/, "");
  const lines = [
    `export UNITOS_MASTER_URL="${master}"`,
    `export UNITOS_RUN_TOKEN="${input.runToken}"`,
    `export UNITOS_OPERATION_ID="${input.operationId}"`,
    'export SUPABASE_DB_URL="postgresql://postgres:<SENHA>@db.<REF>.supabase.co:5432/postgres"',
  ];
  if (input.kind === "validate") {
    lines.push("bash supabase/install/validate.sh");
  } else {
    const appUrl = (input.appUrl ?? "").trim();
    lines.push(
      `export PUBLIC_APP_URL="${appUrl ? (appUrl.startsWith("http") ? appUrl : `https://${appUrl}`) : "https://<DOMINIO>"}"`,
      "bash supabase/install/bootstrap.sh",
    );
  }
  return lines.join("\n");
}

/** Mensagem de atualização exibida antes de confirmar. */
export function updateSummary(
  currentVersion: string | null | undefined,
  availableVersion: string = MASTER_RELEASE_VERSION,
): string {
  const current = (currentVersion ?? "").trim() || "desconhecida";
  return `Atualização disponível: ${current} → ${availableVersion}`;
}


/* -------------------------------------------------- operação travada (stale) */

/**
 * Uma operação viva sem qualquer report novo por este tempo é considerada
 * TRAVADA. O MASTER nunca decide isso sozinho: a UI oferece o reinício seguro
 * (cancela a travada e abre UMA nova operação, nunca duas concorrentes).
 */
export const STALE_OPERATION_MS = 4 * 60 * 1000;

export type LiveOperationLike = {
  status: InstallationOperationStatus;
  startedAt: string;
  lastReportAt: string | null;
};

/** Instante do último sinal de vida da operação (report ou início). */
export function lastSignalAt(op: LiveOperationLike): number {
  const report = op.lastReportAt ? Date.parse(op.lastReportAt) : NaN;
  const started = Date.parse(op.startedAt);
  const values = [report, started].filter((v) => Number.isFinite(v));
  return values.length ? Math.max(...values) : 0;
}

export function isOperationStale(
  op: LiveOperationLike,
  nowMs: number = Date.now(),
  thresholdMs: number = STALE_OPERATION_MS,
): boolean {
  if (op.status !== "pending" && op.status !== "running") return false;
  const signal = lastSignalAt(op);
  if (!signal) return false;
  return nowMs - signal > thresholdMs;
}
