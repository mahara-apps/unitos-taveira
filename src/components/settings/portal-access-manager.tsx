import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { ExpandedModal } from "@/components/ui/expanded-modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { StatusBadge, fmtDate, fmtDateTime } from "@/components/settings/team-shared";
import {
  createPortalAccessFn,
  deletePortalAccessFn,
  listPortalAccessesFn,
  reactivatePortalAccessFn,
  revokePortalAccessFn,
  updatePortalAccessFn,
  type PortalAccess,
} from "@/lib/team-admin.functions";

type Filter = "all" | "active" | "pending" | "expired" | "revoked";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Todos" },
  { id: "active", label: "Ativos" },
  { id: "pending", label: "Pendentes" },
  { id: "expired", label: "Expirados" },
  { id: "revoked", label: "Revogados" },
];

const EXPIRY_OPTIONS = [
  { value: "never", label: "Sem expiração" },
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "365", label: "1 ano" },
];

const portalUrl = (token: string) =>
  typeof window === "undefined" ? "" : `${window.location.origin}/portal/${token}`;

/** Gestão completa dos links/sessões do portal do cliente da marca ativa. */
export function PortalAccessManager({ brandId }: { brandId: string }) {
  const qc = useQueryClient();
  const load = useServerFn(listPortalAccessesFn);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["portal-accesses", brandId],
    queryFn: () => load({ data: { brandId } }),
  });

  const [filter, setFilter] = useState<Filter>("all");
  const [term, setTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PortalAccess | null>(null);

  const accesses = useMemo(() => data?.accesses ?? [], [data]);
  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    return accesses.filter(
      (a) =>
        (filter === "all" || a.status === filter) &&
        (!q || a.clientName.toLowerCase().includes(q) || (a.label ?? "").toLowerCase().includes(q)),
    );
  }, [accesses, filter, term]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of accesses) map[a.status] = (map[a.status] ?? 0) + 1;
    return map;
  }, [accesses]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["portal-accesses", brandId] });
    qc.invalidateQueries({ queryKey: ["brand-team", brandId] });
    qc.invalidateQueries({ queryKey: ["portal-link"] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Acessos do portal do cliente</CardTitle>
          <CardDescription>
            Links white-label por cliente. Cada cliente mantém um único acesso ativo; o histórico
            fica disponível nos filtros.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={(data?.clients ?? []).length === 0}
        >
          <Plus className="mr-2 h-4 w-4" />
          Novo acesso do portal
        </Button>
      </CardHeader>

      <CardContent className="space-y-4 p-0">
        <div className="flex flex-col gap-3 px-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  filter === f.id
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted",
                )}
              >
                {f.label}
                {f.id !== "all" && counts[f.id] ? ` (${counts[f.id]})` : ""}
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Buscar por cliente ou rótulo"
              className="h-9 pl-8 text-sm"
            />
          </div>
        </div>

        <div className="hidden grid-cols-[minmax(0,1.4fr)_110px_120px_120px_140px_48px] items-center gap-4 border-y border-border/60 bg-muted/30 px-6 py-2 text-[11px] uppercase tracking-wider text-muted-foreground lg:grid">
          <div>Cliente / rótulo</div>
          <div>Status</div>
          <div>Criado em</div>
          <div>Expira em</div>
          <div>Último acesso</div>
          <div />
        </div>

        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="px-6 pb-6 text-sm text-destructive">
            Não foi possível carregar os acessos. {(error as Error)?.message}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 pb-8 pt-2 text-center text-sm text-muted-foreground">
            {accesses.length === 0
              ? "Nenhum acesso de portal criado nesta marca."
              : "Nenhum acesso corresponde ao filtro/busca."}
          </div>
        ) : (
          <ul className="border-t border-border/60">
            {rows.map((a) => (
              <AccessRow
                key={a.id}
                brandId={brandId}
                access={a}
                onEdit={() => setEditing(a)}
                onChanged={invalidate}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <CreateAccessModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        brandId={brandId}
        clients={data?.clients ?? []}
        activeByClient={
          new Set(
            accesses
              .filter((a) => a.status !== "revoked" && a.status !== "expired")
              .map((a) => a.clientId),
          )
        }
        onDone={invalidate}
      />
      {editing && (
        <EditAccessModal
          key={editing.id}
          open
          onOpenChange={(v) => !v && setEditing(null)}
          brandId={brandId}
          access={editing}
          onDone={invalidate}
        />
      )}
    </Card>
  );
}

function AccessRow({
  brandId,
  access,
  onEdit,
  onChanged,
}: {
  brandId: string;
  access: PortalAccess;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const revoke = useServerFn(revokePortalAccessFn);
  const reactivate = useServerFn(reactivatePortalAccessFn);
  const del = useServerFn(deletePortalAccessFn);
  const [confirm, setConfirm] = useState<null | "revoke" | "delete">(null);

  const link = portalUrl(access.token);
  const isRevoked = access.status === "revoked";

  const revokeMut = useMutation({
    mutationFn: () => revoke({ data: { brandId, tokenId: access.id } }),
    onSuccess: () => {
      toast.success("Acesso revogado. O link deixou de funcionar.");
      setConfirm(null);
      onChanged();
    },
    onError: (e: Error) => toast.error("Falha ao revogar", { description: e.message }),
  });
  const reactivateMut = useMutation({
    mutationFn: () => reactivate({ data: { brandId, tokenId: access.id } }),
    onSuccess: () => {
      toast.success("Acesso reativado.");
      onChanged();
    },
    onError: (e: Error) => toast.error("Falha ao reativar", { description: e.message }),
  });
  const deleteMut = useMutation({
    mutationFn: () => del({ data: { brandId, tokenId: access.id } }),
    onSuccess: () => {
      toast.success("Registro de acesso excluído.");
      setConfirm(null);
      onChanged();
    },
    onError: (e: Error) => toast.error("Falha ao excluir", { description: e.message }),
  });

  return (
    <li className="grid grid-cols-1 items-center gap-3 border-b border-border/60 px-6 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1.4fr)_110px_120px_120px_140px_48px] lg:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{access.clientName}</span>
          {access.status === "active" && (
            <Badge variant="secondary" className="text-[10px]">
              Link vigente
            </Badge>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {access.label || "Portal do cliente"}
          {access.createdByName ? ` · criado por ${access.createdByName}` : ""}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted-foreground lg:hidden">
          <StatusBadge status={access.status} />
          <span>Criado {fmtDate(access.createdAt)}</span>
          <span>{access.expiresAt ? `Expira ${fmtDate(access.expiresAt)}` : "Sem expiração"}</span>
        </div>
      </div>
      <div className="hidden lg:block">
        <StatusBadge status={access.status} />
      </div>
      <div className="hidden text-xs text-muted-foreground lg:block">
        {fmtDate(access.createdAt)}
      </div>
      <div className="hidden text-xs text-muted-foreground lg:block">
        {access.expiresAt ? fmtDate(access.expiresAt) : "—"}
      </div>
      <div className="hidden text-xs text-muted-foreground lg:block">
        {fmtDateTime(access.lastSeenAt)}
      </div>

      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" aria-label="Ações do acesso">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onEdit}>Editar rótulo e expiração</DropdownMenuItem>
            <DropdownMenuItem
              disabled={isRevoked}
              onClick={() => {
                navigator.clipboard.writeText(link);
                toast.success("Link copiado.");
              }}
            >
              <Copy className="mr-2 h-3.5 w-3.5" /> Copiar link
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isRevoked}
              onClick={() => window.open(link, "_blank", "noreferrer")}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" /> Abrir portal
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isRevoked ? (
              <DropdownMenuItem
                disabled={reactivateMut.isPending}
                onClick={() => reactivateMut.mutate()}
              >
                {reactivateMut.isPending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                )}
                Reativar acesso
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="text-destructive" onClick={() => setConfirm("revoke")}>
                <ShieldOff className="mr-2 h-3.5 w-3.5" /> Revogar acesso
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive" onClick={() => setConfirm("delete")}>
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir registro
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {confirm === "delete" ? "Excluir registro de acesso?" : "Revogar acesso do portal?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {confirm === "delete" ? (
                  <>
                    O registro do link <strong>{access.label || "Portal do cliente"}</strong> de{" "}
                    <strong>{access.clientName}</strong> será apagado definitivamente, junto com seu
                    histórico de último acesso. Esta ação não pode ser desfeita.
                  </>
                ) : (
                  <>
                    O link do portal de <strong>{access.clientName}</strong> deixa de conceder
                    acesso imediatamente. Quem estiver com o link recebe erro na próxima abertura.
                    Você pode reativá-lo depois ou emitir um novo.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  if (confirm === "delete") deleteMut.mutate();
                  else revokeMut.mutate();
                }}
              >
                {(deleteMut.isPending || revokeMut.isPending) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {confirm === "delete" ? "Excluir definitivamente" : "Revogar agora"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function CreateAccessModal({
  open,
  onOpenChange,
  brandId,
  clients,
  activeByClient,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  clients: Array<{ id: string; name: string }>;
  activeByClient: Set<string>;
  onDone: () => void;
}) {
  const create = useServerFn(createPortalAccessFn);
  const [clientId, setClientId] = useState("");
  const [label, setLabel] = useState("Portal do cliente");
  const [expiry, setExpiry] = useState("never");
  const [replaceActive, setReplaceActive] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);

  const hasActive = clientId ? activeByClient.has(clientId) : false;

  const mut = useMutation({
    mutationFn: () =>
      create({
        data: {
          brandId,
          clientId,
          label: label.trim() || "Portal do cliente",
          expiresInDays: expiry === "never" ? null : Number(expiry),
          replaceActive,
        },
      }),
    onSuccess: (row) => {
      setIssued(portalUrl((row as { token: string }).token));
      toast.success("Acesso do portal criado.");
      onDone();
    },
    onError: (e: Error) => toast.error("Falha ao criar acesso", { description: e.message }),
  });

  const close = () => {
    onOpenChange(false);
    setIssued(null);
    setClientId("");
    setReplaceActive(false);
  };

  return (
    <ExpandedModal
      open={open}
      onOpenChange={(v) => (v ? onOpenChange(true) : close())}
      size="sm"
      title="Novo acesso do portal"
      description="Emite um link white-label para um cliente desta marca."
      footer={
        issued ? (
          <div className="flex w-full justify-end">
            <Button onClick={close}>Concluir</Button>
          </div>
        ) : (
          <div className="flex w-full items-center justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button
              onClick={() => mut.mutate()}
              disabled={!clientId || mut.isPending || (hasActive && !replaceActive)}
            >
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar acesso
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-5 px-6 py-6">
        {issued ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Link gerado. Copie e envie ao cliente.</p>
            <div className="break-all rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-xs">
              {issued}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(issued);
                toast.success("Link copiado.");
              }}
            >
              <Copy className="mr-2 h-3.5 w-3.5" /> Copiar link
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {activeByClient.has(c.id) ? " · já tem acesso ativo" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Rótulo</Label>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Portal do cliente"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Expiração</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasActive && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={replaceActive}
                  onChange={(e) => setReplaceActive(e.target.checked)}
                />
                <span>
                  Este cliente já tem um acesso ativo. Marque para{" "}
                  <strong>revogar o link atual</strong> e substituí-lo pelo novo — o link antigo
                  para de funcionar imediatamente.
                </span>
              </label>
            )}
          </>
        )}
      </div>
    </ExpandedModal>
  );
}

function EditAccessModal({
  open,
  onOpenChange,
  brandId,
  access,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  access: PortalAccess;
  onDone: () => void;
}) {
  const update = useServerFn(updatePortalAccessFn);
  const [label, setLabel] = useState(access.label ?? "Portal do cliente");
  const [expiry, setExpiry] = useState<string>("keep");

  const mut = useMutation({
    mutationFn: () =>
      update({
        data: {
          brandId,
          tokenId: access.id,
          label: label.trim() || "Portal do cliente",
          ...(expiry === "keep"
            ? {}
            : { expiresInDays: expiry === "never" ? null : Number(expiry) }),
        },
      }),
    onSuccess: () => {
      toast.success("Acesso atualizado.");
      onDone();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Falha ao salvar", { description: e.message }),
  });

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Editar acesso do portal"
      description={`${access.clientName} · criado em ${fmtDate(access.createdAt)}`}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </div>
      }
    >
      <div className="space-y-5 px-6 py-6">
        <div className="space-y-1.5">
          <Label className="text-xs">Rótulo</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Expiração</Label>
          <Select value={expiry} onValueChange={setExpiry}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="keep">
                Manter atual ({access.expiresAt ? fmtDate(access.expiresAt) : "sem expiração"})
              </SelectItem>
              {EXPIRY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          Status atual: <StatusBadge status={access.status} /> · último acesso{" "}
          {fmtDateTime(access.lastSeenAt)}
        </div>
      </div>
    </ExpandedModal>
  );
}
