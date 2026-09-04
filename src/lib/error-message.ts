/**
 * Extração honesta de mensagem de erro.
 *
 * Motivo: erros do Supabase/PostgREST NÃO são instâncias de `Error` — chegam como
 * objeto simples (`{ message, code, details, hint }`). Um `String(err)` sobre isso
 * produz literalmente "[object Object]", que foi exatamente o que apareceu no
 * job/toast/histórico da geração de pauta e destruiu o diagnóstico.
 */
export function errorToMessage(err: unknown): string {
  if (err === null || err === undefined) return "";
  if (typeof err === "string") return err.trim();
  if (err instanceof Error) return err.message || err.name;

  if (typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    const msg = typeof o["message"] === "string" ? o["message"].trim() : "";
    if (msg) parts.push(msg);
    const code = o["code"];
    if (typeof code === "string" && code) parts.push(`code=${code}`);
    const details = o["details"];
    if (typeof details === "string" && details) parts.push(`details=${details}`);
    const hint = o["hint"];
    if (typeof hint === "string" && hint) parts.push(`hint=${hint}`);
    if (parts.length) return parts.join(" | ");

    // Nested cause (fetch/AI SDK) antes de cair no JSON bruto.
    const cause = o["cause"];
    if (cause && cause !== err) {
      const nested = errorToMessage(cause);
      if (nested) return nested;
    }

    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json.slice(0, 800);
    } catch {
      /* objeto circular — cai no fallback abaixo */
    }
    return "";
  }

  return String(err);
}
