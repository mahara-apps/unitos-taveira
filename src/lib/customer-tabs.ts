/**
 * Fonte ÚNICA de verdade da navegação do Painel do Cliente.
 *
 * Tudo que descreve as abas (valor, label, ordem), os aliases legados e o
 * caminho canônico vive aqui. Nenhum outro arquivo deve declarar mapas de
 * abas do cliente — importe daqui.
 */

export const CUSTOMER_TABS = [
  { value: "overview", label: "Visão geral" },
  { value: "conta", label: "Conta" },
  { value: "briefing", label: "Briefing" },
  { value: "pauta", label: "Pauta" },
  { value: "trabalho", label: "Trabalho" },
  { value: "publicacoes", label: "Publicações" },
] as const;

export type CustomerTab = (typeof CUSTOMER_TABS)[number]["value"];

export const CUSTOMER_TAB_VALUES = CUSTOMER_TABS.map((t) => t.value) as CustomerTab[];

/**
 * Aliases legados: links internos e URLs compartilhadas antes da consolidação
 * em 6 abas. Cada alias aponta para a aba que hoje é a ÚNICA implementação
 * daquele conteúdo (não existem duas telas para o mesmo objetivo).
 */
export const CUSTOMER_TAB_ALIASES = {
  cadastro: "conta", // cadastro do cliente → seção de identidade da aba Conta
  gestao: "conta", // gestão da conta → seção de contrato/jornada da aba Conta
  estrategia: "briefing", // Estratégia IA vive junto do briefing que a gera
  producao: "trabalho", // produção/volumetria virou bloco da aba Trabalho
  channels: "publicacoes", // canais são os destinos das publicações
} as const satisfies Record<string, CustomerTab>;

export type CustomerTabAlias = keyof typeof CUSTOMER_TAB_ALIASES;

/** Valores aceitos em `?tab=` (canônicos + aliases legados). */
export const CUSTOMER_TAB_SEARCH_VALUES = [
  ...CUSTOMER_TAB_VALUES,
  ...(Object.keys(CUSTOMER_TAB_ALIASES) as CustomerTabAlias[]),
] as [string, ...string[]];

export const isCustomerTab = (v?: string | null): v is CustomerTab =>
  !!v && (CUSTOMER_TAB_VALUES as string[]).includes(v);

export const isCustomerTabAlias = (v?: string | null): v is CustomerTabAlias =>
  !!v && v in CUSTOMER_TAB_ALIASES;

/** Normaliza qualquer valor de `?tab=` para uma das 6 abas canônicas. */
export function resolveCustomerTab(tab?: string | null): CustomerTab {
  if (isCustomerTabAlias(tab)) return CUSTOMER_TAB_ALIASES[tab];
  if (isCustomerTab(tab)) return tab;
  return "overview";
}

export function customerTabLabel(tab?: string | null): string {
  const value = resolveCustomerTab(tab);
  return CUSTOMER_TABS.find((t) => t.value === value)?.label ?? "Visão geral";
}

/** Rota canônica do painel — usada por links e breadcrumbs do cliente. */
export const CUSTOMER_PANEL_ROUTE = "/customers/$customerId" as const;

/** Opções de navegação prontas para `<Link>` / `navigate()`. */
export function customerPanelLink(customerId: string, tab?: string | null) {
  return {
    to: CUSTOMER_PANEL_ROUTE,
    params: { customerId },
    search: { tab: resolveCustomerTab(tab) },
  };
}

/** Breadcrumb do cliente derivado da mesma fonte das abas. */
export function customerBreadcrumbs(
  customerId: string,
  customerName: string | null | undefined,
  tab?: string | null,
) {
  return [
    { label: "Clientes", to: "/customers" as const },
    { label: customerName?.trim() || "Cliente", ...customerPanelLink(customerId, "overview") },
    { label: customerTabLabel(tab) },
  ];
}
