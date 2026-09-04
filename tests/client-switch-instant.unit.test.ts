import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  isWorkspaceScopedQueryKey,
  queryKeyCarriesScopeId,
  resetScopeCache,
} from "@/lib/session-reset";

const BRAND = "b1";
const X = "clientX";
const Y = "clientY";

describe("troca de cliente instantânea", () => {
  it("chave escopada por brand/cliente é reconhecida", () => {
    expect(queryKeyCarriesScopeId(["client-account-dashboard", "u1", BRAND, Y, "r"], [Y, BRAND])).toBe(
      true,
    );
    expect(queryKeyCarriesScopeId(["some-global-list"], [Y, BRAND])).toBe(false);
    expect(isWorkspaceScopedQueryKey(["brands"])).toBe(false);
  });

  it("não descarta o cache do cliente anterior (X → Y → X reutiliza cache)", () => {
    const qc = new QueryClient();
    qc.setQueryData(["client-account-dashboard", "u1", BRAND, X, "r"], { kpi: 1 });
    qc.setQueryData(["client-account-dashboard", "u1", BRAND, Y, "r"], { kpi: 2 });

    resetScopeCache(qc, [Y, X, BRAND]);

    expect(qc.getQueryData(["client-account-dashboard", "u1", BRAND, X, "r"])).toEqual({ kpi: 1 });
    expect(qc.getQueryData(["client-account-dashboard", "u1", BRAND, Y, "r"])).toEqual({ kpi: 2 });
  });

  it("é síncrono: não retorna promise nem aguarda fetch pendente", () => {
    const qc = new QueryClient();
    expect(resetScopeCache(qc, [Y, BRAND])).toBeUndefined();
  });

  it("marca como obsoletas apenas queries de escopo sem id na chave", () => {
    const qc = new QueryClient();
    qc.setQueryData(["legacy-scoped-list"], [1]);
    qc.setQueryData(["brands"], [{ id: BRAND }]);
    qc.setQueryData(["client-account-dashboard", "u1", BRAND, Y, "r"], { kpi: 2 });

    resetScopeCache(qc, [Y, BRAND]);

    const state = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated;
    expect(state(["legacy-scoped-list"])).toBe(true);
    expect(state(["brands"])).toBe(false);
    expect(state(["client-account-dashboard", "u1", BRAND, Y, "r"])).toBe(false);
  });
});
