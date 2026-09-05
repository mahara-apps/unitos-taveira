import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  createPortalContactFn,
  listPortalContactsFn,
  removePortalContactFn,
  resetPortalContactPasswordFn,
} from "@/lib/portal-accounts.functions";
import { getPortalAccessConfigFn, savePortalAccessConfigFn } from "@/lib/portal-config.functions";
import {
  PORTAL_MODULES,
  PORTAL_PERMISSION_LABEL,
  type PortalPermissionLevel,
  type PortalPermissions,
} from "@/lib/portal-permissions";

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;

/**
 * Acesso do cliente ao Portal — contatos com login próprio e permissões por
 * módulo do cliente. Vários contatos podem existir; as permissões valem para
 * todos eles e são aplicadas no servidor.
 */
export function PortalAccessSection({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const listContacts = useServerFn(listPortalContactsFn);
  const createContact = useServerFn(createPortalContactFn);
  const resetContact = useServerFn(resetPortalContactPasswordFn);
  const removeContact = useServerFn(removePortalContactFn);
  const loadConfig = useServerFn(getPortalAccessConfigFn);

  const [addOpen, setAddOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string; sent: boolean } | null>(
    null,
  );

  const contactsQ = useQuery({
    queryKey: ["portal-contacts", clientId],
    queryFn: () => listContacts({ data: { clientId } }),
    staleTime: 30_000,
  });
  const configQ = useQuery({
    queryKey: ["portal-access-config", clientId],
    queryFn: () => loadConfig({ data: { clientId } }),
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["portal-contacts", clientId] });
    qc.invalidateQueries({ queryKey: ["portal-access-config", clientId] });
  };

  const resetMut = useMutation({
    mutationFn: (vars: { userId: string; sendEmail: boolean }) =>
      resetContact({ data: { clientId, ...vars } }),
    onSuccess: (res) => {
      setSecret({ email: res.email, password: res.tempPassword, sent: res.emailSent });
      toast.success("Nova senha provisória gerada.");
      invalidate();
    },
    onError: (e: Error) => toast.error("Falha ao gerar senha", { description: e.message }),
  });

  const removeMut = useMutation({
    mutationFn: (userId: string) => removeContact({ data: { clientId, userId } }),
    onSuccess: () => {
      toast.success("Acesso removido.");
      invalidate();
    },
    onError: (e: Error) => toast.error("Falha ao remover acesso", { description: e.message }),
  });

  const contacts = contactsQ.data?.contacts ?? [];
  const permissions = configQ.data?.permissions;
  const activeModules = permissions
    ? PORTAL_MODULES.filter((m) => permissions[m.id] !== "none")
    : [];

  return (
    <div className="space-y-4 border-t border-border/60 px-6 pb-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">Acesso do cliente (login)</span>
          <Badge variant="outline" className="text-[10px]">
            {contacts.length} {contacts.length === 1 ? "contato" : "contatos"}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfigOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" />
            Permissões
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Adicionar contato
          </Button>
        </div>
      </div>

      {contactsQ.isLoading ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : contacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum contato com login. Cada contato recebe e-mail e senha provisória e só vê os dados
          deste cliente.
        </p>
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li
              key={c.userId}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">
                    {c.fullName ?? "Contato do cliente"}
                  </span>
                  {c.state === "pending_password" ? (
                    <Badge className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600">
                      Senha pendente
                    </Badge>
                  ) : (
                    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600">
                      Ativo
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px]">{c.email}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {c.lastSeenAt ? `Último acesso ${fmtDateTime(c.lastSeenAt)}` : "Nunca acessou"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1.5"
                  disabled={resetMut.isPending}
                  onClick={() => {
                    if (!window.confirm("Gerar nova senha provisória para este contato?")) return;
                    resetMut.mutate({ userId: c.userId, sendEmail: true });
                  }}
                >
                  {resetMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  <span className="hidden sm:inline">Nova senha</span>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remover acesso"
                  disabled={removeMut.isPending}
                  onClick={() => {
                    if (!window.confirm("Remover o acesso deste contato?")) return;
                    removeMut.mutate(c.userId);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {permissions && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>O cliente vê:</span>
          {activeModules.length === 0 ? (
            <span>nada liberado</span>
          ) : (
            activeModules.map((m) => (
              <Badge key={m.id} variant="outline" className="text-[10px]">
                {m.label} · {PORTAL_PERMISSION_LABEL[permissions[m.id]].toLowerCase()}
              </Badge>
            ))
          )}
        </div>
      )}

      {secret && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          <div className="text-[11px] font-medium text-amber-600">
            Senha provisória — visível só agora.
            {secret.sent ? " Também enviada por e-mail." : " O e-mail não foi enviado."}
          </div>
          <div className="break-all font-mono text-xs">
            {secret.email}
            <br />
            {secret.password}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                navigator.clipboard.writeText(
                  `E-mail: ${secret.email}\nSenha provisória: ${secret.password}`,
                );
                toast.success("Credenciais copiadas.");
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copiar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
              Já copiei
            </Button>
          </div>
        </div>
      )}

      <AddContactDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        suggestedEmail={contactsQ.data?.suggestedEmail ?? null}
        suggestedName={contactsQ.data?.suggestedName ?? null}
        onCreate={(vars) => createContact({ data: { clientId, ...vars } })}
        onCreated={(res) => {
          setSecret({ email: res.email, password: res.tempPassword, sent: res.emailSent });
          setAddOpen(false);
          invalidate();
        }}
      />

      <PortalPermissionsDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        clientId={clientId}
        onSaved={invalidate}
      />
    </div>
  );
}

/* --------------------------- adicionar contato ---------------------------- */

function AddContactDialog({
  open,
  onOpenChange,
  suggestedEmail,
  suggestedName,
  onCreate,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suggestedEmail: string | null;
  suggestedName: string | null;
  onCreate: (vars: {
    email: string;
    fullName?: string;
    sendEmail: boolean;
  }) => Promise<{ email: string; tempPassword: string; emailSent: boolean; emailError?: string }>;
  onCreated: (res: { email: string; tempPassword: string; emailSent: boolean }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sendEmail, setSendEmail] = useState(true);

  useEffect(() => {
    if (!open) return;
    setEmail(suggestedEmail ?? "");
    setName(suggestedName ?? "");
    setSendEmail(true);
  }, [open, suggestedEmail, suggestedName]);

  const mut = useMutation({
    mutationFn: () =>
      onCreate({
        email: email.trim(),
        ...(name.trim() ? { fullName: name.trim() } : {}),
        sendEmail,
      }),
    onSuccess: (res) => {
      toast.success("Acesso criado.", {
        description: res.emailSent
          ? "Convite enviado por e-mail."
          : (res.emailError ?? "Copie a senha provisória agora."),
      });
      onCreated(res);
    },
    onError: (e: Error) => toast.error("Falha ao criar acesso", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar contato do cliente</DialogTitle>
          <DialogDescription>
            Um acesso por pessoa. O contato entra com e-mail e senha e escolhe a senha definitiva no
            primeiro acesso.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="portal-contact-name">Nome</Label>
            <Input
              id="portal-contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do contato"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal-contact-email">E-mail</Label>
            <Input
              id="portal-contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contato@empresa.com"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs">Enviar convite por e-mail</span>
            </div>
            <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="gap-1.5"
            disabled={mut.isPending || !email.trim()}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Criar acesso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------- permissões e atendimento ------------------------ */

function PortalPermissionsDialog({
  open,
  onOpenChange,
  clientId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  onSaved: () => void;
}) {
  const load = useServerFn(getPortalAccessConfigFn);
  const save = useServerFn(savePortalAccessConfigFn);
  const configQ = useQuery({
    queryKey: ["portal-access-config", clientId],
    queryFn: () => load({ data: { clientId } }),
    enabled: open,
  });

  const [perms, setPerms] = useState<PortalPermissions | null>(null);
  const [owner, setOwner] = useState<string>("none");

  useEffect(() => {
    if (!configQ.data) return;
    setPerms(configQ.data.permissions);
    setOwner(configQ.data.ownerUserId ?? "none");
  }, [configQ.data]);

  const team = useMemo(() => configQ.data?.team ?? [], [configQ.data]);

  const mut = useMutation({
    mutationFn: () =>
      save({
        data: {
          clientId,
          permissions: perms as unknown as Record<string, PortalPermissionLevel>,
          ownerUserId: owner === "none" ? null : owner,
        },
      }),
    onSuccess: () => {
      toast.success("Permissões salvas.");
      onSaved();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Falha ao salvar", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Permissões do cliente no portal</DialogTitle>
          <DialogDescription>
            Vale para todos os contatos deste cliente. O bloqueio é aplicado no servidor.
          </DialogDescription>
        </DialogHeader>

        {configQ.isLoading || !perms ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Responsável pelo atendimento
              </Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger>
                  <SelectValue placeholder="Sem responsável" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem responsável</SelectItem>
                  {team.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ul className="space-y-2">
              {PORTAL_MODULES.map((mod) => (
                <li
                  key={mod.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{mod.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {mod.viewOnly ? mod.description : `${mod.description} Interagir: ${mod.interact}.`}
                    </div>
                  </div>
                  <Select
                    value={perms[mod.id]}
                    onValueChange={(v) =>
                      setPerms((prev) =>
                        prev ? { ...prev, [mod.id]: v as PortalPermissionLevel } : prev,
                      )
                    }
                  >
                    <SelectTrigger className="w-[150px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{PORTAL_PERMISSION_LABEL.none}</SelectItem>
                      <SelectItem value="view">{PORTAL_PERMISSION_LABEL.view}</SelectItem>
                      {!mod.viewOnly && (
                        <SelectItem value="interact">{PORTAL_PERMISSION_LABEL.interact}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="gap-1.5"
            disabled={mut.isPending || !perms}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
