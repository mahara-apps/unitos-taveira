// Brain in-process cache — TTL LRU compartilhado por hot reads (stats,
// contextPack). Ganho: elimina round-trips duplicados dentro do mesmo isolate
// de Worker durante o TTL. Reset natural quando o isolate é reciclado.

interface Entry<V> {
  value: V;
  expires: number;
}

const MAX_ENTRIES = 500;
const store = new Map<string, Entry<unknown>>();

function evictIfNeeded() {
  if (store.size <= MAX_ENTRIES) return;
  // Evict oldest ~20%
  const toDrop = Math.ceil(store.size * 0.2);
  const keys = store.keys();
  for (let i = 0; i < toDrop; i++) {
    const k = keys.next().value;
    if (k) store.delete(k);
  }
}

export function cacheGet<V>(key: string): V | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    store.delete(key);
    return undefined;
  }
  // LRU: refresh insertion order
  store.delete(key);
  store.set(key, hit);
  return hit.value as V;
}

export function cacheSet<V>(key: string, value: V, ttlMs: number): void {
  store.set(key, { value, expires: Date.now() + ttlMs });
  evictIfNeeded();
}

export async function withCache<V>(
  key: string,
  ttlMs: number,
  producer: () => Promise<V>,
): Promise<V> {
  const hit = cacheGet<V>(key);
  if (hit !== undefined) return hit;
  const value = await producer();
  cacheSet(key, value, ttlMs);
  return value;
}

/** Hash simples e determinístico para chaves de cache. */
export function hashKey(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function cacheStats() {
  return { size: store.size, max: MAX_ENTRIES };
}
