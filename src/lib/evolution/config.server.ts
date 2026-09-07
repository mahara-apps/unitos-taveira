// Server-only: resolução e validação da configuração da Evolution API por
// instalação/workspace. NÃO contém QR, webhook, inbox nem envio — apenas a
// camada de configuração usada pelo cliente HTTP.
//
// Precedência da base URL:
//   1. `brand_api_credentials.metadata.base_url` (por workspace)
//   2. `EVOLUTION_API_URL` (default da instalação)
//
// Precedência da API key:
//   1. `brand_api_credentials.ciphertext` (cifrada por workspace)
//   2. `EVOLUTION_API_KEY` (default da instalação)

import { decryptCredential } from "@/lib/credentials-crypto.server";

export const EVOLUTION_PROVIDER = "whatsapp_evolution" as const;

export type EvolutionConfig = {
  baseUrl: string;
  apiKey: string;
  /** De onde veio a configuração (útil para diagnóstico, nunca expõe segredo). */
  source: { baseUrl: "workspace" | "installation"; apiKey: "workspace" | "installation" };
};

export class EvolutionConfigError extends Error {
  readonly code:
    | "missing_base_url"
    | "missing_api_key"
    | "invalid_base_url"
    | "base_url_not_allowed";

  constructor(code: EvolutionConfigError["code"], message: string) {
    super(message);
    this.name = "EvolutionConfigError";
    this.code = code;
  }
}

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /\.internal$/i,
  /\.local$/i,
];

function allowedHosts(): string[] {
  return (process.env["EVOLUTION_ALLOWED_HOSTS"] ?? "")
    .split(/[,\s]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function allowsPrivateHosts(): boolean {
  return process.env["EVOLUTION_ALLOW_PRIVATE_HOSTS"] === "true";
}

/**
 * Valida a base URL da Evolution e devolve a origem normalizada (sem barra final).
 * Bloqueia esquemas não-HTTPS e alvos internos para evitar SSRF a partir do servidor.
 */
export function normalizeEvolutionBaseUrl(raw: string): string {
  const value = (raw ?? "").trim();
  if (!value) {
    throw new EvolutionConfigError("missing_base_url", "Informe a URL da instância Evolution.");
  }

  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw new EvolutionConfigError("invalid_base_url", "A URL da Evolution não é válida.");
  }

  const host = url.hostname.toLowerCase();
  const isPrivate = PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
  const allowlist = allowedHosts();

  if (url.protocol !== "https:" && !(allowsPrivateHosts() && url.protocol === "http:")) {
    throw new EvolutionConfigError("invalid_base_url", "A URL da Evolution precisa usar HTTPS.");
  }

  if (isPrivate && !allowsPrivateHosts()) {
    throw new EvolutionConfigError(
      "base_url_not_allowed",
      "Esta URL aponta para um endereço interno e não é permitida.",
    );
  }

  if (allowlist.length > 0 && !allowlist.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw new EvolutionConfigError(
      "base_url_not_allowed",
      "Esta URL não está na lista de servidores Evolution permitidos.",
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

type CredentialRow = {
  ciphertext?: string | null;
  metadata?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Extrai a base URL declarada no metadata da credencial do workspace. */
export function baseUrlFromMetadata(metadata: unknown) {
  const record = asRecord(metadata);
  const candidate =
    (record?.["base_url"] as string | undefined) ??
    (record?.["baseUrl"] as string | undefined) ??
    (record?.["handle"] as string | undefined);
  const value = (candidate ?? "").trim();
  return value.length > 0 ? value : null;
}

/**
 * Monta a configuração efetiva da Evolution para um workspace.
 * Lê os defaults da instalação apenas dentro do handler (nunca em module scope).
 */
export async function resolveEvolutionConfig(
  credential: CredentialRow | null | undefined,
): Promise<EvolutionConfig> {
  const installationBaseUrl = process.env["EVOLUTION_API_URL"]?.trim() ?? "";
  const installationApiKey = process.env["EVOLUTION_API_KEY"]?.trim() ?? "";

  const workspaceBaseUrl = baseUrlFromMetadata(credential?.metadata);
  const rawBaseUrl = workspaceBaseUrl ?? installationBaseUrl;
  if (!rawBaseUrl) {
    throw new EvolutionConfigError(
      "missing_base_url",
      "A URL da instância Evolution não está configurada.",
    );
  }

  let apiKey = "";
  let apiKeySource: "workspace" | "installation" = "installation";
  if (credential?.ciphertext) {
    apiKey = (await decryptCredential(credential.ciphertext)).trim();
    apiKeySource = "workspace";
  }
  if (!apiKey) {
    apiKey = installationApiKey;
    apiKeySource = "installation";
  }
  if (!apiKey) {
    throw new EvolutionConfigError(
      "missing_api_key",
      "A chave de API da Evolution não está configurada.",
    );
  }

  return {
    baseUrl: normalizeEvolutionBaseUrl(rawBaseUrl),
    apiKey,
    source: { baseUrl: workspaceBaseUrl ? "workspace" : "installation", apiKey: apiKeySource },
  };
}
