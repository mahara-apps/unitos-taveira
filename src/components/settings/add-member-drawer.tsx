import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmailTagsInput } from "@/components/ui/email-tags-input";
import { Loader2, Mail, Link2, UserPlus } from "lucide-react";

import { inviteBrandMembers, addExistingUserToBrand } from "@/lib/team.functions";
import {
  ASSIGNABLE_ROLES,
  ROLE_ACCESS,
  ROLE_SHORT,
  invitableRoles,
} from "@/components/settings/team-shared";
import { useAccessRole } from "@/hooks/use-access-role";
import type { BrandRole } from "@/lib/team-admin.functions";

/**
 * Papéis internos oficiais vêm de `ASSIGNABLE_ROLES` (owner | admin | manager |
 * user). `client` pertence ao Portal e `super_admin` é nível global do perfil —
 * nenhum dos dois é atribuível em formulário da aplicação.
 */
type Role = BrandRole;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Seletor único de papel, com o efeito real do papel escolhido abaixo. */
function RoleSelect({
  value,
  onChange,
  options,
}: {
  value: Role;
  onChange: (r: Role) => void;
  options: Role[];
}) {
  const list = options.length ? options : ASSIGNABLE_ROLES;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Papel</Label>
      <Select value={value} onValueChange={(v) => onChange(v as Role)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Selecione o papel" />
        </SelectTrigger>
        <SelectContent>
          {list.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_SHORT[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] leading-snug text-muted-foreground">{ROLE_ACCESS[value]}</p>
    </div>
  );
}

/** Primeiro papel realmente concedível pelo ator (nunca assume USER). */
function firstGrantable(options: Role[]): Role {
  return options[options.length - 1] ?? "user";
}

export function AddMemberDrawer({
  open,
  onOpenChange,
  brandId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  onDone: () => void;
}) {
  const [tab, setTab] = useState<"invite" | "link">("invite");

  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-3rem)] gap-4 overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-primary" />
            Adicionar membro
          </DialogTitle>
          <DialogDescription className="text-xs">
            Convide alguém por e-mail ou vincule uma conta que já existe no Unitos.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "invite" | "link")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="invite" className="gap-2">
              <Mail className="h-3.5 w-3.5" /> Convidar por e-mail
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <Link2 className="h-3.5 w-3.5" /> Vincular conta
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invite" className="mt-4">
            <InvitePanel brandId={brandId} onDone={onDone} onClose={close} />
          </TabsContent>
          <TabsContent value="link" className="mt-4">
            <LinkPanel brandId={brandId} onDone={onDone} onClose={close} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Aba 1 — Convidar por e-mail (multi-e-mail, dispara inviteBrandMembers)
// ---------------------------------------------------------------------------
function InvitePanel({
  brandId,
  onDone,
  onClose,
}: {
  brandId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const invite = useServerFn(inviteBrandMembers);
  const { authorityRole } = useAccessRole();
  // Espelha `public.can_invite_brand_role`: manager não concede owner/admin.
  const roleOptions = invitableRoles(authorityRole);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<Role>(() => firstGrantable(roleOptions));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (emails.length === 0) {
      toast.error("Adicione ao menos um e-mail");
      return;
    }
    const list = emails;



    setBusy(true);
    try {
      const res = await invite({
        data: { brandId, emails: list, role },
      });
      const okCount = (res.results ?? []).filter((r) => r.status !== "error").length;
      const failCount = (res.results ?? []).filter((r) => r.status === "error").length;
      if (okCount > 0)
        toast.success(
          `${okCount} convite${okCount > 1 ? "s" : ""} enviado${okCount > 1 ? "s" : ""} como ${ROLE_SHORT[role]}`,
        );
      if (failCount > 0)
        toast.error(`${failCount} falha${failCount > 1 ? "s" : ""} — verifique os e-mails`);
      onDone();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(msg.startsWith("forbidden") ? "Você não pode conceder esse papel" : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="invite-emails" className="text-xs">
          E-mails
        </Label>
        <EmailTagsInput
          id="invite-emails"
          value={emails}
          onChange={setEmails}
          hint="Enter, vírgula ou espaço para adicionar. O convite cria a conta se ela não existir."
          disabled={busy}
        />
      </div>


      <RoleSelect value={role} onChange={setRole} options={roleOptions} />

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviar convite{emails.length > 1 ? "s" : ""}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba 2 — Vincular conta existente (sem e-mail, atribuição direta)
// ---------------------------------------------------------------------------
function LinkPanel({
  brandId,
  onDone,
  onClose,
}: {
  brandId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const link = useServerFn(addExistingUserToBrand);
  const { authorityRole } = useAccessRole();
  // Espelha `public.can_invite_brand_role`: só oferecemos papéis que o ator
  // realmente pode conceder — o INSERT continua validado no servidor/RLS.
  const roleOptions = invitableRoles(authorityRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(() => firstGrantable(roleOptions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      toast.error("E-mail inválido");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await link({
        data: { brandId, email: clean, role },
      });
      if (res.status === "not_found") {
        setError("Nenhum usuário com esse e-mail. Use a aba Convidar para criar a conta.");
        return;
      }
      toast.success(
        res.status === "added"
          ? `Membro vinculado como ${ROLE_SHORT[role]}`
          : res.status === "updated"
            ? `Membro atualizado para ${ROLE_SHORT[role]}`
            : `Já era membro com o papel ${ROLE_SHORT[role]}`,
      );
      onDone();
      onClose();
    } catch (e) {
      // Mensagem técnica real do servidor (já traduzida em team.functions.ts).
      setError((e as Error).message || "Falha ao vincular a conta.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="link-email" className="text-xs">
          E-mail do usuário
        </Label>
        <Input
          id="link-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="pessoa@empresa.com"
        />
        <p className="text-[11px] text-muted-foreground">
          Deve ser uma conta já cadastrada no Unitos. Se não existir, use a aba Convidar.
        </p>
      </div>

      <RoleSelect value={role} onChange={setRole} options={roleOptions} />

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button size="sm" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Vincular à marca
        </Button>
      </div>
    </div>
  );
}
