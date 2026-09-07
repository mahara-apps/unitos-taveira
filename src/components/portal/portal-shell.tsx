import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Bell } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
 * Arquivos, Mais). Desktop: barra superior enxuta com as mesmas abas e um menu
 * "Mais" para o excedente. A barra NUNCA rola horizontalmente.
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
  const pending = usePendingCount();
  const initials = (clientName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const showTitle = !SELF_TITLED.includes(activeTab);

  return (
    <div
      className="portal-root min-h-dvh text-foreground"
      style={{ ["--portal-accent" as string]: accent }}
    >
      {/* Cabeçalho: identidade + navegação (desktop) */}
      <header className="sticky top-0 z-30 border-b border-border bg-card">
        <div className="mx-auto flex min-h-16 max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <BrandMark
            clientName={clientName}
            logoUrl={logoUrl}
            accent={accent}
            initials={initials}
            footerLabel={footerLabel}
          />

          <nav aria-label="Navegação do portal" className="ml-4 hidden items-center gap-1 lg:flex">
            {primary.map((t) => (
              <TopTab
                key={t.id}
                item={t}
                active={activeTab === t.id}
                badge={t.id === "approvals" ? pending : 0}
              />
            ))}
            {more.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted">
                  <MoreHorizontal className="h-4 w-4" /> Mais
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {more.map((t) => {
                    const Icon = t.icon;
                    return (
                      <DropdownMenuItem key={t.id} asChild>
                        <PortalLink tab={t.id} current={activeTab === t.id}>
                          <span className="flex items-center gap-2">
                            <Icon className="h-4 w-4" /> {t.label}
                          </span>
                        </PortalLink>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* Avisos: atalho rápido no celular (a aba fica em "Mais"). */}
            {tabs.some((t) => t.id === "notifications") && (
              <PortalLink
                tab="notifications"
                aria-label="Avisos"
                className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground lg:hidden"
              >
                <Bell className="h-5 w-5" />
              </PortalLink>
            )}
            <div className="hidden items-center gap-2 lg:flex">{headerActions}</div>
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

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 sm:px-6 lg:pb-12 lg:pt-6">{children}</main>

      {/* Barra inferior fixa (celular) — 5 alvos de 44px+ */}
      <nav
        aria-label="Navegação do portal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
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

      <footer className="hidden border-t border-border px-4 py-6 text-center text-xs text-muted-foreground lg:block">
        {footerLabel}
      </footer>
    </div>
  );
}

function BrandMark({
  clientName,
  logoUrl,
  accent,
  initials,
  footerLabel,
}: {
  clientName: string;
  logoUrl?: string | null;
  accent: string;
  initials: string;
  footerLabel: string;
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
      <div className="min-w-0">
        <div className="truncate text-[15px] font-extrabold leading-tight">{clientName}</div>
        <div className="truncate text-[11.5px] font-semibold text-muted-foreground">
          {footerLabel || "Portal da marca"}
        </div>
      </div>
    </div>
  );
}

function TopTab({ item, active, badge }: { item: PortalNavItem; active: boolean; badge: number }) {
  const Icon = item.icon;
  return (
    <PortalLink
      tab={item.id}
      current={active}
      className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition-colors ${
        active
          ? "bg-accent text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4" /> {item.label}
      {badge > 0 ? (
        <span className="rounded-full bg-portal-waiting px-1.5 text-[10px] font-extrabold text-white">
          {badge}
        </span>
      ) : null}
    </PortalLink>
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
