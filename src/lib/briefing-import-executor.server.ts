import type { SupabaseClient } from "@supabase/supabase-js";
import { withPtBr } from "@/lib/ai-language";
import { describeProviderAttempts, type ProviderAttempt } from "@/lib/ai-provider.server";
import { BRIEFING_OUTPUT_INSTRUCTIONS } from "@/lib/briefing-generation.server";
import type { BriefingAnalysis } from "@/lib/briefing-analysis-schema";
import {
  classifyChange,
  ImportStepError,
  listImportSteps,
  saveImportProposal,
  setRunModel,
  setRunStep,
  tagImportStep,
  type ImportRunStatus,
  type ImportSourceKind,
  type ImportStep,
} from "@/lib/briefing-import.server";

/** Orçamento de tempo por etapa (ms). Estouro vira falha retentável. */
export const STEP_TIMEOUT_MS: Partial<Record<ImportStep, number>> = {
  extract: 60_000,
  interpret: 120_000,
};

/**
 * Executa uma etapa com deadline próprio. O `AbortSignal` é propagado para
 * quem souber cancelar (IA); para o resto, o race garante que a etapa nunca
 * segura a lease indefinidamente. Qualquer erro sai etiquetado com a etapa
 * real, para que o retry retome do checkpoint correto.
 */
async function withStepDeadline<T>(
  step: ImportStep,
  ms: number | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!ms) return await fn(controller.signal);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new ImportStepError(
            step,
            `step_timeout: a etapa ${step} excedeu o tempo limite de ${Math.round(ms / 1000)}s (timeout)`,
          ),
        );
      }, ms);
    });
    return await Promise.race([fn(controller.signal), timeout]);
  } catch (error) {
    if (error instanceof ImportStepError) throw error;
    if (controller.signal.aborted) {
      throw new ImportStepError(
        step,
        `step_timeout: a etapa ${step} foi abortada por tempo limite (timeout)`,
        { cause: error },
      );
    }
    throw tagImportStep(error, step);
  } finally {
    if (timer) clearTimeout(timer);
  }
}


/**
 * Executor único da importação de briefing (documento OU texto).
 *
 * Fonte de verdade do progresso é a própria run: cada etapa é um checkpoint
 * persistido em `briefing_import_steps`. Ao retomar uma run, etapas `done`
 * não são refeitas — em particular `interpret`, cujo resultado completo fica
 * gravado no step, para que um retry NUNCA pague IA de novo.
 *
 * Este módulo não decide autorização: o escopo brand/cliente é validado na
 * entrada HTTP; aqui a execução usa o cliente de serviço, sem depender do
 * access token do usuário (que pode expirar no meio do processamento).
 */

export type ExecutableRun = {
  id: string;
  brand_id: string;
  client_id: string;
  created_by: string | null;
  source_kind: ImportSourceKind;
  document_id: string | null;
  raw_text: string | null;
};

export type ExecuteOptions = {
  /** Renova a lease entre etapas longas. */
  heartbeat?: () => Promise<void> | void;
};

export type ExecuteResult = {
  status: Extract<ImportRunStatus, "proposed">;
  provider: string | null;
  model: string | null;
  reusedInterpret: boolean;
};

type Db = SupabaseClient;

function table(db: Db, name: string) {
  return (db as unknown as { from: (t: string) => any }).from(name);
}

async function doneSteps(db: Db, run: ExecutableRun): Promise<Map<ImportStep, unknown>> {
  const steps = await listImportSteps(db, {
    brandId: run.brand_id,
    clientId: run.client_id,
    runId: run.id,
  }).catch(() => []);
  const map = new Map<ImportStep, unknown>();
  for (const s of steps) if (s.status === "done") map.set(s.step, s.output);
  return map;
}

function analysisFromCheckpoint(output: unknown): BriefingAnalysis | null {
  const o = (output ?? null) as { analysis?: unknown } | null;
  const a = o?.analysis as BriefingAnalysis | undefined;
  if (!a || typeof a !== "object" || !("briefing" in a)) return null;
  return a;
}

/** Executa a run até `proposed`. Erros sobem para o worker classificar. */
export async function executeImportRun(
  db: Db,
  run: ExecutableRun,
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const scope = { id: run.id, brand_id: run.brand_id, client_id: run.client_id };
  const beat = async () => {
    try {
      await opts.heartbeat?.();
    } catch {
      /* heartbeat é best-effort */
    }
  };

  const completed = await doneSteps(db, run);
  const isTranscript = run.source_kind === "transcript";
  let providerAttempts: ProviderAttempt[] = [];
  let provider: string | null = null;
  let model: string | null = null;

  /* ---------------------------- ingest / extract --------------------------- */

  let docName = run.document_id ? "Documento" : "Texto colado";
  let inlinePayload: { base64: string; mediaType: string } | null = null;
  let extractedText: string | null = null;
  let extractionNote: string | null = null;

  // Transcrição enviada como ARQUIVO tem `source_kind = "transcript"` e
  // `document_id`: o conteúdo vem do Storage, não de `raw_text`. Sem isso a run
  // falhava com `empty_input_text` sem nunca ler o arquivo.
  if (run.document_id) {
    const { data: doc, error: docErr } = await table(db, "client_documents")

      .select("storage_path, mime_type, name")
      .eq("id", run.document_id)
      .eq("brand_id", run.brand_id)
      .eq("client_id", run.client_id)
      .maybeSingle();
    if (docErr) throw tagImportStep(docErr as Error, "ingest");
    if (!doc) throw new ImportStepError("ingest", "document_not_found");
    docName = (doc as { name: string }).name;

    if (!completed.has("ingest")) {
      await setRunStep(db, scope, "ingest", "running");
    }
    const path = (doc as { storage_path: string }).storage_path;
    const dl = await db.storage.from("brand-documents").download(path);
    if (dl.error || !dl.data) {
      throw tagImportStep(dl.error ?? new Error("download_failed"), "ingest");
    }
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const mediaType = (doc as { mime_type: string | null }).mime_type ?? "application/octet-stream";
    const { prepareDocumentContent, assertInlinePayload } = await import(
      "@/lib/document-extract.server"
    );
    // Extração tem deadline próprio (60s): PDF/planilha corrompidos não podem
    // manter a lease presa até o reaper.
    const prepared = await withStepDeadline("extract", STEP_TIMEOUT_MS.extract, async () => {
      const out = await prepareDocumentContent({ bytes, mediaType, filename: docName });
      if (out.mode === "inline") {
        assertInlinePayload({ mediaType: out.mediaType, base64: out.base64 });
      }
      return out;
    });
    if (prepared.mode === "inline") {
      inlinePayload = { base64: prepared.base64, mediaType: prepared.mediaType };
    } else {
      extractedText = prepared.text;
    }
    extractionNote = prepared.note ?? null;
    await setRunStep(db, scope, "ingest", "done", {
      inputRef: path,
      output: {
        bytes: bytes.length,
        mediaType,
        mode: prepared.mode,
        note: prepared.note,
        ...(prepared.mode === "text" ? { chars: prepared.text.length } : {}),
      },
    });
  } else {
    const text = (run.raw_text ?? "").trim();
    if (text.length < 40) throw new ImportStepError("ingest", "empty_input_text");
    extractedText = text;
    await setRunStep(db, scope, "ingest", "done", { output: { chars: text.length } });
  }

  await beat();

  /* ------------------------------- interpret ------------------------------- */

  const { loadCanonicalBriefing } = await import("@/lib/briefing-source.server");
  const canonical = await loadCanonicalBriefing(db as never, {
    brandId: run.brand_id,
    clientId: run.client_id,
  });
  const current = (canonical.hub ?? {}) as Record<string, unknown>;

  let analysis = analysisFromCheckpoint(completed.get("interpret"));
  const reusedInterpret = analysis !== null;

  if (!analysis) {
    await setRunStep(db, scope, "interpret", "running");

    const system = withPtBr(
      `Você é um analista sênior de marca. Interprete o material e devolva um JSON estrito em pt-BR, mapeando cada informação para os campos de briefing. Preencha TODAS as propriedades do schema: use null para texto/confiança ausente e [] para evidence/speakers sem itens. Nunca invente dados. Todos os textos devem ser objetivos e prontos para uso no briefing (sem introduções como "o documento diz").${
        isTranscript
          ? ` Este material é uma TRANSCRIÇÃO: identifique os participantes e infira o papel de cada um SOMENTE com evidência explícita; sem evidência, use role "indefinido" e needs_review = true.`
          : ""
      }`,
    );

    const taskPrompt = [
      `Material: ${docName}`,
      `\nBRIEFING ATUAL (para cruzamento):\n${JSON.stringify(current).slice(0, 12_000)}`,
      `\nTarefas:
1) ${inlinePayload ? "Extraia somente os trechos essenciais (até 4000 caracteres) para `extracted_text`." : "O texto já foi extraído pelo sistema; devolva `extracted_text` como null e não o repita."}
2) Classifique o tipo do material em \`material_type\`.
3) Resumo executivo em até 400 caracteres.
4) Preencha \`briefing\` com o que o material sustenta; deixe null o que não tiver base.
5) Em \`evidence\`, para cada campo proposto, informe o trecho literal (excerpt), se contradiz o briefing atual (conflict) e a confiança do campo.
6) \`confidence\` global de 0 a 1 ou null. \`evidence\` e \`speakers\` devem ser arrays, mesmo quando vazios.
${BRIEFING_OUTPUT_INSTRUCTIONS}`,
    ].join("\n");

    const content: Array<
      | { type: "text"; text: string }
      | { type: "file"; data: string; mediaType: string; filename?: string }
    > = [{ type: "text", text: taskPrompt }];
    if (inlinePayload) {
      content.push({
        type: "file",
        data: inlinePayload.base64,
        mediaType: inlinePayload.mediaType,
        filename: docName,
      });
    } else {
      content.push({
        type: "text",
        text: `MATERIAL${extractionNote ? ` (${extractionNote})` : ""}:\n\n${extractedText ?? ""}`,
      });
    }

    const { generateBriefingAnalysis } = await import("@/lib/briefing-ai-executor.server");
    const generated = await withStepDeadline(
      "interpret",
      STEP_TIMEOUT_MS.interpret,
      (signal) =>
        generateBriefingAnalysis({
          brandId: run.brand_id,
          usage: {
            agent: run.source_kind === "document" ? "document.analyze" : "briefing.import.text",
            clientId: run.client_id,
            userId: run.created_by ?? null,
          },
          system,
          messages: [{ role: "user", content }],
          abortSignal: signal,
        }),
    );

    analysis = generated.analysis;
    providerAttempts = generated.attempts;
    provider = generated.provider;
    model = generated.model;
    await setRunModel(db, run.id, { provider, model });

    // O resultado COMPLETO vira checkpoint: retry não repaga IA.
    await setRunStep(db, scope, "interpret", "done", {
      output: {
        analysis: analysis as unknown,
        material_type: analysis.material_type,
        confidence: analysis.confidence,
        provider_attempts: describeProviderAttempts(providerAttempts),
      },
    });
  }
  await beat();

  if (run.source_kind === "document" && run.document_id) {
    await table(db, "client_documents")
      .update({
        ai_status: "done",
        ai_model: model,
        ai_error: null,
        extracted_text: extractedText ?? analysis.extracted_text ?? null,
        ai_summary: analysis as unknown as Record<string, unknown>,
        analyzed_at: new Date().toISOString(),
      })
      .eq("id", run.document_id);
  }

  /* ---------------------------- diff / propose ---------------------------- */

  const analyzed = analysis;
  const changes = await withStepDeadline("diff", undefined, async () => {
    await setRunStep(db, scope, "diff", "running");
    const evidenceByField = new Map(analyzed.evidence.map((e) => [e.field, e] as const));
    const rows = Object.entries(analyzed.briefing).map(([field, proposed]) => {
      const ev = evidenceByField.get(field);
      return {
        field,
        currentValue: current[field] ?? null,
        proposedValue: proposed,
        action: classifyChange(current[field] ?? null, proposed),
        confidence: ev?.confidence ?? analyzed.confidence ?? null,
        evidence: {
          source: run.source_kind,
          document_id: run.document_id,
          document_name: docName,
          excerpt: ev?.excerpt ?? null,
          conflict: ev?.conflict === true,
        },
      };
    });
    await setRunStep(db, scope, "diff", "done", { output: { fields: rows.length } });
    return rows;
  });

  await withStepDeadline("propose", undefined, async () => {
    await saveImportProposal(db, scope, {
      changes,
      summary: analyzed.executive_summary ?? null,
      confidence: analyzed.confidence ?? null,
      ...(isTranscript ? { speakers: analyzed.speakers } : {}),
    });
    await setRunStep(db, scope, "propose", "done", {
      output: { material_type: analyzed.material_type },
    });
  });


  return { status: "proposed", provider, model, reusedInterpret };
}
