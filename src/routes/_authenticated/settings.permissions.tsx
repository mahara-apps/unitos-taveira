import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Crown, Info, Layers, Loader2, ShieldCheck, Users } from "lucide-react";

import { listBrandTeam } from "@/lib/team.functions";
import { useActiveContext } from "@/hooks/use-active-context";
import { usePageHeader } from "@/hooks/use-page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";

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
  usePageHeader({
    title: "Permissões",
    subtitle: "Papéis realmente aplicados pelo RBAC desta marca",
  });

  const load = useServerFn(listBrandTeam);
  const teamQ = useQuery({
    queryKey: ["brand-team", brandId],
    queryFn: () => load({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const members = useMemo(() => teamQ.data?.members ?? [], [teamQ.data]);

  const counts = useMemo(() => {
    const byRole = (roles: string[]) =>
      members.filter((m) => roles.includes((m.role ?? "").toLowerCase())).length;
    return {
      total: members.length,
      admins: byRole(["owner", "admin"]),
      managers: byRole(["manager"]),
      collaborators: byRole(["user"]),
      clients: byRole(["client"]),
    };
  }, [members]);

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <p className="font-medium">Esta tela é somente leitura</p>
          <p className="text-muted-foreground">
            O acesso é decidido exclusivamente pelo <strong>papel</strong> do usuário (
            <code className="text-xs">brand_members.role</code>), aplicado
            no banco por RLS e nas server functions. Não existem permissões individuais para
            configurar: para mudar o acesso de alguém, altere o papel dele em{" "}
            <Link
              to="/settings/team"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Equipe &amp; Acesso
            </Link>
            .
          </p>
        </div>
      </div>

      <PageKpiGrid>
        <PageKpi label="Membros" value={counts.total} icon={<Users className="h-4 w-4" />} />
        <PageKpi
          label="Admins"
          value={counts.admins}
          icon={<Crown className="h-4 w-4" />}
          status={counts.admins === 0 ? "warning" : "info"}
          description="papel owner (Admin)"
        />
        <PageKpi
          label="Gerentes"
          value={counts.managers}
          icon={<ShieldCheck className="h-4 w-4" />}
          description="papel manager"
        />
        <PageKpi
          label="Users"
          value={counts.collaborators}
          icon={<Layers className="h-4 w-4" />}
          description="operação escopada"
        />
      </PageKpiGrid>

      {teamQ.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
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
      )}

      <div className="flex justify-end">
        <Link to="/settings/team">
          <Button variant="outline" size="sm">
            Gerenciar equipe
          </Button>
        </Link>
      </div>
    </div>
  );
}
