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
  Inbox,
  LogOut,
  KanbanSquare,
  BarChart3,
  Plug,
  User as UserIcon,
  ChevronsUpDown,
  ListChecks,
  CalendarDays,
  FolderKanban,
  Bot,
  Megaphone,
  Users,
  Settings as SettingsIcon,
  ScrollText,
  Target,
  Brain,
  MessageSquare,
  MessagesSquare,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ContextSwitcher } from "./brand-client-switcher";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAccessRole } from "@/hooks/use-access-role";
import { useModulePermissions } from "@/hooks/use-module-permissions";
import { listClientInboxFn } from "@/lib/client-inbox.functions";
import { countUnreadMessages } from "@/lib/messaging.functions";
import { allowedSidebarUrls } from "@/lib/module-permissions";
import { canAccessSidebarUrl } from "@/lib/permissions";
import { useBrandFeatures } from "@/hooks/use-feature-access";
import { useIsSuperAdmin, useHasSession } from "@/hooks/use-feature-access";
import { ShieldAlert } from "lucide-react";
import { resetIdentityState } from "@/lib/session-reset";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  featureKey?: string;
  badge?: "tasks-pending" | "inbox-awaiting" | "messages-unread" | "beta";
  /** Subitens aninhados dentro do item (ex.: Diagnostics sob Brain). */
  children?: Array<{ title: string; url: string }>;
};

/** Inbox fixo no topo: Mensagens (fora de qualquer grupo). */
const messagesItem: NavItem = {
  title: "Mensagens",
  url: "/messages",
  icon: MessagesSquare,
  featureKey: "messages",
  badge: "messages-unread",
};

const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Visão",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Analytics", url: "/analytics", icon: BarChart3, featureKey: "analytics" },
    ],
  },
  {
    label: "Trabalho",
    items: [
      { title: "Calendário", url: "/calendar", icon: CalendarDays, featureKey: "calendar" },
      { title: "Projetos", url: "/projects", icon: FolderKanban, featureKey: "projects" },
      { title: "Pautas", url: "/monthly-plan", icon: ScrollText, featureKey: "monthly_plan" },
      { title: "Conteúdo", url: "/content", icon: KanbanSquare, featureKey: "blog_post" },
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
      // Diagnostics fica dentro da página Brain, não aparece no menu lateral.
      {
        title: "Brain",
        url: "/brain",
        icon: Brain,
        featureKey: "brain",
        badge: "beta",
      },
      { title: "Chat", url: "/chat", icon: MessageSquare, featureKey: "chat" },
    ],
  },
];

/** Grupo recessivo fixo no rodapé — fora do fluxo diário. */
const agencyGroup: { label: string; items: NavItem[] } = {
  label: "Agência",
  items: [
    { title: "Clientes", url: "/customers", icon: Users, featureKey: "customers" },
    { title: "Área do cliente", url: "/inbox", icon: Inbox, badge: "inbox-awaiting" },
    { title: "Integrações", url: "/connections", icon: Plug, featureKey: "connections" },
    { title: "Notificações", url: "/notifications", icon: Bell, featureKey: "notifications" },
    { title: "Configurações", url: "/settings", icon: SettingsIcon },
  ],
};

/** Itens exclusivos de Super Admin — entram no grupo Agência. */
const superAdminItems: NavItem[] = [
  { title: "Recursos", url: "/admin/recursos", icon: ShieldAlert },
  { title: "Identidade", url: "/admin/identidade", icon: Palette },
  { title: "Ambiente", url: "/admin/ambiente", icon: Info },
];

/** Badge de contador — estilo único para todos os contadores acionáveis. */
function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-destructive-foreground group-data-[collapsible=icon]:hidden">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Ponto indicador no modo rail (só ícones), quando há contador ativo. */
function RailDot({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      aria-hidden
      className="absolute right-1 top-1 hidden h-2 w-2 rounded-full bg-destructive ring-2 ring-sidebar group-data-[collapsible=icon]:block"
    />
  );
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (u: string) => pathname === u || pathname.startsWith(u + "/");
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { role, authorityRole } = useAccessRole();
  const { permissions: modulePerms, isReady: permsReady } = useModulePermissions();
  const featuresQ = useBrandFeatures();
  const superQ = useIsSuperAdmin();
  const isSuper = !!superQ.data?.isSuperAdmin;
  const { brandId } = useActiveContextOptional();
  const { clientId } = useActiveContextOptional();
  const hasSession = useHasSession();
  const countPending = useServerFn(countMyPendingTasksFn);
  const pendingQ = useQuery({
    queryKey: ["tasks-pending-count", brandId, clientId ?? null],
    queryFn: async () => {
      try {
        return await countPending({
          data: { brandId: brandId!, clientId: clientId ?? null },
        });
      } catch {
        // Sem sessão válida (logout/refresh) a chamada é rejeitada: não deve
        // derrubar a tela, o gate de auth já redireciona.
        return { count: 0 };
      }
    },
    enabled: !!brandId && !!superQ.data && hasSession,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const pendingCount = pendingQ.data?.count ?? 0;
  // Itens da área do cliente esperando resposta da equipe.
  const listInbox = useServerFn(listClientInboxFn);
  const inboxQ = useQuery({
    queryKey: ["client-inbox-awaiting", brandId],
    queryFn: async () => {
      try {
        const items = await listInbox({
          data: { brandId: brandId!, awaitingOnly: true, limit: 300 },
        });
        return items.length;
      } catch {
        return 0;
      }
    },
    enabled: !!brandId && hasSession,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });
  const inboxAwaiting = inboxQ.data ?? 0;
  // Mensagens não lidas do comunicador interno (equipe + clientes).
  const countUnread = useServerFn(countUnreadMessages);
  const unreadQ = useQuery({
    queryKey: ["messages-unread", brandId],
    queryFn: async () => {
      try {
        return await countUnread({ data: { brandId: brandId! } });
      } catch {
        return 0;
      }
    },
    enabled: !!brandId && hasSession,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const messagesUnread = unreadQ.data ?? 0;
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
  const itemVisible = (i: NavItem) =>
    (isSuper || (canAccessSidebarUrl(role, i.url) && moduleAllowsUrl(i.url))) &&
    featureEnabled(i.featureKey);
  const visibleGroups = groups
    .map((g) => ({ ...g, items: g.items.filter(itemVisible) }))
    .filter((g) => g.items.length > 0);
  const visibleAgencyItems = agencyGroup.items.filter(itemVisible);
  if (isSuper) visibleAgencyItems.push(...superAdminItems);
  const showMessages = itemVisible(messagesItem);

  const badgeCount = (badge?: NavItem["badge"]): number => {
    if (badge === "tasks-pending") return pendingCount;
    if (badge === "messages-unread") return messagesUnread;
    if (badge === "inbox-awaiting") return inboxAwaiting;
    return 0;
  };

  // Subitens aninhados herdam o módulo do item pai, mas respeitam os mesmos
  // filtros de papel/perfil aplicados à URL do filho.
  const childVisible = (url: string) =>
    isSuper || (canAccessSidebarUrl(role, url) && moduleAllowsUrl(url));

  const renderItem = (item: NavItem, recessive = false) => {
    const active = isActive(item.url);
    const count = badgeCount(item.badge);
    const children = item.children?.filter((c) => childVisible(c.url)) ?? [];
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
          <Link
            to={item.url}
            preload="intent"
            className="group/nav relative flex items-center gap-3"
          >
            {active ? (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary group-data-[collapsible=icon]:hidden"
              />
            ) : null}
            <item.icon
              className={cn("h-[19px] w-[19px] shrink-0", recessive && !active && "opacity-60")}
              strokeWidth={active ? 2 : 1.8}
            />
            <span
              className={cn(
                active ? "font-semibold" : "font-medium",
                recessive && !active && "text-muted-foreground",
              )}
            >
              {item.title}
            </span>
            <CountBadge count={count} />
            <RailDot show={collapsed && count > 0} />
            {item.badge === "beta" ? (
              <span className="ml-auto inline-flex items-center rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-primary group-data-[collapsible=icon]:hidden dark:text-primary">
                beta
              </span>
            ) : null}
          </Link>
        </SidebarMenuButton>
        {children.length > 0 ? (
          <SidebarMenuSub className="group-data-[collapsible=icon]:hidden">
            {children.map((child) => {
              const childActive = pathname === child.url;
              return (
                <SidebarMenuSubItem key={child.url}>
                  <SidebarMenuSubButton asChild isActive={childActive}>
                    <Link to={child.url} preload="intent">
                      <span
                        className={cn(
                          "text-muted-foreground",
                          childActive && "font-semibold text-foreground",
                        )}
                      >
                        {child.title}
                      </span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        ) : null}
      </SidebarMenuItem>
    );
  };

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
        {showMessages ? (
          <>
            <SidebarGroup className="py-0">
              <SidebarGroupContent>
                <SidebarMenu>{renderItem(messagesItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator className="mx-3 my-1 w-auto" />
          </>
        ) : null}
        {visibleGroups.map((g, idx) => (
          <SidebarGroup key={g.label} className={idx === 0 ? "mt-1.5" : "mt-3"}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{g.items.map((item) => renderItem(item))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        {visibleAgencyItems.length > 0 ? (
          <SidebarGroup className="mt-auto pt-4">
            <SidebarSeparator className="mx-3 mb-1 w-auto" />
            <SidebarGroupLabel className="opacity-70">{agencyGroup.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{visibleAgencyItems.map((item) => renderItem(item, true))}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
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
