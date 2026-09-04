import { Fragment, useMemo, useState } from "react";
import {
  ArrowUpDown,
  ChevronRight,
  Link2,
  MessageCircle,
  MoreHorizontal,
  Plug,
  RefreshCw,
  Search,
  Settings2,
  Unlink,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { channelDef, formatRelative } from "@/components/connections/channel-meta";
import type { WorkspaceChannel } from "@/lib/client-channels.functions";
import type { EvolutionInstanceRow } from "@/lib/evolution-instances.functions";
import { cn } from "@/lib/utils";

/**
 * Tabela cliente-a-cliente da tela de Integrações.
 *
 * SOMENTE apresentação: nenhuma chamada de OAuth, banco ou server function
 * acontece aqui. Todos os dados vêm por props (`channels` de
 * `listWorkspaceChannelsFn`, `whatsapp` de `listEvolutionInstances`) e todas as
 * ações são delegadas ao componente pai, que mantém os fluxos existentes.
 */

/* ---------------------------------- status --------------------------------- */

export type ChannelHealth =
  | "connected"
  | "attention"
  | "error"
  | "disconnected"
  | "reconnecting"
  | "soon";

const HEALTH_META: Record<ChannelHealth, { label: string; dot: string; chip: string }> = {
  connected: {
    label: "Conectado",
    dot: "bg-health-good",
    chip: "border-health-good/30 bg-health-good/10 text-health-good",
  },
  attention: {
    label: "Atenção",
    dot: "bg-severity-warning",
    chip: "border-severity-warning/30 bg-severity-warning/10 text-severity-warning",
  },
  error: {
    label: "Erro",
    dot: "bg-severity-critical",
    chip: "border-severity-critical/30 bg-severity-critical/10 text-severity-critical",
  },
  reconnecting: {
    label: "Reconectando",
    dot: "bg-primary",
    chip: "border-primary/30 bg-primary/10 text-primary",
  },
  disconnected: {
    label: "Não conectado",
    dot: "bg-muted-foreground/40",
    chip: "border-border bg-muted/40 text-muted-foreground",
  },
  soon: {
    label: "Em breve",
    dot: "bg-muted-foreground/25",
    chip: "border-dashed border-border bg-muted/20 text-muted-foreground",
  },
};

/** Pior estado primeiro: usado na ordenação por status. */
const HEALTH_WEIGHT: Record<ChannelHealth, number> = {
  error: 0,
  attention: 1,
  reconnecting: 2,
  connected: 3,
  disconnected: 4,
  soon: 5,
};

export function HealthBadge({ health, className }: { health: ChannelHealth; className?: string }) {
  const m = HEALTH_META[health];
  return (
    <Badge
      variant="outline"
      className={cn("h-5 gap-1 px-1.5 text-[11px] font-medium", m.chip, className)}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </Badge>
  );
}

export function metaChannelHealth(row: WorkspaceChannel): ChannelHealth {
  if (row.status === "revoked" || row.status === "error") return "error";
  if (row.status === "attention" || row.status === "expired") return "attention";
  if (row.status === "active") return row.lastError ? "attention" : "connected";
  return "disconnected";
}

function whatsappHealth(row: EvolutionInstanceRow): ChannelHealth {
  const s = (row.status ?? "").toLowerCase();
  if (s === "connected") return "connected";
  if (s === "connecting" || s === "qr" || s === "pairing") return "reconnecting";
  if (s === "error" || s === "failed") return "error";
  if (row.lastError) return "attention";
  return "disconnected";
}

/* --------------------------------- colunas -------------------------------- */

type ColumnKey =
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "youtube"
  | "linkedin"
  | "tiktok"
  | "threads"
  | "twitter";

const COLUMNS: Array<{ key: ColumnKey; label: string; meta: boolean }> = [
  { key: "facebook", label: "Facebook", meta: true },
  { key: "instagram", label: "Instagram", meta: true },
  { key: "whatsapp", label: "WhatsApp", meta: false },
  { key: "youtube", label: "Google / YouTube", meta: false },
  { key: "linkedin", label: "LinkedIn", meta: false },
  { key: "tiktok", label: "TikTok", meta: false },
  { key: "threads", label: "Threads", meta: false },
  { key: "twitter", label: "X / Twitter", meta: false },
];

const AVAILABLE_COLUMNS = new Set<ColumnKey>(["facebook", "instagram", "whatsapp"]);

function columnIcon(key: ColumnKey) {
  if (key === "whatsapp") return MessageCircle;
  return channelDef(key).icon;
}

/* ---------------------------------- tipos --------------------------------- */

export type ClientLite = {
  id: string;
  name: string;
  logoUrl?: string | null;
  color?: string | null;
};

type CellKind =
  | { kind: "meta"; row: WorkspaceChannel; health: ChannelHealth }
  | { kind: "whatsapp"; row: EvolutionInstanceRow; health: ChannelHealth }
  | { kind: "empty"; health: ChannelHealth };

type ClientRow = {
  client: ClientLite | null;
  cells: Record<ColumnKey, CellKind>;
  metaChannels: WorkspaceChannel[];
  whatsapp: EvolutionInstanceRow[];
  lastSyncedAt: string | null;
  worst: ChannelHealth;
  connectedCount: number;
  haystack: string;
};

export type ChannelActions = {
  onConnect: () => void;
  onReconnect: (row: WorkspaceChannel) => void;
  onManage: (row: WorkspaceChannel) => void;
  onLink: (row: WorkspaceChannel) => void;
  onManageWhatsapp: () => void;
};

/* ---------------------------------- tabela -------------------------------- */

export function ClientsChannelsTable({
  clients,
  channels,
  whatsapp,
  canManage,
  loading,
  reconnectingIds,
  actions,
}: {
  clients: ClientLite[];
  channels: WorkspaceChannel[];
  whatsapp: EvolutionInstanceRow[];
  canManage: boolean;
  loading: boolean;
  reconnectingIds?: string[];
  actions: ChannelActions;
}) {
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<"all" | ColumnKey>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ChannelHealth>("all");
  const [sort, setSort] = useState<"name" | "status" | "sync">("name");
  const [expanded, setExpanded] = useState<string | null>(null);

  const reconnecting = useMemo(() => new Set(reconnectingIds ?? []), [reconnectingIds]);

  const rows = useMemo<ClientRow[]>(() => {
    const byClient = new Map<string, WorkspaceChannel[]>();
    const orphans: WorkspaceChannel[] = [];
    for (const ch of channels) {
      if (ch.status === "revoked" || ch.status === "disconnected") continue;
      if (!ch.clients.length) orphans.push(ch);
      for (const c of ch.clients) {
        const arr = byClient.get(c.id) ?? [];
        arr.push(ch);
        byClient.set(c.id, arr);
      }
    }
    const waByClient = new Map<string, EvolutionInstanceRow[]>();
    const waShared: EvolutionInstanceRow[] = [];
    for (const inst of whatsapp) {
      if (!inst.clientId) {
        waShared.push(inst);
        continue;
      }
      const arr = waByClient.get(inst.clientId) ?? [];
      arr.push(inst);
      waByClient.set(inst.clientId, arr);
    }

    function build(client: ClientLite | null, metaList: WorkspaceChannel[]): ClientRow {
      const waList = client ? (waByClient.get(client.id) ?? []) : [];
      const cells = {} as Record<ColumnKey, CellKind>;
      for (const col of COLUMNS) {
        if (col.key === "whatsapp") {
          const inst =
            waList.find((i) => i.status === "connected") ?? waList[0] ?? waShared[0] ?? null;
          cells.whatsapp = inst
            ? { kind: "whatsapp", row: inst, health: whatsappHealth(inst) }
            : { kind: "empty", health: "disconnected" };
          continue;
        }
        const match =
          metaList.find((c) => c.channel === col.key && c.status === "active") ??
          metaList.find((c) => c.channel === col.key) ??
          null;
        if (match) {
          const health = reconnecting.has(match.connectionId)
            ? "reconnecting"
            : metaChannelHealth(match);
          cells[col.key] = { kind: "meta", row: match, health };
        } else {
          cells[col.key] = {
            kind: "empty",
            health: AVAILABLE_COLUMNS.has(col.key) ? "disconnected" : "soon",
          };
        }
      }
      const syncs = metaList
        .map((c) => c.lastSyncedAt)
        .filter((v): v is string => !!v)
        .sort();
      const healths = COLUMNS.map((c) => cells[c.key].health).filter(
        (h) => h !== "soon" && h !== "disconnected",
      );
      const worst =
        healths.sort((a, b) => HEALTH_WEIGHT[a] - HEALTH_WEIGHT[b])[0] ?? "disconnected";
      return {
        client,
        cells,
        metaChannels: metaList,
        whatsapp: waList,
        lastSyncedAt: syncs.length ? syncs[syncs.length - 1] : null,
        worst,
        connectedCount: COLUMNS.filter((c) => cells[c.key].health === "connected").length,
        haystack: [
          client?.name ?? "sem cliente",
          ...metaList.flatMap((c) => [
            c.accountLabel,
            c.handle ?? "",
            c.externalId,
            c.pageId ?? "",
            c.instagramBusinessId ?? "",
          ]),
          ...waList.map((i) => `${i.label ?? ""} ${i.phoneNumber ?? ""} ${i.instanceName}`),
        ]
          .join(" ")
          .toLowerCase(),
      };
    }

    const list = clients.map((c) => build(c, byClient.get(c.id) ?? []));
    if (orphans.length) list.unshift(build(null, orphans));
    return list;
  }, [clients, channels, whatsapp, reconnecting]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (clientFilter !== "all" && (r.client?.id ?? "orphan") !== clientFilter) return false;
      if (channelFilter !== "all") {
        const cell = r.cells[channelFilter];
        if (cell.kind === "empty") return false;
        if (statusFilter !== "all" && cell.health !== statusFilter) return false;
      } else if (statusFilter !== "all") {
        const has = COLUMNS.some((c) => r.cells[c.key].health === statusFilter);
        if (!has) return false;
      }
      if (q && !r.haystack.includes(q)) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "status") return HEALTH_WEIGHT[a.worst] - HEALTH_WEIGHT[b.worst];
      if (sort === "sync") return (b.lastSyncedAt ?? "").localeCompare(a.lastSyncedAt ?? "");
      return (a.client?.name ?? "").localeCompare(b.client?.name ?? "", "pt-BR");
    });
    // Canais sem cliente ficam sempre no topo: exigem ação.
    return sorted.sort((a, b) => Number(!!a.client) - Number(!!b.client));
  }, [rows, search, clientFilter, channelFilter, statusFilter, sort]);

  const totals = useMemo(() => {
    let connected = 0;
    let needsAction = 0;
    for (const r of rows) {
      for (const col of COLUMNS) {
        const h = r.cells[col.key].health;
        if (h === "connected") connected += 1;
        if (h === "attention" || h === "error") needsAction += 1;
      }
    }
    return { connected, needsAction };
  }, [rows]);

  return (
    <section className="space-y-3">
      {/* -------------------------------- controles ------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente, @username ou ID"
            className="h-9 pl-8 text-xs"
          />
        </div>
        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="h-9 w-[168px] text-xs">
            <SelectValue placeholder="Cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os clientes</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-xs">
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={channelFilter}
          onValueChange={(v) => setChannelFilter(v as typeof channelFilter)}
        >
          <SelectTrigger className="h-9 w-[150px] text-xs">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os canais</SelectItem>
            {COLUMNS.map((c) => (
              <SelectItem key={c.key} value={c.key} className="text-xs">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
        >
          <SelectTrigger className="h-9 w-[152px] text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {(
              ["connected", "attention", "error", "reconnecting", "disconnected"] as ChannelHealth[]
            ).map((h) => (
              <SelectItem key={h} value={h} className="text-xs">
                {HEALTH_META[h].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
          <SelectTrigger className="h-9 w-[168px] text-xs">
            <ArrowUpDown className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name" className="text-xs">
              Nome (A–Z)
            </SelectItem>
            <SelectItem value="status" className="text-xs">
              Status (críticos primeiro)
            </SelectItem>
            <SelectItem value="sync" className="text-xs">
              Última sincronização
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-health-good" />
          {totals.connected} canal(is) conectado(s)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-severity-warning" />
          {totals.needsAction} precisa(m) de ação
        </span>
        <span>
          {visible.length} de {rows.length} cliente(s)
        </span>
      </div>

      {/* ---------------------------------- tabela --------------------------------- */}
      {loading ? (
        <Card className="space-y-2 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </Card>
      ) : visible.length === 0 ? (
        <Card className="flex flex-col items-start gap-2 border-dashed p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Users className="h-4 w-4 text-muted-foreground" />
            {rows.length ? "Nenhum cliente com esses filtros" : "Nenhum cliente neste workspace"}
          </div>
          <p className="text-xs text-muted-foreground">
            {rows.length
              ? "Ajuste a busca, o canal ou o status para ver os demais clientes."
              : "Cadastre um cliente para começar a vincular canais."}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-8" />
                  <TableHead className="min-w-[200px] text-xs">Cliente</TableHead>
                  {COLUMNS.map((c) => {
                    const Icon = columnIcon(c.key);
                    return (
                      <TableHead key={c.key} className="w-[64px] text-center text-xs">
                        <span
                          className="inline-flex items-center justify-center gap-1"
                          title={c.label}
                        >
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </span>
                      </TableHead>
                    );
                  })}
                  <TableHead className="w-[124px] text-xs">Sincronização</TableHead>
                  <TableHead className="w-[130px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => {
                  const key = r.client?.id ?? "orphan";
                  const isOpen = expanded === key;
                  return (
                    <Fragment key={key}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : key)}
                      >
                        <TableCell className="py-2 pr-0">
                          <ChevronRight
                            className={cn(
                              "h-3.5 w-3.5 text-muted-foreground transition-transform",
                              isOpen && "rotate-90",
                            )}
                          />
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex min-w-0 items-center gap-2">
                            {r.client ? (
                              <>
                                <Avatar className="h-7 w-7 shrink-0">
                                  <AvatarImage
                                    src={r.client.logoUrl ?? undefined}
                                    alt={r.client.name}
                                  />
                                  <AvatarFallback className="text-[10px] uppercase">
                                    {r.client.name.slice(0, 2)}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium">
                                    {r.client.name}
                                  </div>
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {r.connectedCount
                                      ? `${r.connectedCount} canal(is) ativo(s)`
                                      : "Nenhum canal ativo"}
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-severity-warning">
                                  Sem cliente vinculado
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {r.metaChannels.length} canal(is) aguardando vínculo
                                </div>
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {COLUMNS.map((col) => (
                          <TableCell key={col.key} className="py-2 text-center">
                            <ChannelCell
                              column={col}
                              cell={r.cells[col.key]}
                              clientName={r.client?.name ?? null}
                              canManage={canManage}
                              actions={actions}
                            />
                          </TableCell>
                        ))}

                        <TableCell className="py-2 whitespace-nowrap text-[11px] text-muted-foreground">
                          {formatRelative(r.lastSyncedAt)}
                        </TableCell>
                        <TableCell className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {canManage ? (
                              r.client ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1.5 px-2 text-xs"
                                  onClick={actions.onConnect}
                                >
                                  <Plug className="h-3.5 w-3.5" />
                                  Conectar
                                </Button>
                              ) : r.metaChannels.length ? (
                                // Grupo "Sem cliente vinculado": vincular daqui
                                // escolheria um canal arbitrário. Abrimos a lista,
                                // onde cada canal tem seu próprio "Vincular".
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 gap-1.5 px-2 text-xs"
                                  onClick={() => setExpanded(isOpen ? null : key)}
                                >
                                  <Link2 className="h-3.5 w-3.5" />
                                  Vincular a um cliente

                                </Button>
                              ) : null
                            ) : null}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                  <MoreHorizontal className="h-4 w-4" />
                                  <span className="sr-only">Ações avançadas</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem
                                  className="text-xs"
                                  onClick={() => setExpanded(isOpen ? null : key)}
                                >
                                  <Settings2 className="mr-2 h-3.5 w-3.5" />
                                  {isOpen ? "Recolher detalhes" : "Ver detalhes dos canais"}
                                </DropdownMenuItem>
                                {canManage ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-xs"
                                      onClick={actions.onConnect}
                                    >
                                      <Plug className="mr-2 h-3.5 w-3.5" />
                                      Conectar Meta
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-xs"
                                      onClick={actions.onManageWhatsapp}
                                    >
                                      <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                      Gerenciar WhatsApp
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>

                      {isOpen ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={COLUMNS.length + 4} className="bg-muted/20 p-3">
                            <ClientChannelDetails row={r} canManage={canManage} actions={actions} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </section>
  );
}

/* --------------------------------- células -------------------------------- */

function ChannelCell({
  column,
  cell,
  clientName,
  canManage,
  actions,
}: {
  column: { key: ColumnKey; label: string; meta: boolean };
  cell: CellKind;
  clientName: string | null;
  canManage: boolean;
  actions: ChannelActions;
}) {
  const Icon = columnIcon(column.key);
  const m = HEALTH_META[cell.health];
  const soon = cell.health === "soon";

  const trigger = (
    <button
      type="button"
      disabled={soon}
      onClick={(e) => e.stopPropagation()}
      title={`${column.label} · ${m.label}`}
      className={cn(
        "relative mx-auto grid h-8 w-8 place-items-center rounded-lg border transition-colors",
        soon
          ? "cursor-default border-dashed border-border/60 opacity-40"
          : "border-border/70 hover:bg-accent",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4",
          cell.health === "connected" && column.key !== "whatsapp"
            ? channelDef(column.key).tone
            : cell.health === "connected"
              ? "text-emerald-500"
              : "text-muted-foreground",
        )}
      />
      <span
        className={cn(
          "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card",
          m.dot,
          cell.health === "reconnecting" && "animate-pulse",
        )}
      />
    </button>
  );

  if (soon) return trigger;

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="center"
        className="w-72 space-y-3 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  column.key === "whatsapp" ? "text-emerald-500" : channelDef(column.key).tone,
                )}
              />
              {column.label}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {clientName ?? "Sem cliente vinculado"}
            </p>
          </div>
          <HealthBadge health={cell.health} />
        </div>

        {cell.kind === "meta" ? (
          <div className="space-y-1 rounded-lg border bg-muted/30 p-2 text-[11px] text-muted-foreground">
            <div className="truncate font-medium text-foreground">{cell.row.accountLabel}</div>
            {cell.row.handle ? (
              <div className="truncate">@{cell.row.handle.replace(/^@/, "")}</div>
            ) : null}
            <div className="truncate font-mono">
              {cell.row.pageId ?? cell.row.instagramBusinessId ?? cell.row.externalId}
            </div>
            <div>Sincronizado {formatRelative(cell.row.lastSyncedAt)}</div>
          </div>
        ) : cell.kind === "whatsapp" ? (
          <div className="space-y-1 rounded-lg border bg-muted/30 p-2 text-[11px] text-muted-foreground">
            <div className="truncate font-medium text-foreground">
              {cell.row.label ?? cell.row.instanceName}
            </div>
            {cell.row.phoneNumber ? <div className="truncate">{cell.row.phoneNumber}</div> : null}
            <div>Estado {formatRelative(cell.row.lastStateAt)}</div>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Este canal ainda não está conectado para {clientName ?? "este cliente"}.
          </p>
        )}

        {canManage ? (
          <div className="flex flex-wrap gap-1.5">
            {cell.kind === "meta" ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => actions.onReconnect(cell.row as WorkspaceChannel)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Reconectar
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 gap-1.5 px-2 text-xs"
                  onClick={() => actions.onManage(cell.row as WorkspaceChannel)}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Gerenciar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => actions.onManage(cell.row as WorkspaceChannel)}
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Desconectar
                </Button>
              </>
            ) : cell.kind === "whatsapp" ? (
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={actions.onManageWhatsapp}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Gerenciar WhatsApp
              </Button>
            ) : column.key === "whatsapp" ? (
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={actions.onManageWhatsapp}
              >
                <Plug className="h-3.5 w-3.5" />
                Conectar
              </Button>
            ) : (
              <Button size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={actions.onConnect}>
                <Plug className="h-3.5 w-3.5" />
                Conectar
              </Button>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/* --------------------------------- detalhes -------------------------------- */

function ClientChannelDetails({
  row,
  canManage,
  actions,
}: {
  row: ClientRow;
  canManage: boolean;
  actions: ChannelActions;
}) {
  if (!row.metaChannels.length && !row.whatsapp.length) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Nenhum canal conectado para {row.client?.name ?? "este grupo"}. Use “Conectar” para
        autorizar um canal e vinculá-lo.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {row.metaChannels.map((ch) => {
        const def = channelDef(ch.channel);
        const Icon = def.icon;
        return (
          <div
            key={ch.connectionId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-2.5 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarImage src={ch.avatarUrl ?? undefined} alt={ch.accountLabel} />
                <AvatarFallback className="text-[9px] uppercase">
                  {ch.channel.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon className={cn("h-3.5 w-3.5", def.tone)} />
                  <span className="truncate">{ch.accountLabel}</span>
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {ch.handle ? `@${ch.handle.replace(/^@/, "")} · ` : ""}
                  {ch.pageId ?? ch.instagramBusinessId ?? ch.externalId} ·{" "}
                  {formatRelative(ch.lastSyncedAt)}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <HealthBadge health={metaChannelHealth(ch)} />
              {canManage ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => actions.onReconnect(ch)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Reconectar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-xs"
                    onClick={() => actions.onManage(ch)}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Gerenciar
                  </Button>
                  {!ch.clients.length ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 px-2 text-xs"
                      onClick={() => actions.onLink(ch)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Vincular
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        );
      })}

      {row.whatsapp.map((inst) => (
        <div
          key={inst.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-2.5 py-2"
        >
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{inst.label ?? inst.instanceName}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              WhatsApp {inst.phoneNumber ? `· ${inst.phoneNumber}` : ""} ·{" "}
              {formatRelative(inst.lastStateAt)}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <HealthBadge health={whatsappHealth(inst)} />
            {canManage ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={actions.onManageWhatsapp}
              >
                <Settings2 className="h-3.5 w-3.5" />
                Gerenciar
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Legenda compacta dos status (usada no cabeçalho da tela). */
export function ChannelStatusLegend() {
  const order: ChannelHealth[] = [
    "connected",
    "attention",
    "error",
    "disconnected",
    "reconnecting",
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {order.map((h) => (
        <span key={h} className="inline-flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", HEALTH_META[h].dot)} />
          {HEALTH_META[h].label}
        </span>
      ))}
    </div>
  );
}
