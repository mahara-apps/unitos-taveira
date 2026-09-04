import type { SupabaseClient } from "@supabase/supabase-js";
import { writeCanonicalBriefing } from "@/lib/briefing-write.server";
import { callRpc } from "@/lib/supabase-rpc";

/**
 * Camada de EXECUÇÃO de importação de briefing (import-execution / histórico).
 *
 * Única porta de escrita de `briefing_import_runs`, `briefing_import_steps` e
 * `briefing_import_changes`. Não substitui o pipeline existente: reaproveita
 * `ai_jobs` (via `ai_job_id`) como job visível ao usuário e
 * `writeCanonicalBriefing` como única porta de escrita do briefing.
 *
 * Máquina de estados:
 *   queued → running → proposed → applying → applied
 *   terminais: failed | cancelled | discarded
 */

export const IMPORT_SOURCE_KINDS = ["document", "paste", "transcript", "url"] as const;
export type ImportSourceKind = (typeof IMPORT_SOURCE_KINDS)[number];

export const IMPORT_RUN_STATUSES = [
  "queued",
  "running",
  "proposed",
  "applying",
  "applied",
  "failed",
  "cancelled",
  "discarded",
  "paused",
  "needs_input",
  "expired",
] as const;
export type ImportRunStatus = (typeof IMPORT_RUN_STATUSES)[number];

export const IMPORT_STEPS = [
  "ingest",
  "extract",
  "interpret",
  "diff",
  "propose",
  "apply",
] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

export type ImportStepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type ImportChangeAction = "create" | "update" | "keep" | "discard";
export type ImportChangeDecision = "pending" | "accepted" | "rejected";

/** Estados em que a run ainda está "viva" (bloqueiam nova run com o mesmo fingerprint). */
export const ACTIVE_RUN_STATUSES: ImportRunStatus[] = [
  "queued",
  "running",
  "proposed",
  "applying",
];

/** Estados terminais recuperáveis por retry explícito (retomando checkpoints). */
export const RETRYABLE_RUN_STATUSES: ImportRunStatus[] = [
  "failed",
  "expired",
  "paused",
  "needs_input",
];

const TRANSITIONS: Record<ImportRunStatus, ImportRunStatus[]> = {
  queued: ["running", "failed", "cancelled", "expired"],
  // `running` só existe com lease válida; sem heartbeat o reaper devolve para
  // `queued` (nova tentativa) ou encerra em `expired`.
  running: ["proposed", "failed", "cancelled", "paused", "needs_input", "queued", "expired"],
  proposed: ["applying", "discarded", "failed", "cancelled"],
  applying: ["applied", "proposed", "failed"],
  applied: [],
  failed: ["queued", "running"],
  paused: ["queued", "cancelled"],
  needs_input: ["queued", "cancelled"],
  expired: ["queued"],
  cancelled: [],
  discarded: [],
};

export function canTransition(from: ImportRunStatus, to: ImportRunStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Classifica a falha de execução para decidir o estado terminal:
 * - `paused`: bloqueio do provedor (chave ausente, crédito, limite de conta) —
 *   retomar sem ação humana só repetiria o mesmo erro;
 * - `needs_input`: material inservível (arquivo ilegível, sem texto);
 * - `failed`: falha recuperável por retry.
 */
export function classifyRunFailure(error: unknown): {
  status: Extract<ImportRunStatus, "paused" | "needs_input" | "failed">;
  kind: string;
} {
  const raw = error instanceof Error ? `${error.message}` : String(error ?? "");
  // Timeout de etapa é sempre recuperável: nada foi perdido e os checkpoints
  // concluídos permitem retomar sem repagar as etapas anteriores.
  if (/step_timeout|aborterror|\baborted\b|etimedout|timeout/i.test(raw)) {
    return { status: "failed", kind: "timeout" };
  }
  if (
    /ai_provider_not_configured|no_provider|api[_ ]?key|unauthorized|invalid[_ ]api|credit|quota|billing|\b40[123]\b|insufficient/i.test(
      raw,
    )
  ) {
    return { status: "paused", kind: "provider_blocked" };
  }
  // Material inservível é TERMINAL: retry só repetiria a leitura do mesmo
  // arquivo inválido (e, antes, gastava chamadas de IA à toa).
  if (
    /document_not_found|download_failed|empty_input_text|no_text|unsupported_media|unsupported_file|document_format_unsupported|document_corrupted|document_no_text|document_empty|empty_document|too_large|ai_payload_invalid/i.test(
      raw,
    )
  ) {
    return { status: "needs_input", kind: "input" };
  }

  return { status: "failed", kind: "analysis" };
}

/**
 * Erro que carrega a ETAPA real em que a run falhou.
 *
 * Sem isso o worker marcava sempre `interpret` como falha, o que fazia um
 * retry de falha pós-interpret (diff/propose/apply) repagar a chamada de IA.
 */
export class ImportStepError extends Error {
  readonly importStep: ImportStep;
  constructor(step: ImportStep, message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = "ImportStepError";
    this.importStep = step;
  }
}

/** Anexa a etapa ao erro (sem trocar o erro original) e o devolve. */
export function tagImportStep(error: unknown, step: ImportStep): unknown {
  if (error && typeof error === "object" && !("importStep" in error)) {
    try {
      Object.defineProperty(error, "importStep", { value: step, enumerable: false });
    } catch {
      /* erro congelado: ignora */
    }
  }
  return error;
}

/** Recupera a etapa real da falha percorrendo a cadeia de `cause`. */
export function stepFromError(error: unknown): ImportStep | null {
  let node: unknown = error;
  for (let depth = 0; depth < 8 && node != null; depth += 1) {
    const step = (node as { importStep?: unknown }).importStep;
    if (typeof step === "string" && (IMPORT_STEPS as readonly string[]).includes(step)) {
      return step as ImportStep;
    }
    node = (node as { cause?: unknown }).cause;
  }
  return null;
}



export type ImportRunRow = {
  id: string;
  brand_id: string;
  client_id: string;
  ai_job_id: string | null;
  created_by: string | null;
  source_kind: ImportSourceKind;
  document_id: string | null;
  status: ImportRunStatus;
  current_step: ImportStep | null;
  attempt: number;
  idempotency_key: string | null;
  input_fingerprint: string | null;
  model: string | null;
  provider: string | null;
  base_version_id: string | null;
  applied_version_id: string | null;
  summary: string | null;
  counts: ImportCounts;
  confidence: number | null;
  error: string | null;
  error_kind: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  lease_owner?: string | null;
  lease_expires_at?: string | null;
  heartbeat_at?: string | null;
  deadline_at?: string | null;
  max_attempts?: number | null;
  resume_step?: ImportStep | null;
};


export type ImportCounts = {
  created: number;
  updated: number;
  kept: number;
  discarded: number;
};

/** Valor serializável em JSON (compatível com o RPC das server functions). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ImportChangeInput = {
  field: string;
  proposedValue: unknown;
  currentValue?: unknown;
  action?: ImportChangeAction;
  confidence?: number | null;
  evidence?: Record<string, unknown>;
};

export type ImportChangeRow = {
  id: string;
  run_id: string;
  field: string;
  action: ImportChangeAction;
  current_value: JsonValue;
  proposed_value: JsonValue;
  confidence: number | null;
  evidence: Record<string, JsonValue>;
  decision: ImportChangeDecision;
  decided_by: string | null;
  decided_at: string | null;
};


type Db = SupabaseClient;

/** Cliente sem tipos gerados para as tabelas novas em ambientes de teste. */
function table(supabase: Db, name: string) {
  return (supabase as unknown as { from: (t: string) => any }).from(name);
}

const RUN_COLUMNS =
  "id, brand_id, client_id, ai_job_id, created_by, source_kind, document_id, status, current_step, attempt, idempotency_key, input_fingerprint, model, provider, base_version_id, applied_version_id, summary, counts, confidence, error, error_kind, created_at, updated_at, started_at, finished_at";

/* ------------------------------------------------------------------ *
 * Idempotência
 * ------------------------------------------------------------------ */

/** sha256 hex do conteúdo — usa Web Crypto (disponível no Worker e no Node 18+). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fingerprint determinístico da entrada. Para documento usa identidade estável
 * do arquivo (path + tamanho + mime); para texto/transcrição usa o hash do
 * conteúdo normalizado.
 */
export async function buildInputFingerprint(input: {
  sourceKind: ImportSourceKind;
  documentPath?: string | null;
  documentSize?: number | null;
  documentMime?: string | null;
  rawText?: string | null;
}): Promise<string> {
  const parts =
    input.sourceKind === "document"
      ? [
          "doc",
          input.documentPath ?? "",
          String(input.documentSize ?? ""),
          input.documentMime ?? "",
        ]
      : [input.sourceKind, (input.rawText ?? "").trim().replace(/\s+/g, " ")];
  return sha256Hex(parts.join("|"));
}

/* ------------------------------------------------------------------ *
 * Ciclo de vida da run
 * ------------------------------------------------------------------ */

export type StartRunArgs = {
  brandId: string;
  clientId: string;
  userId: string;
  sourceKind: ImportSourceKind;
  documentId?: string | null;
  rawText?: string | null;
  aiJobId?: string | null;
  inputFingerprint: string;
  baseVersionId?: string | null;
  /** Ignora reuso e força uma nova execução (reanálise explícita). */
  force?: boolean;
};

export type StartRunResult = { run: ImportRunRow; reused: boolean };

/**
 * Cria a run ou reaproveita a que já está viva para o mesmo conteúdo.
 * O índice único parcial no banco é a garantia real de concorrência: dois
 * cliques simultâneos → o segundo INSERT falha e devolve a run existente.
 */
export async function startImportRun(
  supabase: Db,
  args: StartRunArgs,
): Promise<StartRunResult> {
  if (!args.force) {
    const existing = await findActiveRun(supabase, args);
    if (existing) return { run: existing, reused: true };
  }

  // Reanálise explícita: fingerprint sufixado libera o índice único parcial.
  const fingerprint = args.force
    ? `${args.inputFingerprint}:${Date.now()}`
    : args.inputFingerprint;
  const key = `${args.brandId}:${args.clientId}:${args.sourceKind}:${fingerprint}`;
  const { data, error } = await table(supabase, "briefing_import_runs")
    .insert({
      brand_id: args.brandId,
      client_id: args.clientId,
      created_by: args.userId,
      source_kind: args.sourceKind,
      document_id: args.documentId ?? null,
      raw_text: args.rawText ?? null,
      ai_job_id: args.aiJobId ?? null,
      status: "queued",
      idempotency_key: key,
      input_fingerprint: fingerprint,
      base_version_id: args.baseVersionId ?? null,
      // Prazo já na criação: run que nunca foi reivindicada por um worker
      // também expira (antes ficava `queued` para sempre, e a UI esperava
      // indefinidamente por uma leitura que nunca ia acontecer).
      deadline_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    })

    .select(RUN_COLUMNS)
    .maybeSingle();

  if (error) {
    // 23505 = unique_violation → outra requisição criou a run primeiro.
    const existing = await findActiveRun(supabase, args);
    if (existing) return { run: existing, reused: true };
    throw error as Error;
  }
  return { run: normalizeRun(data), reused: false };
}

async function findActiveRun(
  supabase: Db,
  args: Pick<StartRunArgs, "brandId" | "clientId" | "sourceKind" | "inputFingerprint">,
): Promise<ImportRunRow | null> {
  const { data, error } = await table(supabase, "briefing_import_runs")
    .select(RUN_COLUMNS)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .eq("source_kind", args.sourceKind)
    .eq("input_fingerprint", args.inputFingerprint)
    .in("status", ACTIVE_RUN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return null;
  const row = (data as unknown[] | null)?.[0];
  return row ? normalizeRun(row) : null;
}

function normalizeRun(row: unknown): ImportRunRow {
  const r = (row ?? {}) as Record<string, unknown>;
  return {
    ...(r as unknown as ImportRunRow),
    counts: normalizeCounts(r.counts),
  };
}

function normalizeCounts(value: unknown): ImportCounts {
  const c = (value ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    created: num(c.created),
    updated: num(c.updated),
    kept: num(c.kept),
    discarded: num(c.discarded),
  };
}

export async function getImportRun(
  supabase: Db,
  args: { brandId: string; clientId: string; runId: string },
): Promise<ImportRunRow | null> {
  const { data, error } = await table(supabase, "briefing_import_runs")
    .select(RUN_COLUMNS)
    .eq("id", args.runId)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .maybeSingle();
  if (error) throw error as Error;
  return data ? normalizeRun(data) : null;
}

export async function listImportRuns(
  supabase: Db,
  args: { brandId: string; clientId: string; limit?: number },
): Promise<ImportRunRow[]> {
  const { data, error } = await table(supabase, "briefing_import_runs")
    .select(RUN_COLUMNS)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 25);
  if (error) throw error as Error;
  return ((data as unknown[] | null) ?? []).map(normalizeRun);
}

/**
 * Transição condicional `queued → running`. Devolve `false` quando outra
 * execução já assumiu a run (fecha a corrida que existia em analyze-document).
 */
export async function claimImportRun(
  supabase: Db,
  runId: string,
  meta?: { model?: string | null; provider?: string | null },
): Promise<boolean> {
  const { data, error } = await table(supabase, "briefing_import_runs")
    .update({
      status: "running",
      started_at: new Date().toISOString(),
      error: null,
      error_kind: null,
      model: meta?.model ?? null,
      provider: meta?.provider ?? null,
    })
    .eq("id", runId)
    .eq("status", "queued")
    .select("id");
  if (error) throw error as Error;
  return ((data as unknown[] | null) ?? []).length > 0;
}

/** Registra modelo/provider reais assim que resolvidos. */
export async function setRunModel(
  supabase: Db,
  runId: string,
  meta: { model: string | null; provider: string | null },
): Promise<void> {
  await table(supabase, "briefing_import_runs")
    .update({ model: meta.model, provider: meta.provider })
    .eq("id", runId);
}

export async function setRunStep(
  supabase: Db,
  run: Pick<ImportRunRow, "id" | "brand_id" | "client_id">,
  step: ImportStep,
  status: ImportStepStatus,
  extra?: {
    output?: unknown;
    error?: string | null;
    errorKind?: string | null;
    inputRef?: string | null;
    outputRef?: string | null;
    contentHash?: string | null;
  },

): Promise<void> {
  const now = new Date().toISOString();
  await table(supabase, "briefing_import_runs")
    .update({ current_step: step })
    .eq("id", run.id);

  const { data: existing } = await table(supabase, "briefing_import_steps")
    .select("id, attempt, started_at")
    .eq("run_id", run.id)
    .eq("step", step)
    .maybeSingle();

  const row = existing as { id: string; attempt: number; started_at: string | null } | null;
  const finished = status === "done" || status === "failed" || status === "skipped";

  if (!row) {
    await table(supabase, "briefing_import_steps").insert({
      run_id: run.id,
      brand_id: run.brand_id,
      client_id: run.client_id,
      step,
      status,
      attempt: status === "running" ? 1 : 0,
      input_ref: extra?.inputRef ?? null,
      output_ref: extra?.outputRef ?? null,
      content_hash: extra?.contentHash ?? null,

      output: (extra?.output ?? null) as never,
      error: extra?.error ?? null,
      error_kind: extra?.errorKind ?? null,
      started_at: status === "running" ? now : null,
      finished_at: finished ? now : null,
    });
    return;
  }

  const startedAt = status === "running" ? now : row.started_at;
  await table(supabase, "briefing_import_steps")
    .update({
      status,
      attempt: status === "running" ? (row.attempt ?? 0) + 1 : row.attempt,
      input_ref: extra?.inputRef ?? undefined,
      output_ref: extra?.outputRef ?? undefined,
      content_hash: extra?.contentHash ?? undefined,

      output: extra?.output === undefined ? undefined : (extra.output as never),
      error: extra?.error ?? null,
      error_kind: extra?.errorKind ?? null,
      started_at: startedAt,
      finished_at: finished ? now : null,
      duration_ms:
        finished && startedAt ? Math.max(0, Date.parse(now) - Date.parse(startedAt)) : null,
    })
    .eq("id", row.id);
}

/* ------------------------------------------------------------------ *
 * Proposta
 * ------------------------------------------------------------------ */

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

/** Classifica a mudança comparando o valor proposto com o briefing atual. */
export function classifyChange(current: unknown, proposed: unknown): ImportChangeAction {
  if (isEmptyValue(proposed)) return "discard";
  if (isEmptyValue(current)) return "create";
  if (sameValue(current, proposed)) return "keep";
  return "update";
}

export function computeCounts(
  changes: Array<{ action: ImportChangeAction }>,
): ImportCounts {
  const counts: ImportCounts = { created: 0, updated: 0, kept: 0, discarded: 0 };
  for (const c of changes) {
    if (c.action === "create") counts.created += 1;
    else if (c.action === "update") counts.updated += 1;
    else if (c.action === "keep") counts.kept += 1;
    else counts.discarded += 1;
  }
  return counts;
}

/**
 * Grava a proposta campo a campo e move a run para `proposed`.
 * Reexecutável: a proposta anterior da mesma run é substituída.
 */
export async function saveImportProposal(
  supabase: Db,
  run: Pick<ImportRunRow, "id" | "brand_id" | "client_id">,
  args: {
    changes: ImportChangeInput[];
    summary?: string | null;
    confidence?: number | null;
    speakers?: unknown[];
    baseVersionId?: string | null;
  },
): Promise<{ counts: ImportCounts }> {
  const rows = args.changes.map((c) => {
    const action = c.action ?? classifyChange(c.currentValue, c.proposedValue);
    return {
      run_id: run.id,
      brand_id: run.brand_id,
      client_id: run.client_id,
      field: c.field,
      action,
      current_value: (c.currentValue ?? null) as never,
      proposed_value: (c.proposedValue ?? null) as never,
      confidence: c.confidence ?? null,
      evidence: (c.evidence ?? {}) as never,
      // Só entra na revisão o que é mudança real; keep/discard já vem decidido.
      decision: action === "keep" || action === "discard" ? "rejected" : "pending",
    };
  });

  await table(supabase, "briefing_import_changes").delete().eq("run_id", run.id);
  if (rows.length > 0) {
    const { error } = await table(supabase, "briefing_import_changes").insert(rows);
    if (error) throw error as Error;
  }

  const counts = computeCounts(rows);
  const { error: upErr } = await table(supabase, "briefing_import_runs")
    .update({
      status: "proposed",
      current_step: "propose",
      counts: counts as never,
      summary: args.summary ?? null,
      confidence: args.confidence ?? null,
      ...(args.speakers ? { speakers: args.speakers as never } : {}),
      ...(args.baseVersionId ? { base_version_id: args.baseVersionId } : {}),
    })
    .eq("id", run.id)
    .in("status", ["running", "queued", "proposed"]);
  if (upErr) throw upErr as Error;

  return { counts };
}

export type ImportStepRow = {
  id: string;
  run_id: string;
  step: ImportStep;
  status: ImportStepStatus;
  attempt: number;
  input_ref: string | null;
  output: JsonValue;
  error: string | null;
  error_kind: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
};

/** Timeline da run — usada pelo detalhe do histórico (somente leitura). */
export async function listImportSteps(
  supabase: Db,
  args: { brandId: string; clientId: string; runId: string },
): Promise<ImportStepRow[]> {
  const { data, error } = await table(supabase, "briefing_import_steps")
    .select(
      "id, run_id, step, status, attempt, input_ref, output, error, error_kind, started_at, finished_at, duration_ms, created_at",
    )
    .eq("run_id", args.runId)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .order("created_at", { ascending: true });
  if (error) throw error as Error;
  return ((data as ImportStepRow[] | null) ?? []);
}


export async function listImportChanges(
  supabase: Db,
  args: { brandId: string; clientId: string; runId: string },
): Promise<ImportChangeRow[]> {
  const { data, error } = await table(supabase, "briefing_import_changes")
    .select(
      "id, run_id, field, action, current_value, proposed_value, confidence, evidence, decision, decided_by, decided_at",
    )
    .eq("run_id", args.runId)
    .eq("brand_id", args.brandId)
    .eq("client_id", args.clientId)
    .order("field", { ascending: true });
  if (error) throw error as Error;
  return ((data as ImportChangeRow[] | null) ?? []).map((r) => ({
    ...r,
    evidence: (r.evidence ?? {}) as Record<string, JsonValue>,
  }));
}

/** Revisão humana: aceita/rejeita campos da proposta. */
export async function decideImportChanges(
  supabase: Db,
  args: {
    brandId: string;
    clientId: string;
    runId: string;
    userId: string;
    decisions: Array<{ field: string; decision: Exclude<ImportChangeDecision, "pending"> }>;
  },
): Promise<{ ok: true; decided: number }> {
  const run = await getImportRun(supabase, args);
  if (!run) throw new Error("import_run_not_found");
  if (run.status !== "proposed") throw new Error("import_run_not_reviewable");

  let decided = 0;
  for (const d of args.decisions) {
    const { error } = await table(supabase, "briefing_import_changes")
      .update({
        decision: d.decision,
        decided_by: args.userId,
        decided_at: new Date().toISOString(),
      })
      .eq("run_id", args.runId)
      .eq("brand_id", args.brandId)
      .eq("client_id", args.clientId)
      .eq("field", d.field);
    if (error) throw error as Error;
    decided += 1;
  }
  return { ok: true, decided };
}

/* ------------------------------------------------------------------ *
 * Aplicação
 * ------------------------------------------------------------------ */

export type ApplyRunResult = {
  ok: true;
  runId: string;
  versionId: string | null;
  appliedFields: string[];
  counts: ImportCounts;
  alreadyApplied: boolean;
};

/**
 * Aplica os campos aceitos ao briefing canônico e fecha a run.
 * Idempotente: uma run já `applied` devolve a versão existente sem reescrever.
 */
export async function applyImportRun(
  supabase: Db,
  args: {
    brandId: string;
    clientId: string;
    runId: string;
    userId: string;
    /** Campos a aceitar agora (atalho para o fluxo atual sem UI de revisão). */
    acceptFields?: string[];
  },
): Promise<ApplyRunResult> {
  const run = await getImportRun(supabase, args);
  if (!run) throw new Error("import_run_not_found");

  if (run.status === "applied") {
    const changes = await listImportChanges(supabase, args);
    return {
      ok: true,
      runId: run.id,
      versionId: run.applied_version_id,
      appliedFields: changes.filter((c) => c.decision === "accepted").map((c) => c.field),
      counts: run.counts,
      alreadyApplied: true,
    };
  }
  if (run.status !== "proposed" && run.status !== "applying") {
    throw new Error("import_run_not_applicable");
  }

  if (args.acceptFields?.length) {
    await decideImportChanges(supabase, {
      ...args,
      userId: args.userId,
      decisions: args.acceptFields.map((field) => ({ field, decision: "accepted" as const })),
    }).catch((err) => {
      if ((err as Error).message !== "import_run_not_reviewable") throw err;
    });
  }

  // Trava de concorrência: só uma requisição sai de `proposed`.
  const { data: claimed } = await table(supabase, "briefing_import_runs")
    .update({ status: "applying", current_step: "apply" })
    .eq("id", run.id)
    .eq("status", "proposed")
    .select("id");
  const gotLock = ((claimed as unknown[] | null) ?? []).length > 0;
  if (!gotLock && run.status === "proposed") {
    // Outra requisição assumiu: devolve o estado atual sem aplicar de novo.
    const fresh = await getImportRun(supabase, args);
    if (fresh?.status === "applied") {
      return {
        ok: true,
        runId: fresh.id,
        versionId: fresh.applied_version_id,
        appliedFields: [],
        counts: fresh.counts,
        alreadyApplied: true,
      };
    }
    throw new Error("import_run_apply_in_progress");
  }


  await setRunStep(supabase, run, "apply", "running");

  try {
    const changes = await listImportChanges(supabase, args);
    const accepted = changes.filter((c) => c.decision === "accepted");
    const patch: Record<string, unknown> = {};
    for (const c of accepted) {
      if (isEmptyValue(c.proposed_value)) continue;
      patch[c.field] = c.proposed_value;
    }
    if (Object.keys(patch).length === 0) throw new Error("no_accepted_fields");

    const result = await writeCanonicalBriefing(supabase, {
      brandId: args.brandId,
      clientId: args.clientId,
      patch,
      authorId: args.userId,
      origin: run.source_kind === "document" ? "document" : "ai.import",
    });

    const counts = computeCounts(changes);
    await table(supabase, "briefing_import_runs")
      .update({
        status: "applied",
        applied_version_id: result.versionId,
        counts: counts as never,
        finished_at: new Date().toISOString(),
        error: null,
        error_kind: null,
      })
      .eq("id", run.id);
    await setRunStep(supabase, run, "apply", "done", {
      output: { versionId: result.versionId, fields: result.changedFields },
    });

    await emitImportBrainEvent(supabase, {
      run,
      userId: args.userId,
      versionId: result.versionId,
      counts,
      changedFields: result.changedFields,
    });

    return {
      ok: true,
      runId: run.id,
      versionId: result.versionId,
      appliedFields: Object.keys(patch),
      counts,
      alreadyApplied: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Falha no apply volta para `proposed` — a chamada de IA não é refeita.
    await table(supabase, "briefing_import_runs")
      .update({ status: "proposed", error: message.slice(0, 500), error_kind: "apply" })
      .eq("id", run.id);
    await setRunStep(supabase, run, "apply", "failed", {
      error: message.slice(0, 500),
      errorKind: "apply",
    });
    throw err;
  }
}

export async function failImportRun(
  supabase: Db,
  run: Pick<ImportRunRow, "id" | "brand_id" | "client_id">,
  args: {
    message: string;
    kind?: string;
    step?: ImportStep;
    /** Estado terminal: `failed` (retry), `paused` (bloqueio) ou `needs_input`. */
    status?: Extract<ImportRunStatus, "failed" | "paused" | "needs_input" | "expired">;
    /** Etapa em que o retry deve retomar. */
    resumeStep?: ImportStep | null;
  },
): Promise<void> {
  if (args.step) {
    await setRunStep(supabase, run, args.step, "failed", {
      error: args.message.slice(0, 500),
      errorKind: args.kind ?? null,
    });
  }
  await table(supabase, "briefing_import_runs")
    .update({
      status: args.status ?? "failed",
      error: args.message.slice(0, 500),
      error_kind: args.kind ?? null,
      finished_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      ...(args.resumeStep !== undefined ? { resume_step: args.resumeStep } : {}),
    })
    .eq("id", run.id);
}

/**
 * Retry seguro: devolve uma run terminal-recuperável (`failed`, `expired`,
 * `paused`, `needs_input`) para `queued`, incrementando a tentativa. Os
 * checkpoints das etapas concluídas são preservados, então o worker retoma de
 * onde parou — sem repagar IA já concluída.
 */
export async function retryImportRun(
  supabase: Db,
  args: { brandId: string; clientId: string; runId: string },
): Promise<ImportRunRow> {
  const run = await getImportRun(supabase, args);
  if (!run) throw new Error("import_run_not_found");
  if (!RETRYABLE_RUN_STATUSES.includes(run.status)) throw new Error("import_run_not_retryable");
  const { error } = await table(supabase, "briefing_import_runs")
    .update({
      status: "queued",
      attempt: (run.attempt ?? 0) + 1,
      error: null,
      error_kind: null,
      finished_at: null,
      lease_owner: null,
      lease_expires_at: null,
      deadline_at: null,
    })
    .eq("id", run.id)
    .eq("status", run.status);
  if (error) throw error as Error;
  return { ...run, status: "queued", attempt: (run.attempt ?? 0) + 1 };
}


/* ------------------------------------------------------------------ *
 * Brain (best-effort, nunca bloqueante)
 * ------------------------------------------------------------------ */

async function emitImportBrainEvent(
  supabase: Db,
  args: {
    run: ImportRunRow;
    userId: string;
    versionId: string | null;
    counts: ImportCounts;
    changedFields: string[];
  },
): Promise<void> {
  try {
    await callRpc(supabase, "emit_brain_event", {
      p_brand_id: args.run.brand_id,
      p_client_id: args.run.client_id,
      p_event_type: "briefing.import.applied",
      p_source_module: "briefing.import",
      p_actor_id: args.userId,
      p_entity_type: "briefing_import_run",
      p_entity_id: args.run.id,
      p_action: "applied",
      p_confidence: args.run.confidence ?? null,
      p_payload: {
        source_kind: args.run.source_kind,
        document_id: args.run.document_id,
        model: args.run.model,
        provider: args.run.provider,
        version_id: args.versionId,
        counts: args.counts,
        changed_fields: args.changedFields,
      },
    });
  } catch (err) {
    console.warn("[briefing-import] brain event falhou", err);
  }
}
