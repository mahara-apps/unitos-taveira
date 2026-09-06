import type { ReactNode } from "react";
import { PortalLink, usePortalCaps, usePortalMode } from "./portal-context";
import {
  visiblePortalTabs,
  PORTAL_TAB_DESCRIPTION,
  PORTAL_TAB_LABEL,
  type PortalTabId,
} from "./portal-nav";

/**
 * SHELL ÚNICO do Portal do Cliente.
 *
 * O portal NÃO imita a UI interna da agência: aqui a navegação é uma barra
 * superior enxuta no desktop e uma barra inferior fixa (alvos grandes) no
 * mobile. Os dois modos (login e link por token) usam esta mesma casca; o que
 * muda por modo entra pelos slots (`headerActions`).
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

export function PortalShell({
  clientName,
  activeTab,
  accent,
  logoUrl,
  background,
  footerLabel,
  headerActions,
  children,
}: PortalShellProps) {
  const { readOnly } = usePortalCaps();
  const tabs = useVisiblePortalTabs();
  const initials = (clientName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="min-h-dvh bg-muted/30 text-foreground"
      style={{
        ["--portal-accent" as string]: accent,
        ...(background ? { ["--background" as string]: background } : {}),
      }}
    >
      {/* Barra superior: identidade + navegação (desktop) + ações do usuário */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={clientName}
                onError={(e) => {
                  // logo remota inválida/expirada: esconde em vez de exibir
                  // asset quebrado (as iniciais permanecem como fallback)
                  e.currentTarget.style.display = "none";
                }}
                className="h-10 w-10 shrink-0 rounded-xl border border-border bg-background object-contain p-1"
              />
            ) : (
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-primary-foreground"
                style={{ backgroundColor: accent }}
              >
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold leading-tight">{clientName}</div>
              <div className="truncate text-[11px] text-muted-foreground">
                {footerLabel || "Portal da marca"}
              </div>
            </div>
          </div>

          <nav
            aria-label="Navegação do portal"
            className="ml-4 hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex"
          >
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <PortalLink
                  key={t.id}
                  tab={t.id}
                  current={active}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {t.label}
                </PortalLink>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2">{headerActions}</div>
        </div>
      </header>

      {/* Cabeçalho da página */}
      <div className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {PORTAL_TAB_LABEL[activeTab]}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {PORTAL_TAB_DESCRIPTION[activeTab]}
          </p>
          {readOnly ? (
            <span className="mt-3 inline-flex w-fit rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
              Acesso de acompanhamento — decisões exigem login
            </span>
          ) : null}
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
        {children}
      </main>

      <footer className="hidden border-t border-border/60 px-4 py-6 text-center text-xs text-muted-foreground lg:block">
        {footerLabel}
      </footer>

      {/* Barra inferior fixa (mobile) — alvos grandes, rolagem horizontal */}
      <nav
        aria-label="Navegação do portal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="flex items-stretch gap-1 overflow-x-auto px-2 py-1.5">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <PortalLink
                key={t.id}
                tab={t.id}
                current={active}
                className={`flex min-h-14 min-w-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="whitespace-nowrap">{t.label}</span>
              </PortalLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
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
