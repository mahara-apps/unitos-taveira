// Blindagem de conexões Meta — capacidade REAL de publicação (server-only).
//
// Regra: `status = active` NÃO significa "pronto para publicar". A capacidade
// só é verdadeira quando toda a cadeia corresponde:
//
//   cliente → client_social_accounts → conexão → canal → external id
//           → Página → Instagram Business → token → granular scope do TARGET
//
// Qualquer elo divergente => BLOCK (fail closed). Nunca há fallback para
// outra conexão, outro token, outra conta ou outro cliente.
//
// Persistência: reaproveita `social_connections.metadata.publish_capability`
// (sem tabela nova).

import { MetaProvider, MetaGraphError } from "./provider.server";
import { decryptCredential } from "@/lib/credentials-crypto.server";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";
/** TTL do cache de validação gravado em metadata.publish_capability. */
const CAPABILITY_TTL_MS = 10 * 60 * 1000;

export type CapabilityCode =
  | "ready"
  | "not_linked_to_client"
  | "wrong_brand"
  | "channel_mismatch"
  | "disconnected"
  | "token_missing"
  | "token_invalid"
  | "instagram_missing"
  | "target_unresolved"
  | "publish_not_authorized"
  | "unsupported_format"
  | "validation_unavailable";

export type CapabilityChecks = {
  connected: boolean;
  token_valid: boolean;
  target_resolved: boolean;
  page_resolved: boolean;
  instagram_resolved: boolean;
  granular_publish_authorized: boolean;
  client_binding_valid: boolean;
};

export type PublishCapability = {
  publishReady: boolean;
  code: CapabilityCode;
  /** Mensagem em linguagem humana (sem jargão da Meta). */
  message: string;
  /** Erro determinístico => nunca faz retry automático. */
  deterministic: boolean;
  /** Ação sugerida na UI. */
  action: "none" | "reconnect" | "relink" | "retry_later";
  checks: CapabilityChecks;
  authorizedTargets: string[];
  externalAccountId: string | null;
  checkedAt: string;
};

export type MetaConnectionCapabilityRow = {
  id: string;
  brand_id: string;
  channel: string;
  provider: string;
  status: string;
  external_id: string | null;
  account_id: string | null;
  access_token_ciphertext: string | null;
  metadata: Record<string, unknown> | null;
};

const emptyChecks = (): CapabilityChecks => ({
  connected: false,
  token_valid: false,
  target_resolved: false,
  page_resolved: false,
  instagram_resolved: false,
  granular_publish_authorized: false,
  client_binding_valid: false,
});

function block(
  code: CapabilityCode,
  message: string,
  opts?: {
    checks?: Partial<CapabilityChecks>;
    deterministic?: boolean;
    action?: PublishCapability["action"];
    targets?: string[];
    externalAccountId?: string | null;
  },
): PublishCapability {
  return {
    publishReady: false,
    code,
    message,
    deterministic: opts?.deterministic ?? true,
    action: opts?.action ?? "reconnect",
    checks: { ...emptyChecks(), ...(opts?.checks ?? {}) },
    authorizedTargets: opts?.targets ?? [],
    externalAccountId: opts?.externalAccountId ?? null,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// debug_token — granular scopes
// ---------------------------------------------------------------------------

type GranularScope = { scope: string; target_ids?: string[] };
type DebugTokenData = {
  is_valid?: boolean;
  scopes?: string[];
  granular_scopes?: GranularScope[];
  expires_at?: number;
};

async function debugToken(token: string): Promise<DebugTokenData> {
  let appId: string;
  let appSecret: string;
  try {
    const { resolveMetaAppCredentials } = await import("./app-config.server");
    ({ appId, appSecret } = await resolveMetaAppCredentials());
  } catch (err) {
    throw new MetaGraphError(err instanceof Error ? err.message : "Meta app não configurado", 0);
  }
  const url = new URL(`${GRAPH_BASE}/debug_token`);
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as {
    data?: DebugTokenData;
    error?: { message?: string; code?: number };
  };
  if (!res.ok || json.error) {
    throw new MetaGraphError(
      json.error?.message ?? "Não foi possível validar o token da conexão",
      res.status,
      json.error as never,
    );
  }
  return json.data ?? {};
}

/**
 * O scope está autorizado PARA ESTE TARGET?
 * - scope ausente => não autorizado
 * - granular com target_ids => precisa conter exatamente este id
 * - granular sem target_ids (ou scope apenas em `scopes`) => autorização ampla
 */
function scopeAuthorizedForTarget(
  data: DebugTokenData,
  scope: string,
  targetId: string,
): { ok: boolean; targets: string[] } {
  const granular = (data.granular_scopes ?? []).find((g) => g.scope === scope);
  if (granular) {
    const targets = (granular.target_ids ?? []).map(String);
    if (targets.length === 0) return { ok: true, targets: [] };
    return { ok: targets.includes(String(targetId)), targets };
  }
  const flat = (data.scopes ?? []).map(String);
  return { ok: flat.includes(scope), targets: [] };
}

// ---------------------------------------------------------------------------
// Avaliação de capacidade de uma conexão
// ---------------------------------------------------------------------------

export async function evaluateConnectionCapability(
  conn: MetaConnectionCapabilityRow,
  opts?: { clientBindingValid?: boolean },
): Promise<PublishCapability> {
  const clientBinding = opts?.clientBindingValid ?? true;
  const channel = conn.channel;
  const targetId = channel === "instagram" ? (conn.account_id ?? null) : (conn.external_id ?? null);

  if (conn.status !== "active") {
    return block("disconnected", "Conta desconectada. Reconecte esta conta para publicar.", {
      checks: { client_binding_valid: clientBinding },
      externalAccountId: targetId,
    });
  }
  if (!conn.access_token_ciphertext) {
    return block(
      "token_missing",
      "Conexão sem autorização válida. Reconecte esta conta para publicar.",
      {
        checks: { connected: true, client_binding_valid: clientBinding },
        externalAccountId: targetId,
      },
    );
  }
  if (channel === "instagram" && !conn.account_id) {
    return block(
      "instagram_missing",
      "Esta Página não tem uma conta Instagram profissional vinculada.",
      { checks: { connected: true, client_binding_valid: clientBinding } },
    );
  }
  if (!targetId) {
    return block("target_unresolved", "Não foi possível identificar a conta conectada.", {
      checks: { connected: true, client_binding_valid: clientBinding },
    });
  }

  let token: string;
  try {
    token = await decryptCredential(conn.access_token_ciphertext);
  } catch {
    return block("token_invalid", "Autorização expirada. Reconecte esta conta para publicar.", {
      checks: { connected: true, client_binding_valid: clientBinding },
      externalAccountId: targetId,
    });
  }

  const checks: CapabilityChecks = {
    ...emptyChecks(),
    connected: true,
    client_binding_valid: clientBinding,
  };

  // 1) Token: validade + granular scopes por target.
  let info: DebugTokenData;
  try {
    info = await debugToken(token);
  } catch (err) {
    // Falha de rede/indisponibilidade: NÃO é determinístico (o worker pode
    // tentar de novo), mas também não afirmamos que está pronto.
    return {
      ...block(
        "validation_unavailable",
        "Não foi possível confirmar a autorização desta conta agora. Tente novamente em instantes.",
        { checks, deterministic: false, action: "retry_later", externalAccountId: targetId },
      ),
      publishReady: false,
      ...(err instanceof MetaGraphError && err.graph?.code === 190
        ? {
            code: "token_invalid" as CapabilityCode,
            deterministic: true,
            action: "reconnect" as const,
          }
        : {}),
    };
  }

  if (info.is_valid === false) {
    return block("token_invalid", "Autorização expirada. Reconecte esta conta para publicar.", {
      checks,
      externalAccountId: targetId,
    });
  }
  checks.token_valid = true;

  const scope = channel === "instagram" ? "instagram_content_publish" : "pages_manage_posts";
  const granular = scopeAuthorizedForTarget(info, scope, targetId);
  if (!granular.ok) {
    return block(
      "publish_not_authorized",
      channel === "instagram"
        ? "Instagram não está autorizado para publicação. A conexão existe, mas a Meta não autorizou este Instagram. Reconecte esta conta para continuar."
        : "Esta Página não está autorizada para publicação. Reconecte esta conta para continuar.",
      { checks, targets: granular.targets, externalAccountId: targetId },
    );
  }
  checks.granular_publish_authorized = true;

  // 2) O target realmente responde com este token (Página / Instagram).
  const provider = new MetaProvider();
  try {
    if (channel === "instagram") {
      await provider.graph<{ id: string }>(`/${conn.account_id}`, {
        accessToken: token,
        query: { fields: "id,username" },
      });
      checks.instagram_resolved = true;
      checks.page_resolved = Boolean(conn.external_id);
    } else {
      await provider.graph<{ id: string }>(`/${conn.external_id}`, {
        accessToken: token,
        query: { fields: "id,name" },
      });
      checks.page_resolved = true;
    }
    checks.target_resolved = true;
  } catch (err) {
    if (err instanceof MetaGraphError) {
      const code = err.graph?.code;
      if (code === 10 || code === 200 || code === 190 || code === 803) {
        return block(
          "publish_not_authorized",
          channel === "instagram"
            ? "Instagram não está autorizado para publicação. Reconecte esta conta autorizando este Instagram."
            : "Esta Página não está autorizada para publicação. Reconecte esta conta.",
          { checks, targets: granular.targets, externalAccountId: targetId },
        );
      }
    }
    return block(
      "validation_unavailable",
      "Não foi possível confirmar a autorização desta conta agora. Tente novamente em instantes.",
      { checks, deterministic: false, action: "retry_later", externalAccountId: targetId },
    );
  }

  const ready = clientBinding;
  return {
    publishReady: ready,
    code: ready ? "ready" : "not_linked_to_client",
    message: ready ? "Pronto para publicar" : "Este canal não está vinculado a este cliente.",
    deterministic: !ready,
    action: ready ? "none" : "relink",
    checks,
    authorizedTargets: granular.targets,
    externalAccountId: targetId,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cache em metadata + resolução do destino (cadeia completa)
// ---------------------------------------------------------------------------

function readCached(conn: MetaConnectionCapabilityRow): PublishCapability | null {
  const meta = (conn.metadata ?? {}) as Record<string, unknown>;
  const cap = meta.publish_capability as PublishCapability | undefined;
  if (!cap || typeof cap !== "object" || !cap.checkedAt) return null;
  const age = Date.now() - new Date(cap.checkedAt).getTime();
  if (!Number.isFinite(age) || age > CAPABILITY_TTL_MS) return null;
  // Nunca cacheamos indisponibilidade de validação.
  if (cap.code === "validation_unavailable") return null;
  return cap;
}

async function persistCapability(
  db: any,
  conn: MetaConnectionCapabilityRow,
  cap: PublishCapability,
): Promise<void> {
  try {
    const meta = { ...((conn.metadata ?? {}) as Record<string, unknown>) };
    meta.publish_capability = cap;
    meta.last_validation_at = cap.checkedAt;
    meta.validation_error = cap.publishReady ? null : cap.message;
    meta.authorized_targets = cap.authorizedTargets;
    await db
      .from("social_connections")
      .update({ metadata: meta as never })
      .eq("id", conn.id);
  } catch {
    // Persistência é telemetria: nunca deve derrubar a validação.
  }
}

/**
 * Valida a capacidade de publicação de uma conexão, com cache curto.
 * `db` pode ser o client do usuário (RLS) ou o admin (worker).
 */
export async function getConnectionCapability(
  db: any,
  conn: MetaConnectionCapabilityRow,
  opts?: { clientBindingValid?: boolean; force?: boolean },
): Promise<PublishCapability> {
  if (opts?.clientBindingValid === false) {
    return block(
      "not_linked_to_client",
      "Canal não vinculado ao cliente. Este canal não pode ser utilizado neste cliente.",
      { action: "relink" },
    );
  }
  if (!opts?.force) {
    const cached = readCached(conn);
    if (cached) return cached;
  }
  const cap = await evaluateConnectionCapability(conn, {
    clientBindingValid: opts?.clientBindingValid ?? true,
  });
  await persistCapability(db, conn, cap);
  return cap;
}

export type ResolveTargetInput = {
  brandId: string;
  clientId: string | null;
  connectionId: string;
  channel?: string | null;
  /** feed | stories | reels ... (opcional) */
  format?: string | null;
  force?: boolean;
};

export type ResolvedTarget = {
  capability: PublishCapability;
  connection: MetaConnectionCapabilityRow | null;
};

/**
 * Pré-flight completo de um destino: cadeia cliente → vínculo → conexão →
 * canal → target → token → granular scope. Fail closed.
 */
export async function resolvePublishTarget(
  db: any,
  input: ResolveTargetInput,
): Promise<ResolvedTarget> {
  const { data: conn, error } = await db
    .from("social_connections")
    .select(
      "id, brand_id, channel, provider, status, external_id, account_id, access_token_ciphertext, metadata",
    )
    .eq("id", input.connectionId)
    .eq("brand_id", input.brandId)
    .maybeSingle();
  if (error) {
    return {
      connection: null,
      capability: block(
        "validation_unavailable",
        "Não foi possível validar a conexão agora. Tente novamente em instantes.",
        { deterministic: false, action: "retry_later" },
      ),
    };
  }
  if (!conn) {
    return {
      connection: null,
      capability: block(
        "wrong_brand",
        "Esta conta não pertence a este workspace e não pode ser utilizada.",
        { action: "relink" },
      ),
    };
  }
  const row = conn as MetaConnectionCapabilityRow;

  if (input.channel && row.channel !== input.channel) {
    return {
      connection: row,
      capability: block(
        "channel_mismatch",
        `A conta selecionada é de ${row.channel}, mas o destino é ${input.channel}.`,
        { action: "relink" },
      ),
    };
  }

  // Vínculo cliente ↔ conta social: única autoridade.
  let binding = true;
  if (input.clientId) {
    const { data: link, error: linkErr } = await db
      .from("client_social_accounts")
      .select("id")
      .eq("brand_id", input.brandId)
      .eq("client_id", input.clientId)
      .eq("connection_id", input.connectionId)
      .maybeSingle();
    if (linkErr) {
      return {
        connection: row,
        capability: block(
          "validation_unavailable",
          "Não foi possível validar o vínculo do canal agora.",
          { deterministic: false, action: "retry_later" },
        ),
      };
    }
    binding = Boolean(link);
  }

  if (input.format) {
    const supported =
      (input.format === "feed" && (row.channel === "instagram" || row.channel === "facebook")) ||
      (input.format === "carrossel" &&
        (row.channel === "instagram" || row.channel === "facebook")) ||
      (input.format === "stories" && row.channel === "instagram") ||
      (input.format === "reels" && row.channel === "instagram");
    if (!supported) {
      return {
        connection: row,
        capability: block(
          "unsupported_format",
          "Este formato ainda não é publicável automaticamente (Feed IG/FB, Carrossel IG/FB, Stories IG ou Reels IG).",
          { action: "none" },
        ),
      };
    }

  }

  const capability = await getConnectionCapability(db, row, {
    clientBindingValid: binding,
    force: input.force,
  });
  return { capability, connection: row };
}
