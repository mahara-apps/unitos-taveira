import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Crown,
  Info,
  Layers,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
} from "lucide-react";

import { listBrandTeam } from "@/lib/team.functions";
import { listAccessProfiles } from "@/lib/access-profiles.functions";
import { useActiveContext } from "@/hooks/use-active-context";
import { useAccessRole } from "@/hooks/use-access-role";
import { usePageHeader } from "@/hooks/use-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { AccessProfilesManager } from "@/components/settings/access-profiles-manager";
import { AddUserDialog } from "@/components/settings/add-user-dialog";
import {
  MemberPermissionsModal,
  type PermissionMemberInput,
} from "@/components/settings/member-permissions-modal";
import { ROLE_SHORT, memberInitials, toAssignableRole } from "@/components/settings/team-shared";
import { hasCustomOverrides, profileLabel } from "@/lib/module-permissions";

export const Route = createFileRoute("/_authenticated/settings/permissions")({
  component: PermissionsPage,
});

type RoleCard = {
  key: string;
  label: string;
  badge: string;
  icon: typeof Crown;
  /** Papéis brutos de `brand_members.role` que caem neste nível. */
  brandRoles: string[];
  scope: string;
  can: string[];
  cannot: string[];
};

/**
 * Fonte da verdade: comportamento REAL aplicado hoje por RLS + server functions
 * (`app_access_role`, `is_brand_admin_level`, `has_brand_role`, `can_access_client`,
 * `is_super_admin`). Nada aqui é configurável — o papel decide tudo.
 */
const ROLE_CARDS: RoleCard[] = [
  {
    key: "admin",
    label: "Admin (proprietário)",
    badge: "Administra a marca",
    icon: Crown,
    brandRoles: ["owner", "admin"],
    scope: "Toda a marca e todos os clientes da marca.",
    can: [
      "Gerenciar equipe: convidar, alterar papel, desativar e remover membros",
      "Editar identidade e dados cadastrais da agência",
      "Configurar SLA da marca e SLA das etapas do pipeline",
      "Gerenciar conexões de canais, limites de IA e acessos do portal",
      "Ler e escrever em todos os clientes, projetos e tarefas da marca",
    ],
    cannot: ["Acessar outras marcas em que não é membro"],
  },
  {
    key: "manager",
    label: "Manager",
    badge: "Administra a marca",
    icon: ShieldCheck,
    brandRoles: ["manager"],
    scope: "Toda a marca e todos os clientes da marca.",
    can: [
      "Gerenciar equipe (exceto owners/administradores)",
      "Editar identidade e dados cadastrais da agência",
      "Configurar SLA da marca e SLA das etapas do pipeline",
      "Gerenciar acessos do portal dos clientes da marca",
      "Ler e escrever em todos os clientes, projetos e tarefas da marca",
    ],
    cannot: [
      "Promover alguém a proprietário ou alterar owners/administradores",
      "Acessar outras marcas",
    ],
  },
  {
    key: "user",
    label: "User",
    badge: "Operação",
    icon: Layers,
    brandRoles: ["user"],
    scope:
      "Somente os clientes de que é responsável (owner_user_id) ou aos quais está vinculado em client_members.",
    can: [
      "Operar conteúdo, pautas, projetos, tarefas e subtarefas dos clientes vinculados",
      "Comentar, apontar horas e mover cards do pipeline",
      "Ler etapas e SLA do pipeline da marca",
    ],
    cannot: [
      "Ver clientes da marca sem vínculo explícito (não há mais acesso por fallback)",
      "Alterar SLA de etapa, identidade da agência, equipe ou acessos do portal",
      "Acessar clientes de outras marcas",
    ],
  },
  {
    key: "client",
    label: "Cliente (Portal)",
    badge: "Portal — fora da equipe",
    icon: Users,
    brandRoles: ["client"],
    scope: "Somente o próprio cliente, através do Portal. Não é membro interno da equipe.",
    can: [
      "Ver e aprovar pauta, conteúdos e aprovações do próprio cliente",
      "Responder briefing e enviar arquivos",
      "Ver calendário e a própria marca",
    ],
    cannot: [
      "Entrar na área interna da agência",
      "Receber papel de equipe (owner/manager/user)",
      "Ver dados de outros clientes ou campos internos/sensíveis",
    ],
  },
];

function PermissionsPage() {
  const { brandId } = useActiveContext();
  const { authorityRole } = useAccessRole();
  const canEdit = ["super_admin", "owner", "admin"].includes((authorityRole ?? "") as string);

  usePageHeader({
    title: "Permissões",
    subtitle: "Usuários, perfis de acesso e o que cada um pode fazer",
  });

  const load = useServerFn(listBrandTeam);
  const loadProfiles = useServerFn(listAccessProfiles);

  const teamQ = useQuery({
    queryKey: ["brand-team", brandId],
    queryFn: () => load({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });
  const profilesQ = useQuery({
    queryKey: ["access-profiles", brandId],
    queryFn: () => loadProfiles({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const members = useMemo(() => teamQ.data?.members ?? [], [teamQ.data]);
  const profiles = profilesQ.data?.profiles ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<PermissionMemberInput | null>(null);

  const counts = useMemo(() => {
    const byRole = (roles: string[]) =>
      members.filter((m) => roles.includes((m.role ?? "").toLowerCase())).length;
    return {
      total: members.length,
      admins: byRole(["owner", "admin"]),
      managers: byRole(["manager"]),
      collaborators: byRole(["user"]),
      profiles: profiles.length,
    };
  }, [members, profiles.length]);

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <PageKpiGrid>
        <PageKpi label="Membros" value={counts.total} icon={<Users className="h-4 w-4" />} />
        <PageKpi
          label="Admins"
          value={counts.admins}
          icon={<Crown className="h-4 w-4" />}
          status={counts.admins === 0 ? "warning" : "info"}
          description="acesso total ao workspace"
        />
        <PageKpi
          label="Gerentes"
          value={counts.managers}
          icon={<ShieldCheck className="h-4 w-4" />}
          description="papel manager"
        />
        <PageKpi
          label="Perfis de acesso"
          value={counts.profiles}
          icon={<Layers className="h-4 w-4" />}
          description="modelos de permissão"
        />
      </PageKpiGrid>

      <Tabs defaultValue="users" className="space-y-4">
        <TabsList>
          <TabsTrigger value="users" className="gap-2">
            <Users className="h-3.5 w-3.5" /> Usuários
          </TabsTrigger>
          <TabsTrigger value="profiles" className="gap-2">
            <Layers className="h-3.5 w-3.5" /> Perfis de acesso
          </TabsTrigger>
          <TabsTrigger value="roles" className="gap-2">
            <ShieldCheck className="h-3.5 w-3.5" /> Papéis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">Usuários do workspace</CardTitle>
                <CardDescription>
                  O perfil define o que a pessoa pode fazer em cada módulo. Os clientes que ela vê
                  continuam sendo definidos pelos vínculos em{" "}
                  <Link
                    to="/settings/team"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Equipe &amp; Acesso
                  </Link>
                  .
                </CardDescription>
              </div>
              {canEdit ? (
                <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                  <UserPlus className="h-3.5 w-3.5" /> Adicionar usuário
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              {teamQ.isLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : members.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">
                  Nenhum membro neste workspace ainda.
                </p>
              ) : (
                <div className="divide-y divide-border/60">
                  {members.map((m) => {
                    const role = toAssignableRole(m.role);
                    const isAdminRole = ["owner", "admin", "manager"].includes(role);
                    const profile = profiles.find((p) => p.id === m.access_profile_id) ?? null;
                    const custom = hasCustomOverrides(
                      profile?.permissions ?? {},
                      { ...(profile?.permissions ?? {}), ...m.module_permissions },
                    );
                    const name = m.full_name ?? m.email ?? "Sem nome";
                    return (
                      <div
                        key={m.user_id}
                        className="flex flex-wrap items-center gap-3 px-6 py-3"
                      >
                        <Avatar className="h-9 w-9">
                          {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={name} /> : null}
                          <AvatarFallback className="text-xs">
                            {memberInitials(m.full_name, m.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.email ?? "—"}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[11px]">
                          {ROLE_SHORT[role]}
                        </Badge>
                        <Badge
                          variant={isAdminRole ? "secondary" : custom ? "secondary" : "outline"}
                          className="text-[11px]"
                        >
                          {isAdminRole
                            ? "Acesso total (papel)"
                            : profileLabel(profile?.name ?? null, custom)}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5"
                          onClick={() =>
                            setEditing({
                              userId: m.user_id,
                              name,
                              email: m.email,
                              role,
                              accessProfileId: m.access_profile_id,
                              modulePermissions: m.module_permissions,
                            })
                          }
                        >
                          <SlidersHorizontal className="h-3.5 w-3.5" />
                          {canEdit ? "Editar permissões" : "Ver permissões"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profiles">
          {brandId ? <AccessProfilesManager brandId={brandId} canEdit={canEdit} /> : null}
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-4 text-sm">
            <Info className="mt-0.5 h-4 w-4 text-primary" />
            <div>
              <p className="font-medium">Papel × perfil de acesso</p>
              <p className="text-muted-foreground">
                O <strong>papel</strong> define a autoridade no workspace e o alcance de clientes.
                O <strong>perfil de acesso</strong> refina o que um usuário pode fazer em cada
                módulo. Admins e gerentes têm acesso total por papel.
              </p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {ROLE_CARDS.map((r) => {
              const count = members.filter((m) =>
                r.brandRoles.includes((m.role ?? "").toLowerCase()),
              ).length;
              return (
                <Card key={r.key}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                          <r.icon className="h-4 w-4 text-muted-foreground" />
                        </span>
                        <div>
                          <CardTitle className="text-base">{r.label}</CardTitle>
                          <CardDescription className="text-xs">{r.scope}</CardDescription>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge variant="secondary" className="text-[10px]">
                          {r.badge}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {count} {count === 1 ? "membro" : "membros"}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div>
                      <p className="mb-1 text-xs font-medium text-emerald-600">Pode</p>
                      <ul className="space-y-1">
                        {r.can.map((c) => (
                          <li key={c} className="flex gap-2 text-xs text-muted-foreground">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-rose-600">Não pode</p>
                      <ul className="space-y-1">
                        {r.cannot.map((c) => (
                          <li key={c} className="flex gap-2 text-xs text-muted-foreground">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rose-500" />
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {brandId ? (
        <AddUserDialog open={addOpen} onOpenChange={setAddOpen} brandId={brandId} />
      ) : null}
      {brandId && editing ? (
        <MemberPermissionsModal
          open={!!editing}
          onOpenChange={(v) => !v && setEditing(null)}
          brandId={brandId}
          member={editing}
          canEdit={canEdit}
        />
      ) : null}
    </div>
  );
}
