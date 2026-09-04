import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listMyPortalClientsFn, resolvePortalSessionFn } from "@/lib/portal-session.functions";
import { FullScreenLoader, PortalAccessError } from "@/components/portal/portal-shared";
import { PortalModeProvider } from "@/components/portal/portal-context";
import { PortalShell } from "@/components/portal/portal-shell";
import { activePortalTab } from "@/components/portal/portal-nav";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

/**
 * Portal por login — usa o SHELL ÚNICO (`PortalShell`) e a navegação única
 * (`portal-nav`). A diferença do modo token fica isolada em `PortalModeProvider`.
 *
 * TENANCY: o cliente do contexto vem do search param `?cliente=<uuid>` e é a
 * ÚNICA fonte de verdade das consultas. Nunca há fallback para "primeiro
 * cliente" ou "último cliente visto": se o id não pertencer ao usuário, o
 * portal falha explicitamente.
 */
export const Route = createFileRoute("/_portal/area")({
  validateSearch: (search: Record<string, unknown>): { cliente?: string } =>
    typeof search["cliente"] === "string" ? { cliente: search["cliente"] as string } : {},
  component: PortalAreaLayout,
});

const STORAGE_KEY = "portal.session.clientId";

function PortalAreaLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { cliente } = Route.useSearch();
  const navigate = useNavigate();
  const resolve = useServerFn(resolvePortalSessionFn);
  const listClients = useServerFn(listMyPortalClientsFn);

  const pickClient = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    void navigate({ to: ".", search: { cliente: id }, replace: true });
  };

  const linksQ = useQuery({
    queryKey: ["portal", "my-clients"],
    queryFn: () => listClients(),
    staleTime: 5 * 60_000,
  });

  const links = linksQ.data ?? [];
  const allowed = cliente ? links.some((l) => l.client_id === cliente) : false;

  // Sem cliente na URL: só resolve automaticamente quando é inequívoco
  // (um único vínculo, ou o último escolhido ainda válido).
  useEffect(() => {
    if (cliente || !linksQ.data) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    const validSaved = linksQ.data.some((l) => l.client_id === saved) ? saved : null;
    const only = linksQ.data.length === 1 ? linksQ.data[0]!.client_id : null;
    const next = validSaved ?? only;
    if (next) void navigate({ to: ".", search: { cliente: next }, replace: true });
  }, [cliente, linksQ.data, navigate]);

  const sessionQ = useQuery({
    queryKey: ["portal", "session", cliente],
    queryFn: () => resolve({ data: { clientId: cliente! } }),
    enabled: Boolean(cliente) && allowed,
    retry: 1,
    staleTime: 60_000,
  });

  if (linksQ.isLoading) return <FullScreenLoader />;
  if (linksQ.isError)
    return (
      <PortalAccessError
        mode="session"
        message={(linksQ.error as Error)?.message}
        onRetry={() => void linksQ.refetch()}
      />
    );

  if (!links.length) return <PortalAccessError mode="session" message="portal_no_client_access" />;

  // Cliente informado que não pertence ao usuário → erro explícito de contexto.
  if (cliente && !allowed)
    return (
      <PortalAccessError
        mode="session"
        message="portal_client_context_invalid"
        onRetry={() => void linksQ.refetch()}
      />
    );

  if (!cliente)
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-muted/30 p-6">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Escolha a marca</h1>
            <p className="text-sm text-muted-foreground">
              Você tem acesso a mais de uma marca. Selecione qual deseja acompanhar.
            </p>
          </div>
          <Select onValueChange={pickClient}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue placeholder="Selecionar marca" />
            </SelectTrigger>
            <SelectContent>
              {links.map((l) => (
                <SelectItem key={l.client_id} value={l.client_id}>
                  {l.client_name ?? "Cliente"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );

  if (sessionQ.isLoading) return <FullScreenLoader />;
  if (sessionQ.isError)
    return (
      <PortalAccessError
        mode="session"
        message={(sessionQ.error as Error)?.message}
        onRetry={() => void sessionQ.refetch()}
      />
    );
  if (!sessionQ.data?.client)
    return (
      <PortalAccessError
        mode="session"
        message={sessionQ.data?.error}
        onRetry={() => void sessionQ.refetch()}
      />
    );

  const client = sessionQ.data.client;
  const brand = sessionQ.data.brand;
  const theme = sessionQ.data.theme;
  const accent = theme?.accent || client.color || "var(--primary)";
  const activeTab = activePortalTab(pathname, "/area");

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <PortalModeProvider value={{ kind: "session", clientId: cliente }}>
      <PortalShell
        clientName={client.name}
        activeTab={activeTab}
        accent={accent}
        dark={theme?.dark}
        logoUrl={theme?.logoUrl ?? null}
        footerLabel={theme?.footerLabel ?? (brand?.name ? `por ${brand.name}` : "")}
        headerActions={
          <>
            {links.length > 1 && (
              <Select value={cliente} onValueChange={pickClient}>
                <SelectTrigger className="h-9 w-56">
                  <SelectValue placeholder="Escolher marca" />
                </SelectTrigger>
                <SelectContent>
                  {links.map((l) => (
                    <SelectItem key={l.client_id} value={l.client_id}>
                      {l.client_name ?? "Cliente"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              onClick={signOut}
            >
              <LogOut className="h-4 w-4" /> Sair
            </Button>
          </>
        }
      >
        <Outlet />
      </PortalShell>
    </PortalModeProvider>
  );
}
