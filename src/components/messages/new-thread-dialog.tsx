/**
 * Nova conversa. O tipo escolhido define o escopo:
 * - Cliente: exige cliente e permite compartilhar com o contato do portal.
 * - Equipe: conversa interna direta, sem cliente e sempre interna.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Switch } from "@/components/ui/switch";
import { createThread, listThreadCandidates } from "@/lib/messaging.functions";
import { listClients } from "@/lib/workspace.functions";

type Kind = "client" | "team_dm";

export function NewThreadDialog({
  brandId,
  defaultKind = "client",
  onCreated,
}: {
  brandId: string;
  defaultKind?: Kind;
  onCreated?: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>(defaultKind);
  const [subject, setSubject] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [shared, setShared] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const fetchClients = useServerFn(listClients);
  const fetchCandidates = useServerFn(listThreadCandidates);
  const create = useServerFn(createThread);

  const clientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => fetchClients({ data: { brandId } }),
    enabled: open && !!brandId,
    staleTime: 60_000,
  });

  const candidatesQ = useQuery({
    queryKey: ["message-candidates", brandId, kind === "client" ? clientId || null : null],
    queryFn: () =>
      fetchCandidates({
        data: { brandId, clientId: kind === "client" && clientId ? clientId : null },
      }),
    enabled: open && !!brandId,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) {
      setSubject("");
      setClientId("");
      setShared(false);
      setSelected([]);
      setKind(defaultKind);
    }
  }, [open, defaultKind]);

  const contacts = useMemo(
    () => (shared ? (candidatesQ.data?.clientContacts ?? []) : []),
    [shared, candidatesQ.data],
  );
  const team = candidatesQ.data?.team ?? [];

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const mut = useMutation({
    mutationFn: () =>
      create({
        data: {
          brandId,
          scope: kind,
          subject: subject.trim(),
          clientId: kind === "client" ? clientId : null,
          visibility: kind === "client" && shared ? "shared_with_client" : "internal",
          participantIds: selected,
        },
      }),
    onSuccess: (res) => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["message-threads", brandId] });
      onCreated?.();
      navigate({ to: "/messages/$threadId", params: { threadId: res.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const valid =
    subject.trim().length >= 2 &&
    (kind === "team_dm" ? selected.length > 0 : !!clientId) &&
    !mut.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Nova conversa
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova conversa</DialogTitle>
          <DialogDescription>
            Conversas de cliente podem ser internas ou compartilhadas com o contato do portal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="team_dm">Equipe (interna)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {kind === "client" ? (
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {(clientsQ.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="thread-subject">Assunto</Label>
            <Input
              id="thread-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={kind === "client" ? "Ex.: Campanha de junho" : "Ex.: Alinhamento rápido"}
            />
          </div>

          {kind === "client" ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="thread-shared">Compartilhar com o cliente</Label>
                <p className="text-xs text-muted-foreground">
                  Quando ligado, os contatos do portal desse cliente enxergam a conversa.
                </p>
              </div>
              <Switch id="thread-shared" checked={shared} onCheckedChange={setShared} />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Participantes</Label>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border/60 p-2">
              {candidatesQ.isPending ? (
                <p className="p-2 text-xs text-muted-foreground">Carregando pessoas…</p>
              ) : (
                <>
                  {team.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selected.includes(p.id)}
                        onCheckedChange={() => toggle(p.id)}
                      />
                      <span className="truncate">{p.name}</span>
                    </label>
                  ))}
                  {contacts.length > 0 ? (
                    <>
                      <p className="px-2 pt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Contatos do cliente
                      </p>
                      {contacts.map((p) => (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={selected.includes(p.id)}
                            onCheckedChange={() => toggle(p.id)}
                          />
                          <span className="truncate">{p.name}</span>
                        </label>
                      ))}
                    </>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={!valid} onClick={() => mut.mutate()}>
            {mut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Criar conversa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
