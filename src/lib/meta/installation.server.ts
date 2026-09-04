/**
 * Multi-installation helpers for the Meta integration — server-only.
 *
 * Several independent Unitos installations (own domain + own Supabase) can
 * share a SINGLE Meta App. OAuth already works per installation because the
 * redirect URI is derived from the request origin. The only Meta limitation is
 * that an App has ONE webhook Callback URL per product, so the installation
 * that owns that URL forwards events it cannot match locally to its sibling
 * installations.
 *
 * Security invariants:
 *  - forward targets come exclusively from `META_WEBHOOK_PEERS` (infrastructure
 *    configuration), never from the request → no SSRF;
 *  - only absolute `https://` origins with no credentials/query are accepted;
 *  - the raw body and the `X-Hub-Signature-256` header are preserved so the
 *    peer re-validates the Meta signature with the shared app secret;
 *  - a forward marker header stops forwarding chains (no loops);
 *  - no tokens, cookies or Supabase credentials are ever forwarded.
 */

/** Marker header: a request carrying it is already a forwarded copy. */
export const META_FORWARD_HEADER = "x-unitos-meta-forward";
export const META_WEBHOOK_PATH = "/api/public/meta/webhook";

/** Milliseconds allowed per peer forward attempt. */
export const META_FORWARD_TIMEOUT_MS = 4000;

/**
 * Parses the trusted peer list from configuration.
 * Accepts comma/whitespace separated absolute https origins.
 */
export function parseInstallationPeers(raw?: string | null, selfOrigin?: string | null): string[] {
  if (!raw) return [];
  const self = safeOrigin(selfOrigin);
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const candidate = part.trim();
    if (!candidate) continue;
    const origin = safeOrigin(candidate);
    if (!origin) continue;
    if (self && origin === self) continue; // never forward to ourselves
    if (!out.includes(origin)) out.push(origin);
  }
  return out;
}

function safeOrigin(value?: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/** True when this request is already a forwarded copy (loop guard). */
export function isForwardedWebhook(headers: Headers): boolean {
  return headers.get(META_FORWARD_HEADER) === "1";
}

export type ForwardOutcome = {
  target: string;
  ok: boolean;
  status?: number;
  error?: string;
};

/**
 * Replays a verified Meta webhook to the configured sibling installations.
 * Errors are contained: Meta must always receive a 200 from us.
 */
export async function forwardMetaWebhook(opts: {
  rawBody: string;
  signature: string;
  peers: string[];
  contentType?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<ForwardOutcome[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const results = await Promise.all(
    opts.peers.map(async (target): Promise<ForwardOutcome> => {
      const url = `${target}${META_WEBHOOK_PATH}`;
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": opts.contentType || "application/json",
            "X-Hub-Signature-256": opts.signature,
            [META_FORWARD_HEADER]: "1",
          },
          body: opts.rawBody,
          signal: AbortSignal.timeout(META_FORWARD_TIMEOUT_MS),
        });
        return { target, ok: res.ok, status: res.status };
      } catch (err) {
        return { target, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return results;
}

/**
 * Peers derivados do Installation Manager (somente o MASTER tem a tabela
 * `installations` preenchida). Assim uma nova instalação passa a receber os
 * eventos do webhook compartilhado sem editar env manualmente.
 *
 * A fonte é infraestrutura interna (registro feito por Super Admin), nunca o
 * payload da requisição — o alvo continua não manipulável de fora.
 */
export async function loadRegisteredInstallationPeers(
  selfOrigin?: string | null,
): Promise<string[]> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("installations")
      .select("domain, status")
      .not("domain", "is", null)
      .limit(200);
    if (error || !data) return [];
    const raw = data
      .filter((r) => r.status !== "archived")
      .map((r) => normalizeHttpsOrigin(r.domain))
      .filter((v): v is string => !!v)
      .join(",");
    return parseInstallationPeers(raw, selfOrigin);
  } catch {
    return [];
  }
}

function normalizeHttpsOrigin(value?: string | null): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return safeOrigin(/^https?:\/\//i.test(v) ? v.replace(/^http:/i, "https:") : `https://${v}`);
}

/** União ordenada e deduplicada de peers (env + registro), preservando ordem. */
export function mergePeers(...lists: string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const peer of list) if (!out.includes(peer)) out.push(peer);
  }
  return out;
}
