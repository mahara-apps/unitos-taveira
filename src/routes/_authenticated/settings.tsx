import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  History,
  KeyRound,
  ListChecks,
  Loader2,
  Lock,
  Palette,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";

import { useAccessRole } from "@/hooks/use-access-role";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsLayout,
});

type TabDef = {
  to: string;
  label: string;
  icon: typeof User;
  /** true = exige poder administrar a marca (owner/manager/super admin). */
  admin: boolean;
};

type TabGroup = { label: string; tabs: TabDef[] };

/**
 * Configurações organizadas por ESCOPO do dado:
 * - Conta: preferências do usuário logado;
 * - Workspace: dados da marca (identidade, acesso, operação, auditoria);
 * - IA: governança de consumo (provedores/modelos vivem em Integrações → IA).
 */
const GROUPS: TabGroup[] = [
  {
    label: "Minha conta",
    tabs: [
      { to: "/settings/profile", label: "Perfil", icon: User, admin: false },
      { to: "/settings/notifications", label: "Notificações", icon: Bell, admin: false },
    ],
  },
  {
    label: "Workspace",
    tabs: [
      { to: "/settings/identity", label: "Agência", icon: Palette, admin: true },
      { to: "/settings/team", label: "Equipe & Acesso", icon: Users, admin: true },
      { to: "/settings/permissions", label: "Permissões", icon: ShieldCheck, admin: true },
      {
        to: "/settings/work-statuses",
        label: "Status de trabalho",
        icon: ListChecks,
        admin: true,
      },
      { to: "/settings/access-log", label: "Acessos", icon: KeyRound, admin: true },
      { to: "/settings/logs", label: "Auditoria", icon: History, admin: true },
    ],
  },
];

const ALL_TABS = GROUPS.flatMap((g) => g.tabs);

function SettingsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { role, isReady } = useAccessRole();
  const isAdmin = role === "admin";

  const currentTab = ALL_TABS.find((t) => pathname === t.to || pathname.startsWith(t.to + "/"));
  const blocked = !!currentTab?.admin && isReady && !isAdmin;

  return (
    <div className="flex min-h-full flex-col">
      <nav className="sticky top-14 z-20 flex flex-wrap items-center gap-x-1 gap-y-1 overflow-x-auto border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur">
        {GROUPS.map((group) => {
          const tabs = group.tabs.filter((t) => !t.admin || isAdmin);
          if (tabs.length === 0) return null;
          return (
            <div key={group.label} className="flex items-center gap-1">
              <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </span>
              {tabs.map((t) => {
                const active = pathname === t.to || pathname.startsWith(t.to + "/");
                return (
                  <Link
                    key={t.to}
                    to={t.to}
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                    {t.label}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {!isReady && currentTab?.admin ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : blocked ? (
        <div className="mx-auto w-full max-w-2xl p-6">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <Lock className="h-6 w-6 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">Acesso restrito</p>
                <p className="text-sm text-muted-foreground">
                  Esta configuração é administrada por owners e managers da marca. Fale com quem
                  administra o workspace se precisar de acesso.
                </p>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/profile">Ir para meu perfil</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}
