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
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createPortalContactFn,
  listPortalContactsFn,
  removePortalContactFn,
  resetPortalContactPasswordFn,
} from "@/lib/portal-accounts.functions";
import { getPortalAccessConfigFn, savePortalAccessConfigFn } from "@/lib/portal-config.functions";
import {
  PORTAL_MODULES,
  type PortalPermissionLevel,
  type PortalPermissions,
} from "@/lib/portal-permissions";

/**
 * Assistente "Acesso do Cliente" — 3 etapas:
 *  1. Contatos com login próprio (e-mail + senha provisória / convite).
 *  2. Responsável do atendimento na agência.
 *  3. Permissões por módulo (Visualizar / Criar e editar).
 *
 * Só UI: toda escrita reaproveita as server functions existentes, e o
 * enforcement continua no servidor.
 */

const STEPS = [
  { id: 1, label: "Cliente e contatos", hint: "Quem entra no portal" },
  { id: 2, label: "Atendimento", hint: "Responsável na agência" },
  { id: 3, label: "Permissões", hint: "O que o cliente pode fazer" },
] as const;

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null;

export function ClientAccessWizard({
  open,
  onOpenChange,
  clientId,
  clientName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName?: string | null;
}) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const listContacts = useServerFn(listPortalContactsFn);
  const createContact = useServerFn(createPortalContactFn);
  const resetContact = useServerFn(resetPortalContactPasswordFn);
  const removeContact = useServerFn(removePortalContactFn);
  const loadConfig = useServerFn(getPortalAccessConfigFn);
  const saveConfig = useServerFn(savePortalAccessConfigFn);

  const [secret, setSecret] = useState<{ email: string; password: string; sent: boolean } | null>(
    null,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [owner, setOwner] = useState("none");
  const [perms, setPerms] = useState<PortalPermissions | null>(null);

  useEffect(() => {
    if (open) return;
    setStep(1);
    setSecret(null);
    setName("");
    setEmail("");
  }, [open]);

  const contactsQ = useQuery({
    queryKey: ["portal-contacts", clientId],
    queryFn: () => listContacts({ data: { clientId } }),
    enabled: open,
    staleTime: 30_000,
  });
  const configQ = useQuery({
    queryKey: ["portal-access-config", clientId],
    queryFn: () => loadConfig({ data: { clientId } }),
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!configQ.data) return;
    setPerms(configQ.data.permissions);
    setOwner(configQ.data.ownerUserId ?? "none");
  }, [configQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["portal-contacts", clientId] });
    qc.invalidateQueries({ queryKey: ["portal-access-config", clientId] });
  };

  const contacts = contactsQ.data?.contacts ?? [];
  const team = useMemo(() => configQ.data?.team ?? [], [configQ.data]);

  const createMut = useMutation({
    mutationFn: () =>
      createContact({
        data: {
          clientId,
          email: email.trim(),
          ...(name.trim() ? { fullName: name.trim() } : {}),
          sendEmail,
        },
      }),
    onSuccess: (res) => {
      setSecret({ email: res.email, password: res.tempPassword, sent: res.emailSent });
      setName("");
      setEmail("");
      toast.success("Acesso criado.", {
        description: res.emailSent
          ? "Convite enviado por e-mail."
          : (res.emailError ?? "Copie a senha provisória agora."),
      });
      invalidate();
    },
    onError: (e: Error) => toast.error("Falha ao criar acesso", { description: e.message }),
  });

  const resetMut = useMutation({
    mutationFn: (userId: string) => resetContact({ data: { clientId, userId, sendEmail: true } }),
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

  const saveMut = useMutation({
    mutationFn: () =>
      saveConfig({
        data: {
          clientId,
          permissions: perms as unknown as Record<string, PortalPermissionLevel>,
          ownerUserId: owner === "none" ? null : owner,
        },
      }),
    onSuccess: () => {
      toast.success("Acesso do cliente salvo.");
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Falha ao salvar", { description: e.message }),
  });

  const setLevel = (id: string, level: PortalPermissionLevel) =>
    setPerms((prev) => (prev ? { ...prev, [id]: level } : prev));

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Acesso do Cliente"
      description={
        clientName
          ? `Login e senha para ${clientName} acompanhar e aprovar pelo portal.`
          : "Login e senha para o cliente acompanhar e aprovar pelo portal."
      }
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <div className="flex items-center gap-2">
          {step > 1 && (
            <Button variant="outline" onClick={() => setStep(step - 1)}>
              Voltar
            </Button>
          )}
          {step < 3 ? (
            <Button onClick={() => setStep(step + 1)}>Próximo</Button>
          ) : (
            <Button
              className="gap-1.5"
              disabled={saveMut.isPending || !perms}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Salvar acesso
            </Button>
          )}
        </div>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* etapas */}
        <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1 lg:overflow-visible">
          {STEPS.map((s) => {
            const done = s.id < step;
            const active = s.id === step;
            return (
              <li key={s.id} className="min-w-[150px] lg:min-w-0">
                <button
                  type="button"
                  onClick={() => setStep(s.id)}
                  className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    active ? "bg-primary/10 text-primary" : "hover:bg-muted"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                      done
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                        : active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : s.id}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{s.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {s.hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="min-w-0 space-y-4">
          {secret && (
            <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-600">
                <KeyRound className="h-3.5 w-3.5" />
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
                      `Endereço: ${window.location.origin}/login\nE-mail: ${secret.email}\nSenha provisória: ${secret.password}`,
                    );
                    toast.success("Credenciais copiadas.");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copiar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
                  Já copiei
                </Button>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="grid gap-3 rounded-xl border border-border/60 p-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cw-name">Nome do contato</Label>
                  <Input
                    id="cw-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex.: Ana Souza"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cw-email">E-mail</Label>
                  <Input
                    id="cw-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contato@empresa.com"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 sm:col-span-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs">
                      Enviar convite por e-mail com a senha provisória
                    </span>
                  </div>
                  <Switch checked={sendEmail} onCheckedChange={setSendEmail} />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    className="gap-1.5"
                    disabled={createMut.isPending || !email.trim()}
                    onClick={() => createMut.mutate()}
                  >
                    {createMut.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                    Adicionar contato
                  </Button>
                </div>
              </div>

              {contactsQ.isLoading ? (
                <Skeleton className="h-20 w-full rounded-xl" />
              ) : contacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum contato com login ainda. Cada contato entra pela tela de login do sistema e
                  vê somente os dados deste cliente.
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
                          {c.lastSeenAt
                            ? `Último acesso ${fmtDateTime(c.lastSeenAt)}`
                            : "Nunca acessou"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5"
                          disabled={resetMut.isPending}
                          onClick={() => {
                            if (!window.confirm("Gerar nova senha provisória para este contato?"))
                              return;
                            resetMut.mutate(c.userId);
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
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3 rounded-xl border border-border/60 p-4">
              <Label className="flex items-center gap-1.5 text-xs">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Responsável pelo atendimento
              </Label>
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="max-w-sm">
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
              <p className="text-[11px] text-muted-foreground">
                Recebe os pedidos e avisos que este cliente enviar pelo portal.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              {configQ.isLoading || !perms ? (
                <Skeleton className="h-64 w-full rounded-xl" />
              ) : (
                <>
                  <div className="hidden grid-cols-[minmax(0,1fr)_92px_110px] gap-3 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
                    <span>Área</span>
                    <span className="text-center">Visualizar</span>
                    <span className="text-center">Criar / Editar</span>
                  </div>
                  <ul className="space-y-2">
                    {PORTAL_MODULES.map((mod) => {
                      const level = perms[mod.id];
                      const canView = level !== "none";
                      const canWrite = level === "interact";
                      return (
                        <li
                          key={mod.id}
                          className="grid grid-cols-[minmax(0,1fr)_92px_110px] items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-xs font-medium">{mod.label}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {mod.viewOnly
                                ? mod.description
                                : `${mod.description} Criar/editar: ${mod.interact.toLowerCase()}.`}
                            </div>
                          </div>
                          <div className="flex justify-center">
                            <Switch
                              checked={canView}
                              aria-label={`Visualizar ${mod.label}`}
                              onCheckedChange={(v) => setLevel(mod.id, v ? "view" : "none")}
                            />
                          </div>
                          <div className="flex justify-center">
                            {mod.viewOnly ? (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            ) : (
                              <Switch
                                checked={canWrite}
                                aria-label={`Criar e editar ${mod.label}`}
                                onCheckedChange={(v) => setLevel(mod.id, v ? "interact" : "view")}
                              />
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Vale para todos os contatos deste cliente e é aplicado no servidor — não é só
                    esconder botão.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

    </ExpandedModal>
  );
}
