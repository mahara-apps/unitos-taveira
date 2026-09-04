/**
 * Contrato do canal de progresso POST /api/public/installations/report.
 *
 * Módulo PURO e testável: valida o evento recebido do bootstrap/validate e
 * garante que nenhum secret, token ou credencial entre no MASTER através do
 * texto livre. O token de execução é o único campo sensível aceito e nunca é
 * ecoado de volta.
 */

import { z } from "zod";

import { INSTALLATION_SECRET_VARS } from "./preflight-contract";

/** Etapas aceitas — qualquer outro identificador é recusado. */
export const REPORT_STEP_IDS = [
  "supabase",
  "code",
  "deploy_link",
  "database",
  "rls",
  "storage",
  "seeds",
  "secrets",
  "cron",
  "brain",
  "deploy",
  "validation",
  "isolation",
] as const;

export const reportEventSchema = z.object({
  token: z.string().min(32).max(200),
  step: z.enum(REPORT_STEP_IDS).optional(),
  state: z.enum(["pending", "running", "done", "error"]).optional(),
  detail: z.string().max(2000).nullable().optional(),
  /** Progresso interno da etapa (0–100), para etapas longas. */
  percent: z.number().min(0).max(100).nullable().optional(),
  done: z.boolean().optional(),
  ok: z.boolean().optional(),
  warnings: z.boolean().optional(),
  version: z
    .string()
    .max(40)
    .regex(/^[0-9A-Za-z._-]*$/)
    .nullable()
    .optional(),
  summary: z.string().max(2000).nullable().optional(),
  errorKind: z
    .string()
    .max(60)
    .regex(/^[a-z0-9_]*$/i)
    .nullable()
    .optional(),
  checks: z.record(z.string(), z.enum(["ok", "attention", "error", "pending"])).optional(),
});

export type ReportEvent = z.infer<typeof reportEventSchema>;

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:postgres(?:ql)?:\/\/)\S+/gi,
  /\b(?:sb_(?:secret|publishable)_[A-Za-z0-9_-]+)/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  /\bBearer\s+\S+/gi,
  new RegExp(
    `\\b(?:${INSTALLATION_SECRET_VARS.join("|")}|SUPABASE_SERVICE_ROLE_KEY)\\s*[=:]\\s*\\S+`,
    "gi",
  ),
];

/** Remove qualquer aparência de credencial do texto livre reportado. */
export function redactReportText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let out = String(value);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  out = out.replace(/\s+/g, " ").trim();
  return out.slice(0, 500) || null;
}

export type ParsedReport =
  | {
      ok: true;
      kind: "progress";
      event: ReportEvent & {
        step: string;
        state: string;
        detail: string | null;
        percent: number | null;
      };
    }
  | {
      ok: true;
      kind: "final";
      event: ReportEvent & { summary: string | null; errorKind: string | null };
    }
  | { ok: false; status: 400; reason: string };

/**
 * Valida e normaliza o payload. Progresso exige step+state válidos; evento
 * final exige `done` com `ok` booleano.
 */
export function parseReportEvent(payload: unknown): ParsedReport {
  const parsed = reportEventSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, status: 400, reason: "invalid_payload" };
  const event = parsed.data;

  if (event.done) {
    if (typeof event.ok !== "boolean") {
      return { ok: false, status: 400, reason: "missing_ok" };
    }
    return {
      ok: true,
      kind: "final",
      event: {
        ...event,
        summary: redactReportText(event.summary ?? null),
        errorKind: event.errorKind ?? null,
      },
    };
  }

  if (!event.step || !event.state) return { ok: false, status: 400, reason: "missing_step_state" };

  return {
    ok: true,
    kind: "progress",
    event: {
      ...event,
      step: event.step,
      state: event.state,
      detail: redactReportText(event.detail ?? null),
      percent:
        typeof event.percent === "number"
          ? Math.max(0, Math.min(100, Math.round(event.percent)))
          : null,
    },
  };
}
