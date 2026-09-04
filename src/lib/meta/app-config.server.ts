/**
 * Tipo de App Meta POR INSTALAÇÃO (server-only, singleton
 * `public.installation_meta_app`).
 *
 * Modelo:
 * - `unitos` (padrão de toda instalação nova): usa o App Meta oficial e
 *   centralizado, cujas credenciais vivem em env (`META_APP_ID`,
 *   `META_APP_SECRET`, `META_BUSINESS_CONFIG_ID`);
 * - `client`: a instalação usa o App Meta PRÓPRIO do cliente — credenciais
 *   gravadas nesta instalação (segredo cifrado com AES-256-GCM), sem tocar em
 *   env compartilhado e portanto sem afetar nenhuma outra instalação.
 *
 * Regras:
 * - só Super Admin lê/escreve (policy no banco + `assertSuperAdmin` nas server
 *   functions);
 * - o fluxo OAuth existente NÃO é duplicado: ele apenas consome
 *   `resolveMetaAppCredentials()` / `resolveMetaBusinessConfigId()`;
 * - voltar para `unitos` restaura o App oficial imediatamente (as credenciais
 *   do cliente permanecem gravadas, mas deixam de ser usadas).
 */

import {
  decryptCredential,
  encryptCredential,
  maskCredential,
} from "@/lib/credentials-crypto.server";
import { readRuntimeEnv } from "@/lib/runtime-env.server";


export type MetaAppType = "unitos" | "client";

export type MetaAppCredentials = {
  appType: MetaAppType;
  appId: string;
  appSecret: string;
  businessConfigId: string | null;
};

export type MetaAppSettings = {
  appType: MetaAppType;
  /** Credenciais do App próprio do cliente (segredo nunca é devolvido em claro). */
  client: {
    appId: string | null;
    businessConfigId: string | null;
    hasSecret: boolean;
    secretMasked: string | null;
    complete: boolean;
  };
  /** App oficial do Unitos (env), só para diagnóstico na UI. */
  official: {
    appId: string | null;
    businessConfigId: string | null;
    configured: boolean;
  };
  /** Origem das credenciais efetivamente usadas pelo fluxo OAuth. */
  effective: {
    source: "env" | "stored" | "none";
    appId: string | null;
    businessConfigId: string | null;
  };
  updatedAt: string | null;
  /**
   * Esta é a instalação MASTER? Só nela o App oficial do Unitos é editável;
   * nas instalações cliente ele chega pronto (env propagada no provisionamento)
   * e a UI é somente leitura.
   */
  isMaster: boolean;
  /** Somente o MASTER edita as credenciais do App oficial. */
  officialEditable: boolean;
};

type Row = {
  app_type?: string | null;
  app_id?: string | null;
  app_secret_ciphertext?: string | null;
  business_config_id?: string | null;
  updated_at?: string | null;
};

const DEFAULT_ROW: Row = { app_type: "unitos" };
const CACHE_MS = 15_000;
let cache: { at: number; row: Row } | null = null;

function normalizeType(value?: string | null): MetaAppType {
  return value === "client" ? "client" : "unitos";
}

function envValue(name: string): string | null {
  return readRuntimeEnv(name);
}

/**
 * Lê o singleton. Nunca lança: instalação sem a linha (ou leitura falhando)
 * comporta-se como `unitos`, o padrão seguro.
 */
async function readRow(opts?: { fresh?: boolean }): Promise<Row> {
  if (!opts?.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.row;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const res = await (
      supabaseAdmin as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            limit: (n: number) => { maybeSingle: () => Promise<{ data: Row | null }> };
          };
        };
      }
    )
      .from("installation_meta_app")
      .select("app_type, app_id, app_secret_ciphertext, business_config_id, updated_at")
      .limit(1)
      .maybeSingle();
    const row = res.data ?? DEFAULT_ROW;
    cache = { at: Date.now(), row };
    return row;
  } catch {
    return cache?.row ?? DEFAULT_ROW;
  }
}

/** Tipo de App Meta em uso nesta instalação. */
export async function getMetaAppType(): Promise<MetaAppType> {
  return normalizeType((await readRow()).app_type);
}

/**
 * Leitura SÍNCRONA do tipo já em cache (sem I/O). `null` = desconhecido nesta
 * worker ainda. Serve para guards defensivos em código sync — nunca como fonte
 * de verdade: quem precisa do valor real usa `getMetaAppType()`.
 */
export function peekMetaAppTypeSync(): MetaAppType | null {
  if (!cache) return null;
  return normalizeType(cache.row.app_type);
}

/**
 * Credenciais efetivas do App Meta desta instalação.
 * Lança erro acionável (pt-BR) quando o modo `client` está selecionado sem
 * credenciais completas — nunca cai silenciosamente no App oficial.
 */
export async function resolveMetaAppCredentials(): Promise<MetaAppCredentials> {
  const row = await readRow();
  const appType = normalizeType(row.app_type);

  if (appType === "client") {
    const appId = row.app_id?.trim() || null;
    const ciphertext = row.app_secret_ciphertext?.trim() || null;
    if (!appId || !ciphertext) {
      throw new Error(
        "Esta instalação está configurada como “Cliente — App Meta próprio”, mas o App ID e o App Secret do cliente não foram informados. Configure em Administração → App Meta ou volte para “Unitos — App Meta oficial”.",
      );
    }
    let appSecret: string;
    try {
      appSecret = await decryptCredential(ciphertext);
    } catch {
      throw new Error(
        "Não foi possível descriptografar o App Secret do App Meta do cliente. Informe o segredo novamente em Administração → App Meta.",
      );
    }
    return {
      appType,
      appId,
      appSecret,
      businessConfigId: row.business_config_id?.trim() || null,
    };
  }

  // Modo oficial: env tem prioridade; sem env, usa as credenciais gravadas
  // nesta instalação (mesmo singleton, segredo cifrado). Assim uma instalação
  // nova consegue operar sem depender de variáveis de ambiente.
  const envAppId = envValue("META_APP_ID");
  const envSecret = envValue("META_APP_SECRET");
  if (envAppId && envSecret) {
    return {
      appType,
      appId: envAppId,
      appSecret: envSecret,
      businessConfigId: envValue("META_BUSINESS_CONFIG_ID"),
    };
  }

  const storedAppId = row.app_id?.trim() || null;
  const storedCiphertext = row.app_secret_ciphertext?.trim() || null;
  if (!storedAppId || !storedCiphertext) {
    throw new Error(
      "O App Meta desta instalação ainda não foi configurado. Informe App ID e App Secret em Administração → App Meta (ou defina META_APP_ID e META_APP_SECRET no ambiente).",
    );
  }
  let storedSecret: string;
  try {
    storedSecret = await decryptCredential(storedCiphertext);
  } catch {
    throw new Error(
      "Não foi possível descriptografar o App Secret salvo. Informe o segredo novamente em Administração → App Meta.",
    );
  }
  return {
    appType,
    appId: storedAppId,
    appSecret: storedSecret,
    businessConfigId: row.business_config_id?.trim() || envValue("META_BUSINESS_CONFIG_ID"),
  };
}

/** Config ID do Facebook Login for Business do App em uso. */
export async function resolveMetaBusinessConfigId(): Promise<string | null> {
  const row = await readRow();
  const stored = row.business_config_id?.trim() || null;
  if (normalizeType(row.app_type) === "client") return stored;
  if (envValue("META_APP_ID") && envValue("META_APP_SECRET")) {
    return envValue("META_BUSINESS_CONFIG_ID") ?? stored;
  }
  return stored ?? envValue("META_BUSINESS_CONFIG_ID");
}

/** Resumo para a UI de Super Admin — sem expor o segredo. */
export async function getMetaAppSettings(): Promise<MetaAppSettings> {
  const { detectMaster } = await import("@/lib/installation/manager.server");
  const isMaster = detectMaster();
  const row = await readRow({ fresh: true });
  const appId = row.app_id?.trim() || null;
  const ciphertext = row.app_secret_ciphertext?.trim() || null;
  let secretMasked: string | null = null;
  if (ciphertext) {
    try {
      secretMasked = maskCredential(await decryptCredential(ciphertext));
    } catch {
      secretMasked = "••••••••";
    }
  }
  const officialAppId = envValue("META_APP_ID");
  const officialConfigured = !!officialAppId && !!envValue("META_APP_SECRET");
  const appType = normalizeType(row.app_type);
  const storedComplete = !!appId && !!ciphertext;
  const effectiveSource: "env" | "stored" | "none" =
    appType === "client"
      ? storedComplete
        ? "stored"
        : "none"
      : officialConfigured
        ? "env"
        : storedComplete
          ? "stored"
          : "none";
  return {
    appType,
    client: {
      appId,
      businessConfigId: row.business_config_id?.trim() || null,
      hasSecret: !!ciphertext,
      secretMasked,
      complete: storedComplete,
    },
    official: {
      appId: officialAppId,
      businessConfigId: envValue("META_BUSINESS_CONFIG_ID"),
      configured: officialConfigured,
    },
    effective: {
      source: effectiveSource,
      appId:
        effectiveSource === "env" ? officialAppId : effectiveSource === "stored" ? appId : null,
      businessConfigId:
        effectiveSource === "env"
          ? envValue("META_BUSINESS_CONFIG_ID")
          : effectiveSource === "stored"
            ? row.business_config_id?.trim() || null
            : null,
    },
    updatedAt: row.updated_at ?? null,
    isMaster,
    officialEditable: isMaster,
  };
}

export type SaveMetaAppInput = {
  appType: MetaAppType;
  appId?: string | null;
  /** Texto em claro; `undefined` mantém o segredo atual, `null` apaga. */
  appSecret?: string | null;
  businessConfigId?: string | null;
  actorId: string;
};

/**
 * Grava a configuração. O chamador DEVE exigir Super Admin antes (a policy do
 * banco também exige, mas aqui usamos service_role).
 */
export async function saveMetaAppSettings(input: SaveMetaAppInput): Promise<void> {
  const patch: Record<string, string | null> = {
    app_type: input.appType,
    updated_by: input.actorId,
  };
  if (input.appId !== undefined) patch.app_id = input.appId?.trim() || null;
  if (input.businessConfigId !== undefined) {
    patch.business_config_id = input.businessConfigId?.trim() || null;
  }
  if (input.appSecret !== undefined) {
    const secret = input.appSecret?.trim() || null;
    patch.app_secret_ciphertext = secret ? await encryptCredential(secret) : null;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await (
    supabaseAdmin as unknown as {
      from: (t: string) => {
        update: (p: unknown) => {
          eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
        };
      };
    }
  )
    .from("installation_meta_app")
    .update(patch)
    .eq("id", true);
  if (error) throw new Error(error.message);
  cache = null;
}

/** Somente para testes: limpa o memo por worker. */
export function __resetMetaAppConfigCache(): void {
  cache = null;
}
