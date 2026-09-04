import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar as CalendarIcon,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  FileBarChart2,
  Filter,
  Layers,
  Plus,
  Search,
  Send,
  TrendingUp,
  User as UserIcon,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import { listClients } from "@/lib/workspace.functions";
import { listBrandTeam } from "@/lib/team.functions";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { KpiCard } from "@/components/ui/kpi-card";
import { DashboardPageShell, DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { createProject, listProjects, type ProjectStats } from "@/lib/projects.functions";
import { NewFromTemplateDialog } from "@/components/projects/new-from-template-dialog";
import { PlanStatusBadge } from "@/lib/monthly-plan-status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, LayoutGrid, List as ListIcon, Palette, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProjectCard } from "@/components/projects/project-card";

const VIEWS = ["cards", "list"] as const;
type ViewMode = (typeof VIEWS)[number];
const COLOR_BYS = ["project", "status", "client"] as const;
type ColorBy = (typeof COLOR_BYS)[number];

const VIEW_STORAGE_KEY = "projects:view";
const COLORBY_STORAGE_KEY = "projects:colorBy";

const projectsSearchSchema = z.object({
  view: z.enum(VIEWS).optional(),
  colorBy: z.enum(COLOR_BYS).optional(),
});

export const Route = createFileRoute("/_authenticated/projects/")({
  validateSearch: projectsSearchSchema,
  component: ProjectsIndexPage,
});

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

// Requisições penduradas deixavam a tela em esqueleto infinito (parecia
// "cliente sem projetos"). Aqui elas falham de forma visível.
const REQUEST_TIMEOUT_MS = 20_000;
const SLOW_HINT_MS = 8_000;

function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  outer: AbortSignal | undefined,
  ms = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) onAbort();
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(new Error("Tempo esgotado ao carregar os dados.")),
    ms,
  );
  return run(controller.signal).finally(() => {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  });
}

/** Sinaliza carregamento anormalmente longo, sem travar a tela. */
function useSlowHint(active: boolean, ms = SLOW_HINT_MS) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return slow;
}



const COLORS = [
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f43f5e", // rose
  "#f59e0b", // amber
  "#10b981", // emerald
  "#0ea5e9", // sky
  "#71717a", // neutral
];

const STATUS_META: Record<string, { label: string; className: string }> = {
  planning: { label: "Planejamento", className: "border-border/60 bg-muted text-muted-foreground" },
  active: {
    label: "Ativa",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  in_progress: {
    label: "Em execução",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  paused: {
    label: "Pausada",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  done: {
    label: "Concluída",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  archived: { label: "Arquivada", className: "border-border/60 bg-muted text-muted-foreground" },
};

// Cor de destaque por status (leitura rápida no modo cards).
const STATUS_ACCENT: Record<string, string> = {
  planning: "#71717a",
  active: "#10b981",
  in_progress: "#0ea5e9",
  paused: "#f59e0b",
  done: "#10b981",
  archived: "#a1a1aa",
};

const SORT_LABELS: Record<SortKey, string> = {
  due: "Entrega mais próxima",
  name: "Nome",
  client: "Cliente",
  status: "Status",
  progress: "Progresso",
};

const COLOR_BY_LABELS: Record<ColorBy, string> = {
  project: "Cor do projeto",
  status: "Status",
  client: "Cliente",
};



const ProjectSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto"),
  client_id: z.string().uuid().nullable(),
  owner_id: z.string().uuid().nullable(),
  status: z.enum(["planning", "active", "in_progress", "paused", "done"]),
  color: z.string(),
  start_date: z.string().nullable(),
  due_at: z.string().nullable(),
  goals: z.string().max(4000).optional(),
});
type ProjectFormValues = z.infer<typeof ProjectSchema>;

function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

type SortKey = "name" | "client" | "status" | "due" | "progress";
type SortDir = "asc" | "desc";

function ClientFilterCombobox(props: {
  value: string;
  onChange: (v: string) => void;
  clients: Array<{ id: string; name: string; color: string | null }>;
  sidebarClientId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const selected = props.clients.find((c) => c.id === props.value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-[220px] justify-between px-3 text-xs font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected ? (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: selected.color ?? "#8b5cf6" }}
              />
            ) : (
              <UserIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{selected ? selected.name : "Todos os clientes"}</span>
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar cliente..." className="h-9 text-xs" />
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
              Nenhum cliente encontrado.
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="Todos os clientes"
                onSelect={() => {
                  props.onChange("all");
                  setOpen(false);
                }}
                className="text-xs"
              >
                <Check
                  className={cn(
                    "mr-2 h-3.5 w-3.5",
                    props.value === "all" ? "opacity-100" : "opacity-0",
                  )}
                />
                Todos os clientes
              </CommandItem>
              {props.clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.name}
                  onSelect={() => {
                    props.onChange(c.id);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5",
                      props.value === c.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span
                    className="mr-2 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: c.color ?? "#8b5cf6" }}
                  />
                  <span className="truncate">{c.name}</span>
                  {props.sidebarClientId === c.id ? (
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground">
                      sidebar
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SortHeader(props: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const isActive = props.active === props.sortKey;
  return (
    <TableHead className={props.className}>
      <button
        type="button"
        onClick={() => props.onSort(props.sortKey)}
        className={cn(
          "flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition-colors hover:text-foreground",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {props.label}
        {isActive ? (
          props.dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : null}
      </button>
    </TableHead>
  );
}

function FilterChip(props: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClear}
      className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      {props.label}
      <X className="h-3 w-3" />
    </button>
  );
}

function ProjectsIndexPage() {
  const { brandId, clientId: activeClientId } = useActiveContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useServerFn(listProjects);
  const create = useServerFn(createProject);
  const clientsFn = useServerFn(listClients);
  const teamFn = useServerFn(listBrandTeam);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  // Com cliente ativo na sidebar, o escopo fica travado nesse cliente.
  const [clientFilter, setClientFilter] = useState<string>(activeClientId ?? "all");
  useEffect(() => {
    if (activeClientId) setClientFilter(activeClientId);
  }, [activeClientId]);
  const effectiveClientId = activeClientId ?? (clientFilter === "all" ? null : clientFilter);
  const [sortKey, setSortKey] = useState<SortKey>("due");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [formOpen, setFormOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  // Visualização: cards é o padrão; URL manda, senão a última escolha salva.
  const search = Route.useSearch();
  const [view, setViewState] = useState<ViewMode>(search.view ?? "cards");
  const [colorBy, setColorByState] = useState<ColorBy>(search.colorBy ?? "project");
  useEffect(() => {
    if (!search.view) setViewState(readStored(VIEW_STORAGE_KEY, VIEWS, "cards"));
    if (!search.colorBy) setColorByState(readStored(COLORBY_STORAGE_KEY, COLOR_BYS, "project"));
    // Só na montagem: depois disso a fonte da verdade é a interação do usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setView = useCallback(
    (v: ViewMode) => {
      setViewState(v);
      if (typeof window !== "undefined") window.localStorage.setItem(VIEW_STORAGE_KEY, v);
      navigate({ to: "/projects", search: { ...search, view: v }, replace: true });
    },
    [navigate, search],
  );
  const setColorBy = useCallback(
    (v: ColorBy) => {
      setColorByState(v);
      if (typeof window !== "undefined") window.localStorage.setItem(COLORBY_STORAGE_KEY, v);
      navigate({ to: "/projects", search: { ...search, colorBy: v }, replace: true });
    },
    [navigate, search],
  );



  const projectsQ = useQuery({
    queryKey: ["projects", brandId, statusFilter, ownerFilter, effectiveClientId],
    queryFn: ({ signal }) =>
      withTimeout(
        (s) =>
          list({
            signal: s,
            data: {
              brandId: brandId!,
              status: statusFilter === "all" ? null : (statusFilter as never),
              ownerId: ownerFilter === "all" ? null : ownerFilter,
              clientId: effectiveClientId,
            },
          }),
        signal,
      ),
    enabled: !!brandId,
    retry: 2,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 6000),
  });

  const clientsQ = useQuery({
    queryKey: ["clients", brandId],
    queryFn: ({ signal }) =>
      withTimeout((s) => clientsFn({ signal: s, data: { brandId: brandId! } }), signal),
    enabled: !!brandId,
    retry: 2,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 6000),
  });
  const teamQ = useQuery({
    queryKey: ["team", brandId],
    queryFn: ({ signal }) =>
      withTimeout((s) => teamFn({ signal: s, data: { brandId: brandId! } }), signal),
    enabled: !!brandId,
    retry: 2,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 6000),
  });

  const team = (teamQ.data?.members ?? []) as Array<{ user_id: string; full_name: string | null }>;
  const clients = (clientsQ.data ?? []) as Array<{
    id: string;
    name: string;
    color: string | null;
  }>;

  const clientName = useCallback(
    (id: string | null) => clients.find((c) => c.id === id)?.name ?? "",
    [clients],
  );

  const rows = useMemo(() => {
    const all = projectsQ.data?.projects ?? [];
    const stats = projectsQ.data?.stats ?? {};
    const query = q.trim().toLowerCase();
    // Arquivados só aparecem quando explicitamente pedidos.
    const scoped = statusFilter === "archived" ? all : all.filter((r) => r.status !== "archived");
    const filtered = !query
      ? scoped
      : scoped.filter(
          (r) =>
            r.name.toLowerCase().includes(query) ||
            clientName(r.client_id).toLowerCase().includes(query),
        );

    const dir = sortDir === "asc" ? 1 : -1;
    const value = (p: (typeof all)[number]) => {
      const s: ProjectStats = stats[p.id] ?? { total: 0, approved: 0, published: 0, pending: 0 };
      switch (sortKey) {
        case "name":
          return p.name.toLowerCase();
        case "client":
          return clientName(p.client_id).toLowerCase();
        case "status":
          return STATUS_META[p.status]?.label?.toLowerCase() ?? p.status;
        case "due":
          return p.due_at ? new Date(p.due_at).getTime() : Number.MAX_SAFE_INTEGER;
        case "progress":
          return s.total > 0 ? s.published / s.total : -1;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === vb) return a.name.localeCompare(b.name);
      return va > vb ? dir : -dir;
    });
  }, [projectsQ.data, q, sortKey, sortDir, clients, statusFilter, clientName]);

  function onSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "name" || k === "client" || k === "status" ? "asc" : "asc");
    }
  }

  const kpis = useMemo(() => {
    const all = (projectsQ.data?.projects ?? []).filter((p) => p.status !== "archived");
    const stats = projectsQ.data?.stats ?? {};
    let total = 0;
    let published = 0;
    let approved = 0;
    for (const p of all) {
      const s = stats[p.id];
      if (!s) continue;
      total += s.total || 0;
      published += s.published || 0;
      approved += s.approved || 0;
    }
    const active = all.filter((r) => r.status === "active" || r.status === "in_progress").length;
    return { count: all.length, active, total, published, approved };
  }, [projectsQ.data]);

  // Sem resposta ainda: nada de exibir "0" como se fosse dado real.
  const hasProjectData = projectsQ.data !== undefined;
  const kpiValue = (v: number) => (hasProjectData ? v : "—");
  const showSlowHint = useSlowHint(projectsQ.isLoading || projectsQ.isRefetching);


  const createMut = useMutation({
    mutationFn: (values: ProjectFormValues) => create({ data: { brandId: brandId!, values } }),
    onSuccess: () => {
      toast.success("Projeto criado");
      qc.invalidateQueries({ queryKey: ["projects", brandId] });
      setFormOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  usePageHeader(
    {
      title: "Projetos",
      subtitle: "Gerencie seus projetos e acompanhe o progresso das publicações.",
      actions: (
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9">
                <Plus className="mr-2 h-4 w-4" /> Novo projeto
                <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setFormOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Em branco
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTemplateOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4" /> A partir de modelo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
    [brandId],
  );

  if (!brandId) {
    return (
      <DashboardPageShell>
        <DashboardPanelSurface className="flex items-start gap-3 px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
          Selecione um workspace no menu lateral para ver os projetos.
        </DashboardPanelSurface>
      </DashboardPageShell>
    );
  }

  const hasFilters =
    q.trim().length > 0 ||
    statusFilter !== "all" ||
    ownerFilter !== "all" ||
    (!activeClientId && clientFilter !== "all");

  return (
    <DashboardPageShell>
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          tone="neutral"
          icon={<Layers className="h-4 w-4" />}
          label="Projetos"
          value={kpiValue(kpis.count)}
          sub={hasProjectData ? `${kpis.active} em andamento` : "Carregando..."}
        />
        <KpiCard
          tone="sky"
          icon={<TrendingUp className="h-4 w-4" />}
          label="Publicações"
          value={kpiValue(kpis.total)}
          sub="Total no escopo"
        />
        <KpiCard
          tone="emerald"
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Aprovadas"
          value={kpiValue(kpis.approved)}
          sub={
            hasProjectData
              ? `${kpis.total > 0 ? Math.round((kpis.approved / kpis.total) * 100) : 0}% do total`
              : "—"
          }
        />
        <KpiCard
          tone="pink"
          icon={<Send className="h-4 w-4" />}
          label="Publicadas"
          value={kpiValue(kpis.published)}
          sub={
            hasProjectData
              ? `${kpis.total > 0 ? Math.round((kpis.published / kpis.total) * 100) : 0}% do total`
              : "—"
          }
        />

      </div>

      {/* Filtros */}
      <DashboardPanelSurface className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por projeto ou cliente..."
              className="h-9 pl-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <Filter className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Ativos (sem arquivados)</SelectItem>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <UserIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="Todos..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os responsáveis</SelectItem>
              {team.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.full_name ?? "Sem nome"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeClientId ? (
            <span
              title="Troque o cliente no seletor da barra lateral"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 text-xs text-muted-foreground"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  background: clients.find((c) => c.id === activeClientId)?.color ?? "#8b5cf6",
                }}
              />
              <span className="truncate font-medium text-foreground">
                {clientName(activeClientId) || "Cliente ativo"}
              </span>
              <span className="hidden text-[10px] uppercase tracking-wide sm:inline">sidebar</span>
            </span>
          ) : (
            <ClientFilterCombobox
              value={clientFilter}
              onChange={setClientFilter}
              clients={clients}
              sidebarClientId={null}
            />
          )}

          <div className="ml-auto flex items-center gap-2">
            {view === "cards" ? (
              <>
                <Select
                  value={colorBy}
                  onValueChange={(v) => setColorBy(v as ColorBy)}
                >
                  <SelectTrigger className="h-9 w-[168px] text-xs">
                    <Palette className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COLOR_BYS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {COLOR_BY_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={`${sortKey}:${sortDir}`}
                  onValueChange={(v) => {
                    const [k, d] = v.split(":") as [SortKey, SortDir];
                    setSortKey(k);
                    setSortDir(d);
                  }}
                >
                  <SelectTrigger className="h-9 w-[190px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                      <SelectItem key={k} value={`${k}:${k === "progress" ? "desc" : "asc"}`}>
                        {SORT_LABELS[k]}
                      </SelectItem>
                    ))}
                    <SelectItem value="due:desc">Entrega mais distante</SelectItem>
                  </SelectContent>
                </Select>
              </>
            ) : null}
            <div className="inline-flex h-9 shrink-0 items-center rounded-md border border-border/60 bg-muted/40 p-0.5">
              <Button
                type="button"
                size="sm"
                variant={view === "cards" ? "secondary" : "ghost"}
                aria-pressed={view === "cards"}
                onClick={() => setView("cards")}
                className="h-8 gap-1.5 px-2.5 text-xs"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cards</span>
              </Button>
              <Button
                type="button"
                size="sm"
                variant={view === "list" ? "secondary" : "ghost"}
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
                className="h-8 gap-1.5 px-2.5 text-xs"
              >
                <ListIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Lista</span>
              </Button>
            </div>
          </div>
        </div>



        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {hasProjectData
              ? `${rows.length} ${rows.length === 1 ? "projeto" : "projetos"}`
              : projectsQ.isError
                ? "Não carregado"
                : "Carregando projetos..."}
          </span>

          {q.trim() ? <FilterChip label={`Busca: ${q.trim()}`} onClear={() => setQ("")} /> : null}
          {statusFilter !== "all" ? (
            <FilterChip
              label={`Status: ${STATUS_META[statusFilter]?.label ?? statusFilter}`}
              onClear={() => setStatusFilter("all")}
            />
          ) : null}
          {ownerFilter !== "all" ? (
            <FilterChip
              label={`Responsável: ${team.find((m) => m.user_id === ownerFilter)?.full_name ?? "—"}`}
              onClear={() => setOwnerFilter("all")}
            />
          ) : null}
          {!activeClientId && clientFilter !== "all" ? (
            <FilterChip
              label={`Cliente: ${clientName(clientFilter) || "—"}`}
              onClear={() => setClientFilter("all")}
            />
          ) : null}
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setQ("");
                setStatusFilter("all");
                setOwnerFilter("all");
                if (!activeClientId) setClientFilter("all");
              }}
            >
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </DashboardPanelSurface>

      {/* Lista de projetos */}
      {projectsQ.isError ? (
        <DashboardPanelSurface className="space-y-3 p-6 text-center">
          <p className="text-sm font-medium text-foreground">
            Não foi possível carregar os projetos
          </p>
          <p className="text-xs text-muted-foreground">
            {(projectsQ.error as Error | null)?.message ||
              "Falha de comunicação com o servidor. Isso não significa que o cliente esteja sem projetos."}
          </p>
          <div>
            <Button size="sm" variant="outline" onClick={() => void projectsQ.refetch()}>
              Tentar novamente
            </Button>
          </div>
        </DashboardPanelSurface>
      ) : projectsQ.isLoading ? (
        <div className="space-y-2">
          {showSlowHint ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <span>Está demorando mais que o normal para carregar os projetos.</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={() => void projectsQ.refetch()}
              >
                Recarregar
              </Button>
            </div>
          ) : null}
          {view === "cards" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[104px] animate-pulse rounded-lg border border-border/60 bg-muted/50"
                />
              ))}
            </div>
          ) : (
            <DashboardPanelSurface className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />
              ))}
            </DashboardPanelSurface>
          )}
        </div>
      ) : rows.length === 0 ? (

        <DashboardPanelSurface>
          <PanelEmptyState
            icon={<FileBarChart2 className="h-4 w-4" />}
            text={
              hasFilters
                ? "Nenhum projeto corresponde aos filtros aplicados."
                : effectiveClientId
                  ? "Nenhum projeto para este cliente ainda. Crie o primeiro clicando em Novo projeto."
                  : "Nenhum projeto encontrado. Crie o primeiro clicando em Novo projeto."
            }
          />

        </DashboardPanelSurface>
      ) : view === "cards" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((p) => {
            const stats: ProjectStats = projectsQ.data?.stats?.[p.id] ?? {
              total: 0,
              approved: 0,
              published: 0,
              pending: 0,
            };
            const client = clients.find((c) => c.id === p.client_id);
            const meta = STATUS_META[p.status] ?? STATUS_META.active;
            const accent =
              colorBy === "status"
                ? (STATUS_ACCENT[p.status] ?? "#8b5cf6")
                : colorBy === "client"
                  ? (client?.color ?? "#8b5cf6")
                  : (p.color ?? "#8b5cf6");
            const period =
              p.start_date || p.due_at
                ? p.due_at
                  ? `Entrega ${fmtDate(p.due_at)}`
                  : `Início ${fmtDate(p.start_date)}`
                : "Sem datas";
            return (
              <ProjectCard
                key={p.id}
                name={p.name}
                accentColor={accent}
                clientName={client?.name ?? null}
                clientColor={client?.color ?? null}
                statusLabel={meta.label}
                statusClassName={meta.className}
                planBadge={
                  p.plan ? <PlanStatusBadge status={p.plan.status} prefix="Pauta:" /> : null
                }
                periodLabel={period}
                published={stats.published}
                total={stats.total || 0}
                onOpen={() =>
                  navigate({ to: "/projects/$projectId", params: { projectId: p.id } })
                }
              />
            );
          })}
        </div>
      ) : (

        <DashboardPanelSurface className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortHeader
                  label="Projeto"
                  sortKey="name"
                  active={sortKey}
                  dir={sortDir}
                  onSort={onSort}
                />
                {activeClientId ? null : (
                  <SortHeader
                    label="Cliente"
                    sortKey="client"
                    active={sortKey}
                    dir={sortDir}
                    onSort={onSort}
                    className="hidden md:table-cell"
                  />
                )}
                <SortHeader
                  label="Status"
                  sortKey="status"
                  active={sortKey}
                  dir={sortDir}
                  onSort={onSort}
                />
                <TableHead className="hidden text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:table-cell">
                  Pauta
                </TableHead>
                <SortHeader
                  label="Período"
                  sortKey="due"
                  active={sortKey}
                  dir={sortDir}
                  onSort={onSort}
                  className="hidden lg:table-cell"
                />
                <SortHeader
                  label="Progresso"
                  sortKey="progress"
                  active={sortKey}
                  dir={sortDir}
                  onSort={onSort}
                  className="w-[200px]"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const stats: ProjectStats = projectsQ.data?.stats?.[p.id] ?? {
                  total: 0,
                  approved: 0,
                  published: 0,
                  pending: 0,
                };
                const client = clients.find((c) => c.id === p.client_id);
                const meta = STATUS_META[p.status] ?? STATUS_META.active;
                const total = stats.total || 0;
                const pct = total > 0 ? Math.round((stats.published / total) * 100) : 0;
                return (
                  <TableRow
                    key={p.id}
                    tabIndex={0}
                    onClick={() =>
                      navigate({ to: "/projects/$projectId", params: { projectId: p.id } })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        navigate({ to: "/projects/$projectId", params: { projectId: p.id } });
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <TableCell className="max-w-[280px]">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: p.color ?? "#8b5cf6" }}
                        />
                        <span className="truncate text-sm font-medium text-foreground">
                          {p.name}
                        </span>
                      </div>
                    </TableCell>
                    {activeClientId ? null : (
                      <TableCell className="hidden md:table-cell">
                        {client ? (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ background: client.color ?? "#8b5cf6" }}
                            />
                            <span className="truncate">{client.name}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`h-5 shrink-0 rounded-full px-2 text-[10px] ${meta.className}`}
                      >
                        {meta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {p.plan ? (
                        <PlanStatusBadge status={p.plan.status} prefix="Pauta:" />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap text-[11px] text-muted-foreground lg:table-cell">
                      {fmtDate(p.start_date)} — {fmtDate(p.due_at)}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>
                            {stats.published}/{total} publicadas
                          </span>
                          <span className="font-medium text-foreground">{pct}%</span>
                        </div>
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </DashboardPanelSurface>
      )}

      <ProjectFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        clients={clients}
        team={team}
        submitting={createMut.isPending}
        onSubmit={(v) => createMut.mutate(v)}
      />
      <NewFromTemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        brandId={brandId!}
      />
    </DashboardPageShell>
  );
}

function ProjectFormDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clients: Array<{ id: string; name: string; color: string | null }>;
  team: Array<{ user_id: string; full_name: string | null }>;
  submitting: boolean;
  onSubmit: (v: ProjectFormValues) => void;
}) {
  const [values, setValues] = useState<ProjectFormValues>({
    name: "",
    client_id: null,
    owner_id: null,
    status: "active",
    color: COLORS[0],
    start_date: null,
    due_at: null,
    goals: "",
  });

  function submit() {
    const parsed = ProjectSchema.safeParse(values);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }
    props.onSubmit(parsed.data);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo Projeto</DialogTitle>
          <DialogDescription>
            Agrupe as publicações de uma campanha em um projeto.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="p-name">Nome do projeto</Label>
            <Input
              id="p-name"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              placeholder="Ex.: Lançamento Verão"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={values.status}
                onValueChange={(v) =>
                  setValues((s) => ({ ...s, status: v as ProjectFormValues["status"] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_META)
                    .filter(([k]) => k !== "archived")
                    .map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Cliente</Label>
              <Select
                value={values.client_id ?? "none"}
                onValueChange={(v) =>
                  setValues((s) => ({ ...s, client_id: v === "none" ? null : v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem cliente</SelectItem>
                  {props.clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Responsável</Label>
              <Select
                value={values.owner_id ?? "none"}
                onValueChange={(v) =>
                  setValues((s) => ({ ...s, owner_id: v === "none" ? null : v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhum</SelectItem>
                  {props.team.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.full_name ?? "Sem nome"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              label="Data de início"
              value={values.start_date}
              onChange={(v) => setValues((s) => ({ ...s, start_date: v }))}
            />
            <DateField
              label="Data de término"
              value={values.due_at}
              onChange={(v) => setValues((s) => ({ ...s, due_at: v }))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setValues((s) => ({ ...s, color: c }))}
                  aria-label={`Cor ${c}`}
                  className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition ${
                    values.color === c ? "ring-2 ring-foreground" : ""
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-goals">Objetivos / Metas</Label>
            <Textarea
              id="p-goals"
              value={values.goals ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, goals: e.target.value }))}
              placeholder="Ex.: Aumentar vendas em 30%, gerar 500 leads..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={props.submitting}>
            {props.submitting ? "Salvando..." : "Criar projeto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateField(props: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const date = props.value ? new Date(props.value) : undefined;
  return (
    <div className="grid gap-1.5">
      <Label>{props.label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? (
              fmtDate(props.value)
            ) : (
              <span className="text-muted-foreground">Selecionar data</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => props.onChange(d ? d.toISOString() : null)}
            initialFocus
            className="pointer-events-auto p-3"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
