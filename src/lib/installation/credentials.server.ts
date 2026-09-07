/**
 * Credenciais de automação POR INSTALAÇÃO (server-only).
 *
 * Contexto: cada cliente tem o seu próprio projeto Supabase, o seu próprio
 * projeto de deploy e o seu próprio repositório. Um único token global no
 * runtime do MASTER não consegue tocar em projetos de outras organizações
 * (Management API responde 403 “account does not have the necessary
 * privileges”). Por isso cada instalação guarda as SUAS credenciais.
 *
 * Regras:
 * - os tokens são gravados cifrados (AES-256-GCM, `BRAND_CREDENTIALS_SECRET`)
 *   na tabela `public.installation_credentials`;
 * - nunca voltam em claro para a UI — só máscara e “configurado sim/não”;
 * - o env do MASTER continua sendo FALLBACK: instalação sem credencial própria
 *   segue usando o token global (útil para projetos da mesma organização);
 * - a credencial da instalação tem PRECEDÊNCIA sobre o env global.
 */

import { AUTOMATION_CREDENTIAL_VARS, type AutomationEnv } from "./automation-contract";

export type InstallationCredentialField =
  | "supabaseManagementToken"
  | "vercelToken"
  | "vercelTeamId"
  | "githubToken";

type Row = {
  supabase_management_token_ciphertext?: string | null;
  vercel_token_ciphertext?: string | null;
  vercel_team_id?: string | null;
  github_token_ciphertext?: string | null;
  generated_secrets_ciphertext?: string | null;
  updated_at?: string | null;
};

/** Cliente Supabase mínimo (o real é injetado pelas server functions). */
type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const TABLE = "installation_credentials";

const CIPHER_COLUMN: Record<Exclude<InstallationCredentialField, "vercelTeamId">, keyof Row> = {
  supabaseManagementToken: "supabase_management_token_ciphertext",
  vercelToken: "vercel_token_ciphertext",
  githubToken: "github_token_ciphertext",
};

export type InstallationCredentialsStatus = {
  supabaseManagementToken: { configured: boolean; masked: string | null };
  vercelToken: { configured: boolean; masked: string | null };
  githubToken: { configured: boolean; masked: string | null };
  vercelTeamId: string | null;
  updatedAt: string | null;
};

async function readRow(client: Client, installationId: string): Promise<Row | null> {
  const { data, error } = await client
    .from(TABLE)
    .select(
      "supabase_management_token_ciphertext, vercel_token_ciphertext, vercel_team_id, github_token_ciphertext, generated_secrets_ciphertext, updated_at",
    )
    .eq("installation_id", installationId)
    .maybeSingle();
  if (error) throw error;
  return (data as Row | null) ?? null;
}

/**
 * Estado das credenciais próprias — só máscaras, nunca valores em claro.
 * Uma máscara ilegível (segredo de criptografia trocado) devolve `null` sem
 * quebrar a tela: a UI mostra apenas “configurado”.
 */
export async function getInstallationCredentialsStatus(
  client: Client,
  installationId: string,
): Promise<InstallationCredentialsStatus> {
  const row = await readRow(client, installationId);
  const { decryptCredential, maskCredential } = await import("@/lib/credentials-crypto.server");

  const describe = async (stored: string | null | undefined) => {
    const value = (stored ?? "").trim();
    if (!value) return { configured: false, masked: null };
    try {
      return { configured: true, masked: maskCredential(await decryptCredential(value)) };
    } catch {
      return { configured: true, masked: null };
    }
  };

  return {
    supabaseManagementToken: await describe(row?.supabase_management_token_ciphertext),
    vercelToken: await describe(row?.vercel_token_ciphertext),
    githubToken: await describe(row?.github_token_ciphertext),
    vercelTeamId: (row?.vercel_team_id ?? null) || null,
    updatedAt: row?.updated_at ?? null,
  };
}

/**
 * Grava/atualiza credenciais. Campos ausentes ficam intactos; string vazia
 * apaga aquele campo (permite remover um token sem apagar os outros).
 */
export async function saveInstallationCredentials(
  client: Client,
  installationId: string,
  actorId: string,
  patch: Partial<Record<InstallationCredentialField, string | null>>,
): Promise<void> {
  const { encryptCredential } = await import("@/lib/credentials-crypto.server");
  const payload: Record<string, unknown> = {
    installation_id: installationId,
    updated_by: actorId,
    updated_at: new Date().toISOString(),
  };

  for (const field of ["supabaseManagementToken", "vercelToken", "githubToken"] as const) {
    if (!(field in patch)) continue;
    const raw = (patch[field] ?? "").trim();
    payload[CIPHER_COLUMN[field] as string] = raw ? await encryptCredential(raw) : null;
  }
  if ("vercelTeamId" in patch) {
    payload["vercel_team_id"] = (patch.vercelTeamId ?? "").trim() || null;
  }

  const { error } = await client.from(TABLE).upsert(payload, { onConflict: "installation_id" });
  if (error) throw error;
}

/* --------------------------------------------- secrets próprios persistidos */

/**
 * Secrets exclusivos da instalação (CRON_SECRET, BRAND_CREDENTIALS_SECRET,
 * META_STATE_SECRET, META_WEBHOOK_VERIFY_TOKEN).
 *
 * REGRA CRÍTICA: são gerados UMA ÚNICA VEZ por instalação e reutilizados em
 * toda execução seguinte da automação. `BRAND_CREDENTIALS_SECRET` cifra os
 * tokens das contas sociais no banco do destino — trocá-lo torna todos os
 * tokens já gravados ilegíveis ("Falha ao decriptar token da conexão") e
 * obriga a reconectar cada conta. O mesmo vale para o segredo do cron (jobs
 * agendados) e para os segredos do Meta (retorno do OAuth e webhook).
 */
export type InstallationSecrets = Record<string, string>;

/** Segredos gravados mas ilegíveis: nunca regerar por conta própria. */
export class UnreadableInstallationSecretsError extends Error {
  constructor() {
    super(
      "Os segredos desta instalação estão gravados mas não podem ser lidos. " +
        "Troque cada chave explicitamente na aba Acessos antes de continuar.",
    );
    this.name = "UnreadableInstallationSecretsError";
  }
}

async function readGeneratedSecrets(
  client: Client,
  installationId: string,
): Promise<InstallationSecrets> {
  let row: Row | null = null;
  try {
    row = await readRow(client, installationId);
  } catch {
    return {};
  }
  const stored = (row?.generated_secrets_ciphertext ?? "").trim();
  if (!stored) return {};
  try {
    const { decryptCredential } = await import("@/lib/credentials-crypto.server");
    const parsed = JSON.parse(await decryptCredential(stored)) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: InstallationSecrets = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    // Valor ilegível (chave de criptografia do MASTER trocada). Gerar novos
    // segredos aqui invalidaria em silêncio os acessos já cifrados no destino —
    // exatamente o bug que originou "Falha ao decriptar token da conexão".
    // Falhamos fechado: a troca precisa ser uma decisão explícita.
    throw new UnreadableInstallationSecretsError();
  }
}

async function writeGeneratedSecrets(
  client: Client,
  installationId: string,
  actorId: string | null,
  secrets: InstallationSecrets,
): Promise<void> {
  const { encryptCredential } = await import("@/lib/credentials-crypto.server");
  const payload: Record<string, unknown> = {
    installation_id: installationId,
    generated_secrets_ciphertext: await encryptCredential(JSON.stringify(secrets)),
    updated_at: new Date().toISOString(),
  };
  if (actorId) payload["updated_by"] = actorId;
  const { error } = await client.from(TABLE).upsert(payload, { onConflict: "installation_id" });
  if (error) throw error;
}

/**
 * Devolve os secrets da instalação, gerando apenas os que ainda não existem.
 * Idempotente: reexecutar o provisionamento NÃO invalida dados em repouso.
 */
export async function ensureInstallationSecrets(input: {
  client: Client;
  installationId: string;
  actorId?: string | null;
  names: readonly string[];
  generate: () => string;
}): Promise<{ secrets: InstallationSecrets; created: string[]; reused: string[] }> {
  const existing = await readGeneratedSecrets(input.client, input.installationId);
  const secrets: InstallationSecrets = { ...existing };
  const created: string[] = [];
  const reused: string[] = [];

  for (const name of input.names) {
    const current = (secrets[name] ?? "").trim();
    if (current) {
      reused.push(name);
      continue;
    }
    secrets[name] = input.generate();
    created.push(name);
  }

  if (created.length > 0) {
    await writeGeneratedSecrets(
      input.client,
      input.installationId,
      input.actorId ?? null,
      secrets,
    );
  }
  return { secrets, created, reused };
}

/**
 * Rotação EXPLÍCITA de um secret da instalação. Nunca é automática: rotacionar
 * `BRAND_CREDENTIALS_SECRET` exige reconectar todas as contas sociais daquela
 * instalação, porque os tokens já cifrados deixam de ser legíveis.
 */
export async function rotateInstallationSecret(input: {
  client: Client;
  installationId: string;
  actorId?: string | null;
  name: string;
  generate: () => string;
}): Promise<void> {
  const existing = await readGeneratedSecrets(input.client, input.installationId);
  existing[input.name] = input.generate();
  await writeGeneratedSecrets(
    input.client,
    input.installationId,
    input.actorId ?? null,
    existing,
  );
}

/** Quais secrets da instalação já estão persistidos (nunca os valores). */
export async function getInstallationSecretsStatus(
  client: Client,
  installationId: string,
  names: readonly string[],
): Promise<{ name: string; configured: boolean }[]> {
  const existing = await readGeneratedSecrets(client, installationId);
  return names.map((name) => ({ name, configured: Boolean((existing[name] ?? "").trim()) }));
}

/** Remove todas as credenciais próprias — a instalação volta ao env do MASTER. */
export async function clearInstallationCredentials(
  client: Client,
  installationId: string,
): Promise<void> {
  const { error } = await client.from(TABLE).delete().eq("installation_id", installationId);
  if (error) throw error;
}

/**
 * Env efetivo da automação para UMA instalação: o env do runtime do MASTER
 * sobrescrito pelas credenciais próprias daquela instalação. Toda a automação
 * (provisionar, validar, atualizar, retomar) passa por aqui.
 */
/**
 * Ambiente sem `null`: os runners de automação recebem exatamente este formato.
 */
export type ResolvedAutomationEnv = Record<string, string | undefined>;

/** Remove `null` para que o ambiente sirva a qualquer runner. */
function normalize(env: AutomationEnv): ResolvedAutomationEnv {
  const out: ResolvedAutomationEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

export async function resolveInstallationEnv(
  client: Client,
  installationId: string,
  baseEnv?: AutomationEnv,
): Promise<ResolvedAutomationEnv> {
  const { runtimeEnv } = await import("@/lib/runtime-env.server");
  const env: AutomationEnv = { ...(baseEnv ?? runtimeEnv()) };

  let row: Row | null = null;
  try {
    row = await readRow(client, installationId);
  } catch {
    // Sem acesso à tabela (ambiente antigo) a automação segue com o env global.
    return normalize(env);
  }
  if (!row) return normalize(env);

  const { decryptCredential } = await import("@/lib/credentials-crypto.server");
  const put = async (names: readonly string[], stored: string | null | undefined) => {
    const value = (stored ?? "").trim();
    if (!value) return;
    try {
      const plain = (await decryptCredential(value)).trim();
      if (plain) for (const name of names) env[name] = plain;
    } catch {
      // Valor ilegível não pode virar credencial inválida silenciosa: mantém
      // o env global, e a UI já sinaliza a credencial como não legível.
    }
  };

  await put(AUTOMATION_CREDENTIAL_VARS.supabaseManagement, row.supabase_management_token_ciphertext);
  await put(AUTOMATION_CREDENTIAL_VARS.vercel, row.vercel_token_ciphertext);
  await put(AUTOMATION_CREDENTIAL_VARS.github, row.github_token_ciphertext);
  const team = (row.vercel_team_id ?? "").trim();
  if (team) for (const name of AUTOMATION_CREDENTIAL_VARS.vercelTeam) env[name] = team;

  return normalize(env);
}
