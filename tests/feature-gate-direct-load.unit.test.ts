import { describe, expect, it, beforeEach, vi } from "vitest";

/**
 * PERF3 — carregamento direto de rota protegida (F5 / link colado).
 *
 * O `beforeLoad` roda antes do provider de contexto montar: sem a dica
 * persistida o gate concluía "no_workspace" e redirecionava para o dashboard,
 * deixando a tela em branco depois de esperar o timeout inteiro.
 */
vi.mock("@/lib/feature-flags.functions", () => ({
  requireFeatureAccess: vi.fn(async ({ data }: { data: { brandId: string } }) => ({
    enabled: data.brandId === "brand-a",
    reason: data.brandId === "brand-a" ? "granted" : "feature_disabled",
  })),
}));
vi.mock("@/lib/portal-access.functions", () => ({ getMyPortalAccessFn: vi.fn(async () => null) }));

import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import { __resetActiveWorkspace, publishActiveWorkspace } from "@/lib/active-workspace";
import { clearAccessCaches } from "@/lib/access-cache";

// Ambiente de teste roda em Node: simula o storage do navegador.
const store = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
};
const localStorage = (globalThis as any).window.localStorage as Storage;

beforeEach(() => {
  __resetActiveWorkspace();
  clearAccessCaches();
  localStorage.clear();
});

describe("PERF3 — feature gate em carregamento direto", () => {
  it("usa a preferência persistida como dica quando o contexto não resolveu", async () => {
    localStorage.setItem("nx.brand", "brand-a");
    await expect(ensureFeatureEnabled("tasks")).resolves.toBeUndefined();
  });

  it("não bloqueia quando não há contexto nem dica (inicialização)", async () => {
    await expect(ensureFeatureEnabled("tasks")).resolves.toBeUndefined();
  });

  it("continua bloqueando feature desabilitada do workspace resolvido", async () => {
    publishActiveWorkspace("brand-b", true);
    await expect(ensureFeatureEnabled("tasks")).rejects.toBeTruthy();
  });

  it("dica de workspace sem a feature também bloqueia", async () => {
    localStorage.setItem("nx.brand", "brand-b");
    await expect(ensureFeatureEnabled("tasks")).rejects.toBeTruthy();
  });
});
