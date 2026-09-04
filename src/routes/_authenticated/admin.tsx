import { createFileRoute, Link, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { Boxes, Info, Palette, Plug, Server, ShieldAlert } from "lucide-react";

import { amISuperAdmin } from "@/lib/feature-flags.functions";
import { useActiveContextOptional } from "@/hooks/use-active-context";
import { useBrandName } from "@/hooks/use-brand-name";
import { usePageHeader } from "@/hooks/use-page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Administração do ambiente — área exclusiva de Super Admin dentro do próprio
 * cliente/marca. O bloqueio real está no servidor: cada server function da área
 * revalida Super Admin; este `beforeLoad` é só UX.
 */
export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: async () => {
    // O token de sessão só é anexado no cliente; durante SSR/prerender a
    // chamada protegida falharia com 401. O bloqueio real é no servidor.
    if (typeof window === "undefined") return;
    // FAIL-CLOSED: qualquer falha na verificação nega o acesso. Um erro de
    // rede/401 transitório NÃO pode liberar a área de Super Admin.
    let isSuperAdmin = false;
    try {
      ({ isSuperAdmin } = await amISuperAdmin());
    } catch {
      isSuperAdmin = false;
    }
    if (!isSuperAdmin) throw redirect({ to: "/dashboard" });
  },

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
  const { brandId } = useActiveContextOptional();
  const brandName = useBrandName(brandId);

  usePageHeader(
    {
      title: brandName ? `Administração — ${brandName}` : "Administração",
      subtitle: "Configure recursos, funcionalidades e identidade disponíveis neste ambiente.",
    },
    [brandName],
  );

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
