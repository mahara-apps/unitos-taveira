import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExpandedModal, EXPANDED_MODAL_TABS_BODY } from "@/components/ui/expanded-modal";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, X, Mail, Link2, UserPlus } from "lucide-react";
import { inviteBrandMembers, addExistingUserToBrand } from "@/lib/team.functions";
import { ASSIGNABLE_ROLES, ROLE_LABEL, invitableRoles } from "@/components/settings/team-shared";
import { useAccessRole } from "@/hooks/use-access-role";
import type { BrandRole } from "@/lib/team-admin.functions";

/**
 * Papéis internos oficiais vêm de `ASSIGNABLE_ROLES` (owner | manager | user).
 * `client` pertence ao Portal e `super_admin` é um nível global do perfil —
 * nenhum dos dois é atribuível em formulário da aplicação.
 */
type Role = BrandRole;
const ROLES = ASSIGNABLE_ROLES;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;


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
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      bodyClassName={EXPANDED_MODAL_TABS_BODY}
      title={
        <span className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          Adicionar membro
        </span>
      }
      description="Convide alguém por e-mail ou vincule uma conta que já existe no Unitos."
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "invite" | "link")}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="border-b border-border/60 px-6 pt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="invite" className="gap-2">
              <Mail className="h-3.5 w-3.5" /> Convidar por e-mail
            </TabsTrigger>
            <TabsTrigger value="link" className="gap-2">
              <Link2 className="h-3.5 w-3.5" /> Vincular conta existente
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="invite"
          className="flex-1 overflow-y-auto px-6 py-6 data-[state=inactive]:hidden"
        >
          <InvitePanel brandId={brandId} onDone={onDone} onClose={close} />
        </TabsContent>
        <TabsContent
          value="link"
          className="flex-1 overflow-y-auto px-6 py-6 data-[state=inactive]:hidden"
        >
          <LinkPanel brandId={brandId} onDone={onDone} onClose={close} />
        </TabsContent>
      </Tabs>
    </ExpandedModal>
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
  // Espelha `public.can_invite_brand_role`: manager não concede owner/manager.
  const roleOptions = invitableRoles(authorityRole);
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [busy, setBusy] = useState(false);


  const commit = (raw: string) => {
    const clean = raw.trim().toLowerCase();
    if (!clean) return;
    if (!EMAIL_RE.test(clean)) {
      toast.error(`E-mail inválido: ${clean}`);
      return;
    }
    if (emails.includes(clean)) return;
    setEmails((prev) => [...prev, clean]);
    setDraft("");
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && emails.length > 0) {
      setEmails((prev) => prev.slice(0, -1));
    }
  };

  const submit = async () => {
    if (draft.trim()) commit(draft);
    const list =
      draft.trim() && EMAIL_RE.test(draft.trim().toLowerCase())
        ? Array.from(new Set([...emails, draft.trim().toLowerCase()]))
        : emails;
    if (list.length === 0) {
      toast.error("Adicione ao menos um e-mail");
      return;
    }

    setBusy(true);
    try {
      const res = await invite({
        data: { brandId, emails: list, role },
      });
      const okCount = (res.results ?? []).filter((r) => r.status !== "error").length;
      const failCount = (res.results ?? []).filter((r) => r.status === "error").length;
      if (okCount > 0)
        toast.success(
          `${okCount} convite${okCount > 1 ? "s" : ""} enviado${okCount > 1 ? "s" : ""}`,
        );
      if (failCount > 0)
        toast.error(`${failCount} falha${failCount > 1 ? "s" : ""} — verifique os e-mails`);
      onDone();
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(msg.startsWith("forbidden") ? "Apenas owners e managers podem convidar" : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="invite-emails" className="text-xs">
          E-mails
        </Label>
        <div className="min-h-[42px] rounded-md border border-input bg-transparent px-2 py-1.5 flex flex-wrap gap-1.5">
          {emails.map((e) => (
            <Badge key={e} variant="secondary" className="gap-1 pr-1 font-normal">
              {e}
              <button
                type="button"
                aria-label={`Remover ${e}`}
                onClick={() => setEmails((prev) => prev.filter((x) => x !== e))}
                className="rounded-sm hover:bg-muted p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <Input
            id="invite-emails"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            onBlur={() => draft && commit(draft)}
            placeholder={emails.length === 0 ? "pessoa@empresa.com" : ""}
            className="h-7 flex-1 min-w-[180px] border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
            autoComplete="off"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Enter, vírgula ou espaço para adicionar. O convite cria a conta automaticamente se ela não
          existir.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Papel</Label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {(roleOptions.length ? roleOptions : ROLES).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          O papel define todo o acesso (ver aba Permissões). Não há permissões individuais.
        </p>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
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
  const [role, setRole] = useState<Role>("user");
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
          ? "Membro vinculado à marca"
          : res.status === "updated"
            ? `Membro atualizado para ${role}`
            : `Já era membro com o papel ${role}`,
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
    <div className="space-y-5">
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

      <div className="space-y-1.5">
        <Label className="text-xs">Papel</Label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm"
        >
          {(roleOptions.length ? roleOptions : ROLES).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-muted-foreground">
          Admin (proprietário) pode conceder Admin, Manager ou User. Manager concede apenas User.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Vincular à marca
        </Button>
      </div>
    </div>
  );
}
