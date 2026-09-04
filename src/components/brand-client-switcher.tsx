import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Sparkles, Users, UserPlus } from "lucide-react";
import { useActiveContext } from "@/hooks/use-active-context";
import { listClients } from "@/lib/workspace.functions";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { CustomerAvatar } from "@/components/customer/customer-avatar";
import { useAccessRole } from "@/hooks/use-access-role";
import { QuickCreateCustomerDrawer } from "@/components/customer/quick-create-customer-drawer";
import { resetScopeCache } from "@/lib/session-reset";
import { useMyBrandsQuery } from "@/hooks/use-my-brands";
import { shouldClearClient } from "@/lib/workspace-context-rules";
import { clientDashboardFn } from "@/lib/client-dashboard.functions";
import {
  clientDashboardInput,
  clientDashboardQueryKey,
  defaultDashboardRange,
} from "@/lib/client-dashboard.query";
import { useSessionUserId } from "@/hooks/use-session-user";

export function ContextSwitcher() {
  const { brandId, clientId, setClientId } = useActiveContext();
  const qc = useQueryClient();
  const sessionUserId = useSessionUserId();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { role, allowedClientIds } = useAccessRole();
  const isAdmin = role === "admin";
  const listCl = useServerFn(listClients);

  const brandsQ = useMyBrandsQuery();

  const clientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => listCl({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);

  // Extrai o segmento após /customers/ para reconstruir sub-rota ao trocar de cliente
  const customerMatch = pathname.match(/^\/customers\/([^/]+)(\/[^?#]*)?/);
  const currentCustomerSub = customerMatch?.[2] ?? "";

  // Prefetch do painel ao apenas passar o mouse/foco no item: quando o clique
  // acontece, o dado do cliente Y normalmente já está no cache — a troca vira
  // instantânea de ponta a ponta (sem alterar chaves nem escopo).
  const dashboardFn = useServerFn(clientDashboardFn);
  const prefetchClient = (id: string) => {
    if (!brandId || id === clientId) return;
    const range = defaultDashboardRange();
    void qc.prefetchQuery({
      queryKey: clientDashboardQueryKey(sessionUserId, brandId, id, range),
      queryFn: () => dashboardFn({ data: clientDashboardInput(brandId, id, range) }),
      staleTime: 60_000,
    });
  };

  // Troca de cliente/workspace é NAVEGAÇÃO, não carregamento: o estado ativo muda
  // de forma síncrona e nenhuma query é aguardada. `resetScopeCache` é síncrono e
  // apenas marca como obsoletas as queries sem id de escopo na chave.
  const handleSelectClient = (id: string) => {
    setClientId(id);
    setPopoverOpen(false);
    resetScopeCache(qc, [id, clientId, brandId]);
    if (!customerMatch) return;
    const sub = currentCustomerSub;
    const to =
      sub === "/brain"
        ? "/customers/$customerId/brain"
        : sub === "/briefing"
          ? "/customers/$customerId/briefing"
          : sub === "/media-plan"
            ? "/customers/$customerId/media-plan"
            : "/customers/$customerId";
    void navigate({ to, params: { customerId: id }, replace: true });
  };

  const handleSelectAllClients = () => {
    setClientId(null);
    setPopoverOpen(false);
    resetScopeCache(qc, [clientId, brandId]);
    if (customerMatch) void navigate({ to: "/customers", replace: true });
  };



  // A resolução do workspace ativo NÃO vive mais aqui: ela é feita por
  // `<WorkspaceResolver />` (montado em `_authenticated`), para que o contexto
  // não dependa desta UI estar montada nem da query desta tela.


  const activeBrand = brandsQ.data?.find((b) => b.id === brandId) ?? null;
  const visibleClients = (clientsQ.data ?? []).filter(
    (c) => !allowedClientIds || allowedClientIds.has(c.id),
  );
  const activeClient = visibleClients.find((c) => c.id === clientId) ?? null;

  // Revalidação do clientId persistido (nunca amplia autorização):
  // 1) fora do escopo do usuário (manager/user) → limpa;
  // 2) não pertence ao workspace ativo (residual de outro workspace) → limpa,
  //    inclusive para admin/super admin, cujo escopo é `null` (todo o workspace).
  // Enquanto a lista de clientes do workspace não carregou, nada é limpo.
  useEffect(() => {
    const brandClientIds = clientsQ.data ? clientsQ.data.map((c) => c.id) : null;
    if (shouldClearClient(clientId, allowedClientIds ?? null, brandClientIds)) setClientId(null);
  }, [clientId, allowedClientIds, clientsQ.data, setClientId]);

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            tooltip={activeClient?.name ?? activeBrand?.name ?? "Workspace"}
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            {activeClient ? (
              <CustomerAvatar
                name={activeClient.name}
                logoUrl={null}
                className="h-5 w-5"
                textClassName="text-[9px]"
              />
            ) : (
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white shadow-sm"
                style={{
                  background: activeBrand?.color ?? "linear-gradient(135deg,#8b5cf6,#6366f1)",
                }}
              >
                <Sparkles className="h-3 w-3" />
              </div>
            )}
            <div className="grid flex-1 text-left leading-tight min-w-0">
              <span className="truncate text-sm font-medium tracking-tight">
                {/* "Nenhum workspace" só quando a lista já carregou: durante a
                    resolução o rótulo neutro evita o flicker de boot. */}
                {activeClient?.name ??
                  activeBrand?.name ??
                  (brandsQ.data ? "Nenhum workspace" : "Carregando…")}
              </span>
              <span className="truncate text-[10px] text-muted-foreground">
                {activeClient ? (activeBrand?.name ?? "") : "Todas as contas"}
              </span>
            </div>
            <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Buscar cliente…" className="h-9" />
            <CommandList className="max-h-80">
              <CommandEmpty>Nenhum resultado.</CommandEmpty>
              {/* Workspace é singleton da instalação: nenhuma UI de seleção,
                  troca ou criação de workspace. O contexto é resolvido
                  automaticamente por <WorkspaceResolver />. */}
              {brandsQ.data && brandsQ.data.length === 0 && (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Sua conta ainda não está vinculada ao workspace desta instalação. Peça a um Admin
                  para vincular seu e-mail em Configurações → Equipe &amp; Acesso.
                </div>
              )}
              <CommandGroup
                heading={
                  <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Users className="h-3 w-3" /> CLIENTES
                  </span>
                }
              >
                <CommandItem value="all accounts" onSelect={() => void handleSelectAllClients()}>
                  <div className="h-3 w-3 rounded-full border border-dashed border-muted-foreground" />
                  <span className="flex-1">Todos os clientes</span>
                  {!clientId && <Check className="h-3.5 w-3.5" />}
                </CommandItem>
                {visibleClients.length === 0 && (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                    {isAdmin ? "Nenhum cliente ainda." : "Nenhum cliente atribuído a você."}
                  </div>
                )}
                {visibleClients.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`account ${c.name}`}
                    onMouseEnter={() => prefetchClient(c.id)}
                    onFocus={() => prefetchClient(c.id)}
                    onSelect={() => void handleSelectClient(c.id)}
                  >
                    <CustomerAvatar
                      name={c.name}
                      logoUrl={null}
                      className="h-5 w-5"
                      textClassName="text-[9px]"
                    />
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.id === clientId && <Check className="h-3.5 w-3.5" />}
                  </CommandItem>
                ))}
                {brandId && isAdmin && (
                  <CommandItem
                    value="create customer"
                    onSelect={() => {
                      setPopoverOpen(false);
                      setCustomerDialogOpen(true);
                    }}
                    className="text-muted-foreground"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Novo cliente</span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>



      <QuickCreateCustomerDrawer
        brandId={brandId}
        open={customerDialogOpen}
        onOpenChange={setCustomerDialogOpen}
        onCreated={(c) => setClientId(c.id)}
        nested
      />
    </>
  );
}

// Backwards-compatible aliases so existing imports keep working while the
// sidebar transitions to the unified <ContextSwitcher />.
export const BrandSwitcher = ContextSwitcher;
export const ClientSwitcher = () => null;
