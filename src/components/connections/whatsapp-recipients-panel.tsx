// Gerenciamento de destinatários de WhatsApp (contatos do cliente, grupos e
// usuários internos). Sem inbox: aqui só se define PARA QUEM as automações e
// notificações enviam.
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Power, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createWhatsappRecipient,
  deleteWhatsappRecipient,
  listWhatsappEligibleUsers,
  listWhatsappRecipients,
  updateWhatsappRecipient,
} from "@/lib/whatsapp-recipients.functions";
import {
  WHATSAPP_RECIPIENT_LABELS,
  WHATSAPP_RECIPIENT_TYPES,
  type WhatsappRecipientRow,
  type WhatsappRecipientType,
} from "@/lib/whatsapp/types";
import { listClients } from "@/lib/workspace.functions";

const NEEDS_CLIENT: WhatsappRecipientType[] = [
  "client_contact",
  "account_manager",
  "whatsapp_group",
];

export function WhatsappRecipientsPanel({
  brandId,
  canManage,
  clientId: lockedClientId,
  title = "Destinatários",
  hint = "Usados por automações, notificações e templates.",
}: {
  brandId: string | null;
  canManage: boolean;
  /** Quando informado, a lista e o cadastro ficam presos a este cliente. */
  clientId?: string;
  title?: string;
  hint?: string;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listWhatsappRecipients);
  const clientsFn = useServerFn(listClients);
  const usersFn = useServerFn(listWhatsappEligibleUsers);
  const createFn = useServerFn(createWhatsappRecipient);
  const updateFn = useServerFn(updateWhatsappRecipient);
  const deleteFn = useServerFn(deleteWhatsappRecipient);

  const [type, setType] = useState<WhatsappRecipientType>("client_contact");
  const [clientIdState, setClientId] = useState<string>(lockedClientId ?? "");
  const clientId = lockedClientId ?? clientIdState;
  const [name, setName] = useState("");
  const [roleLabel, setRoleLabel] = useState("");
  const [destination, setDestination] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [editing, setEditing] = useState<WhatsappRecipientRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editDestination, setEditDestination] = useState("");

  const key = ["whatsapp-recipients", brandId, lockedClientId ?? null] as const;

  const { data: recipients = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      listFn({ data: { brandId: brandId!, clientId: lockedClientId ?? null } }),
    enabled: !!brandId,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["whatsapp-recipients-clients", brandId],
    queryFn: () => clientsFn({ data: { brandId: brandId! } }),
    enabled: !!brandId && !lockedClientId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["whatsapp-recipients-users", brandId],
    queryFn: () => usersFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const needsClient = NEEDS_CLIENT.includes(type);
  const needsDestination = type === "client_contact" || type === "whatsapp_group";
  const needsUser = type === "workspace_user";

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          brandId: brandId!,
          clientId: needsClient ? clientId : null,
          type,
          name: name.trim(),
          roleLabel: roleLabel.trim() || null,
          destination: needsDestination ? destination.trim() : null,
          userId: needsUser ? userId : null,
        },
      }),
    onSuccess: () => {
      setName("");
      setRoleLabel("");
      setDestination("");
      setUserId("");
      toast.success("Destinatário cadastrado.");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao cadastrar o destinatário."),
  });

  const toggle = useMutation({
    mutationFn: (input: { recipientId: string; isActive: boolean }) =>
      updateFn({ data: { brandId: brandId!, ...input } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar."),
  });

  const saveEdit = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          brandId: brandId!,
          recipientId: editing!.id,
          name: editName.trim(),
          roleLabel: editRole.trim() || null,
          ...(editing!.destination !== null ? { destination: editDestination.trim() } : {}),
        },
      }),
    onSuccess: () => {
      setEditing(null);
      toast.success("Destinatário atualizado.");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar o destinatário."),
  });

  const remove = useMutation({
    mutationFn: (recipientId: string) => deleteFn({ data: { brandId: brandId!, recipientId } }),
    onSuccess: () => {
      toast.success("Destinatário removido.");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Falha ao remover."),
  });

  const canSubmit = useMemo(() => {
    if (!brandId || !canManage || name.trim().length < 2) return false;
    if (needsClient && !clientId) return false;
    if (needsDestination && destination.trim().length < 5) return false;
    if (needsUser && !userId) return false;
    return true;
  }, [brandId, canManage, name, needsClient, clientId, needsDestination, destination, needsUser, userId]);

  if (!brandId) return null;

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold">{title}</h3>
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        </div>

        {canManage ? (
          <div className="grid gap-2 md:grid-cols-6">
            <Select value={type} onValueChange={(v) => setType(v as WhatsappRecipientType)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WHATSAPP_RECIPIENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {WHATSAPP_RECIPIENT_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {needsClient && !lockedClientId ? (
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Cliente" />
                </SelectTrigger>
                <SelectContent>
                  {(clients as Array<{ id: string; name: string }>).map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="hidden md:block" />
            )}

            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome (ex.: João)"
              className="h-8 text-xs"
            />
            <Input
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              placeholder="Função (ex.: Financeiro)"
              className="h-8 text-xs"
            />

            {needsDestination ? (
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={
                  type === "whatsapp_group" ? "ID do grupo (…@g.us)" : "Telefone com DDD"
                }
                className="h-8 text-xs"
              />
            ) : needsUser ? (
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Usuário" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.userId} value={u.userId} className="text-xs">
                      {u.name}
                      {u.hasWhatsapp ? "" : " (sem WhatsApp)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center text-[11px] text-muted-foreground">
                Telefone vem do cadastro do usuário.
              </div>
            )}

            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!canSubmit || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Plus className="mr-1 h-3 w-3" />
              )}
              Adicionar
            </Button>
          </div>
        ) : null}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando destinatários…</p>
        ) : recipients.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum destinatário cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Destinatário</TableHead>
                <TableHead className="text-xs">Tipo</TableHead>
                <TableHead className="text-xs">Cliente</TableHead>
                <TableHead className="text-xs">Destino</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                {canManage ? <TableHead /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...recipients]
                .sort((a, b) =>
                  (a.clientName ?? "\uffff").localeCompare(b.clientName ?? "\uffff") ||
                  a.name.localeCompare(b.name),
                )
                .map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">
                    <span className="font-medium">{r.userName ?? r.name}</span>
                    {r.roleLabel ? (
                      <span className="text-muted-foreground"> · {r.roleLabel}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">{WHATSAPP_RECIPIENT_LABELS[r.type]}</TableCell>
                  <TableCell className="text-xs">{r.clientName ?? "—"}</TableCell>
                  <TableCell className="text-xs">
                    {r.destination ?? <span className="text-muted-foreground">dinâmico</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.isActive ? "default" : "outline"} className="text-[10px]">
                      {r.isActive ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Editar"
                        onClick={() => {
                          setEditing(r);
                          setEditName(r.name);
                          setEditRole(r.roleLabel ?? "");
                          setEditDestination(r.destination ?? "");
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title={r.isActive ? "Desativar" : "Ativar"}
                        onClick={() =>
                          toggle.mutate({ recipientId: r.id, isActive: !r.isActive })
                        }
                      >
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        title="Remover"
                        onClick={() => remove.mutate(r.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Dialog open={!!editing} onOpenChange={(open) => (!open ? setEditing(null) : null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">Editar destinatário</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Nome</Label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Função</Label>
                <Input
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              {editing?.destination !== null && editing?.destination !== undefined ? (
                <div className="space-y-1">
                  <Label className="text-[11px]">
                    {editing.type === "whatsapp_group" ? "ID do grupo" : "Telefone"}
                  </Label>
                  <Input
                    value={editDestination}
                    onChange={(e) => setEditDestination(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={editName.trim().length < 2 || saveEdit.isPending}
                onClick={() => saveEdit.mutate()}
              >
                {saveEdit.isPending ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : null}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
