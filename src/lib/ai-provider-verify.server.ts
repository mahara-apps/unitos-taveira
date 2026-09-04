/**
 * Verificação real de chaves de API dos provedores de IA.
 *
 * Faz uma chamada mínima e apenas de leitura (listagem de modelos da conta) para
 * confirmar que a chave é válida antes de marcá-la como conectada. Nada é gerado,
 * então o teste não consome tokens.
 */

import type { ProviderName } from "./ai-models-catalog.server";

export type VerifyStatus = "valid" | "invalid" | "unverified";

export type VerifyResult = {
  status: VerifyStatus;
  message: string;
  models: string[];
};

const TIMEOUT_MS = 8_000;

type Endpoint = { url: string; headers: Record<string, string> };

function endpointFor(provider: ProviderName, apiKey: string): Endpoint {
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/models",
      headers: { Authorization: `Bearer ${apiKey}` },
    };
  }
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/models?limit=100",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    };
  }
  if (provider === "groq") {
    return {
      url: "https://api.groq.com/openai/v1/models",
      headers: { Authorization: `Bearer ${apiKey}` },
    };
  }
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    headers: { "x-goog-api-key": apiKey },
  };
}

function parseModels(provider: ProviderName, json: unknown): string[] {
  if (provider === "gemini") {
    const models = (json as { models?: Array<{ name?: string }> }).models ?? [];
    return models.map((m) => (m.name ?? "").replace(/^models\//, "")).filter(Boolean);
  }
  const data = (json as { data?: Array<{ id?: string }> }).data ?? [];
  return data.map((m) => m.id ?? "").filter(Boolean);
}

const PROVIDER_LABEL: Record<ProviderName, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  groq: "Groq",
};

/**
 * Testa a chave contra o provedor.
 * - `invalid`: a chave foi rejeitada (401/403) — não deve ser salva.
 * - `unverified`: falha temporária (rede, 429, 5xx) — a chave pode ser salva,
 *   mas o estado fica pendente de verificação.
 */
export async function verifyProviderKey(
  provider: ProviderName,
  apiKey: string,
): Promise<VerifyResult> {
  const label = PROVIDER_LABEL[provider];
  const { url, headers } = endpointFor(provider, apiKey.trim());

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      status: "unverified",
      message: `Não foi possível falar com a ${label} agora (${reason}). A chave foi guardada e será verificada novamente.`,
      models: [],
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      status: "invalid",
      message: `Chave inválida ou revogada pela ${label} (HTTP ${res.status}). Verifique se copiou a chave completa e se ela ainda está ativa.`,
      models: [],
    };
  }

  if (res.status === 400 && provider === "gemini") {
    // A API do Gemini responde 400 com API_KEY_INVALID para chaves malformadas.
    const body = await res.text().catch(() => "");
    if (body.toLowerCase().includes("api key")) {
      return {
        status: "invalid",
        message: `Chave inválida para a ${label}. Verifique se copiou a chave completa.`,
        models: [],
      };
    }
    return {
      status: "unverified",
      message: `A ${label} respondeu HTTP 400. A chave foi guardada e será verificada novamente.`,
      models: [],
    };
  }

  if (!res.ok) {
    return {
      status: "unverified",
      message: `A ${label} respondeu HTTP ${res.status} no teste. A chave foi guardada e será verificada novamente.`,
      models: [],
    };
  }

  let models: string[] = [];
  try {
    models = parseModels(provider, await res.json());
  } catch {
    models = [];
  }

  return {
    status: "valid",
    message: `Chave válida — ${models.length} modelo(s) disponíveis na conta ${label}.`,
    models,
  };
}
