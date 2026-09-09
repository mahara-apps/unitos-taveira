import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("nenhuma tela interna pode ficar em branco", () => {
  it("o gate de sessão pinta um indicador central, nunca null", () => {
    const src = read("src/routes/_authenticated/route.tsx");
    expect(src).not.toMatch(/pendingComponent:\s*\(\)\s*=>\s*null/);
    expect(src).toContain("<AppLoading fullscreen");
  });

  it("a tela do cliente tem erro e carregamento próprios", () => {
    const src = read("src/routes/_authenticated/customers.$customerId.tsx");
    expect(src).toContain("errorComponent: RouteError");
    expect(src).toContain("pendingComponent: () => <AppLoading");
  });

  it("o erro de rota tenta se recuperar uma única vez e oferece retry", () => {
    const src = read("src/components/route-error.tsx");
    expect(src).toContain("recovered.add(pathname)");
    expect(src).toContain("Tentar de novo");
    expect(src).toContain("Recarregar página");
  });
});
