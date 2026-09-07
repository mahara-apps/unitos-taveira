import {
  Home,
  CheckSquare,
  CalendarDays,
  FolderOpen,
  FileText,
  Sparkles,
  Palette,
  Inbox,
  Bell,
  UserCircle,
} from "lucide-react";

export type PortalTabId =
  | "home"
  | "approvals"
  | "pauta"
  | "calendar"
  | "briefing"
  | "files"
  | "brand"
  | "requests"
  | "notifications"
  | "account";

/**
 * FASE 1 — FONTE ÚNICA de navegação do Portal do Cliente.
 *
 * Ordem, rótulos, ícones e os paths dos dois modos (login e link por token)
 * vivem aqui. Nenhum shell/tela declara navegação própria.
 */
export const PORTAL_TABS: Array<{
  id: PortalTabId;
  label: string;
  icon: typeof Home;
  /** Sufixo do path em ambos os modos ("" = raiz da área). */
  segment: string;
}> = [
  { id: "home", label: "Início", icon: Home, segment: "" },
  { id: "approvals", label: "Aprovações", icon: CheckSquare, segment: "aprovacoes" },
  { id: "pauta", label: "Pauta", icon: Sparkles, segment: "pauta" },
  { id: "calendar", label: "Calendário", icon: CalendarDays, segment: "calendario" },
  { id: "briefing", label: "Briefing", icon: FileText, segment: "briefing" },
  { id: "files", label: "Arquivos", icon: FolderOpen, segment: "arquivos" },
  { id: "brand", label: "Minha Marca", icon: Palette, segment: "minha-marca" },
  { id: "requests", label: "Pedidos", icon: Inbox, segment: "pedidos" },
];

/**
 * Abas de conta (só no modo LOGIN): ficam fora da navegação principal e são
 * acessadas pelo header — link sem senha não tem conta nem avisos.
 */
export const PORTAL_ACCOUNT_TABS: Array<{
  id: PortalTabId;
  label: string;
  icon: typeof Home;
  segment: string;
}> = [
  { id: "notifications", label: "Avisos", icon: Bell, segment: "avisos" },
  { id: "account", label: "Minha conta", icon: UserCircle, segment: "conta" },
];

const ALL_TABS = [...PORTAL_TABS, ...PORTAL_ACCOUNT_TABS];

export const PORTAL_TAB_LABEL: Record<PortalTabId, string> = ALL_TABS.reduce(
  (acc, t) => ({ ...acc, [t.id]: t.label }),
  {} as Record<PortalTabId, string>,
);

export const PORTAL_TAB_DESCRIPTION: Record<PortalTabId, string> = {
  home: "Seu resumo, próximos passos e prazos em um só lugar.",
  approvals: "Revise conteúdos e registre suas decisões com segurança.",
  pauta: "Acompanhe e aprove o planejamento de conteúdo do mês.",
  calendar: "Veja publicações, compromissos e datas importantes.",
  briefing: "Responda solicitações e acompanhe a revisão da equipe.",
  files: "Acesse os documentos liberados para sua marca.",
  brand: "Consulte as informações que orientam a criação da sua marca.",
  requests: "Peça novos materiais e acompanhe cada solicitação.",
  notifications: "Tudo o que precisa da sua atenção, em ordem.",
  account: "Seus dados de acesso, foto e preferências de aviso.",
};

const SEGMENT = ALL_TABS.reduce(
  (acc, t) => ({ ...acc, [t.id]: t.segment }),
  {} as Record<PortalTabId, string>,
);

/** Path da aba no modo LOGIN. */
export function sessionTabPath(tab: PortalTabId): string {
  return SEGMENT[tab] ? `/area/${SEGMENT[tab]}` : "/area/inicio";
}

/** Path da aba no modo TOKEN (com `$token` literal, para `<Link params>`). */
export function tokenTabRoute(tab: PortalTabId): string {
  return SEGMENT[tab] ? `/portal/$token/${SEGMENT[tab]}` : "/portal/$token/";
}

/** Aba ativa a partir do pathname, nos dois modos. */
export function activePortalTab(pathname: string, base: string): PortalTabId {
  const rest = pathname.startsWith(base) ? pathname.slice(base.length).replace(/^\/|\/$/g, "") : "";
  if (rest === "inicio") return "home";
  return ALL_TABS.find((t) => t.segment && t.segment === rest)?.id ?? "home";
}
