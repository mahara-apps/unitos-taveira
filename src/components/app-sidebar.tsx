import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyProfile } from "@/lib/profile.functions";
import { countMyPendingTasksFn } from "@/lib/tasks.functions";
import { useActiveContextOptional } from "@/hooks/use-active-context";
import { useSessionUser } from "@/hooks/use-session-user";
import { UnitosLogo } from "@/components/brand/unitos-logo";
import {
  LayoutDashboard,
  Bell,
  LogOut,
  KanbanSquare,
  BarChart3,
  Plug,
  UserPlus,
  User as UserIcon,
  ChevronsUpDown,
  Link2,
  ListChecks,
  CalendarDays,
  FolderKanban,
  FileBarChart,
  Workflow,
  Bot,
  Gift,
  Megaphone,
  Users,
  Settings as SettingsIcon,
  ScrollText,
  Target,
  Gauge,
  Brain,
  BrainCircuit,
  MessageSquare,
  Activity,
  Palette,
  Info,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ContextSwitcher } from "./brand-client-switcher";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAccessRole } from "@/hooks/use-access-role";
import { useModulePermissions } from "@/hooks/use-module-permissions";
import { allowedSidebarUrls } from "@/lib/module-permissions";
import { canAccessSidebarUrl } from "@/lib/permissions";
import { useBrandFeatures } from "@/hooks/use-feature-access";
import { useIsSuperAdmin } from "@/hooks/use-feature-access";
import { ShieldAlert } from "lucide-react";
import { resetIdentityState } from "@/lib/session-reset";

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  featureKey?: string;
  badge?: "tasks-pending" | "beta";
};

const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Visão Geral",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Analytics", url: "/analytics", icon: BarChart3, featureKey: "analytics" },
    ],
  },
  {
    label: "Operação",
    items: [
      { title: "Projetos", url: "/projects", icon: FolderKanban, featureKey: "projects" },
      { title: "Pauta", url: "/monthly-plan", icon: ScrollText, featureKey: "monthly_plan" },
      { title: "Conteúdo", url: "/content", icon: KanbanSquare, featureKey: "blog_post" },
      { title: "Calendário", url: "/calendar", icon: CalendarDays, featureKey: "calendar" },
      {
        title: "Tarefas",
        url: "/tasks",
        icon: ListChecks,
        featureKey: "tasks",
        badge: "tasks-pending",
      },
      { title: "Mídia paga", url: "/media-plans", icon: Target, featureKey: "midia_paga" },
    ],
  },
  {
    label: "Inteligência",
    items: [
      { title: "Agentes IA", url: "/agents", icon: Bot, featureKey: "agents" },
      { title: "Brain", url: "/brain", icon: Brain, featureKey: "brain", badge: "beta" },
      {
        title: "Brain Diagnostics",
        url: "/brain/diagnostics",
        icon: Activity,
        featureKey: "brain",
      },
      { title: "Chat", url: "/chat", icon: MessageSquare, featureKey: "chat" },
    ],
  },
  {
    label: "Gestão & Configurações",
    items: [
      { title: "Clientes", url: "/customers", icon: Users, featureKey: "customers" },
      { title: "Integrações", url: "/connections", icon: Plug, featureKey: "connections" },
      { title: "Notificações", url: "/notifications", icon: Bell, featureKey: "notifications" },
      { title: "Configurações", url: "/settings", icon: SettingsIcon },
    ],
  },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (u: string) => pathname === u || pathname.startsWith(u + "/");
  const { role, authorityRole } = useAccessRole();
  const { permissions: modulePerms, isReady: permsReady } = useModulePermissions();
  const featuresQ = useBrandFeatures();
  const superQ = useIsSuperAdmin();
  const isSuper = !!superQ.data?.isSuperAdmin;
  const { brandId } = useActiveContextOptional();
  const { clientId } = useActiveContextOptional();
  const qc = useQueryClient();
  const clientsCache = qc.getQueryData<
    Array<{ id: string; name: string; logo_url?: string | null }>
  >(["clients", brandId]);
  const activeClient = clientId ? (clientsCache?.find((c) => c.id === clientId) ?? null) : null;
  const countPending = useServerFn(countMyPendingTasksFn);
  const pendingQ = useQuery({
    queryKey: ["tasks-pending-count", brandId, clientId ?? null],
    queryFn: async () => {
      try {
        return await countPending({
          data: { brandId: brandId!, clientId: clientId ?? null },
        });
      } catch (err) {
        // Session may have expired mid-refetch; swallow auth errors so the
        // sidebar badge never blanks the app before the auth gate redirects.
        if (err instanceof Error && /Unauthorized/i.test(err.message)) {
          return { count: 0 };
        }
        throw err;
      }
    },
    enabled: !!brandId && !!superQ.data,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const pendingCount = pendingQ.data?.count ?? 0;
  const featureEnabled = (key?: string) => {
    if (!key) return true;
    if (isSuper) return true;
    // Enquanto carrega, esconde módulos vendáveis para evitar CTA quebrada.
    if (!featuresQ.data) return false;
    const f = featuresQ.data.find((r) => r.key === key);
    return !!f?.enabled;
  };
  // Usuários operacionais também passam pelo filtro de módulos do perfil de
  // acesso. Papéis administrativos mantêm o menu completo.
  const moduleAllowsUrl = (url: string) => {
    if (authorityRole !== "user") return true;
    if (!permsReady) return true;
    const allowed = allowedSidebarUrls(modulePerms);
    return [...allowed].some((u) => url === u || url.startsWith(u + "/"));
  };
  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          (isSuper || (canAccessSidebarUrl(role, i.url) && moduleAllowsUrl(i.url))) &&
          featureEnabled(i.featureKey),
      ),
    }))
    .filter((g) => g.items.length > 0);
  if (isSuper) {
    // Área exclusiva de Super Admin dentro do próprio ambiente do cliente.
    visibleGroups.push({
      label: "Administração do Cliente",
      items: [
        { title: "Recursos", url: "/admin/recursos", icon: ShieldAlert },
        { title: "Identidade", url: "/admin/identidade", icon: Palette },
        { title: "Ambiente", url: "/admin/ambiente", icon: Info },
      ],
    });
  }
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="group/brand h-[68px] flex-row items-center justify-between gap-1 border-b border-sidebar-border/60 !bg-transparent p-0 px-2 group-data-[collapsible=icon]:relative group-data-[collapsible=icon]:px-1">
        <Link
          to="/dashboard"
          preload="intent"
          aria-label="Unitos"
          className="flex h-full min-w-0 flex-1 items-center !bg-transparent group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center"
        >
          <UnitosLogo
            variant="full"
            className="w-full max-w-[176px] group-data-[collapsible=icon]:hidden"
          />
          <UnitosLogo
            variant="mark"
            align="center"
            className="hidden h-11 w-11 transition-opacity group-data-[collapsible=icon]:block group-data-[collapsible=icon]:group-hover/brand:opacity-0"
          />

        </Link>
        <SidebarTrigger className="h-7 w-7 shrink-0 text-muted-foreground group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:inset-0 group-data-[collapsible=icon]:m-auto group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:group-hover/brand:opacity-100 transition-opacity" />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <ContextSwitcher />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {visibleGroups.map((g, idx) => (
          <SidebarGroup key={g.label} className={idx === 0 ? "mt-2.5" : "mt-4"}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {g.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link
                        to={item.url}
                        preload="intent"
                        className="group/nav relative flex items-center gap-3"
                      >
                        {isActive(item.url) ? (
                          <span
                            aria-hidden
                            className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-lime group-data-[collapsible=icon]:hidden"
                          />
                        ) : null}
                        <item.icon
                          className="h-[19px] w-[19px] shrink-0"
                          strokeWidth={isActive(item.url) ? 2 : 1.8}
                        />
                        <span className={isActive(item.url) ? "font-semibold" : "font-medium"}>
                          {item.title}
                        </span>
                        {item.badge === "tasks-pending" && pendingCount > 0 ? (
                          <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-destructive-foreground group-data-[collapsible=icon]:hidden">
                            {pendingCount > 99 ? "99+" : pendingCount}
                          </span>
                        ) : null}
                        {item.badge === "beta" ? (
                          <span className="ml-auto inline-flex items-center rounded-md bg-brand-lime/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-brand-lime-foreground group-data-[collapsible=icon]:hidden dark:text-brand-lime">
                            beta
                          </span>
                        ) : null}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {idx === 0 && activeClient ? (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive(`/customers/${activeClient.id}`)}
                        tooltip={activeClient.name}
                      >
                        <Link
                          to="/customers/$customerId"
                          params={{ customerId: activeClient.id }}
                          preload="intent"
                          className="group/nav relative flex items-center gap-3"
                        >
                          {isActive(`/customers/${activeClient.id}`) ? (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-lime group-data-[collapsible=icon]:hidden"
                            />
                          ) : null}
                          <UserIcon
                            className="h-[19px] w-[19px] shrink-0"
                            strokeWidth={isActive(`/customers/${activeClient.id}`) ? 2 : 1.8}
                          />
                          <span
                            className={
                              isActive(`/customers/${activeClient.id}`)
                                ? "font-semibold"
                                : "font-medium"
                            }
                          >
                            Perfil
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </>
                ) : null}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserProfileMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function UserProfileMenu() {
  useSidebar();
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const { userId } = useSessionUser();
  const { data: profile } = useQuery({
    queryKey: ["me", "profile", userId],
    queryFn: () => fetchProfile(),
    enabled: Boolean(userId),
    retry: 0,
    staleTime: 30_000,
  });
  const user = profile
    ? { email: profile.email ?? undefined, name: profile.full_name || undefined }
    : null;

  const label = user?.name || user?.email || "Minha conta";
  const initials =
    (user?.name || user?.email || "?")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <SidebarMenuButton
          tooltip={label}
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <Avatar className="h-5 w-5 rounded-md">
            <AvatarFallback className="rounded-md bg-indigo-600 text-[9px] font-medium text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-xs leading-tight">
            <span className="truncate text-sm font-medium">{user?.name || "Minha conta"}</span>
            {user?.email ? (
              <span className="truncate text-[10px] text-muted-foreground">{user.email}</span>
            ) : null}
          </div>
          <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60" />
        </SidebarMenuButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[--radix-popover-trigger-width] min-w-56 rounded-lg p-1"
      >
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar className="h-8 w-8 rounded-md">
            <AvatarFallback className="rounded-md bg-indigo-600 text-xs font-medium text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-xs leading-tight">
            <span className="truncate font-medium">{user?.name || "Minha conta"}</span>
            {user?.email ? (
              <span className="truncate text-[10px] text-muted-foreground">{user.email}</span>
            ) : null}
          </div>
        </div>
        <div className="my-1 h-px bg-border" />
        <Link
          to="/settings/profile"
          preload="intent"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground"
        >
          <UserIcon className="h-3.5 w-3.5" />
          <span>Perfil do usuário</span>
        </Link>
        <button
          type="button"
          onClick={async () => {
            await supabase.auth.signOut();
            resetIdentityState(queryClient);
            window.location.href = "/login";
          }}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Sair</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
