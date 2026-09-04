import { describe, expect, it } from "vitest";
import {
  INCREMENTAL_MAX_AGE_MS,
  decideDiscoveryMode,
  describeDiscoveryDecision,
  mergeIncrementalPayload,
} from "@/lib/meta/refresh-policy";
import type { CachedPagesPayload } from "@/lib/meta/portfolio-shared";

const NOW = Date.parse("2026-09-03T00:00:00.000Z");
const iso = (ms: number) => new Date(NOW - ms).toISOString();

/** Estado "saudável": token já varrido, cache presente e recente. */
const healthy = {
  knownAssetCount: 42,
  loadedAt: iso(60_000),
  tokenAlreadyScanned: true,
  now: NOW,
};

describe("decideDiscoveryMode", () => {
  it("usa refresh incremental (deep=false) quando os dados existentes são válidos", () => {
    const d = decideDiscoveryMode(healthy);
    expect(d.mode).toBe("incremental");
    expect(d.deep).toBe(false);
    expect(d.reason).toBe("fresh_cache");
  });

  it("faz descoberta completa em token novo", () => {
    const d = decideDiscoveryMode({ ...healthy, tokenAlreadyScanned: false });
    expect(d.mode).toBe("full");
    expect(d.deep).toBe(true);
    expect(d.reason).toBe("new_token");
  });

  it("faz descoberta completa na ausência de cache", () => {
    const d = decideDiscoveryMode({ ...healthy, knownAssetCount: 0 });
    expect(d.mode).toBe("full");
    expect(d.reason).toBe("no_cache");
  });

  it("faz descoberta completa com dados expirados", () => {
    const d = decideDiscoveryMode({ ...healthy, loadedAt: iso(INCREMENTAL_MAX_AGE_MS + 1000) });
    expect(d.mode).toBe("full");
    expect(d.reason).toBe("expired_cache");
  });

  it("faz descoberta completa quando o usuário solicita explicitamente", () => {
    const d = decideDiscoveryMode({ ...healthy, requestedFull: true });
    expect(d.mode).toBe("full");
    expect(d.reason).toBe("requested_full");
  });

  it("faz descoberta completa quando não há data de carga", () => {
    expect(decideDiscoveryMode({ ...healthy, loadedAt: null }).reason).toBe("expired_cache");
    expect(decideDiscoveryMode({ ...healthy, loadedAt: "não-uma-data" }).mode).toBe("full");
  });

  it("mantém incremental exatamente no limite da janela", () => {
    const d = decideDiscoveryMode({ ...healthy, loadedAt: iso(INCREMENTAL_MAX_AGE_MS) });
    expect(d.mode).toBe("incremental");
    expect(d.cacheAgeMs).toBe(INCREMENTAL_MAX_AGE_MS);
  });

  it("prioriza o pedido explícito sobre qualquer cache válido", () => {
    const d = decideDiscoveryMode({ ...healthy, requestedFull: true, knownAssetCount: 500 });
    expect(d.mode).toBe("full");
  });

  it("descreve a decisão em pt-BR", () => {
    expect(describeDiscoveryDecision(decideDiscoveryMode(healthy))).toContain(
      "refresh incremental",
    );
    expect(
      describeDiscoveryDecision(decideDiscoveryMode({ ...healthy, requestedFull: true })),
    ).toContain("varredura completa");
  });
});

// ------------------------------- consumo comparado (incremental vs completa) ---

/**
 * Modelo de custo da Graph API: a varredura rasa consulta apenas
 * `/me/accounts`; a profunda soma `/me/businesses` + 3 arestas por portfólio.
 */
function requestsFor(deep: boolean, portfolios: number): number {
  return deep ? 1 + 1 + portfolios * 3 : 1;
}

describe("refresh incremental vs descoberta completa (consumo)", () => {
  it("reduz drasticamente o número de requests numa sincronização normal", () => {
    const incremental = decideDiscoveryMode(healthy);
    const full = decideDiscoveryMode({ ...healthy, requestedFull: true });
    const portfolios = 25;

    const cheap = requestsFor(incremental.deep, portfolios);
    const expensive = requestsFor(full.deep, portfolios);

    expect(cheap).toBe(1);
    expect(expensive).toBe(77);
    expect(cheap / expensive).toBeLessThan(0.05);
  });

  it("o custo incremental não cresce com a quantidade de portfólios", () => {
    const d = decideDiscoveryMode(healthy);
    expect(requestsFor(d.deep, 1)).toBe(requestsFor(d.deep, 48));
  });
});

// ------------------------------------------------------ merge incremental ---

const page = (id: string, extra: Partial<CachedPagesPayload["pages"][number]> = {}) => ({
  pageId: id,
  pageName: `Página ${id}`,
  category: null,
  pagePictureUrl: null,
  instagramBusinessId: null,
  instagramUsername: null,
  instagramPictureUrl: null,
  businessId: null,
  businessName: null,
  ...extra,
});

const known: CachedPagesPayload = {
  pages: [
    page("1", { pageName: "Antigo", pageAccessToken: "tok-1", businessId: "b1" }),
    page("2", { businessId: "b1" }),
  ],
  standaloneInstagram: [
    { instagramId: "ig9", username: "ig9", name: null, pictureUrl: null, businessName: "Port" },
  ],
  warnings: ["aviso antigo"],
  businessCount: 3,
  businesses: [{ id: "b1", name: "Portfólio 1" }],
  publishAuthorization: null,
};

describe("mergeIncrementalPayload", () => {
  it("atualiza páginas da varredura rasa sem descartar ativos de portfólio", () => {
    const scanned: CachedPagesPayload = {
      pages: [page("1", { pageName: "Novo nome" })],
      standaloneInstagram: [],
      warnings: [],
      businessCount: 0,
      businesses: [],
      publishAuthorization: null,
    };
    const merged = mergeIncrementalPayload(known, scanned);
    expect(merged.pages.map((p) => p.pageId).sort()).toEqual(["1", "2"]);
    expect(merged.pages.find((p) => p.pageId === "1")?.pageName).toBe("Novo nome");
    // Token de página conhecido é preservado.
    expect(merged.pages.find((p) => p.pageId === "1")?.pageAccessToken).toBe("tok-1");
    // Instagram avulso e portfólios vêm do cache (a rasa não os consulta).
    expect(merged.standaloneInstagram).toHaveLength(1);
    expect(merged.businesses).toEqual([{ id: "b1", name: "Portfólio 1" }]);
    expect(merged.businessCount).toBe(3);
  });

  it("mescla avisos sem duplicar e aceita autorização granular nova", () => {
    const scanned: CachedPagesPayload = {
      pages: [],
      standaloneInstagram: [],
      warnings: ["aviso antigo", "aviso novo"],
      businessCount: 0,
      businesses: [],
      publishAuthorization: null,
    };
    const auth = {
      instagram: { broad: true, targets: [], granted: true },
      facebook: { broad: true, targets: [], granted: true },
      checkedAt: new Date(NOW).toISOString(),
      unavailable: false,
    };
    const merged = mergeIncrementalPayload(known, scanned, auth);
    expect(merged.warnings).toEqual(["aviso antigo", "aviso novo"]);
    expect(merged.publishAuthorization).toBe(auth);
    expect(merged.pages).toHaveLength(2);
  });
});
