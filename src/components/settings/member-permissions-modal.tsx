import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RotateCcw, Save, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModulePermissionsEditor } from "@/components/settings/module-permissions-editor";
import {
  listAccessProfiles,
  saveMemberModulePermissions,
} from "@/lib/access-profiles.functions";
import {
  diffFromProfile,
  emptyModulePermissions,
  fullModulePermissions,
  hasCustomOverrides,
  mergeModulePermissions,
  profileLabel,
  type ModuleKey,
  type ModuleLevel,
  type PartialModulePermissions,
} from "@/lib/module-permissions";

export type PermissionMemberInput = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  accessProfileId: string | null;
  modulePermissions: PartialModulePermissions;
};

const ADMIN_ROLES = new Set(["owner", "admin", "manager", "super_admin"]);

/**
 * Permissões por módulo de UM membro: perfil de acesso + ajustes individuais.
 * Administradores não têm matriz (acesso total por papel).
 */
export function MemberPermissionsModal({
  open,
  onOpenChange,
  brandId,
  member,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  member: PermissionMemberInput;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const load = useServerFn(listAccessProfiles);
  const save = useServerFn(saveMemberModulePermissions);

  const profilesQ = useQuery({
    queryKey: ["access-profiles", brandId],
    queryFn: () => load({ data: { brandId } }),
    enabled: open && !!brandId,
  });
  const profiles = profilesQ.data?.profiles ?? [];

  const isAdminRole = ADMIN_ROLES.has((member.role ?? "").toLowerCase());

  const [profileId, setProfileId] = useState<string | null>(member.accessProfileId);
  const [draft, setDraft] = useState<PartialModulePermissions>(emptyModulePermissions());

  const profilePerms = useMemo<PartialModulePermissions>(() => {
    const p = profiles.find((x) => x.id === profileId);
    return p ? { ...emptyModulePermissions(), ...p.permissions } : emptyModulePermissions();
  }, [profiles, profileId]);

  useEffect(() => {
    if (!open) return;
    setProfileId(member.accessProfileId);
  }, [open, member.accessProfileId]);

  useEffect(() => {
    if (!open) return;
    setDraft(mergeModulePermissions(profilePerms, member.modulePermissions));
  }, [open, profilePerms, member.modulePermissions]);

  const customized = hasCustomOverrides(profilePerms, draft);
  const selectedProfileName = profiles.find((p) => p.id === profileId)?.name ?? null;

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          brandId,
          userId: member.userId,
          accessProfileId: profileId,
          modulePermissions: customized
            ? (diffFromProfile(profilePerms, draft) as Record<ModuleKey, ModuleLevel>)
            : null,
        },
      }),
    onSuccess: () => {
      toast.success("Permissões atualizadas.");
      qc.invalidateQueries({ queryKey: ["brand-team", brandId] });
      qc.invalidateQueries({ queryKey: ["my-module-permissions"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Não foi possível salvar."),
  });

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          Permissões de {member.name}
        </span>
      }
      description={member.email ?? "Defina o perfil de acesso e ajuste módulo por módulo."}
    >
      <div className="space-y-4 px-6 py-5">
        {isAdminRole ? (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
            Este usuário é <strong className="text-foreground">administrador do workspace</strong>{" "}
            e por isso tem acesso total a todos os módulos. Para usar permissões por módulo, altere
            o papel para <strong className="text-foreground">Usuário</strong> na tela de equipe.
            <div className="mt-3">
              <ModulePermissionsEditor value={fullModulePermissions()} onChange={() => {}} disabled />
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid min-w-[240px] gap-2">
                <Label>Perfil de acesso</Label>
                <Select
                  value={profileId ?? "none"}
                  onValueChange={(v) => setProfileId(v === "none" ? null : v)}
                  disabled={!canEdit || profilesQ.isLoading}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Selecione um perfil" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem perfil (definir manualmente)</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Badge variant={customized ? "secondary" : "outline"} className="mb-1.5">
                {profileLabel(selectedProfileName, customized)}
              </Badge>
              {customized && canEdit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-1"
                  onClick={() => setDraft(mergeModulePermissions(profilePerms, null))}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Voltar ao perfil
                </Button>
              ) : null}
            </div>

            <ModulePermissionsEditor
              value={draft}
              baseline={profilePerms}
              disabled={!canEdit}
              onChange={(key, level) => setDraft((prev) => ({ ...prev, [key]: level }))}
            />

            <p className="text-xs text-muted-foreground">
              As permissões definem <strong>o que</strong> o usuário pode fazer. Os clientes que ele
              vê continuam controlados pelos vínculos de cliente.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button onClick={() => mut.mutate()} disabled={!canEdit || mut.isPending}>
                {mut.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                Salvar permissões
              </Button>
            </div>
          </>
        )}
      </div>
    </ExpandedModal>
  );
}
