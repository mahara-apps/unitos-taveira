import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Bell, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PortalLink, usePortalApi, usePortalCaps, usePortalMode } from "./portal-context";
import {
  visiblePortalTabs,
  splitPortalTabs,
  PORTAL_TAB_DESCRIPTION,
  PORTAL_TAB_LABEL,
  type PortalNavItem,
  type PortalTabId,
} from "./portal-nav";

/**
 * SHELL ÚNICO do Portal do Cliente — mobile-first.
 *
 * Celular: barra inferior fixa com 5 alvos (Início, Aprovar, Calendário,
 * Arquivos, Mais) — inalterada. Desktop: coluna lateral esquerda retrátil com
 * TODAS as áreas visíveis (sem menu "Mais"), estado lembrado no navegador.
 */
export type PortalShellProps = {
  clientName: string;
  activeTab: PortalTabId;
  accent: string;
  dark?: boolean;
  logoUrl?: string | null;
  background?: string | null;
  footerLabel: string;
  headerActions?: ReactNode;
  children: ReactNode;
};

/** Telas que já trazem o próprio cabeçalho de conteúdo. */
const SELF_TITLED: PortalTabId[] = ["home", "approvals"];

const COLLAPSE_KEY = "portal:nav-collapsed";

export function PortalShell({
  clientName,
  activeTab,
  accent,
  logoUrl,
  footerLabel,
  headerActions,
  children,
}: PortalShellProps) {
  const { readOnly } = usePortalCaps();
  const tabs = useVisiblePortalTabs();
  const { primary, more } = splitPortalTabs(tabs);
  const [moreOpen, setMoreOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pending = usePendingCount();
  const initials = (clientName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const showTitle = !SELF_TITLED.includes(activeTab);

  // Preferência do usuário — lida após a hidratação para não divergir do SSR.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage indisponível: mantém expandido */
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignora */
      }
      return next;
    });
  };

  return (
    <div
      className="portal-root min-h-dvh text-foreground"
      style={{ ["--portal-accent" as string]: accent }}
    >
      <div className="flex min-h-dvh">
        {/* NAVEGAÇÃO DESKTOP (>=900px) — coluna lateral retrátil */}
        <aside
          aria-label="Navegação do portal"
          className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card min-[900px]:flex ${
            collapsed ? "w-[76px]" : "w-[244px]"
          }`}
        >
          <div
            className={`flex min-h-16 items-center px-3 py-3 ${collapsed ? "justify-center" : ""}`}
          >
            <BrandMark
              clientName={clientName}
              logoUrl={logoUrl}
              accent={accent}
              initials={initials}
              footerLabel={footerLabel}
              compact={collapsed}
            />
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            <ul className="space-y-1">
              {primary.map((t) => (
                <li key={t.id}>
                  <SideTab
                    item={t}
                    active={activeTab === t.id}
                    badge={t.id === "approvals" ? pending : 0}
                    collapsed={collapsed}
                  />
                </li>
              ))}
              {more.length > 0 ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(true)}
                    aria-label="Mais áreas"
                    className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-[13px] font-bold transition-colors ${
                      more.some((t) => t.id === activeTab)
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    } ${collapsed ? "justify-center" : ""}`}
                  >
                    <MoreHorizontal className="h-[18px] w-[18px] shrink-0" />
                    {collapsed ? null : <span className="truncate">Mais</span>}
                  </button>
                </li>
              ) : null}
            </ul>
          </nav>

          <div className="space-y-2 border-t border-border p-2">
            {headerActions && !collapsed ? (
              <div className="flex flex-col gap-2 [&_button]:w-full [&>*]:w-full">
                {headerActions}
              </div>
            ) : null}
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
              className={`flex min-h-10 w-full items-center gap-2 rounded-xl px-2.5 text-[12.5px] font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground ${
                collapsed ? "justify-center" : ""
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4.5 w-4.5" />
              ) : (
                <>
                  <PanelLeftClose className="h-4.5 w-4.5" /> Recolher menu
                </>
              )}
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Cabeçalho enxuto: identidade no celular + ações */}
          <header className="sticky top-0 z-30 border-b border-border bg-card">
            <div className="mx-auto flex min-h-16 max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
              <div className="min-w-0 min-[900px]:hidden">
                <BrandMark
                  clientName={clientName}
                  logoUrl={logoUrl}
                  accent={accent}
                  initials={initials}
                  footerLabel={footerLabel}
                />
              </div>
              <div className="hidden min-w-0 min-[900px]:block">
                <div className="truncate text-[15px] font-extrabold leading-tight">
                  {PORTAL_TAB_LABEL[activeTab]}
                </div>
                <div className="truncate text-[11.5px] font-semibold text-muted-foreground">
                  {clientName}
                </div>
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* Avisos: atalho rápido no celular (a aba fica em "Mais"). */}
                {tabs.some((t) => t.id === "notifications") && (
                  <PortalLink
                    tab="notifications"
                    aria-label="Avisos"
                    className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground min-[900px]:hidden"
                  >
                    <Bell className="h-5 w-5" />
                  </PortalLink>
                )}
                {/* Expandido: ações ficam na base da lateral. Recolhido: no topo. */}
                {collapsed ? (
                  <div className="hidden items-center gap-2 min-[900px]:flex">{headerActions}</div>
                ) : null}
              </div>
            </div>
          </header>

          {/* Cabeçalho da página (telas secundárias) */}
          {showTitle ? (
            <div className="border-b border-border bg-card">
              <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
                <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
                  {PORTAL_TAB_LABEL[activeTab]}
                </h1>
                <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
                  {PORTAL_TAB_DESCRIPTION[activeTab]}
                </p>
                {readOnly ? (
                  <span className="mt-3 inline-flex w-fit rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                    Acesso de acompanhamento — decisões exigem login
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 sm:px-6 min-[900px]:pb-12 min-[900px]:pt-6">
            {children}
          </main>

          <footer className="mt-auto hidden border-t border-border px-4 py-6 text-center text-xs text-muted-foreground min-[900px]:block">
            {footerLabel}
          </footer>
        </div>
      </div>

      {/* Barra inferior fixa (celular) — 5 alvos de 44px+ */}
      <nav
        aria-label="Navegação do portal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] min-[900px]:hidden"
      >
        <div className="mx-auto flex max-w-md items-stretch px-1.5 py-1.5">
          {primary.map((t) => (
            <BottomTab
              key={t.id}
              item={t}
              active={activeTab === t.id}
              badge={t.id === "approvals" ? pending : 0}
            />
          ))}
          {more.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label="Mais opções"
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10.5px] font-bold ${
                more.some((t) => t.id === activeTab) ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <MoreHorizontal className="h-[22px] w-[22px]" />
              Mais
            </button>
          )}
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="text-left">
            <SheetTitle>Mais</SheetTitle>
          </SheetHeader>
          <div className="mt-3 grid gap-1.5">
            {more.map((t) => {
              const Icon = t.icon;
              return (
                <PortalLink
                  key={t.id}
                  tab={t.id}
                  current={activeTab === t.id}
                  className={`flex min-h-[52px] items-center gap-3 rounded-xl px-3 text-sm font-bold ${
                    activeTab === t.id ? "bg-accent text-accent-foreground" : "bg-muted/60"
                  }`}
                >
                  <Icon className="h-5 w-5" /> {t.label}
                </PortalLink>
              );
            })}
            {headerActions ? (
              <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
                {headerActions}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BrandMark({
  clientName,
  logoUrl,
  accent,
  initials,
  footerLabel,
  compact,
}: {
  clientName: string;
  logoUrl?: string | null;
  accent: string;
  initials: string;
  footerLabel: string;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={clientName}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
          className="h-10 w-10 shrink-0 rounded-xl border border-border bg-card object-contain p-1"
        />
      ) : (
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-[13px] font-extrabold text-white"
          style={{ backgroundColor: accent }}
        >
          {initials}
        </div>
      )}
      {compact ? null : (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-extrabold leading-tight">{clientName}</div>
          <div className="truncate text-[11.5px] font-semibold text-muted-foreground">
            {footerLabel || "Portal da marca"}
          </div>
        </div>
      )}
    </div>
  );
}

function SideTab({
  item,
  active,
  badge,
  collapsed,
}: {
  item: PortalNavItem;
  active: boolean;
  badge: number;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  const link = (
    <PortalLink
      tab={item.id}
      current={active}
      aria-label={collapsed ? item.label : undefined}
      className={`relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-[13.5px] font-bold transition-colors ${
        collapsed ? "justify-center px-0" : ""
      } ${
        active
          ? "bg-accent text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-[19px] w-[19px] shrink-0" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
      {badge > 0 ? (
        <span
          className={`grid h-[18px] min-w-[18px] place-items-center rounded-full bg-portal-waiting px-1 text-[10px] font-extrabold text-white ${
            collapsed ? "absolute right-2 top-1.5" : "ml-auto"
          }`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </PortalLink>
  );
  if (!collapsed) return link;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function BottomTab({
  item,
  active,
  badge,
}: {
  item: PortalNavItem;
  active: boolean;
  badge: number;
}) {
  const Icon = item.icon;
  const label = item.id === "approvals" ? "Aprovar" : item.label;
  return (
    <PortalLink
      tab={item.id}
      current={active}
      className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10.5px] font-bold ${
        active ? "text-primary" : "text-muted-foreground"
      }`}
    >
      <Icon className="h-[22px] w-[22px]" />
      <span className="whitespace-nowrap">{label}</span>
      {badge > 0 ? (
        <span className="absolute right-[calc(50%-22px)] top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-card bg-destructive px-1 text-[10px] font-extrabold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </PortalLink>
  );
}

/** Pendências do cliente — alimenta o badge de "Aprovar". */
function usePendingCount(): number {
  const api = usePortalApi();
  const q = useQuery({
    queryKey: ["portal", "metrics", api.scopeKey],
    queryFn: () => api.metrics(),
    staleTime: 30_000,
  });
  return q.data?.pending ?? 0;
}

/**
 * Abas visíveis = matriz de permissões do cliente.
 * "Início" é sempre visível; Avisos/Minha conta existem só com login.
 */
function useVisiblePortalTabs() {
  const { permissions } = usePortalCaps();
  const mode = usePortalMode();
  return visiblePortalTabs(permissions, mode.kind === "session");
}
