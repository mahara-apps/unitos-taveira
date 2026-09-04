import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActiveContextProvider, useActiveContext } from "@/hooks/use-active-context";
import { PageHeaderProvider, usePageHeaderState } from "@/hooks/use-page-header";
import { CommandMenu } from "@/components/command-menu";
import { Command } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationsBell } from "@/components/notifications/notifications-drawer";
import { MandatoryPasswordReset } from "@/components/auth/mandatory-password-reset";
import { AiJobsProvider } from "@/components/ai-jobs/ai-jobs-provider";
import { AiJobsIndicator } from "@/components/ai-jobs/ai-jobs-indicator";
import { BrandFavicon } from "@/components/brand/brand-favicon";
import { getCachedUser } from "@/lib/auth-cache";
import { getCachedPortalAccess } from "@/lib/access-cache";
import { isWorkspaceScopedQueryKey, queryKeyCarriesScopeId } from "@/lib/session-reset";
import { WorkspaceResolver } from "@/components/workspace-resolver";

const fallbackTitles: Record<string, string> = {
  "/dashboard": "Painel",
  "/content": "Conteúdo",
  "/calendar": "Calendário",
  "/tasks": "Tarefas",
  "/projects": "Projetos",
  "/customers": "Clientes",
  "/agents": "Cérebro de Agentes",
  "/connections": "Conexões",
  "/settings/profile": "Perfil",
  "/settings/notifications": "Notificações",
  "/settings/identity": "Agência",
  "/settings/team": "Equipe & Acesso",
  "/settings/permissions": "Permissões",
  "/settings/logs": "Auditoria",
  "/settings": "Configurações",
  "/analytics": "Análises",
  "/notifications": "Notificações",
};

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  // O servidor não executa o gate desta subárvore. Evitar serializar o
  // skeleton global no HTML impede mismatch quando o cliente redireciona uma
  // sessão ausente diretamente para /login durante a hidratação.
  pendingComponent: () => null,
  beforeLoad: async ({ location }) => {
    // Usuário e escopo de portal vêm de cache deduplicado: o gate roda em toda
    // navegação e sem cache pagava 2 roundtrips seriais antes de renderizar.
    const [user, access] = await Promise.all([getCachedUser(), getCachedPortalAccess()]);
    if (!user) {
      await supabase.auth.signOut().catch(() => null);
      const next =
        location.href.startsWith("/") && !location.href.startsWith("/login")
          ? location.href
          : "/dashboard";
      throw redirect({ to: "/login", search: { next } });
    }
    // Cliente final (client_members.role = 'portal_client') sem vínculo de
    // equipe não entra na UI interna — vai para a área do portal.
    if (access && access.isPortalUser && !access.isTeamMember) {
      throw redirect({ to: "/area/inicio" });
    }
    return { user };
  },

  component: AppShell,
});

/**
 * Troca de workspace: as chaves de query já carregam `brandId`/`clientId`, então
 * o cache é naturalmente isolado e pode ser reutilizado ao voltar. Aqui apenas
 * descartamos as queries de escopo cuja chave NÃO carrega o workspace ativo —
 * remover tudo derrubava também as queries do NOVO workspace que já iniciaram
 * neste mesmo commit, causando refetch em cascata e travando a troca.
 */
function WorkspaceQueryReset() {
  const { brandId, clientId } = useActiveContext();
  const queryClient = useQueryClient();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = brandId;
    if (!before || !brandId || before === brandId) return;
    queryClient.removeQueries({
      predicate: (q) =>
        isWorkspaceScopedQueryKey(q.queryKey) &&
        !queryKeyCarriesScopeId(q.queryKey, [brandId, clientId]),
    });
  }, [brandId, clientId, queryClient]);
  return null;
}


function AppShell() {
  return (
    <ActiveContextProvider>
      <WorkspaceResolver />
      <WorkspaceQueryReset />

      <PageHeaderProvider>
        <AiJobsProvider>
          <SidebarProvider>
            <div className="flex min-h-screen w-full bg-background">
              <AppSidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <ShellHeader />
                <main className="min-w-0 flex-1">
                  <Outlet />
                </main>
              </div>
            </div>
            <CommandMenu />
            <MandatoryPasswordReset />
            <BrandFavicon />
          </SidebarProvider>
        </AiJobsProvider>
      </PageHeaderProvider>
    </ActiveContextProvider>
  );
}

function ShellHeader() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { title, subtitle, actions } = usePageHeaderState();
  const resolvedTitle = title ?? fallbackTitles[pathname] ?? "Unitos";
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold">{resolvedTitle}</span>
          {subtitle ? (
            <span className="truncate text-[11px] text-muted-foreground">{subtitle}</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-xs text-muted-foreground"
          onClick={() => {
            const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true });
            document.dispatchEvent(ev);
          }}
        >
          <Command className="h-3 w-3" /> Buscar
          <kbd className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </Button>
        {actions}
        <AiJobsIndicator />
        <NotificationsBell />
        <ThemeToggle />
      </div>
    </header>
  );
}
