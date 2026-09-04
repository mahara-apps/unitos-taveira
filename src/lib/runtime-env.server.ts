/**
 * Ambiente de execução do servidor — fonte única e segura.
 *
 * Em runtimes serverless (Cloudflare Workers/edge) as variáveis chegam no
 * binding `env` do `fetch`, não em `process.env`. Em Node/Vercel chegam em
 * `process.env`. Este módulo unifica as duas origens SEM nunca expor valores:
 * apenas leitura server-side, e diagnósticos que devolvem só NOMES.
 *
 * Regras:
 *  - módulo `.server` — nunca entra no bundle do cliente;
 *  - nada é logado: valores de credenciais jamais aparecem em log/telemetria;
 *  - `captureRuntimeEnv` é chamado no entrypoint do worker por request.
 */

type EnvRecord = Record<string, string | undefined>;

const store: { bindings: EnvRecord } = { bindings: {} };

/**
 * Registra o binding de ambiente do runtime (Cloudflare/Nitro) para que
 * handlers de server functions possam ler credenciais que não existem em
 * `process.env`. Ignora chaves não-string (KV, D1, filas, etc.).
 */
export function captureRuntimeEnv(env: unknown): void {
  if (!env || typeof env !== "object") return;
  const next: EnvRecord = {};
  for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > 0) next[key] = value;
  }
  if (Object.keys(next).length > 0) store.bindings = { ...store.bindings, ...next };
}

/**
 * Ambiente efetivo do servidor: `process.env` complementado pelos bindings do
 * runtime. `process.env` tem prioridade quando ambos possuem a chave.
 */
export function runtimeEnv(): EnvRecord {
  const base: EnvRecord =
    typeof process !== "undefined" && process.env ? (process.env as EnvRecord) : {};
  return { ...store.bindings, ...base };
}

/** Lê uma variável do ambiente efetivo, já com trim. Nunca loga o valor. */
export function readRuntimeEnv(name: string): string | null {
  const value = runtimeEnv()[name];
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Primeiro nome com valor presente — usado por diagnósticos (só nomes). */
export function firstPresentEnvName(names: readonly string[]): string | null {
  for (const name of names) {
    if (readRuntimeEnv(name)) return name;
  }
  return null;
}
