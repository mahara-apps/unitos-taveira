import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  PowerOff,
  Radio,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { useAccessRole } from "@/hooks/use-access-role";
import { KpiCard } from "@/components/ui/kpi-card";
import { DashboardPageShell } from "@/components/ui/dashboard-primitives";
import { CustomerAvatar } from "@/components/customer/customer-avatar";
import { NewCustomerWizard, CUSTOMER_SEGMENTS } from "@/components/customer/new-customer-wizard";
import {
  CHANNEL_ICON_SIZE, channelDef } from "@/components/connections/channel-meta";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import { listClients, updateClient, deleteClient } from "@/lib/workspace.functions";
import { listBrandClientChannelsFn } from "@/lib/customers-list.functions";
import { listBrandTeam } from "@/lib/team.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/customers/")({
  component: CustomersIndexPage,
});

type ClientRow = {
  id: string;
  name: string;
  legal_name?: string | null;
  cnpj?: string | null;
  description?: string | null;
  niche: string | null;
  color: string | null;
  logo_url?: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website?: string | null;
  socials?: unknown;
  is_active?: boolean;
  owner_user_id?: string | null;
  created_at: string;
  updated_at: string;
};

const ANY = "__any";

function timeAgo(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} mês${mo > 1 ? "es" : ""}`;
  return `${Math.floor(mo / 12)} ano(s)`;
}

/** Checklist do CADASTRO BÁSICO (Brand Hub não entra nesta conta). */
function basicSetup(c: ClientRow) {
  const checks = [
    { key: "Segmento", ok: !!(c.niche ?? "").trim() },
    { key: "Responsável", ok: !!c.owner_user_id },
    { key: "Contato", ok: !!(c.contact_email ?? c.contact_phone ?? "") },
    { key: "Descrição", ok: !!(c.description ?? "").trim() },
  ];
  const done = checks.filter((x) => x.ok).length;
  return { done, total: checks.length, missing: checks.filter((x) => !x.ok).map((x) => x.key) };
}

function CustomersIndexPage() {
  const { brandId } = useActiveContext();
  const { role: accessRole } = useAccessRole();
  const qc = useQueryClient();

  const navigate = useNavigate();
  const list = useServerFn(listClients);
  const update = useServerFn(updateClient);
  const remove = useServerFn(deleteClient);
  const channelsFn = useServerFn(listBrandClientChannelsFn);
  const teamFn = useServerFn(listBrandTeam);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ANY);
  const [segmentFilter, setSegmentFilter] = useState<string>(ANY);
  const [ownerFilter, setOwnerFilter] = useState<string>(ANY);
  const [channelFilter, setChannelFilter] = useState<string>(ANY);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [toDelete, setToDelete] = useState<ClientRow | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  const clientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => list({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });
  const channelsQ = useQuery({
    queryKey: ["clients-channels", brandId],
    queryFn: () => channelsFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });
  const teamQ = useQuery({
    queryKey: ["team", brandId],
    queryFn: () => teamFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  const members = (teamQ.data?.members ?? []) as Array<{
    user_id: string;
    full_name: string | null;
  }>;
  const memberName = (id?: string | null) =>
    (id && members.find((m) => m.user_id === id)?.full_name) || (id ? id.slice(0, 8) : null);

  const all = useMemo(() => (clientsQ.data ?? []) as ClientRow[], [clientsQ.data]);
  const channelsByClient = useMemo(() => channelsQ.data ?? {}, [channelsQ.data]);

  const segments = useMemo(() => {
    const set = new Set<string>();
    for (const c of all) if ((c.niche ?? "").trim()) set.add(c.niche!.trim());
    for (const s of CUSTOMER_SEGMENTS) set.add(s);
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [all]);

  const availableChannels = useMemo(() => {
    const set = new Set<string>();
    for (const rows of Object.values(channelsByClient)) for (const r of rows) set.add(r.channel);
    return [...set].sort();
  }, [channelsByClient]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((c) => {
      if (term) {
        const hay = [c.name, c.legal_name, c.niche, c.contact_name, c.contact_email]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      if (statusFilter !== ANY) {
        const active = c.is_active !== false;
        if (statusFilter === "active" && !active) return false;
        if (statusFilter === "inactive" && active) return false;
      }
      if (segmentFilter !== ANY && (c.niche ?? "").trim() !== segmentFilter) return false;
      if (ownerFilter !== ANY) {
        if (ownerFilter === "none" ? !!c.owner_user_id : c.owner_user_id !== ownerFilter)
          return false;
      }
      if (channelFilter !== ANY) {
        const chans = channelsByClient[c.id] ?? [];
        if (
          channelFilter === "none"
            ? chans.length > 0
            : !chans.some((x) => x.channel === channelFilter)
        )
          return false;
      }
      return true;
    });
  }, [all, q, statusFilter, segmentFilter, ownerFilter, channelFilter, channelsByClient]);

  const activeCount = all.filter((c) => c.is_active !== false).length;
  const inactiveCount = all.length - activeCount;
  const operatingCount = all.filter(
    (c) => c.is_active !== false && (channelsByClient[c.id] ?? []).length > 0,
  ).length;

  const filtersOn =
    !!q ||
    statusFilter !== ANY ||
    segmentFilter !== ANY ||
    ownerFilter !== ANY ||
    channelFilter !== ANY;
  const clearFilters = () => {
    setQ("");
    setStatusFilter(ANY);
    setSegmentFilter(ANY);
    setOwnerFilter(ANY);
    setChannelFilter(ANY);
  };

  const updateMut = useMutation({
    mutationFn: (args: { clientId: string; patch: Record<string, unknown> }) =>
      update({ data: { brandId: brandId!, clientId: args.clientId, patch: args.patch as never } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients", brandId] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMut = useMutation({
    mutationFn: (args: { clientId: string; is_active: boolean }) =>
      update({
        data: { brandId: brandId!, clientId: args.clientId, patch: { is_active: args.is_active } },
      }),
    onSuccess: (_r, v) => {
      toast.success(v.is_active ? "Cliente ativado" : "Cliente desativado");
      qc.invalidateQueries({ queryKey: ["clients", brandId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (clientId: string) => remove({ data: { brandId: brandId!, clientId } }),
    onSuccess: () => {
      toast.success("Cliente excluído");
      qc.invalidateQueries({ queryKey: ["clients", brandId] });
      setToDelete(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!brandId) {
    return (
      <DashboardPageShell>
        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
          Selecione um workspace no menu lateral para ver os clientes.
        </div>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell>
      <HeaderRegister onCreate={() => setWizardOpen(true)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          tone="neutral"
          icon={<Users className="h-4 w-4" />}
          label="Total de clientes"
          value={all.length}
          sub="Neste workspace"
        />
        <KpiCard
          tone="emerald"
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Ativos"
          value={activeCount}
          sub="Contas habilitadas"
        />
        <KpiCard
          tone="amber"
          icon={<PowerOff className="h-4 w-4" />}
          label="Inativos"
          value={inactiveCount}
          sub="Contas desativadas"
        />
        <KpiCard
          tone="sky"
          icon={<Radio className="h-4 w-4" />}
          label="Em operação"
          value={operatingCount}
          sub="Ativos com canal vinculado"
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card p-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por cliente, contato ou e-mail…"
            className="h-9 pl-8 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[130px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos os status</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="inactive">Inativos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={segmentFilter} onValueChange={setSegmentFilter}>
          <SelectTrigger className="h-9 w-[150px] text-xs">
            <SelectValue placeholder="Segmento" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos os segmentos</SelectItem>
            {segments.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="h-9 w-[170px] text-xs">
            <SelectValue placeholder="Responsável" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos os responsáveis</SelectItem>
            <SelectItem value="none">Sem responsável</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.user_id} value={m.user_id}>
                {m.full_name ?? m.user_id.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="h-9 w-[150px] text-xs">
            <SelectValue placeholder="Canais" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos os canais</SelectItem>
            <SelectItem value="none">Sem canal</SelectItem>
            {availableChannels.map((ch) => (
              <SelectItem key={ch} value={ch}>
                {channelDef(ch).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersOn ? (
          <Button variant="ghost" size="sm" className="h-9 gap-1 text-xs" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Limpar
          </Button>
        ) : null}
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        {clientsQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando clientes…
          </div>
        ) : rows.length === 0 ? (
          <PanelEmptyState
            icon={<Users className="h-4 w-4" />}
            text={
              all.length > 0
                ? "Nenhum cliente corresponde aos filtros aplicados."
                : accessRole === "admin"
                  ? "Nenhum cliente cadastrado ainda. Clique em “Novo cliente” para começar."
                  : "Nenhum cliente atribuído a você. Peça a um administrador para definir você como responsável ou vincular você ao cliente."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[10px] uppercase tracking-widest">Cliente</TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">Segmento</TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">Status</TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">Responsável</TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">Canais</TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Configuração
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-widest">
                  Última atividade
                </TableHead>
                <TableHead className="w-[60px] text-right text-[10px] uppercase tracking-widest">
                  Ações
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const setup = basicSetup(c);
                const chans = channelsByClient[c.id] ?? [];
                const active = c.is_active !== false;
                return (
                  <TableRow key={c.id} className="group">
                    <TableCell className="max-w-[280px]">
                      <Link
                        to="/customers/$customerId"
                        params={{ customerId: c.id }}
                        className="flex min-w-0 items-center gap-2.5"
                      >
                        <CustomerAvatar
                          name={c.name}
                          logoUrl={c.logo_url}
                          className="h-8 w-8 shrink-0"
                          textClassName="text-[11px]"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {c.name}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {(c.description ?? c.legal_name ?? "").trim() || "Sem descrição"}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(c.niche ?? "").trim() || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-5 rounded-full px-2 text-[10px] font-normal",
                          active
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-border/60 text-muted-foreground",
                        )}
                      >
                        {active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {memberName(c.owner_user_id) ?? "Sem responsável"}
                    </TableCell>
                    <TableCell>
                      {chans.length === 0 ? (
                        <span className="text-[11px] text-muted-foreground">Nenhum canal</span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          {chans.slice(0, 4).map((ch) => {
                            const def = channelDef(ch.channel);
                            const Icon = def.icon;
                            return (
                              <span key={ch.connectionId} title={`${def.label} · ${ch.label}`}>
                                <Icon className={cn(CHANNEL_ICON_SIZE, def.tone)} />
                              </span>
                            );
                          })}
                          {chans.length > 4 ? (
                            <span className="text-[10px] text-muted-foreground">
                              +{chans.length - 4}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {setup.done === setup.total ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          Cadastro completo
                        </span>
                      ) : (
                        <span
                          title={`Pendente: ${setup.missing.join(", ")}`}
                          className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                        >
                          {setup.done}/{setup.total} preenchido
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {timeAgo(c.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              navigate({
                                to: "/customers/$customerId",
                                params: { customerId: c.id },
                              })
                            }
                          >
                            Abrir cliente
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setEditing(c)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() =>
                              toggleMut.mutate({ clientId: c.id, is_active: !active })
                            }
                          >
                            <PowerOff className="mr-2 h-3.5 w-3.5" />
                            {active ? "Desativar" : "Ativar"}
                          </DropdownMenuItem>
                          {accessRole === "admin" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => {
                                  setDeleteConfirmName("");
                                  setToDelete(c);
                                }}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> Excluir
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <NewCustomerWizard brandId={brandId} open={wizardOpen} onOpenChange={setWizardOpen} />

      <EditCustomerDialog
        key={editing?.id ?? "none"}
        client={editing}
        members={members}
        submitting={updateMut.isPending}
        onOpenChange={(v) => !v && setEditing(null)}
        onSubmit={(patch) => editing && updateMut.mutate({ clientId: editing.id, patch })}
      />

      <AlertDialog
        open={!!toDelete}
        onOpenChange={(v) => {
          if (!v) {
            setToDelete(null);
            setDeleteConfirmName("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cliente?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Você está prestes a excluir <strong>{toDelete?.name}</strong>.
                </p>
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
                  Todos os dados deste cliente serão excluídos permanentemente: briefing, documentos
                  e arquivos, pautas e planejamentos, posts, projetos, tarefas, conexões e
                  histórico. <strong>Esta ação é irreversível e os dados não poderão ser
                  recuperados.</strong>
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="delete-client-confirm" className="text-xs">
                    Para confirmar, digite o nome do cliente: <strong>{toDelete?.name}</strong>
                  </Label>
                  <Input
                    id="delete-client-confirm"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={toDelete?.name ?? ""}
                    autoComplete="off"
                    disabled={deleteMut.isPending}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (toDelete && deleteConfirmName.trim() === toDelete.name.trim()) {
                  deleteMut.mutate(toDelete.id);
                }
              }}
              disabled={
                deleteMut.isPending ||
                !toDelete ||
                deleteConfirmName.trim() !== toDelete.name.trim()
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Excluir permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardPageShell>
  );
}

function HeaderRegister({ onCreate }: { onCreate: () => void }) {
  usePageHeader(
    {
      title: "Clientes",
      subtitle: "Gerencie seus clientes e acompanhe suas contas.",
      actions: (
        <Button size="sm" onClick={onCreate} className="h-9 gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Novo cliente
        </Button>
      ),
    },
    [onCreate],
  );
  return null;
}

const EditSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da empresa").max(120),
  legal_name: z.string().trim().max(200),
  cnpj: z.string().trim().max(24),
  niche: z.string().trim().min(2, "Informe o segmento").max(120),
  description: z.string().trim().max(2000),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^https?:\/\/.+\..+/.test(v), "Use uma URL válida (https://…)"),
  contact_name: z.string().trim().max(120),
  contact_email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido"),
  contact_phone: z.string().trim().max(40),
  owner_user_id: z.string().uuid("Selecione o responsável pela conta"),
  is_active: z.boolean(),
});

/** Edição do CADASTRO BÁSICO — mesmos campos do wizard, sem nada estratégico. */
function EditCustomerDialog({
  client,
  members,
  submitting,
  onOpenChange,
  onSubmit,
}: {
  client: ClientRow | null;
  members: Array<{ user_id: string; full_name: string | null }>;
  submitting: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (patch: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState({
    name: client?.name ?? "",
    legal_name: client?.legal_name ?? "",
    cnpj: client?.cnpj ?? "",
    niche: client?.niche ?? "",
    description: client?.description ?? "",
    website: client?.website ?? "",
    contact_name: client?.contact_name ?? "",
    contact_email: client?.contact_email ?? "",
    contact_phone: client?.contact_phone ?? "",
    owner_user_id: client?.owner_user_id ?? "",
    is_active: client?.is_active !== false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof values, v: string | boolean) => setValues((s) => ({ ...s, [k]: v }));

  const submit = () => {
    const parsed = EditSchema.safeParse(values);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[i.path.join(".")] = i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    const d = parsed.data;
    onSubmit({
      name: d.name,
      legal_name: d.legal_name || null,
      cnpj: d.cnpj || null,
      niche: d.niche,
      description: d.description || null,
      website: d.website || null,
      contact_name: d.contact_name || null,
      contact_email: d.contact_email || null,
      contact_phone: d.contact_phone || null,
      owner_user_id: d.owner_user_id,
      is_active: d.is_active,
    });
  };

  const segmentKnown = CUSTOMER_SEGMENTS.includes(
    values.niche as (typeof CUSTOMER_SEGMENTS)[number],
  );

  return (
    <Dialog open={!!client} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar cadastro</DialogTitle>
          <DialogDescription>
            Dados básicos do cliente. Informações estratégicas continuam no Cérebro da Marca.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-xs">Nome da empresa *</Label>
            <Input
              className="mt-1"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
            />
            {errors.name ? <p className="mt-1 text-xs text-destructive">{errors.name}</p> : null}
          </div>
          <div>
            <Label className="text-xs">Razão social</Label>
            <Input
              className="mt-1"
              value={values.legal_name}
              onChange={(e) => set("legal_name", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">CNPJ</Label>
            <Input
              className="mt-1"
              value={values.cnpj}
              onChange={(e) => set("cnpj", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Segmento *</Label>
            <Select
              value={segmentKnown ? values.niche : "__other"}
              onValueChange={(v) => set("niche", v === "__other" ? "" : v)}
            >
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue placeholder="Selecionar segmento…" />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMER_SEGMENTS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
                <SelectItem value="__other">Outro</SelectItem>
              </SelectContent>
            </Select>
            {!segmentKnown ? (
              <Input
                className="mt-2"
                value={values.niche}
                onChange={(e) => set("niche", e.target.value)}
                placeholder="Informe o segmento"
              />
            ) : null}
            {errors.niche ? <p className="mt-1 text-xs text-destructive">{errors.niche}</p> : null}
          </div>
          <div>
            <Label className="text-xs">Site</Label>
            <Input
              className="mt-1"
              value={values.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://empresa.com"
            />
            {errors.website ? (
              <p className="mt-1 text-xs text-destructive">{errors.website}</p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Descrição da empresa</Label>
            <Textarea
              className="mt-1 min-h-[70px]"
              value={values.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Contato principal</Label>
            <Input
              className="mt-1"
              value={values.contact_name}
              onChange={(e) => set("contact_name", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">E-mail</Label>
            <Input
              className="mt-1"
              value={values.contact_email}
              onChange={(e) => set("contact_email", e.target.value)}
            />
            {errors.contact_email ? (
              <p className="mt-1 text-xs text-destructive">{errors.contact_email}</p>
            ) : null}
          </div>
          <div>
            <Label className="text-xs">Telefone / WhatsApp</Label>
            <Input
              className="mt-1"
              value={values.contact_phone}
              onChange={(e) => set("contact_phone", e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Responsável pela conta *</Label>
            <Select value={values.owner_user_id} onValueChange={(v) => set("owner_user_id", v)}>
              <SelectTrigger className="mt-1 h-9 text-xs">
                <SelectValue placeholder="Selecionar responsável…" />
              </SelectTrigger>
              <SelectContent>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name ?? m.user_id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.owner_user_id ? (
              <p className="mt-1 text-xs text-destructive">{errors.owner_user_id}</p>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Status</Label>
            <div className="mt-1 flex h-9 items-center justify-between rounded-md border border-border bg-background px-3">
              <span className="text-xs text-muted-foreground">
                {values.is_active ? "Cliente ativo" : "Cliente inativo"}
              </span>
              <Switch checked={values.is_active} onCheckedChange={(v) => set("is_active", v)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
