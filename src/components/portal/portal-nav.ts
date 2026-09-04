import {
  Home,
  CheckSquare,
  CalendarDays,
  FolderOpen,
  FileText,
  Sparkles,
  Palette,
} from "lucide-react";

export type PortalTabId =
  | "home"
  | "approvals"
  | "pauta"
  | "calendar"
  | "briefing"
  | "files"
  | "brand";

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
];

export const PORTAL_TAB_LABEL: Record<PortalTabId, string> = PORTAL_TABS.reduce(
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
};

const SEGMENT = PORTAL_TABS.reduce(
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
  return PORTAL_TABS.find((t) => t.segment && t.segment === rest)?.id ?? "home";
}
