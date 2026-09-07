import { describe, expect, it } from "vitest";
import {
  CUSTOMER_TABS,
  CUSTOMER_TAB_ALIASES,
  CUSTOMER_TAB_SEARCH_VALUES,
  customerBreadcrumbs,
  customerPanelLink,
  customerTabLabel,
  isCustomerTab,
  isCustomerTabAlias,
  resolveCustomerTab,
} from "@/lib/customer-tabs";

const CID = "11111111-1111-1111-1111-111111111111";

describe("customer panel tabs (fonte única)", () => {
  it("expõe exatamente as abas canônicas na ordem alvo", () => {
    expect(CUSTOMER_TABS.map((t) => t.value)).toEqual([
      "overview",
      "conta",
      "briefing",
      "pauta",
      "trabalho",
      "publicacoes",
      "area-cliente",
    ]);
  });

  it("aponta links antigos de pedidos para a Área do cliente", () => {
    expect(resolveCustomerTab("pedidos")).toBe("area-cliente");
    expect(resolveCustomerTab("requests")).toBe("area-cliente");
  });


  it("resolve todos os aliases legados para uma aba canônica", () => {
    for (const [alias, target] of Object.entries(CUSTOMER_TAB_ALIASES)) {
      expect(isCustomerTabAlias(alias)).toBe(true);
      expect(isCustomerTab(alias)).toBe(false);
      expect(resolveCustomerTab(alias)).toBe(target);
    }
  });

  it("cai para 'overview' com valores ausentes ou inválidos", () => {
    expect(resolveCustomerTab(undefined)).toBe("overview");
    expect(resolveCustomerTab(null)).toBe("overview");
    expect(resolveCustomerTab("nao-existe")).toBe("overview");
  });

  it("aceita em ?tab= apenas canônicas + aliases", () => {
    expect(new Set(CUSTOMER_TAB_SEARCH_VALUES)).toEqual(
      new Set([...CUSTOMER_TABS.map((t) => t.value), ...Object.keys(CUSTOMER_TAB_ALIASES)]),
    );
  });

  it("gera link e breadcrumb canônicos do painel", () => {
    expect(customerPanelLink(CID, "gestao")).toEqual({
      to: "/customers/$customerId",
      params: { customerId: CID },
      search: { tab: "conta" },
    });
    expect(customerTabLabel("producao")).toBe("Trabalho");
    const crumbs = customerBreadcrumbs(CID, "Café Aurora", "channels");
    expect(crumbs.map((c) => c.label)).toEqual(["Clientes", "Café Aurora", "Publicações"]);
  });
});
