// Social Analytics — cache in-memory por isolate (TTL 10 min).
//
// Regra do módulo: métricas NUNCA são persistidas em banco. Sempre
// consultamos a API do provider. Para reduzir custo/latência, cacheamos
// o resultado das chamadas de provider por 10 minutos, com chave por
// usuário + conexão + operação + argumentos.
//
// Coalescência de requests: chamadas concorrentes para a mesma chave
// compartilham a mesma Promise pendente — evita "thundering herd" quando
// múltiplas abas abrem o dashboard ao mesmo tempo.
//
// Escopo: por isolate de Worker. Ao ser reciclado, o cache reinicia —
// aceitável, comportamento equivalente a Vercel/CF Workers.

export const SOCIAL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

interface Entry<V> {
  value: V;
  expires: number;
}

const MAX_ENTRIES = 500;
const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function evictIfNeeded() {
  if (store.size <= MAX_ENTRIES) return;
  const toDrop = Math.ceil(store.size * 0.2);
  const it = store.keys();
  for (let i = 0; i < toDrop; i++) {
    const k = it.next().value;
    if (k) store.delete(k);
  }
}

function get<V>(key: string): V | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return undefined;
  }
  // LRU refresh
  store.delete(key);
  store.set(key, hit);
  return hit.value as V;
}

function set<V>(key: string, value: V, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
  evictIfNeeded();
}

/**
 * Executa `producer` com cache TTL + coalescência de chamadas concorrentes.
 * Transparente para o chamador — o retorno tem a mesma forma que
 * `producer()` teria.
 */
export async function withSocialCache<V>(
  key: string,
  producer: () => Promise<V>,
  ttlMs: number = SOCIAL_CACHE_TTL_MS,
): Promise<V> {
  const cached = get<V>(key);
  if (cached !== undefined) return cached;

  const pending = inflight.get(key) as Promise<V> | undefined;
  if (pending) return pending;

  const p = (async () => {
    try {
      const value = await producer();
      set(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Hash determinístico curto para compor chaves. */
export function hashKey(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Compõe uma chave estável para operações do módulo.
 * `scope` deve identificar tenant/usuário para evitar cross-tenant leak.
 */
export function socialCacheKey(
  op: string,
  scope: string,
  args: Record<string, unknown> = {},
): string {
  const serialized = Object.keys(args)
    .sort()
    .map((k) => `${k}=${JSON.stringify(args[k])}`)
    .join("&");
  return `sa:${op}:${scope}:${hashKey(serialized)}`;
}

export function socialCacheStats() {
  return { size: store.size, max: MAX_ENTRIES, inflight: inflight.size };
}
