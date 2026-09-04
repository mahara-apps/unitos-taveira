/**
 * Decide o que fazer quando o servidor devolve uma versão do briefing
 * diferente da que originou o formulário em tela (ex.: importação por IA).
 *
 * - `apply`: substitui os campos pela versão do servidor.
 * - `prompt`: existe edição local não salva — pergunta antes de sobrescrever.
 * - `keep`: nada mudou; mantém o formulário atual.
 *
 * A decisão NÃO depende só de `updated_at`: bancos sem o gatilho de
 * atualização (instalações defasadas) mantêm a data antiga mesmo quando o
 * conteúdo muda. Por isso comparamos também uma assinatura do conteúdo.
 */
export type BriefingSyncDecision = "apply" | "prompt" | "keep";

export function decideBriefingFormSync(args: {
  /** Formulário já montado em tela. */
  hasForm: boolean;
  /** Existem edições locais não salvas. */
  dirty: boolean;
  /** updated_at retornado pelo servidor. */
  serverVersion: string | null;
  /** updated_at que originou o formulário atual. */
  syncedVersion: string | null;
  /** Assinatura estável do conteúdo devolvido pelo servidor. */
  serverSignature?: string | null;
  /** Assinatura do conteúdo que originou o formulário atual. */
  syncedSignature?: string | null;
}): BriefingSyncDecision {
  if (!args.hasForm) return "apply";
  const versionChanged = args.serverVersion !== args.syncedVersion;
  const signatureChanged =
    args.serverSignature != null &&
    args.syncedSignature != null &&
    args.serverSignature !== args.syncedSignature;
  if (!versionChanged && !signatureChanged) return "keep";
  return args.dirty ? "prompt" : "apply";
}

/** Assinatura estável (ordem de chaves independente) de um valor JSON. */
export function briefingContentSignature(value: unknown): string {
  return stable(value);
}

function stable(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
