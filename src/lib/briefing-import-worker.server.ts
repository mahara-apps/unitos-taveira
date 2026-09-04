import { callRpc } from "@/lib/supabase-rpc";
import { executeImportRun, type ExecutableRun } from "@/lib/briefing-import-executor.server";
import {
  classifyRunFailure,
  failImportRun,
  stepFromError,
  type ImportStep,
} from "@/lib/briefing-import.server";

/**
 * Worker único da fila de importação de briefing.
 *
 * Concorrência: `briefing_import_claim_lease` (SECURITY DEFINER, CAS com
 * `FOR UPDATE SKIP LOCKED`) reserva runs `queued` para este owner por um
 * intervalo curto. Enquanto processa, o worker renova a lease
 * (`briefing_import_heartbeat`); se o isolate morrer, a lease expira e o
 * reaper (`briefing_import_reap`) devolve a run para `queued` ou a marca como
 * `expired` — nunca fica presa em `running` bloqueando novos uploads.
 *
 * Todo o trabalho é limitado: no máximo `limit` runs por invocação.
 */

const LEASE_SECONDS = 120;
const HEARTBEAT_MS = 30_000;
const DEFAULT_LIMIT = 3;

type ClaimedRun = ExecutableRun & {
  attempt: number;
  max_attempts: number | null;
  resume_step: string | null;
};

export type WorkerReport = {
  claimed: number;
  processed: number;
  proposed: number;
  failed: number;
  results: Array<{
    runId: string;
    status: string;
    reusedInterpret?: boolean;
    error?: string;
  }>;
};

function newOwner(): string {
  return `worker-${crypto.randomUUID()}`;
}

/** Processa um lote limitado da fila. Nunca lança: sempre devolve relatório. */
export async function processImportQueue(
  opts: { limit?: number } = {},
): Promise<WorkerReport> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 10);
  const owner = newOwner();
  const report: WorkerReport = { claimed: 0, processed: 0, proposed: 0, failed: 0, results: [] };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await callRpc<ClaimedRun[] | null>(
    supabaseAdmin,
    "briefing_import_claim_lease",
    { _owner: owner, _limit: limit, _lease_seconds: LEASE_SECONDS },
  );
  if (error) {
    console.error("[briefing-import-worker] claim falhou:", error.message);
    return report;
  }

  const runs = data ?? [];
  report.claimed = runs.length;

  for (const run of runs) {
    const beat = async () => {
      await callRpc(supabaseAdmin, "briefing_import_heartbeat", {
        _run_id: run.id,
        _owner: owner,
        _lease_seconds: LEASE_SECONDS,
      });
    };
    const timer = setInterval(() => void beat().catch(() => undefined), HEARTBEAT_MS);
    try {
      const result = await executeImportRun(supabaseAdmin as never, run, { heartbeat: beat });
      report.processed += 1;
      report.proposed += 1;
      report.results.push({
        runId: run.id,
        status: result.status,
        reusedInterpret: result.reusedInterpret,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { status, kind } = classifyRunFailure(err);
      const attempt = run.attempt ?? 1;
      const maxAttempts = run.max_attempts ?? 3;
      // Falha recuperável com tentativas restantes volta para a fila; o resto
      // termina em estado terminal explícito (com retry manual disponível).
      const terminal = status !== "failed" || attempt >= maxAttempts;
      const { friendlyAnalysisError } = await import("@/lib/briefing-import-ui");
      const friendly = friendlyAnalysisError(err) || message;
      // Etapa REAL da falha: sem isso um erro pós-interpret marcaria
      // `interpret` como falho e o retry repagaria a chamada de IA.
      const failedStep: ImportStep | undefined =
        stepFromError(err) ?? (run.resume_step as ImportStep | null) ?? undefined;
      if (terminal) {
        await failImportRun(supabaseAdmin as never, run, {
          message: friendly,
          kind,
          status,
          ...(failedStep ? { step: failedStep } : {}),
        }).catch(() => undefined);
      } else {
        // Persiste a causa REAL antes de devolver a run para a fila: o reaper
        // preserva esses campos ao expirar, então a UI nunca mostra "stalled"
        // em lugar do erro que de fato aconteceu.
        if (failedStep) {
          const { setRunStep } = await import("@/lib/briefing-import.server");
          await setRunStep(supabaseAdmin as never, run, failedStep, "failed", {
            error: friendly.slice(0, 500),
            errorKind: kind,
          }).catch(() => undefined);
        }
        await (supabaseAdmin as unknown as { from: (t: string) => any })
          .from("briefing_import_runs")
          .update({
            error: friendly.slice(0, 500),
            error_kind: kind,
            ...(failedStep ? { resume_step: failedStep } : {}),
          })
          .eq("id", run.id)
          .then(() => undefined, () => undefined);
        await callRpc(supabaseAdmin, "briefing_import_heartbeat", {
          _run_id: run.id,
          _owner: owner,
          _lease_seconds: 1,
        }).catch(() => undefined);
      }
      if (run.document_id) {
        await (supabaseAdmin as unknown as { from: (t: string) => any })
          .from("client_documents")
          .update({ ai_status: terminal ? "failed" : "queued", ai_error: friendly })
          .eq("id", run.document_id)
          .then(() => undefined, () => undefined);
      }
      report.processed += 1;
      report.failed += 1;
      report.results.push({ runId: run.id, status: terminal ? status : "queued", error: message });
      console.error("[briefing-import-worker] run falhou", run.id, message);
    } finally {
      clearInterval(timer);
    }
  }

  return report;
}

/** Recupera runs abandonadas (lease expirada / deadline vencido). */
export async function reapImportRuns(): Promise<unknown> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await callRpc(supabaseAdmin, "briefing_import_reap", {});
  if (error) throw new Error(error.message);
  return data;
}
