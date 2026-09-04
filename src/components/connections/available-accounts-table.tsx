import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Copy, Link2, ListFilter, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CHANNEL_ICON_SIZE, channelDef } from "@/components/connections/channel-meta";
import type { DiscoveredAccountsResult } from "@/lib/meta/discovery.functions";
import { cn } from "@/lib/utils";

/**
 * Listagem de "Contas disponíveis" (Central de Canais).
 *
 * Camada 100% de apresentação: recebe as contas EXATAMENTE como a descoberta
 * atual da Meta devolveu (`DiscoveredAccountsResult.accounts`) e apenas
 * busca / filtra / ordena / pagina esse conjunto. Nunca inventa contas, nunca
 * consulta o banco e nunca altera OAuth, vínculo, reconexão ou revogação.
 */

type Account = DiscoveredAccountsResult["accounts"][number];

type SortKey = "name_asc" | "name_desc" | "recent";

export type AvailableFilters = {
  channel: "all" | "facebook" | "instagram" | "whatsapp" | "ads" | "other";
  status: "all" | "ready" | "attention";
  kind: "all" | "page" | "instagram";
  auth: "all" | "authorized" | "problem";
  sort: SortKey;
};

/** Abas de tipo de ativo (WhatsApp/Ads ainda não são descobertos pela Meta). */
const CHANNEL_TABS: Array<{ value: AvailableFilters["channel"]; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "ads", label: "Ads" },
  { value: "other", label: "Outros" },
];

const DEFAULT_FILTERS: AvailableFilters = {
  channel: "all",
  status: "all",
  kind: "all",
  auth: "all",
  sort: "recent",
};

const PAGE_SIZES = [25, 50, 100] as const;

function normalize(v: string) {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isReady(a: Account) {
  return a.status === "ready";
}

function AccountIdCell({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="group flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      title={`${label}: ${value}`}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
    >
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">{label}</span>
      <span className="truncate font-mono">{value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-health-good" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

function AuthBadge({ ready }: { ready: boolean }) {
  return (
    <Badge
      variant="outline"
      title={
        ready
          ? "Autorizada na descoberta atual da Meta"
          : "A Meta não confirmou as permissões desta conta"
      }
      className={cn(
        "h-6 gap-1.5 px-2 text-xs font-medium",
        ready
          ? "border-health-good/30 bg-health-good/10 text-health-good"
          : "border-severity-warning/30 bg-severity-warning/10 text-severity-warning",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {ready ? "Autorizada" : "Com atenção"}
    </Badge>
  );
}

export function AvailableAccountsTable({
  accounts,
  canManage,
  onLink,
  emptyDescription,
  actions,
  clientByExternalId,
  hideControls = false,
}: {
  accounts: Account[];
  canManage: boolean;
  onLink: (account: Account) => void;
  /** Texto do estado "sem contas disponíveis" (contexto vem do chamador). */
  emptyDescription: string;
  /** Sincronizar / Autorizar — renderizados na barra de controle. */
  actions?: React.ReactNode;
  /** Cliente já vinculado ao ativo (quando existir), por ID externo da Meta. */
  clientByExternalId?: Map<string, string>;
  /**
   * Apenas apresentação: omite abas/busca/filtro/ordenação quando a tabela é
   * aberta dentro de uma tela que já oferece esses controles (evita filtros
   * duplicados). Contador, paginação e `actions` continuam visíveis.
   */
  hideControls?: boolean;
}) {
  const [rawSearch, setRawSearch] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<AvailableFilters>(DEFAULT_FILTERS);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1);

  // Busca em tempo real com debounce.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(rawSearch.trim()), 250);
    return () => window.clearTimeout(t);
  }, [rawSearch]);

  const activeFilters =
    (filters.channel !== "all" ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0) +
    (filters.kind !== "all" ? 1 : 0) +
    (filters.auth !== "all" ? 1 : 0);

  const filtered = useMemo(() => {
    const q = normalize(search);
    const rows = accounts.filter((a) => {
      if (filters.channel !== "all" && a.channel !== filters.channel) return false;
      if (filters.kind === "page" && a.channel !== "facebook") return false;
      if (filters.kind === "instagram" && a.channel !== "instagram") return false;
      if (filters.status === "ready" && !isReady(a)) return false;
      if (filters.status === "attention" && isReady(a)) return false;
      if (filters.auth === "authorized" && !isReady(a)) return false;
      if (filters.auth === "problem" && isReady(a)) return false;
      if (!q) return true;
      return normalize(
        [a.label, a.handle ?? "", a.externalId, a.pageId ?? "", a.instagramBusinessId ?? ""].join(
          " ",
        ),
      ).includes(q);
    });
    if (filters.sort === "recent") return rows;
    const dir = filters.sort === "name_asc" ? 1 : -1;
    return [...rows].sort(
      (a, b) => dir * a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }),
    );
  }, [accounts, search, filters]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);

  // Busca/filtros mudaram → volta para a primeira página.
  useEffect(() => {
    setPage(1);
  }, [search, filters, pageSize]);

  const visible = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  const hasQuery = !!search || activeFilters > 0;

  function clearAll() {
    setRawSearch("");
    setSearch("");
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  return (
    <div className="space-y-3">
      {/* ---------------------------- abas por tipo ---------------------------- */}
      {hideControls ? null : (
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1">
          {CHANNEL_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, channel: t.value }))}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                filters.channel === t.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* -------------------------- barra de controle -------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {hideControls ? null : (
        <>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            placeholder="Buscar contas, @username ou ID Meta..."
            className="h-9 pl-8 pr-8 text-sm"
          />
          {rawSearch ? (
            <button
              type="button"
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setRawSearch("")}
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-sm">
              <ListFilter className="h-4 w-4" />
              Filtrar
              {activeFilters ? (
                <Badge className="ml-0.5 h-5 min-w-5 justify-center px-1 text-[11px]">
                  {activeFilters}
                </Badge>
              ) : null}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Canal</Label>
              <Select
                value={filters.channel}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, channel: v as AvailableFilters["channel"] }))
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os canais</SelectItem>
                  <SelectItem value="facebook">Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tipo</Label>
              <Select
                value={filters.kind}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, kind: v as AvailableFilters["kind"] }))
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="page">Página do Facebook</SelectItem>
                  <SelectItem value="instagram">Instagram Business</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select
                value={filters.status}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, status: v as AvailableFilters["status"] }))
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="ready">Pronto</SelectItem>
                  <SelectItem value="attention">Com atenção</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Autorização</Label>
              <Select
                value={filters.auth}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, auth: v as AvailableFilters["auth"] }))
                }
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Qualquer autorização</SelectItem>
                  <SelectItem value="authorized">Autorizada</SelectItem>
                  <SelectItem value="problem">Problema</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {activeFilters ? (
              <>
                <Separator />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full text-xs"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                >
                  Limpar filtros
                </Button>
              </>
            ) : null}
          </PopoverContent>
        </Popover>

        <Select
          value={filters.sort}
          onValueChange={(v) => setFilters((f) => ({ ...f, sort: v as SortKey }))}
        >
          <SelectTrigger className="h-9 w-[168px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Mais recentes</SelectItem>
            <SelectItem value="name_asc">Nome A–Z</SelectItem>
            <SelectItem value="name_desc">Nome Z–A</SelectItem>
          </SelectContent>
        </Select>

        {hasQuery ? (
          <Button variant="ghost" size="sm" className="h-9 gap-1.5 text-xs" onClick={clearAll}>
            <X className="h-3.5 w-3.5" />
            Limpar
          </Button>
        ) : null}
        </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {total} conta{total === 1 ? "" : "s"} · página {safePage} de {pageCount}
          </span>
          {actions}
        </div>
      </div>

      {/* ------------------------------- tabela ------------------------------- */}
      {accounts.length === 0 ? (
        <Card className="border-dashed p-5 text-sm text-muted-foreground">
          <div className="font-medium text-foreground">Não encontramos contas disponíveis.</div>
          <p className="mt-1 text-xs">{emptyDescription}</p>
        </Card>
      ) : total === 0 ? (
        <Card className="flex flex-col items-start gap-2 border-dashed p-5">
          <div className="text-sm font-medium">Nenhuma conta corresponde aos filtros.</div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={clearAll}>
            Limpar filtros
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px] text-xs">Conta</TableHead>
                  <TableHead className="text-xs">Canal</TableHead>
                  <TableHead className="min-w-[180px] text-xs">ID Meta</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="min-w-[140px] text-xs">Cliente</TableHead>
                  <TableHead className="w-[180px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((a) => {
                  const def = channelDef(a.channel);
                  const Icon = def.icon;
                  const client =
                    clientByExternalId?.get(a.externalId) ??
                    (a.pageId ? clientByExternalId?.get(a.pageId) : undefined) ??
                    null;
                  return (
                    <TableRow key={`${a.channel}:${a.externalId}`}>
                      <TableCell className="py-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={cn(
                              "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40",
                              def.tone,
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{a.label}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {a.handle
                                ? `@${a.handle.replace(/^@/, "")}`
                                : a.channel === "facebook"
                                  ? "Página do Facebook"
                                  : "Instagram Business"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-2.5 text-sm">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon className={cn(CHANNEL_ICON_SIZE, def.tone)} />
                          {def.label}
                        </span>
                      </TableCell>
                      <TableCell className="py-2.5">
                        <AccountIdCell
                          label={a.channel === "instagram" ? "IG" : "Page"}
                          value={a.externalId}
                        />
                      </TableCell>
                      <TableCell className="py-2.5">
                        <AuthBadge ready={isReady(a)} />
                        {!isReady(a) ? (
                          <p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">
                            Autorização ativa — este ativo não está disponível no momento.
                            {a.statusReason ? ` ${a.statusReason}` : ""}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="py-2.5 text-xs">
                        {client ? (
                          <span className="truncate">{client}</span>
                        ) : (
                          <span className="text-muted-foreground">Sem cliente vinculado</span>
                        )}
                      </TableCell>
                      <TableCell className="py-2.5 text-right">
                        {canManage ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => onLink(a)}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            {client ? "Gerenciar" : isReady(a) ? "Vincular" : "Reconectar"}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* ----------------------------- paginação ---------------------------- */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Itens por página</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-8 w-[76px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>
                {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, total)} de {total}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </Button>
              <span className="px-1 text-xs text-muted-foreground">
                {safePage} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 text-xs"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                Próxima
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
