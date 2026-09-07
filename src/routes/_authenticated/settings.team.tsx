import { displayName } from "@/lib/identity";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listBrandTeam, revokeBrandInvite } from "@/lib/team.functions";
import {
  listTeamMembersFn,
  removeTeamMemberFn,
  saveTeamMemberFn,
  type TeamMember,
} from "@/lib/team-admin.functions";
import { useActiveContext } from "@/hooks/use-active-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import {
  MoreHorizontal,
  UserPlus,
  Copy,
  X,
  Loader2,
  Users,
  Mail as MailIcon,
  Link as LinkIcon,
  Crown,
  Power,
  PowerOff,
  Trash2,
  Pencil,
} from "lucide-react";
import { usePageHeader } from "@/hooks/use-page-header";
import { AddMemberDrawer } from "@/components/settings/add-member-drawer";
import { MemberEditModal } from "@/components/settings/member-edit-modal";
import { PortalAccessManager } from "@/components/settings/portal-access-manager";
import {
  ROLE_ACCESS,
  ROLE_SHORT,
  StatusBadge,
  fmtDate,
  fmtDateTime,
  memberInitials,
} from "@/components/settings/team-shared";

export const Route = createFileRoute("/_authenticated/settings/team")({
  component: TeamSettingsPage,
});

function TeamSettingsPage() {
  const { brandId } = useActiveContext();
  const qc = useQueryClient();
  const loadTeam = useServerFn(listBrandTeam);
  const loadMembers = useServerFn(listTeamMembersFn);

  const [addOpen, setAddOpen] = useState(false);
  const [showRevoked, setShowRevoked] = useState(false);

  usePageHeader(
    {
      title: "Equipe & Acesso",
      subtitle: "Membros, papéis, convites e acessos do portal",
      actions: brandId ? (
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-2 h-4 w-4" />
          Adicionar membro
        </Button>
      ) : undefined,
    },
    [brandId],
  );

  const membersQ = useQuery({
    queryKey: ["team-members", brandId],
    queryFn: () => loadMembers({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });
  const teamQ = useQuery({
    queryKey: ["brand-team", brandId],
    queryFn: () => loadTeam({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const members = membersQ.data?.members ?? [];
  const myRole = membersQ.data?.myRole ?? null;

  const invitesAll = useMemo(() => teamQ.data?.invites ?? [], [teamQ.data]);
  const pendingInvites = useMemo(
    () => invitesAll.filter((i) => !i.accepted_at && !i.revoked_at),
    [invitesAll],
  );
  const revokedInvites = useMemo(
    () => invitesAll.filter((i) => !i.accepted_at && i.revoked_at),
    [invitesAll],
  );
  const activeMembers = members.filter((m) => m.isActive).length;
  const owners = members.filter((m) => m.role === "owner" && m.isActive).length;
  const activePortals = (teamQ.data?.portalTokens ?? []).filter((t) => !t.revoked_at).length;

  if (!brandId) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-sm text-muted-foreground">
          Selecione uma marca no menu lateral para gerenciar a equipe.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <AddMemberDrawer
        open={addOpen}
        onOpenChange={setAddOpen}
        brandId={brandId}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["brand-team", brandId] });
          qc.invalidateQueries({ queryKey: ["team-members", brandId] });
        }}
      />

      <PageKpiGrid>
        <PageKpi
          label="Membros ativos"
          value={activeMembers}
          icon={<Users className="h-4 w-4" />}
          status="info"
        />
        <PageKpi
          label="Convites pendentes"
          value={pendingInvites.length}
          icon={<MailIcon className="h-4 w-4" />}
          status={pendingInvites.length > 0 ? "warning" : "neutral"}
        />
        <PageKpi
          label="Portais ativos"
          value={activePortals}
          icon={<LinkIcon className="h-4 w-4" />}
          status="info"
        />
        <PageKpi
          label="Owners ativos"
          value={owners}
          icon={<Crown className="h-4 w-4" />}
          status={owners > 0 ? "success" : "warning"}
        />
      </PageKpiGrid>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">Membros da equipe</CardTitle>
            <CardDescription>
              Pessoas com acesso a esta marca. O papel define o acesso real aplicado pelo sistema.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Adicionar membro
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="hidden grid-cols-[minmax(0,1.3fr)_130px_100px_minmax(0,1fr)_48px] items-center gap-4 border-y border-border/60 bg-muted/30 px-6 py-2 text-[11px] uppercase tracking-wider text-muted-foreground lg:grid">
            <div>Membro</div>
            <div>Papel</div>
            <div>Status</div>
            <div>Acesso concedido</div>
            <div />
          </div>
          {membersQ.isLoading ? (
            <div className="space-y-2 p-6">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : membersQ.isError ? (
            <div className="p-8 text-center text-sm text-destructive">
              Não foi possível carregar os membros. {(membersQ.error as Error)?.message}
            </div>
          ) : members.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nenhum membro nesta marca.
            </div>
          ) : (
            <ul>
              {members.map((m) => (
                <MemberRow
                  key={m.userId}
                  brandId={brandId}
                  member={m}
                  authorityRole={myRole}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Convites pendentes</CardTitle>
          <CardDescription>Convites ainda não aceitos ou expirados.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {pendingInvites.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhum convite pendente.
            </div>
          ) : (
            <ul>
              {pendingInvites.map((i) => (
                <InviteRow key={i.id} brandId={brandId} invite={i} />
              ))}
            </ul>
          )}
          {revokedInvites.length > 0 && (
            <div className="border-t border-border/60 px-6 py-2.5">
              <button
                type="button"
                onClick={() => setShowRevoked((v) => !v)}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {showRevoked ? "Ocultar revogados" : `Ver revogados (${revokedInvites.length})`}
              </button>
              {showRevoked && (
                <ul className="mt-2 border-t border-border/60">
                  {revokedInvites.map((i) => (
                    <InviteRow key={i.id} brandId={brandId} invite={i} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <PortalAccessManager brandId={brandId} />
    </div>
  );
}

function MemberRow({
  brandId,
  member,
  authorityRole,
}: {
  brandId: string;
  member: TeamMember;
  authorityRole: string | null;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveTeamMemberFn);
  const remove = useServerFn(removeTeamMemberFn);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["team-members", brandId] });
    qc.invalidateQueries({ queryKey: ["brand-team", brandId] });
  };

  const toggleMut = useMutation({
    mutationFn: () =>
      save({ data: { brandId, userId: member.userId, isActive: !member.isActive } }),
    onSuccess: () => {
      toast.success(member.isActive ? "Membro desativado." : "Membro reativado.");
      invalidate();
    },
    onError: (e: Error) =>
      toast.error("Não foi possível alterar o status", { description: e.message }),
  });

  const removeMut = useMutation({
    mutationFn: () => remove({ data: { brandId, userId: member.userId } }),
    onSuccess: () => {
      toast.success("Membro removido da marca.");
      setConfirmRemove(false);
      invalidate();
    },
    onError: (e: Error) => toast.error("Não foi possível remover", { description: e.message }),
  });

  return (
    <li className="grid grid-cols-1 items-center gap-3 border-b border-border/60 px-6 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1.3fr)_130px_100px_minmax(0,1fr)_48px] lg:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-9 w-9">
          {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-[11px]">
            {memberInitials(member.fullName, member.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{displayName({ full_name: member.fullName, email: member.email })}</span>
            {member.isSuperAdmin && (
              <Badge variant="secondary" className="text-[10px]">
                Super admin
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {member.email ?? "e-mail indisponível"}
            {member.jobTitle ? ` · ${member.jobTitle}` : ""}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Desde {fmtDate(member.createdAt)} · último acesso {fmtDateTime(member.lastSignInAt)}
          </div>
          <div className="mt-1.5 flex items-center gap-2 lg:hidden">
            <Badge variant="secondary">{ROLE_SHORT[member.role]}</Badge>
            <StatusBadge status={member.status} />
          </div>
        </div>
      </div>
      <div className="hidden lg:block">
        <Badge variant="secondary">{ROLE_SHORT[member.role]}</Badge>
      </div>
      <div className="hidden lg:block">
        <StatusBadge status={member.status} />
      </div>
      <div className="hidden text-xs text-muted-foreground lg:block">
        {ROLE_ACCESS[member.role]}
      </div>

      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Ações do membro">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Editar dados e papel
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={toggleMut.isPending} onClick={() => toggleMut.mutate()}>
              {toggleMut.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : member.isActive ? (
                <PowerOff className="mr-2 h-3.5 w-3.5" />
              ) : (
                <Power className="mr-2 h-3.5 w-3.5" />
              )}
              {member.isActive ? "Desativar acesso" : "Reativar acesso"}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Remover da marca
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <MemberEditModal
          open={editOpen}
          onOpenChange={setEditOpen}
          brandId={brandId}
          member={member}
          authorityRole={authorityRole}
        />

        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover membro da marca?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong>{displayName({ full_name: member.fullName, email: member.email })}</strong> perde o acesso a esta marca e a
                todos os clientes dela, incluindo os vínculos por cliente. A conta de login continua
                existindo, mas sem acesso aqui. Para suspender temporariamente, use “Desativar
                acesso”.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  removeMut.mutate();
                }}
              >
                {removeMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Remover membro
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function InviteRow({
  brandId,
  invite,
}: {
  brandId: string;
  invite: {
    id: string;
    email: string;
    role: string;
    token: string;
    expires_at: string;
    revoked_at?: string | null;
    temp_password_sent?: boolean;
  };
}) {
  const qc = useQueryClient();
  const revoke = useServerFn(revokeBrandInvite);
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/invite/${invite.token}` : "";
  const revokeMut = useMutation({
    mutationFn: () => revoke({ data: { brandId, inviteId: invite.id } }),
    onSuccess: () => {
      toast.success("Convite revogado");
      qc.invalidateQueries({ queryKey: ["brand-team", brandId] });
    },
    onError: (e: Error) => toast.error("Não foi possível revogar", { description: e.message }),
  });
  const isExpired = new Date(invite.expires_at).getTime() < Date.now();
  const isRevoked = Boolean(invite.revoked_at);
  return (
    <li className="flex items-center justify-between gap-4 border-b border-border/60 px-6 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{invite.email}</span>
          {isRevoked ? (
            <StatusBadge status="revoked" />
          ) : isExpired ? (
            <StatusBadge status="expired" />
          ) : (
            <StatusBadge status="pending" label="Convite enviado" />
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Papel: <span className="capitalize">{invite.role}</span> · Expira em{" "}
          {fmtDate(invite.expires_at)}
          {invite.temp_password_sent ? " · senha temporária enviada" : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isRevoked}
          onClick={() => {
            navigator.clipboard.writeText(link);
            toast.success("Link copiado");
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copiar link
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => revokeMut.mutate()}
          disabled={revokeMut.isPending || isRevoked}
          title="Revogar convite"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}
