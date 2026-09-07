import type { ReactNode } from "react";
import { PortalLink, usePortalCaps, usePortalMode } from "./portal-context";
import { portalCanView } from "@/lib/portal-permissions";
import {
  PORTAL_ACCOUNT_TABS,
  PORTAL_TABS,
  PORTAL_TAB_DESCRIPTION,
  PORTAL_TAB_LABEL,
  type PortalTabId,
} from "./portal-nav";

/**
 * FASE 1 — SHELL ÚNICO do Portal do Cliente.
 *
 * Os dois modos (login e link por token) renderizam exatamente esta casca:
 * sidebar no desktop, navegação horizontal no mobile e cabeçalho com o nome da
 * aba ativa. O que muda por modo entra pelos slots (`headerActions`, `footer`).
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
  dark,
  logoUrl,
  background,
  footerLabel,
  headerActions,
  children,
}: PortalShellProps) {
  const { readOnly } = usePortalCaps();
  const initials = (clientName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="min-h-dvh bg-background text-foreground"
      style={{
        ["--portal-accent" as string]: accent,
        ...(background ? { ["--background" as string]: background, background } : {}),
      }}
    >
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
          <div className="flex items-center gap-3 border-b border-border px-5 py-6">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={clientName}
                onError={(e) => {
                  // logo remota inválida/expirada: esconde a imagem em vez de
                  // exibir asset quebrado (as iniciais do cliente permanecem)
                  e.currentTarget.style.display = "none";
                }}
                className="h-11 w-11 shrink-0 rounded-lg border border-border bg-background object-contain p-1"
              />
            ) : (
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-primary-foreground"
                style={{ backgroundColor: accent }}
              >
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{clientName}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">Portal da marca</div>
            </div>
          </div>

          <PortalNavList activeTab={activeTab} />

          <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
            {footerLabel}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <nav
            aria-label="Navegação do portal"
            className="sticky top-0 z-20 flex items-center gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 shadow-sm lg:hidden"
          >
            <PortalNavList activeTab={activeTab} compact />
          </nav>

          <header className="border-b border-border bg-background px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="mb-2 text-xs font-medium text-muted-foreground">{clientName}</div>
                <h1 className="truncate text-2xl font-semibold">{PORTAL_TAB_LABEL[activeTab]}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {PORTAL_TAB_DESCRIPTION[activeTab]}
                </p>
              </div>
              {readOnly ? (
                <span className="w-fit rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
                  Acesso de acompanhamento — decisões exigem login
                </span>
              ) : null}
              {headerActions ? (
                <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
              ) : null}
            </div>
          </header>

          <main className="flex-1 bg-muted/20 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
            <div className="mx-auto max-w-7xl">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

function PortalNavList({ activeTab, compact }: { activeTab: PortalTabId; compact?: boolean }) {
  const { permissions } = usePortalCaps();
  const mode = usePortalMode();
  const isSession = mode.kind === "session";
  // "Início" é sempre visível; os demais seguem a permissão do cliente.
  // Pedidos, Avisos e Minha conta existem SOMENTE no acesso com login.
  const tabs = [...PORTAL_TABS, ...(isSession ? PORTAL_ACCOUNT_TABS : [])].filter(
    (t) =>
      t.id === "home" ||
      ((isSession || t.id !== "requests") &&
        (t.id === "notifications" || t.id === "account"
          ? isSession
          : portalCanView(permissions, t.id as never))),
  );
  if (compact) {
    return (
      <>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <PortalLink
              key={t.id}
              tab={t.id}
              current={active}
              className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </PortalLink>
          );
        })}
      </>
    );
  }
  return (
    <nav aria-label="Navegação do portal" className="flex-1 space-y-1 px-3 py-5">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = activeTab === t.id;
        return (
          <PortalLink
            key={t.id}
            tab={t.id}
            current={active}
            className={`relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className={`h-4 w-4 ${active ? "" : "text-muted-foreground/70"}`} />
            <span className="truncate">{t.label}</span>
          </PortalLink>
        );
      })}
    </nav>
  );
}
