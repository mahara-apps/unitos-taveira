/**
 * Installation Manager — execução/orquestração (server-only).
 *
 * O MASTER NÃO reimplementa o bootstrap: ele emite um token de execução de uso
 * único, o operador roda os scripts existentes de `supabase/install/` na
 * instalação de destino e o script reporta progresso real de volta.
 *
 * Regras duras:
 *  - o token só é exibido UMA vez; no banco fica apenas o hash SHA-256;
 *  - nenhum secret/credencial do destino é armazenado;
 *  - nenhuma operação pode apontar para o MASTER;
 *  - resultado parcial nunca é descartado em caso de erro.
 */

import {
  MASTER_RELEASE_VERSION,
  applyStepReport,
  normalizeStepPercent,
  healthFromChecks,
  isStepState,
  normalizeHealthChecks,
  operationStatusFromSteps,
  statusAfterOperation,
  type CheckState,
  type HealthCheckId,
  type InstallationOperationKind,
  type OperationStep,
} from "./manager-contract";

/* ----------------------------------------------------------------- token */

const HEX = "0123456789abcdef";

export function generateRunToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += HEX[b >> 4] + HEX[b & 15];
  return out;
}

export async function hashRunToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token.trim()));
  return Array.from(new Uint8Array(digest))
    .map((b) => HEX[b >> 4] + HEX[b & 15])
    .join("");
}

/** Validade do token de execução: suficiente para um bootstrap completo. */
export const RUN_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

/* ------------------------------------------------------------- health probe */

type ProbeResult = { state: CheckState; detail?: string | null };

async function probeUrl(url: string, timeoutMs = 10_000): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    if (res.status >= 200 && res.status < 400) return { state: "ok", detail: `HTTP ${res.status}` };
    if (res.status === 401 || res.status === 403)
      return { state: "ok", detail: `HTTP ${res.status} (protegido)` };
    return { state: "attention", detail: `HTTP ${res.status}` };
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return { state: "error", detail: aborted ? "timeout" : "sem resposta" };
  } finally {
    clearTimeout(timer);
  }
}

function toOrigin(value: string): string {
  const v = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * Checks que o MASTER consegue medir sozinho (sem credenciais do destino):
 * frontend, conectividade e Supabase. Banco, Storage, Cron e Secrets vêm da
 * última validação reportada pelo script — até então ficam `pending`.
 */
export async function probeInstallationHealth(input: {
  domain: string | null;
  supabaseUrl: string | null;
  gitRepoUrl: string | null;
  deployProject: string | null;
  storedChecks: unknown;
}): Promise<Record<HealthCheckId, ProbeResult>> {
  const stored = normalizeHealthChecks(input.storedChecks);

  const frontend = input.domain
    ? await probeUrl(toOrigin(input.domain))
    : ({ state: "pending", detail: "domínio não informado" } as ProbeResult);

  const supabase = input.supabaseUrl
    ? await probeUrl(`${toOrigin(input.supabaseUrl)}/auth/v1/health`)
    : ({ state: "pending", detail: "Supabase não informado" } as ProbeResult);

  const connectivity: ProbeResult =
    frontend.state === "ok" && supabase.state === "ok"
      ? { state: "ok", detail: "frontend e Supabase respondendo" }
      : frontend.state === "error" || supabase.state === "error"
        ? { state: "error", detail: "frontend ou Supabase inacessível" }
        : { state: frontend.state === "pending" ? "pending" : "attention", detail: null };

  const missing = [
    !input.domain && "domínio",
    !input.supabaseUrl && "Supabase",
    !input.gitRepoUrl && "repositório",
    !input.deployProject && "projeto de deploy",
  ].filter(Boolean) as string[];

  const configuration: ProbeResult = missing.length
    ? { state: "attention", detail: `pendente: ${missing.join(", ")}` }
    : { state: "ok", detail: "metadados completos" };

  return {
    connectivity,
    supabase,
    // Publicação do código é comprovada pelo provisionamento/atualização.
    code: stored.code,

    database: stored.database,
    storage: stored.storage,
    cron: stored.cron,
    frontend,
    secrets: stored.secrets,
    configuration,
    // Primeiro acesso é reportado pela validação/provisionamento automáticos
    // (leitura real do destino); a sonda HTTP preserva o que já foi comprovado.
    super_admin: stored.super_admin,
    workspace: stored.workspace,
  };
}


/* ------------------------------------------------------- report / finalize */

type AnyClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type OperationRow = {
  id: string;
  installation_id: string;
  kind: string;
  status: string;
  steps: unknown;
  detail: unknown;
  summary: string | null;
  run_token_expires_at: string | null;
};

function readSteps(raw: unknown): OperationStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => ({
      id: String(s["id"] ?? ""),
      label: String(s["label"] ?? ""),
      script: String(s["script"] ?? ""),
      state: isStepState(s["state"]) ? s["state"] : "pending",
      detail: typeof s["detail"] === "string" ? s["detail"] : null,
      percent: normalizeStepPercent(s["percent"]),
    }))
    .filter((s) => s.id);
}

export type StepReport = {
  step: string;
  state: string;
  detail?: string | null;
  /** Progresso interno da etapa (0–100) para etapas longas. */
  percent?: number | null;
};

export type FinalReport = {
  ok: boolean;
  warnings?: boolean;
  version?: string | null;
  summary?: string | null;
  errorKind?: string | null;
  checks?: Partial<Record<HealthCheckId, CheckState>>;
};

/** Aplica um progresso de etapa reportado pelo script. */
export async function applyProgressReport(
  client: AnyClient,
  op: OperationRow,
  report: StepReport,
): Promise<OperationStep[]> {
  const state = isStepState(report.state) ? report.state : "running";
  // `op` é lido uma única vez no início da operação. Aplicar o progresso sobre
  // essa cópia apagaria as etapas já concluídas (UI ficava em "0/9 etapas" e
  // a etapa 01 parecia "pulada"). A verdade é sempre a linha persistida.
  const { data: fresh } = await client
    .from("installation_operations")
    .select("steps, detail")
    .eq("id", op.id)
    .maybeSingle();
  const current = readSteps(fresh?.steps ?? op.steps);
  const base = current.length > 0 ? current : readSteps(op.steps);
  const steps = applyStepReport(base, {
    step: report.step,
    state,
    detail: sanitize(report.detail),
    percent: report.percent ?? null,
  });
  const { error } = await client
    .from("installation_operations")
    .update({
      steps,
      status: operationStatusFromSteps(steps) === "failed" ? "running" : "running",
      last_report_at: new Date().toISOString(),
    })
    .eq("id", op.id);
  if (error) throw error;
  return steps;
}

/** Remove qualquer coisa que pareça segredo antes de persistir texto livre. */
export function sanitize(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return v
    .replace(/(postgres(?:ql)?:\/\/[^\s]+)/gi, "[conexão omitida]")
    .replace(/(eyJ[A-Za-z0-9._-]{20,})/g, "[token omitido]")
    .replace(/\b(sb_secret|sb_publishable)_[A-Za-z0-9._-]+/g, "[chave omitida]")
    .replace(/\b(service_role|cron_secret|password|api[_-]?key)\b\s*[:=]\s*\S+/gi, "$1=[omitido]")
    .slice(0, 1000);
}

/** Fecha a operação, atualiza status/saúde da instalação e libera a trava. */
export async function finalizeOperation(
  client: AnyClient,
  op: OperationRow,
  report: FinalReport,
): Promise<void> {
  const kind = op.kind as InstallationOperationKind;
  const nowIso = new Date().toISOString();

  // As etapas persistidas durante a execução (applyProgressReport) são a fonte
  // da verdade: `op` foi lido no início da operação e já está obsoleto aqui.
  // Sem esta releitura, a etapa que falhou era sobrescrita e a UI mostrava
  // "etapa não identificada".
  const { data: fresh } = await client
    .from("installation_operations")
    .select("steps")
    .eq("id", op.id)
    .maybeSingle();
  const persisted = readSteps(fresh?.steps ?? op.steps);
  const steps = (persisted.length > 0 ? persisted : readSteps(op.steps)).map((s) =>
    s.state === "running"
      ? { ...s, state: report.ok ? ("done" as const) : ("error" as const) }
      : s,
  );
  const finalSteps = report.ok ? steps.map((s) => ({ ...s, state: "done" as const })) : steps;

  const summary = sanitize(report.summary) ?? op.summary;
  const outcome = {
    ok: report.ok,
    warnings: report.warnings ?? false,
    version: (report.version ?? "").trim() || null,
  };

  const { error: opError } = await client
    .from("installation_operations")
    .update({
      steps: finalSteps,
      status: report.ok ? "success" : "failed",
      summary,
      error_kind: report.ok ? null : (sanitize(report.errorKind) ?? "operation_failed"),
      detail: {
        ...(((fresh?.detail ?? op.detail) ?? {}) as Record<string, unknown>),
        executed: true,
        warnings: outcome.warnings,
        releaseVersion: MASTER_RELEASE_VERSION,
      },
      run_token_hash: null,
      finished_at: nowIso,
      last_report_at: nowIso,
    })
    .eq("id", op.id);
  if (opError) throw opError;

  const { data: installation } = await client
    .from("installations")
    .select("health_checks")
    .eq("id", op.installation_id)
    .maybeSingle();

  const checks = normalizeHealthChecks(installation?.health_checks);
  for (const [id, state] of Object.entries(report.checks ?? {})) {
    if (state) checks[id as HealthCheckId] = { state, detail: null };
  }

  const patch: Record<string, unknown> = {
    status: statusAfterOperation(kind, outcome),
    health: healthFromChecks(checks),
    health_checks: checks,
    health_checked_at: nowIso,
    active_operation_id: null,
    last_error: report.ok ? null : (summary ?? "Falha registrada na operação."),
    ...(outcome.version ? { current_version: outcome.version } : {}),
    ...(kind !== "validate" && report.ok ? { last_provisioned_at: nowIso } : {}),
    ...(kind === "validate" ? { last_validated_at: nowIso } : {}),
  };

  const { error: instError } = await client
    .from("installations")
    .update(patch)
    .eq("id", op.installation_id);
  if (instError) throw instError;
}
