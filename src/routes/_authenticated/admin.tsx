import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Boxes, Info, Palette, Plug, RefreshCw, Server, ShieldAlert } from "lucide-react";

import { useIsSuperAdmin } from "@/hooks/use-feature-access";
import { useActiveContextOptional } from "@/hooks/use-active-context";
import { useBrandName } from "@/hooks/use-brand-name";
import { usePageHeader } from "@/hooks/use-page-header";
import { AppLoading } from "@/components/app-loading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveAdminAccessState } from "@/lib/admin-access-state";
import { cn } from "@/lib/utils";

/**
 * Administração do ambiente — área exclusiva de Super Admin dentro do próprio
 * cliente/marca. O bloqueio real está no servidor: cada server function da área
 * revalida Super Admin; este gate no componente é apenas UX e não lança redirects
 * durante o estado pendente do roteador.
 */
export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const TABS = [
  { to: "/admin/recursos", label: "Recursos", icon: Boxes },
  { to: "/admin/identidade", label: "Identidade", icon: Palette },
  { to: "/admin/meta", label: "App Meta", icon: Plug },
  { to: "/admin/instalacoes", label: "Instalações", icon: Server },
  { to: "/admin/ambiente", label: "Informações do ambiente", icon: Info },
] as const;

function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { brandId } = useActiveContextOptional();
  const brandName = useBrandName(brandId);
  const superAdminQuery = useIsSuperAdmin();
  const accessState = resolveAdminAccessState({
    isPending: superAdminQuery.isPending,
    isError: superAdminQuery.isError,
    isSuperAdmin: superAdminQuery.data?.isSuperAdmin,
  });

  usePageHeader(
    {
      title: brandName ? `Administração — ${brandName}` : "Administração",
      subtitle: "Configure recursos, funcionalidades e identidade disponíveis neste ambiente.",
    },
    [brandName],
  );

  useEffect(() => {
    if (accessState !== "denied") return;
    void navigate({ to: "/dashboard", replace: true });
  }, [accessState, navigate]);

  if (accessState === "loading" || accessState === "denied") {
    return <AppLoading label={accessState === "denied" ? "Redirecionando…" : "Validando acesso…"} />;
  }

  if (accessState === "error") {
    return (
      <div className="mx-auto w-full max-w-xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Não foi possível validar seu acesso</CardTitle>
            <CardDescription>
              Sua sessão pode ter sido atualizada. Tente novamente sem recarregar toda a página.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={() => void superAdminQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Tentar novamente
            </Button>
            <Button asChild variant="outline">
              <Link to="/dashboard">Voltar ao painel</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!brandId) {
    return (
      <div className="mx-auto w-full max-w-6xl p-6">
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            Selecione um workspace no menu lateral para administrar o ambiente.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 p-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
        <ShieldAlert className="h-4 w-4 text-destructive" />
        <span className="text-sm text-destructive">Área restrita — Super Admin</span>
        <Badge variant="outline" className="ml-auto border-destructive/40 text-destructive">
          {brandName ?? "ambiente atual"}
        </Badge>
      </div>

      <nav className="flex flex-wrap gap-1.5" aria-label="Administração do ambiente">
        {TABS.map((t) => {
          const active = pathname === t.to || pathname.startsWith(t.to + "/");
          return (
            <Button
              key={t.to}
              asChild
              size="sm"
              variant={active ? "secondary" : "ghost"}
              className={cn("h-9", active && "font-semibold")}
            >
              <Link to={t.to} aria-current={active ? "page" : undefined}>
                <t.icon className="mr-2 h-4 w-4" />
                {t.label}
              </Link>
            </Button>
          );
        })}
      </nav>

      <Outlet />
    </div>
  );
}
