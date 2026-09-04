/**
 * Budget global de requisições por varredura da Meta Graph API.
 *
 * Os tetos por aresta e por portfólio são multiplicativos (25 × 3 × 10), então
 * uma conta extrema ainda podia gerar centenas de chamadas e estourar a quota
 * do aplicativo (#4). Estes testes fixam o contrato do teto duro:
 * para imediatamente, preserva dados parciais, não faz retry e reporta
 * `stopReason = "request_budget"`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_REQUESTS_PER_SCAN } from "@/lib/meta/graph-budget";
import { MetaProvider } from "@/lib/meta/provider.server";

const realFetch = globalThis.fetch;

/** Graph API simulada: N portfólios, cada aresta com `pagesPerEdge` páginas. */
function stubGraph(opts: { businesses: number; pagesPerEdge: number }) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const raw = String(input);
    calls.push(raw);
    const url = new URL(raw);
    const page = Number(url.searchParams.get("__p") ?? "1");
    const body: Record<string, unknown> = {};
    if (url.pathname.endsWith("/me/accounts")) {
      body.data = [
        { id: `page-${page}`, name: "Página", access_token: "t" },
      ];
    } else if (url.pathname.endsWith("/me/businesses")) {
      body.data = Array.from({ length: opts.businesses }, (_, i) => ({
        id: `${1_000_000 + i}`,
        name: `Portfólio ${i}`,
      }));
    } else if (url.pathname.includes("owned_instagram_accounts")) {
      body.data = [{ id: `ig-${calls.length}`, username: "conta" }];
    } else {
      body.data = [{ id: `bp-${calls.length}`, name: "Página do portfólio", access_token: "t" }];
    }
    if (page < opts.pagesPerEdge) {
      const next = new URL(raw);
      next.searchParams.set("__p", String(page + 1));
      body.paging = { next: next.toString() };
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
  return calls;
}

beforeEach(() => {
  vi.stubEnv("META_REDIRECT_URI", "https://audit.test/api/public/meta/callback");
  vi.stubEnv("META_APP_ID", "app-id");
  vi.stubEnv("META_APP_SECRET", "app-secret");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
});

const provider = () =>
  new MetaProvider({
    appId: "app-id",
    appSecret: "app-secret",
    redirectUri: "https://audit.test/api/public/meta/callback",
  });

describe("budget global de requests por discovery", () => {
  it("o teto padrão é 200 requisições por varredura", () => {
    expect(MAX_REQUESTS_PER_SCAN).toBe(200);
  });

  it("nunca excede o budget em uma conta extrema (48 portfólios, arestas longas)", async () => {
    const calls = stubGraph({ businesses: 48, pagesPerEdge: 10 });
    const scan = await provider().scanPortfolio("TOKEN-EXTREMO");

    expect(calls.length).toBeLessThanOrEqual(MAX_REQUESTS_PER_SCAN);
    expect(scan.requestCount).toBeLessThanOrEqual(MAX_REQUESTS_PER_SCAN);
    expect(scan.stopReason).toBe("request_budget");
  });

  it("para EXATAMENTE em 200: a requisição 201 nunca é emitida", async () => {
    const calls = stubGraph({ businesses: 48, pagesPerEdge: 10 });
    const scan = await provider().scanPortfolio("TOKEN-200");

    expect(calls.length).toBe(200);
    expect(scan.requestCount).toBe(200);
    expect(calls.length).not.toBe(201);
    // Sem retry automático: nenhum request extra foi gasto tentando de novo.
    expect(scan.telemetry?.retries).toBe(0);
    expect(scan.telemetry?.requests).toBe(200);
  });

  it("respeita um budget customizado e reporta o motivo na telemetria", async () => {
    const calls = stubGraph({ businesses: 48, pagesPerEdge: 10 });
    const scan = await provider().scanPortfolio("TOKEN-50", { maxRequests: 50 });

    expect(calls.length).toBe(50);
    expect(scan.stopReason).toBe("request_budget");
    expect(scan.telemetry?.reason).toBe("request_budget");
  });

  it("cenário parcial: preserva todos os ativos já obtidos e avisa a UI", async () => {
    stubGraph({ businesses: 48, pagesPerEdge: 10 });
    const scan = await provider().scanPortfolio("TOKEN-PARCIAL", { maxRequests: 40 });

    // Dados parciais preservados — nunca lista vazia, nunca erro fatal.
    expect(scan.pages.length).toBeGreaterThan(0);
    expect(scan.businessCount).toBe(48);
    expect(
      scan.warnings.some((w) => /limite de 40 consultas/i.test(w)),
    ).toBe(true);
    expect(scan.warnings.some((w) => /preservad/i.test(w))).toBe(true);
  });

  it("conta pequena termina normalmente, sem acionar o budget", async () => {
    const calls = stubGraph({ businesses: 3, pagesPerEdge: 1 });
    const scan = await provider().scanPortfolio("TOKEN-PEQUENO");

    // 1 (/me/accounts) + 1 (/me/businesses) + 3 portfólios × 3 arestas
    expect(calls.length).toBe(11);
    expect(scan.stopReason).toBe("completed");
    expect(scan.warnings).toHaveLength(0);
  });
});
