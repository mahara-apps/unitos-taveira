/**
 * Lógica pura da experiência de "Importar Briefing via IA".
 *
 * Toda regra de negócio real (fingerprint, run, proposta, apply) vive em
 * `briefing-import.server.ts`. Aqui ficam apenas as decisões de apresentação:
 * validação do arquivo antes do upload, máquina de estados do modal, rótulos
 * e agregações usadas pela revisão e pelo histórico.
 */

import type {
  ImportChangeAction,
  ImportChangeRow,
  ImportRunStatus,
  ImportSourceKind,
  ImportStep,
} from "@/lib/briefing-import.server";

/* --------------------------- Arquivos aceitos --------------------------- */

/** Limite por arquivo — mesmo do uploader de Documentos & Contexto. */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Formatos aceitos. Todo arquivo válido segue o MESMO caminho: upload no
 * bucket + análise no servidor, onde a extração canônica acontece
 * (`document-extract.server.ts`): PDF/imagem vão inteiros ao modelo
 * multimodal; docx, planilhas, texto puro e legendas são convertidos em texto
 * no backend. Nada é extraído no navegador.
 * `.doc` legado (binário do Word 97) não é legível em nenhum caminho.
 */
export const NATIVE_IMPORT_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".webp"] as const;

/** Formatos convertidos em texto no servidor. */
export const EXTRACT_IMPORT_EXTENSIONS = [
  ".docx",
  ".xlsx",
  ".xls",
  ".csv",
  ".txt",
  ".md",
  ".json",
  ".vtt",
  ".srt",
] as const;

export const ACCEPTED_IMPORT_EXTENSIONS = [
  ...NATIVE_IMPORT_EXTENSIONS,
  ...EXTRACT_IMPORT_EXTENSIONS,
] as const;

export const ACCEPT_ATTRIBUTE = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
  ...ACCEPTED_IMPORT_EXTENSIONS,
].join(",");

/** `server`: upload + análise no backend. Único caminho de arquivo. */
export type FileHandling = "server" | "unsupported";

export type FileValidation = { ok: true } | { ok: false; reason: string };

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/** Se o arquivo é aceito — todos os aceitos são lidos no servidor. */
export function fileHandling(name: string): FileHandling {
  const ext = extensionOf(name);
  return (ACCEPTED_IMPORT_EXTENSIONS as readonly string[]).includes(ext) ? "server" : "unsupported";
}

export function validateImportFile(file: { name: string; size: number }): FileValidation {
  const ext = extensionOf(file.name);
  if (ext === ".doc") {
    return {
      ok: false,
      reason: "O formato .doc (Word 97) não é legível. Salve como .docx ou PDF e reenvie.",
    };
  }
  if (fileHandling(file.name) === "unsupported") {
    return {
      ok: false,
      reason: `Formato não suportado (${ext || "sem extensão"}). Use PDF, DOCX, XLS/XLSX, CSV, texto, legenda ou imagem.`,
    };
  }
  if (file.size <= 0) return { ok: false, reason: "Arquivo vazio." };
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return { ok: false, reason: "Arquivo excede o limite de 25 MB." };
  }
  return { ok: true };
}


export function formatBytes(n: number | null | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------ Origem ------------------------------ */

const TRANSCRIPT_HINTS = [
  "transcri",
  "transcript",
  "reuniao",
  "reunião",
  "meeting",
  "call",
  "ata",
  "gravacao",
  "gravação",
];

/**
 * Infere a origem a partir do nome do arquivo. Só distingue transcrição de
 * documento: o backend preserva `source_kind`, e a extração de participantes
 * fica como ponto de extensão (ver `speakers` em `briefing_import_runs`).
 */
export function inferSourceKind(filename: string): Extract<ImportSourceKind, "document" | "transcript"> {
  const lower = filename.toLowerCase();
  const ext = extensionOf(lower);
  if (ext === ".vtt" || ext === ".srt") return "transcript";
  return TRANSCRIPT_HINTS.some((h) => lower.includes(h)) ? "transcript" : "document";
}

export const SOURCE_KIND_LABELS: Record<ImportSourceKind, string> = {
  document: "Documento",
  transcript: "Transcrição de reunião",
  paste: "Texto colado",
  url: "Link",
};

/* --------------------------- Texto colado --------------------------- */

/** Abaixo disso não há material suficiente para a IA cruzar com o briefing. */
export const MIN_PASTE_CHARS = 40;

/**
 * Heurística de transcrição sobre o conteúdo colado: linhas com prefixo de
 * falante (`Nome:`), marcas de tempo de legenda ou vocabulário de reunião.
 * Só decide a ORIGEM — a identificação de participantes/papéis é da IA.
 */
export function looksLikeTranscript(text: string): boolean {
  const sample = text.slice(0, 4000);
  if (/\d{1,2}:\d{2}(:\d{2})?([.,]\d{3})?\s*-->\s*\d{1,2}:\d{2}/.test(sample)) return true;
  const lines = sample
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const speakerLines = lines.filter((l) => /^(\[?\d{1,2}:\d{2}[^\]]*\]?\s*)?[\p{L}][\p{L}\s.'-]{1,30}:\s+\S/u.test(l));
  if (lines.length >= 4 && speakerLines.length >= Math.max(3, Math.ceil(lines.length * 0.3))) {
    return true;
  }
  const lower = sample.toLowerCase();
  return TRANSCRIPT_HINTS.some((h) => lower.includes(h)) && speakerLines.length >= 2;
}

/** Origem do texto colado, já considerando a heurística de transcrição. */
export function inferPasteSourceKind(text: string): Extract<ImportSourceKind, "paste" | "transcript"> {
  return looksLikeTranscript(text) ? "transcript" : "paste";
}

/* ---------------------------- Leitura de arquivos ---------------------------- */

export type FileReadStatus = "pending" | "reading" | "ready" | "uploading" | "sent" | "error";

export const FILE_READ_STATUS_LABELS: Record<FileReadStatus, string> = {
  pending: "Aguardando",
  reading: "Lendo conteúdo",
  ready: "Pronto",
  uploading: "Enviando",
  sent: "Em análise",
  error: "Erro",
};


/* --------------------------- Máquina de estados --------------------------- */

export type ImportUiStep = "upload" | "analyzing" | "review" | "applied" | "failed";

/** Estado do modal derivado exclusivamente do status real da run. */
export function uiStepFromRun(status: ImportRunStatus | null | undefined): ImportUiStep {
  switch (status) {
    case "queued":
    case "running":
      return "analyzing";
    case "proposed":
    case "applying":
      return "review";
    case "applied":
      return "applied";
    case "failed":
    case "expired":
    case "paused":
    case "needs_input":
      return "failed";
    default:
      return "upload";
  }
}

/** A run deve continuar sendo consultada enquanto a IA trabalha. */
export function shouldPollRun(status: ImportRunStatus | null | undefined): boolean {
  return status === "queued" || status === "running" || status === "applying";
}

/** Estados terminais que o usuário pode retomar (retry retoma checkpoints). */
export function canRetryRun(status: ImportRunStatus | null | undefined): boolean {
  return (
    status === "failed" || status === "expired" || status === "paused" || status === "needs_input"
  );
}

export const STEP_LABELS: Record<ImportStep, string> = {
  ingest: "Leitura do arquivo",
  extract: "Extração de conteúdo",
  interpret: "Interpretação pela IA",
  diff: "Comparação com o briefing atual",
  propose: "Proposta de alterações",
  apply: "Aplicação no briefing",
};

export const RUN_STATUS_LABELS: Record<ImportRunStatus, string> = {
  queued: "Na fila",
  running: "Analisando",
  proposed: "Aguardando revisão",
  applying: "Aplicando",
  applied: "Aplicado",
  failed: "Falhou",
  cancelled: "Cancelado",
  discarded: "Descartado",
  paused: "Pausado (configuração de IA)",
  needs_input: "Material insuficiente",
  expired: "Expirou por tempo",
};


/* ---------------------------- Revisão de campos ---------------------------- */

export const BRIEFING_FIELD_LABELS: Record<string, string> = {
  description: "Descrição da marca",
  mission: "Missão",
  positioning: "Posicionamento",
  values: "Valores",
  audience: "Público-alvo",
  pain_points: "Dores",
  demographics: "Demografia",
  offer: "Oferta / Produto",
  differentials: "Diferenciais",
  objections: "Objeções",
  journey: "Jornada",
  desires: "Desejos",
  tone_text: "Tom de voz",
  hashtags: "Hashtags",
  goals: "Metas",
};

export function fieldLabel(field: string): string {
  return BRIEFING_FIELD_LABELS[field] ?? field;
}

export type ChangeState = "new" | "update" | "conflict" | "unchanged" | "empty";

/** Confiança abaixo deste piso em cima de conteúdo existente = conflito. */
export const CONFLICT_CONFIDENCE_FLOOR = 0.5;

/**
 * Classifica a mudança para a UI. "Conflito" é uma sobrescrita de conteúdo
 * existente com baixa confiança (ou marcada como conflito pela evidência) —
 * ela nunca é aceita por padrão.
 */
export function changeState(change: {
  action: ImportChangeAction;
  confidence: number | null;
  evidence?: Record<string, unknown> | null;
}): ChangeState {
  if (change.action === "create") return "new";
  if (change.action === "keep") return "unchanged";
  if (change.action === "discard") return "empty";
  const flagged = change.evidence?.["conflict"] === true;
  const lowConfidence = typeof change.confidence === "number" && change.confidence < CONFLICT_CONFIDENCE_FLOOR;
  return flagged || lowConfidence ? "conflict" : "update";
}

export const CHANGE_STATE_LABELS: Record<ChangeState, string> = {
  new: "Novo",
  update: "Atualização",
  conflict: "Conflito",
  unchanged: "Sem alteração",
  empty: "Sem conteúdo",
};

/** Somente mudanças reais entram na revisão. */
export function isReviewable(action: ImportChangeAction): boolean {
  return action === "create" || action === "update";
}

/**
 * Pré-seleção da revisão: novidades e atualizações confiáveis vêm marcadas;
 * conflitos exigem decisão explícita do usuário.
 */
export function defaultSelection(changes: ImportChangeRow[]): Set<string> {
  const selected = new Set<string>();
  for (const c of changes) {
    if (!isReviewable(c.action)) continue;
    if (changeState(c) === "conflict") continue;
    if (c.decision === "rejected") continue;
    selected.add(c.field);
  }
  return selected;
}

export type ReviewSummary = {
  reviewable: number;
  novos: number;
  atualizacoes: number;
  conflitos: number;
  semAlteracao: number;
};

export function summarizeChanges(changes: ImportChangeRow[]): ReviewSummary {
  const summary: ReviewSummary = {
    reviewable: 0,
    novos: 0,
    atualizacoes: 0,
    conflitos: 0,
    semAlteracao: 0,
  };
  for (const c of changes) {
    const state = changeState(c);
    if (isReviewable(c.action)) summary.reviewable += 1;
    if (state === "new") summary.novos += 1;
    else if (state === "update") summary.atualizacoes += 1;
    else if (state === "conflict") summary.conflitos += 1;
    else summary.semAlteracao += 1;
  }
  return summary;
}

/** Texto legível de qualquer valor de briefing (string, array, objeto). */
export function displayValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function confidenceLabel(confidence: number | null | undefined): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return `${Math.round(confidence * 100)}% de confiança`;
}

/**
 * Traduz falhas técnicas da análise (provider, payload, formato) em mensagem
 * amigável. O erro técnico completo continua nos logs/steps da execução.
 */
export function friendlyAnalysisError(error: unknown): string {
  const root = error as { message?: unknown; responseBody?: unknown; cause?: unknown } | null;
  const raw = [
    error instanceof Error ? error.message : String(error ?? ""),
    typeof root?.responseBody === "string" ? root.responseBody : "",
    root?.cause instanceof Error ? root.cause.message : "",
  ].join(" ");
  if (/ai_provider_not_configured|ai_provider_key_missing/i.test(raw)) {
    return "A IA ainda não está configurada para este workspace.";
  }
  if (/ai_budget_exceeded/i.test(raw)) {
    return "O limite de consumo de IA deste workspace foi atingido.";
  }
  if (/ai_model_unavailable/i.test(raw)) {
    return "O modelo de IA configurado não está disponível. Revise a configuração de IA.";
  }
  if (/ai_payload_invalid|inline_data|inlineData|Invalid value at|Starting an object/i.test(raw)) {
    return "Não foi possível preparar este arquivo para a IA. Tente outro formato (PDF, DOCX, XLSX, CSV, TXT ou imagem).";
  }
  if (/ai_output_truncated|max completion tokens|maximum context length|finish.?reason.{0,20}length/i.test(raw)) {
    return "A análise ficou maior que o limite de resposta da IA. O material foi preservado; tente reprocessar após o ajuste ou envie um conteúdo menor.";
  }
  if (/json_validate_failed|jsonschema|does not validate|failed_generation|não conseguiu estruturar/i.test(raw)) {
    return "A IA leu o material, mas não conseguiu organizar a análise. Tente novamente em alguns instantes.";
  }
  if (/document_format_unsupported/i.test(raw)) {
    return "Formato não suportado. Envie PDF, DOCX, XLS/XLSX, CSV, TXT ou imagem (.doc antigo não é lido).";
  }
  if (/document_no_text|document_empty/i.test(raw)) {
    return "Não encontramos texto legível neste arquivo. Envie um arquivo com conteúdo ou cole o texto.";
  }
  if (/document_not_found|download_failed/i.test(raw)) {
    return "Não foi possível ler o arquivo enviado. Faça o upload novamente.";
  }
  if (/rate.?limit|429/i.test(raw)) {
    return "O provedor de IA está limitando as requisições. Tente novamente em alguns instantes.";
  }
  if (/provider_unavailable|overloaded|unavailable|503/i.test(raw)) {
    return "A IA está temporariamente indisponível. O material foi preservado; tente novamente em alguns instantes.";
  }
  if (/timeout|ETIMEDOUT|aborted/i.test(raw)) {
    return "A análise excedeu o tempo limite. Tente novamente com um arquivo menor.";
  }
  return "";
}

/** Mensagem de erro amigável para as falhas conhecidas da camada de import. */
export function importErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const map: Record<string, string> = {
    import_run_not_found: "Execução não encontrada.",
    import_run_not_reviewable: "Esta execução não está mais em revisão.",
    import_run_not_applicable: "Esta execução não pode mais ser aplicada.",
    import_run_apply_in_progress: "A aplicação já está em andamento.",
    import_run_not_retryable: "Só execuções com falha podem ser reprocessadas.",
    no_accepted_fields: "Selecione ao menos um campo para aplicar.",
    document_not_analyzed: "O documento ainda não foi interpretado pela IA.",
  };
  for (const [key, message] of Object.entries(map)) {
    if (raw.includes(key)) return message;
  }
  const friendly = friendlyAnalysisError(error);
  if (friendly) return friendly;
  if (/unauthorized|forbidden|permission|denied|row-level security|\brls\b/i.test(raw)) {
    return "Você não tem permissão para importar o briefing deste cliente.";
  }
  return raw || "Falha na importação.";
}

