import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { resetScopeCache } from "@/lib/session-reset";
import { pickClientIdentity } from "@/lib/client-identity";
import { clientDashboardInput, clientDashboardQueryKey } from "@/lib/client-dashboard.query";
import { dayRangeKey } from "@/lib/range-key";

const BRAND = "b1";
const X = "clientX";
const Y = "clientY";
const CLIENTS = [
  { id: X, name: "Cliente X", niche: "Moda" },
  { id: Y, name: "Cliente Y", niche: "Saúde" },
];

describe("X → Y: troca de cliente não bloqueia e não reaproveita dados de X", () => {
  it("identidade do cabeçalho troca no mesmo frame e nunca é a de X", () => {
    expect(pickClientIdentity(CLIENTS, Y)).toEqual({ id: Y, name: "Cliente Y", niche: "Saúde" });
    // Cliente ainda não presente na lista → null, jamais o registro anterior.
    expect(pickClientIdentity(CLIENTS, "clienteZ")).toBeNull();
    expect(pickClientIdentity(undefined, Y)).toBeNull();
  });

  it("chave do painel isola userId + brandId + clientId (X e Y nunca colidem)", () => {
    const range = { from: new Date("2026-08-01T10:31:02.123Z"), to: new Date("2026-08-28T22:59:59Z") };
    const kx = clientDashboardQueryKey("u1", BRAND, X, range);
    const ky = clientDashboardQueryKey("u1", BRAND, Y, range);
    expect(kx).not.toEqual(ky);
    expect(ky).toContain(Y);
    expect(ky).not.toContain(X);
    expect(clientDashboardQueryKey("u2", BRAND, Y, range)).not.toEqual(ky);
  });

  it("chave do período tem precisão de dia (cache reaproveitável em X → Y → X)", () => {
    const a = { from: new Date(2026, 7, 1, 10, 31, 2, 123), to: new Date(2026, 7, 28, 9, 0, 0, 0) };
    const b = { from: new Date(2026, 7, 1, 23, 59, 59, 999), to: new Date(2026, 7, 28, 1, 2, 3, 4) };
    expect(dayRangeKey(a)).toEqual(dayRangeKey(b));
    expect(clientDashboardQueryKey("u1", BRAND, Y, a)).toEqual(
      clientDashboardQueryKey("u1", BRAND, Y, b),
    );
    // payload normalizado para os limites do dia, coerente com a chave
    const input = clientDashboardInput(BRAND, Y, a);
    expect(input.clientId).toBe(Y);
    expect(input.range?.from).toMatch(/T/);
  });

  it("handler de troca é síncrono: não aguarda nem cancela requisições", () => {
    const qc = new QueryClient();
    const cancel = vi.spyOn(qc, "cancelQueries");
    const remove = vi.spyOn(qc, "removeQueries");

    const t0 = Date.now();
    const result = resetScopeCache(qc, [Y, X, BRAND]);
    expect(result).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(50);
    expect(cancel).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("não dispara refetch global e não derruba a query recém-iniciada de Y", () => {
    const qc = new QueryClient();
    const range = { from: new Date(2026, 7, 1), to: new Date(2026, 7, 28) };
    const keyY = clientDashboardQueryKey("u1", BRAND, Y, range) as unknown[];
    const keyX = clientDashboardQueryKey("u1", BRAND, X, range) as unknown[];
    qc.setQueryData(keyX, { kpi: "X" });
    qc.setQueryData(keyY, { kpi: "Y" });
    qc.setQueryData(["legacy-scoped-list"], [1]);

    const invalidate = vi.spyOn(qc, "invalidateQueries");
    resetScopeCache(qc, [Y, X, BRAND]);

    // nunca refetch imediato (rajada concorrente com o fetch de Y)
    expect(invalidate.mock.calls[0]?.[0]?.refetchType).toBe("none");
    // cache de Y intacto (reuso instantâneo) e o de X preservado para voltar
    expect(qc.getQueryData(keyY)).toEqual({ kpi: "Y" });
    expect(qc.getQueryData(keyX)).toEqual({ kpi: "X" });
    expect(qc.getQueryState(keyY)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(["legacy-scoped-list"])?.isInvalidated).toBe(true);
  });
});
