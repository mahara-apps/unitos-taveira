import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, ShieldCheck } from "lucide-react";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveTeamMemberFn, type BrandRole, type TeamMember } from "@/lib/team-admin.functions";
import {
  ROLE_LABEL,
  ROLE_ACCESS,
  invitableRoles,
  toAssignableRole,
  memberInitials,
} from "@/components/settings/team-shared";

/**
 * Edição completa de um membro da marca ativa: perfil (nome, telefone, cargo),
 * papel e status. Permissões não são campos livres — o acesso real vem do papel
 * (RBAC/RLS), então o modal explica o que cada papel concede.
 */
export function MemberEditModal({
  open,
  onOpenChange,
  brandId,
  member,
  authorityRole,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  member: TeamMember;
  /** Papel de autoridade do ator (`app_access_role`) — define papéis concedíveis. */
  authorityRole: string | null;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveTeamMemberFn);

  const [fullName, setFullName] = useState(member.fullName ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? "");
  const [role, setRole] = useState<BrandRole>(toAssignableRole(member.role));
  const [isActive, setIsActive] = useState(member.isActive);

  useEffect(() => {
    if (!open) return;
    setFullName(member.fullName ?? "");
    setPhone(member.phone ?? "");
    setJobTitle(member.jobTitle ?? "");
    setRole(toAssignableRole(member.role));
    setIsActive(member.isActive);
  }, [open, member]);

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          brandId,
          userId: member.userId,
          fullName: fullName.trim() || member.fullName || "—",
          phone: phone.trim() || null,
          jobTitle: jobTitle.trim() || null,
          role,
          isActive,
        },
      }),
    onSuccess: () => {
      toast.success("Membro atualizado.");
      qc.invalidateQueries({ queryKey: ["team-members", brandId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Não foi possível salvar", { description: e.message }),
  });

  // Matriz canônica: só oferecemos papéis que o ator pode conceder.
  const grantable = invitableRoles(authorityRole);
  const roles = grantable.length > 0 ? grantable : [toAssignableRole(member.role)];
  const canChangeRole = grantable.includes(toAssignableRole(member.role));

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Editar membro"
      description="Dados do colaborador, papel na marca e status de acesso."
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar alterações
          </Button>
        </div>
      }
    >
      <div className="space-y-6 px-6 py-6">
        <div className="flex items-center gap-3">
          <Avatar className="h-14 w-14">
            {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-sm">
              {memberInitials(member.fullName, member.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{member.fullName || "Sem nome"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {member.email ?? "e-mail indisponível"}
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome completo">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nome e sobrenome"
            />
          </Field>
          <Field label="E-mail (login)">
            <Input value={member.email ?? ""} readOnly disabled />
          </Field>
          <Field label="Telefone (opcional)">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+55 11 90000-0000"
            />
          </Field>
          <Field label="Cargo (opcional)">
            <Input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Ex.: Social Media"
            />
          </Field>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Papel na marca</Label>
          <Select
            value={role}
            onValueChange={(v) => setRole(v as BrandRole)}
            disabled={!canChangeRole}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">{ROLE_ACCESS[role]}</p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-3">
          <div>
            <div className="text-sm font-medium">Acesso ativo</div>
            <p className="text-xs text-muted-foreground">
              Ao desativar, a pessoa perde imediatamente o acesso a esta marca e aos clientes dela.
            </p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>
      </div>
    </ExpandedModal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
