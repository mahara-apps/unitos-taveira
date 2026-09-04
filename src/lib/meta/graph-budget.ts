/**
 * Orçamento de requisições da Meta Graph API (módulo puro, testável).
 *
 * A Graph API é tratada como RECURSO CARO. Este módulo concentra:
 *  - os limites duros de paginação / portfólios / concorrência;
 *  - `mapLimit`: fan-out com concorrência limitada (nunca `Promise.all` solto);
 *  - `createSharedCache`: cache TTL + deduplicação de chamadas em voo;
 *  - `createGraphTelemetry`: contabilidade por endpoint de uma execução.
 *
 * Nada aqui faz I/O: os consumidores server-only injetam as funções reais.
 */

// --------------------------------------------------------------- Limites ---

/** Máximo de páginas seguidas via `paging.next` por aresta. */
export const MAX_PAGES_PER_EDGE = 10;
/**
 * Teto DURO de requisições reais à Graph API em UMA varredura.
 *
 * Existe porque os tetos por aresta/portfólio são multiplicativos: 25
 * portfólios × 3 arestas × 10 páginas chegavam a 770 requests numa conta
 * extrema. Ao atingir o budget a varredura para imediatamente, preserva tudo
 * o que já foi lido e devolve `stopReason = "request_budget"`.
 */
export const MAX_REQUESTS_PER_SCAN = 200;
/** Máximo de Business Portfolios varridos em uma execução. */
export const MAX_PORTFOLIOS_PER_SCAN = 25;

/** Prazo total de uma varredura de portfólio. */
export const SCAN_DEADLINE_MS = 45_000;
/** Concorrência máxima ao consultar arestas por portfólio. */
export const PORTFOLIO_CONCURRENCY = 3;
/** Concorrência máxima em fan-outs de analytics (posts/mídias). */
export const ANALYTICS_CONCURRENCY = 4;
/** Janela em que o resultado de uma varredura é reutilizado sem novo scan. */
export const SCAN_REUSE_TTL_MS = 120_000;
/** Janela de reuso da validação granular do token (`/debug_token`). */
export const DEBUG_TOKEN_TTL_MS = 300_000;

/** Códigos de rate limit da Meta (Graph API + Business Manager). */
export const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);

/** Reconhece rate limit por código Graph ou HTTP 429. */
export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; graph?: { code?: number; error_subcode?: number } };
  if (e.status === 429) return true;
  return !!e.graph?.code && RATE_LIMIT_CODES.has(e.graph.code);
}

/**
 * O fallback de `fields` só se justifica quando a Meta rejeitou o CONJUNTO DE
 * CAMPOS — não em rate limit, não em token inválido. Sem isso, um único #4
 * virava três requisições.
 */
export function shouldRetryWithSmallerFields(err: unknown): boolean {
  if (isRateLimitError(err)) return false;
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; graph?: { code?: number }; message?: string };
  if (e.graph?.code === 190) return false; // token inválido
  if (typeof e.status === "number" && e.status >= 500) return true;
  if (e.graph?.code === 100) return true; // campo/aresta inexistente
  return /nonexisting field|unsupported get request|unknown field/i.test(e.message ?? "");
}

// ------------------------------------------------------------- mapLimit ---

/**
 * Executa `fn` sobre `items` com no máximo `limit` chamadas simultâneas,
 * preservando a ordem do resultado. Substitui `Promise.all` irrestrito.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.floor(limit));
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

// -------------------------------------------------------- Cache + dedupe ---

export type SharedCache<T> = {
  /** Reutiliza resultado fresco, aguarda execução em voo ou executa `fn`. */
  run: (key: string, fn: () => Promise<T>) => Promise<{ value: T; source: CacheSource }>;
  /** Resultado fresco em cache, sem executar nada. */
  peek: (key: string) => T | undefined;
  invalidate: (key: string) => void;
  clear: () => void;
};

export type CacheSource = "fresh" | "cache" | "inflight";

/**
 * Cache TTL com deduplicação de chamadas concorrentes.
 *
 * É o mecanismo que garante "UMA descoberta por operação": duas trilhas
 * distintas (OAuth/discovery e abertura do modal) pedindo a mesma chave
 * compartilham a MESMA promise, e a segunda não gera requisição alguma.
 */
export function createSharedCache<T>(ttlMs: number, now: () => number = Date.now): SharedCache<T> {
  const done = new Map<string, { value: T; at: number }>();
  const inflight = new Map<string, Promise<T>>();

  return {
    peek(key) {
      const hit = done.get(key);
      if (!hit) return undefined;
      if (now() - hit.at > ttlMs) {
        done.delete(key);
        return undefined;
      }
      return hit.value;
    },
    async run(key, fn) {
      const hit = done.get(key);
      if (hit && now() - hit.at <= ttlMs) return { value: hit.value, source: "cache" };
      if (hit) done.delete(key);

      const running = inflight.get(key);
      if (running) return { value: await running, source: "inflight" };

      const p = (async () => fn())();
      inflight.set(key, p);
      try {
        const value = await p;
        done.set(key, { value, at: now() });
        return { value, source: "fresh" as const };
      } finally {
        inflight.delete(key);
      }
    },
    invalidate(key) {
      done.delete(key);
    },
    clear() {
      done.clear();
      inflight.clear();
    },
  };
}

// ------------------------------------------------------------ Telemetria ---

export type GraphTelemetrySummary = {
  discoveryId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requests: number;
  byEndpoint: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  paginationPages: number;
  portfolios: number;
  pages: number;
  instagram: number;
  adAccounts: number;
  retries: number;
  rateLimits: number;
  reason: GraphStopReason;
};

export type GraphStopReason =
  | "completed"
  | "deadline"
  | "page_cap"
  | "portfolio_cap"
  | "request_budget"
  | "rate_limited"
  | "error"
  | "cached"
  | "deduped";

export type GraphTelemetry = {
  discoveryId: string;
  /** Contabiliza UMA requisição real à Graph API. */
  request: (endpoint: string) => void;
  /** Contabiliza uma página adicional seguida via `paging.next`. */
  paginationPage: () => void;
  cacheHit: () => void;
  cacheMiss: () => void;
  retry: () => void;
  rateLimit: () => void;
  counts: (
    c: Partial<Pick<GraphTelemetrySummary, "portfolios" | "pages" | "instagram" | "adAccounts">>,
  ) => void;
  finish: (reason: GraphStopReason) => GraphTelemetrySummary;
  logLine: (summary?: GraphTelemetrySummary) => string;
};

/** Normaliza `/1234567/owned_pages` → `/{id}/owned_pages` para agregação. */
export function normalizeEndpoint(path: string): string {
  const clean = path.split("?")[0] ?? path;
  return clean
    .replace(/^https?:\/\/[^/]+\/v\d+\.\d+/, "")
    .split("/")
    .map((seg) => (/^\d{5,}$/.test(seg) || /^act_\d+$/.test(seg) ? "{id}" : seg))
    .join("/");
}

export function createGraphTelemetry(
  label: string,
  now: () => number = Date.now,
  idFactory: () => string = () => Math.random().toString(36).slice(2, 10),
): GraphTelemetry {
  const startedAtMs = now();
  const s: GraphTelemetrySummary = {
    discoveryId: idFactory(),
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(startedAtMs).toISOString(),
    durationMs: 0,
    requests: 0,
    byEndpoint: {},
    cacheHits: 0,
    cacheMisses: 0,
    paginationPages: 0,
    portfolios: 0,
    pages: 0,
    instagram: 0,
    adAccounts: 0,
    retries: 0,
    rateLimits: 0,
    reason: "completed",
  };

  const t: GraphTelemetry = {
    discoveryId: s.discoveryId,
    request(endpoint) {
      s.requests += 1;
      const key = normalizeEndpoint(endpoint);
      s.byEndpoint[key] = (s.byEndpoint[key] ?? 0) + 1;
    },
    paginationPage() {
      s.paginationPages += 1;
    },
    cacheHit() {
      s.cacheHits += 1;
    },
    cacheMiss() {
      s.cacheMisses += 1;
    },
    retry() {
      s.retries += 1;
    },
    rateLimit() {
      s.rateLimits += 1;
    },
    counts(c) {
      Object.assign(s, c);
    },
    finish(reason) {
      s.reason = reason;
      const end = now();
      s.finishedAt = new Date(end).toISOString();
      s.durationMs = end - startedAtMs;
      return { ...s, byEndpoint: { ...s.byEndpoint } };
    },
    logLine(summary) {
      const v = summary ?? s;
      const endpoints = Object.entries(v.byEndpoint)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}=${n}`)
        .join(" ");
      return (
        `${label} id=${v.discoveryId} requests=${v.requests} cacheHits=${v.cacheHits} ` +
        `cacheMisses=${v.cacheMisses} portfolios=${v.portfolios} pages=${v.pages} ` +
        `instagram=${v.instagram} adAccounts=${v.adAccounts} paginationPages=${v.paginationPages} ` +
        `retries=${v.retries} rateLimits=${v.rateLimits} ` +
        `duration=${(v.durationMs / 1000).toFixed(1)}s reason=${v.reason}` +
        (endpoints ? ` | ${endpoints}` : "")
      );
    },
  };
  return t;
}
