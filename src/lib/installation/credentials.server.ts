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
      "supabase_management_token_ciphertext, vercel_token_ciphertext, vercel_team_id, github_token_ciphertext, updated_at",
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
