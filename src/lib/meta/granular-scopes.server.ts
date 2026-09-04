// Autorização granular da Meta na etapa de DESCOBERTA (server-only).
//
// Regra do Unitos: "usuário autorizado" ≠ "conta autorizada". `/me/permissions`
// dizer `instagram_content_publish = granted` NÃO autoriza todas as contas.
// A autorização real vive em `debug_token.granular_scopes[].target_ids`.
//
// Este módulo só LÊ o token (nenhuma escrita, nenhum efeito colateral) e
// devolve, por canal, a lista de targets autorizados para publicação.

import { DEBUG_TOKEN_TTL_MS, createSharedCache } from "./graph-budget";

const GRAPH_BASE = "https://graph.facebook.com/v22.0";

export type ChannelAuthorization = {
  /** Autorização ampla (scope sem target_ids => vale para todas as contas). */
  broad: boolean;
  /** IDs explicitamente autorizados pela Meta. */
  targets: string[];
  /** O scope foi concedido de alguma forma? */
  granted: boolean;
};

export type PublishAuthorization = {
  instagram: ChannelAuthorization;
  facebook: ChannelAuthorization;
  checkedAt: string;
  /** true quando não foi possível consultar a Meta (nunca afirmamos "pronto"). */
  unavailable: boolean;
};

const emptyChannel = (): ChannelAuthorization => ({
  broad: false,
  targets: [],
  granted: false,
});

export function unknownAuthorization(): PublishAuthorization {
  return {
    instagram: emptyChannel(),
    facebook: emptyChannel(),
    checkedAt: new Date().toISOString(),
    unavailable: true,
  };
}

type GranularScope = { scope: string; target_ids?: string[] };

function readChannel(
  scopes: string[],
  granular: GranularScope[],
  scope: string,
): ChannelAuthorization {
  const g = granular.find((x) => x.scope === scope);
  if (g) {
    const targets = (g.target_ids ?? []).map(String);
    return { granted: true, broad: targets.length === 0, targets };
  }
  const flat = scopes.includes(scope);
  return { granted: flat, broad: flat, targets: [] };
}

/**
 * Cache TTL + dedupe de `/debug_token`.
 *
 * A mesma operação (OAuth → discovery → abertura do portfólio) validava o
 * token 2–3 vezes. A autorização granular não muda em segundos, então uma
 * janela curta elimina essas repetições sem alterar o comportamento.
 */
const authCache = createSharedCache<PublishAuthorization>(DEBUG_TOKEN_TTL_MS);

/** Chave estável e não reversível do token (nunca logamos o token). */
function tokenKey(token: string): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `t${(h >>> 0).toString(36)}:${token.length}`;
}

/** Consulta `debug_token` (com reuso em janela curta) e extrai a autorização. */
export async function getPublishAuthorization(userToken: string): Promise<PublishAuthorization> {
  const key = tokenKey(userToken);
  const { value } = await authCache.run(key, () => fetchPublishAuthorization(userToken));
  // Resultado indisponível não é memorizado: a próxima tentativa deve reconsultar.
  if (value.unavailable) authCache.invalidate(key);
  return value;
}

async function fetchPublishAuthorization(userToken: string): Promise<PublishAuthorization> {
  let appId: string;
  let appSecret: string;
  try {
    const { resolveMetaAppCredentials } = await import("./app-config.server");
    ({ appId, appSecret } = await resolveMetaAppCredentials());
  } catch {
    return unknownAuthorization();
  }
  try {
    const url = new URL(`${GRAPH_BASE}/debug_token`);
    url.searchParams.set("input_token", userToken);
    url.searchParams.set("access_token", `${appId}|${appSecret}`);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { scopes?: string[]; granular_scopes?: GranularScope[]; is_valid?: boolean };
      error?: unknown;
    };
    if (!res.ok || json.error || !json.data) return unknownAuthorization();
    const scopes = (json.data.scopes ?? []).map(String);
    const granular = json.data.granular_scopes ?? [];
    return {
      instagram: readChannel(scopes, granular, "instagram_content_publish"),
      facebook: readChannel(scopes, granular, "pages_manage_posts"),
      checkedAt: new Date().toISOString(),
      unavailable: false,
    };
  } catch {
    return unknownAuthorization();
  }
}

/** O target específico está autorizado para publicar neste canal? */
export function isTargetAuthorized(
  auth: PublishAuthorization | null | undefined,
  channel: "instagram" | "facebook",
  targetId: string | null | undefined,
): boolean {
  if (!auth || auth.unavailable || !targetId) return false;
  const ch = auth[channel];
  if (!ch.granted) return false;
  if (ch.broad) return true;
  return ch.targets.includes(String(targetId));
}
