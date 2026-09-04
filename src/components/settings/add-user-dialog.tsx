import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Copy, KeyRound, Loader2, Mail, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExpandedModal, EXPANDED_MODAL_TABS_BODY } from "@/components/ui/expanded-modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listAccessProfiles } from "@/lib/access-profiles.functions";
import { addPerson, inviteBrandMembers } from "@/lib/team.functions";
import { useAccessRole } from "@/hooks/use-access-role";
import { ROLE_LABEL, invitableRoles } from "@/components/settings/team-shared";
import type { BrandRole } from "@/lib/team-admin.functions";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Adiciona um colaborador ao workspace de duas formas:
 *  - Convite por e-mail (a pessoa cria a própria senha ao aceitar);
 *  - Criar acesso agora (senha temporária gerada e enviada por e-mail).
 * Em ambos os casos escolhe-se o papel e o perfil de acesso inicial.
 */
export function AddUserDialog({
  open,
  onOpenChange,
  brandId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { authorityRole } = useAccessRole();
  const roleOptions = invitableRoles(authorityRole);
  const loadProfiles = useServerFn(listAccessProfiles);
  const invite = useServerFn(inviteBrandMembers);
  const create = useServerFn(addPerson);

  const profilesQ = useQuery({
    queryKey: ["access-profiles", brandId],
    queryFn: () => loadProfiles({ data: { brandId } }),
    enabled: open && !!brandId,
  });
  const profiles = profilesQ.data?.profiles ?? [];

  const [tab, setTab] = useState<"invite" | "create">("invite");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<BrandRole>("user");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setEmail("");
    setFullName("");
    setRole("user");
    setProfileId(null);
    setTempPassword(null);
    setTab("invite");
  }, [open]);

  useEffect(() => {
    if (profileId || profiles.length === 0) return;
    const preset = profiles.find((p) => p.key === "atendimento") ?? profiles[0];
    if (preset) setProfileId(preset.id);
  }, [profiles, profileId]);

  const emailOk = EMAIL_RE.test(email.trim().toLowerCase());
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["brand-team", brandId] });
    qc.invalidateQueries({ queryKey: ["team-members", brandId] });
    onDone?.();
  };

  const submitInvite = async () => {
    if (!emailOk) return toast.error("Informe um e-mail válido.");
    setBusy(true);
    try {
      await invite({
        data: {
          brandId,
          emails: [email.trim().toLowerCase()],
          role,
          accessProfileId: profileId,
        },
      });
      toast.success("Convite enviado.");
      refresh();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível convidar.");
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async () => {
    if (!emailOk) return toast.error("Informe um e-mail válido.");
    setBusy(true);
    try {
      const res = (await create({
        data: {
          brandId,
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          role,
          sendEmail: true,
          accessProfileId: profileId,
        },
      })) as { tempPassword?: string | null } | null;
      const pwd = res?.tempPassword ?? null;
      setTempPassword(pwd);
      toast.success(
        pwd ? "Acesso criado. Senha temporária gerada." : "Acesso criado e e-mail enviado.",
      );
      refresh();
      if (!pwd) onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar o acesso.");
    } finally {
      setBusy(false);
    }
  };

  const commonFields = (
    <>
      <div className="grid gap-2">
        <Label htmlFor="add-user-email">E-mail</Label>
        <Input
          id="add-user-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="pessoa@agencia.com.br"
          autoComplete="off"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Papel no workspace</Label>
          <Select value={role} onValueChange={(v) => setRole(v as BrandRole)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roleOptions.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label>Perfil de acesso inicial</Label>
          <Select
            value={profileId ?? "none"}
            onValueChange={(v) => setProfileId(v === "none" ? null : v)}
            disabled={profilesQ.isLoading}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sem perfil (definir depois)</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        O perfil define o que a pessoa pode fazer em cada módulo. Depois é possível ajustar módulo
        por módulo em Permissões. Papéis <strong>Admin</strong> e <strong>Manager</strong> já têm
        acesso total, independentemente do perfil.
      </p>
    </>
  );

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      bodyClassName={EXPANDED_MODAL_TABS_BODY}
      title={
        <span className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" /> Adicionar usuário
        </span>
      }
      description="Convide por e-mail ou crie o acesso imediatamente com senha temporária."
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "invite" | "create")}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-border/60 px-6 pt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="invite" className="gap-2">
              <Mail className="h-3.5 w-3.5" /> Convidar por e-mail
            </TabsTrigger>
            <TabsTrigger value="create" className="gap-2">
              <KeyRound className="h-3.5 w-3.5" /> Criar acesso agora
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="invite"
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5 data-[state=inactive]:hidden"
        >
          {commonFields}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={submitInvite} disabled={busy || !emailOk}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Enviar convite
            </Button>
          </div>
        </TabsContent>

        <TabsContent
          value="create"
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5 data-[state=inactive]:hidden"
        >
          <div className="grid gap-2">
            <Label htmlFor="add-user-name">Nome completo</Label>
            <Input
              id="add-user-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nome do colaborador"
            />
          </div>
          {commonFields}
          {tempPassword ? (
            <div className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Badge variant="secondary">Senha temporária</Badge>
                <code className="rounded bg-background px-2 py-1 text-xs">{tempPassword}</code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => {
                    void navigator.clipboard.writeText(tempPassword);
                    toast.success("Senha copiada.");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Guarde agora — ela não será exibida novamente. A pessoa deve trocá-la no primeiro
                acesso.
              </p>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {tempPassword ? "Fechar" : "Cancelar"}
            </Button>
            <Button onClick={submitCreate} disabled={busy || !emailOk || !!tempPassword}>
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Criar acesso
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </ExpandedModal>
  );
}
