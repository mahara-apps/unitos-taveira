import { describe, expect, it } from "vitest";
import {
  MAX_PAGES_PER_EDGE,
  MAX_PORTFOLIOS_PER_SCAN,
  createGraphTelemetry,
  createSharedCache,
  isRateLimitError,
  mapLimit,
  normalizeEndpoint,
  shouldRetryWithSmallerFields,
} from "@/lib/meta/graph-budget";

describe("limites", () => {
  it("mantém tetos conservadores", () => {
    expect(MAX_PAGES_PER_EDGE).toBeLessThanOrEqual(10);
    expect(MAX_PORTFOLIOS_PER_SCAN).toBeLessThanOrEqual(25);
  });
});

describe("isRateLimitError", () => {
  it("reconhece os códigos de rate limit da Meta, incluindo 341", () => {
    for (const code of [4, 17, 32, 341, 613]) {
      expect(isRateLimitError({ graph: { code } })).toBe(true);
    }
  });
  it("reconhece HTTP 429", () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
  });
  it("não confunde outros erros", () => {
    expect(isRateLimitError({ graph: { code: 190 } })).toBe(false);
    expect(isRateLimitError(new Error("x"))).toBe(false);
  });
});

describe("shouldRetryWithSmallerFields", () => {
  it("nunca repete em rate limit nem token inválido", () => {
    expect(shouldRetryWithSmallerFields({ graph: { code: 4 } })).toBe(false);
    expect(shouldRetryWithSmallerFields({ graph: { code: 190 } })).toBe(false);
  });
  it("repete em erro de campo/aresta ou 5xx", () => {
    expect(shouldRetryWithSmallerFields({ status: 500 })).toBe(true);
    expect(shouldRetryWithSmallerFields({ graph: { code: 100 } })).toBe(true);
    expect(shouldRetryWithSmallerFields({ message: "Unsupported get request" })).toBe(true);
  });
});

describe("mapLimit", () => {
  it("respeita a concorrência máxima e preserva a ordem", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });
});

describe("createSharedCache", () => {
  it("reutiliza resultado dentro do TTL sem executar de novo", async () => {
    let calls = 0;
    let t = 0;
    const cache = createSharedCache<number>(100, () => t);
    const a = await cache.run("k", async () => ++calls);
    const b = await cache.run("k", async () => ++calls);
    expect([a.source, b.source]).toEqual(["fresh", "cache"]);
    expect(calls).toBe(1);
    t = 500;
    const c = await cache.run("k", async () => ++calls);
    expect(c.source).toBe("fresh");
    expect(calls).toBe(2);
  });

  it("deduplica chamadas concorrentes na mesma promise", async () => {
    let calls = 0;
    const cache = createSharedCache<number>(1000);
    const fn = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return calls;
    };
    const [x, y] = await Promise.all([cache.run("k", fn), cache.run("k", fn)]);
    expect(calls).toBe(1);
    expect(y.source === "inflight" || x.source === "inflight").toBe(true);
  });

  it("invalidate força nova execução", async () => {
    let calls = 0;
    const cache = createSharedCache<number>(1000);
    await cache.run("k", async () => ++calls);
    cache.invalidate("k");
    await cache.run("k", async () => ++calls);
    expect(calls).toBe(2);
  });
});

describe("telemetria", () => {
  it("agrega requests por endpoint normalizado", () => {
    const t = createGraphTelemetry("scan");
    t.request("/1234567890/owned_pages");
    t.request("/9876543210/owned_pages");
    t.request("/me/accounts");
    t.paginationPage();
    t.rateLimit();
    const s = t.finish("rate_limited");
    expect(s.requests).toBe(3);
    expect(s.byEndpoint["/{id}/owned_pages"]).toBe(2);
    expect(s.paginationPages).toBe(1);
    expect(s.rateLimits).toBe(1);
    expect(s.reason).toBe("rate_limited");
    expect(t.logLine(s)).toContain("requests=3");
  });

  it("normaliza URLs absolutas da Graph", () => {
    expect(normalizeEndpoint("https://graph.facebook.com/v22.0/123456789/client_pages?x=1")).toBe(
      "/{id}/client_pages",
    );
  });
});
