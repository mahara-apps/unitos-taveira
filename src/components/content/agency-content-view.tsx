import { useMemo, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlarmClock,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Filter,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  UserCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import { PanelCard } from "@/components/ui/panel-card";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { PageKpi, PageKpiGrid, type KpiStatus } from "@/components/ui/page-kpi";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { useActiveContext } from "@/hooks/use-active-context";
import {
  listAgencyContentFn,
  type AgencyContentSnapshot,
  type AgencyPostRow,
} from "@/lib/agency-content.functions";

type SlaFilter = "any" | "on_track" | "at_risk" | "overdue";
type Mode = "kanban" | "list";

const COLOR_DOT: Record<string, string> = {
  muted: "bg-muted-foreground/60",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  sky: "bg-sky-500",
  rose: "bg-rose-500",
  cyan: "bg-sky-500",
};

function slaBadge(status: AgencyPostRow["sla_status"]) {
  if (status === "overdue")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
        <AlarmClock className="h-2.5 w-2.5" /> Atrasado
      </span>
    );
  if (status === "at_risk")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
        <Clock className="h-2.5 w-2.5" /> Próx. vencer
      </span>
    );
  if (status === "on_track")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-2.5 w-2.5" /> Em dia
      </span>
    );
  return null;
}

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "há minutos";
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export function AgencyContentView({ brandId }: { brandId: string }) {
  const load = useServerFn(listAgencyContentFn);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [stalledDays, setStalledDays] = useState(3);
  const { data } = useSuspenseQuery({
    queryKey: ["agency-content", brandId, selectedClients.slice().sort().join(","), stalledDays],
    queryFn: () =>
      load({
        data: {
          brandId,
          clientIds: selectedClients.length ? selectedClients : undefined,
          stalledDays,
        },
      }),
  });

  const [mode, setMode] = useState<Mode>("kanban");
  const [slaFilter, setSlaFilter] = useState<SlaFilter>("any");
  const [stageFilter, setStageFilter] = useState<string>("any");
  const [clientFilter, setClientFilter] = useState<string>("any");

  const filtered = useMemo(() => {
    return data.posts.filter((p) => {
      if (slaFilter !== "any" && p.sla_status !== slaFilter) return false;
      if (stageFilter !== "any" && p.stage_label.toLowerCase() !== stageFilter) return false;
      if (clientFilter !== "any" && p.client_id !== clientFilter) return false;
      return true;
    });
  }, [data.posts, slaFilter, stageFilter, clientFilter]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <KpiBar snapshot={data} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={mode}
            onValueChange={(v) => v && setMode(v as Mode)}
            className="rounded-md border border-border/60"
          >
            <ToggleGroupItem value="kanban" aria-label="Kanban" className="h-8 px-2">
              <LayoutGrid className="h-3.5 w-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="Lista" className="h-8 px-2">
              <ListIcon className="h-3.5 w-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                <Filter className="h-3.5 w-3.5" />
                Filtros
                {(slaFilter !== "any" || stageFilter !== "any" || clientFilter !== "any") && (
                  <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">
                    {[slaFilter, stageFilter, clientFilter].filter((x) => x !== "any").length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-3 p-3">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">SLA</label>
                <Select value={slaFilter} onValueChange={(v) => setSlaFilter(v as SlaFilter)}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Todos</SelectItem>
                    <SelectItem value="on_track">Em dia</SelectItem>
                    <SelectItem value="at_risk">Próximo de vencer</SelectItem>
                    <SelectItem value="overdue">Atrasado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Etapa</label>
                <Select value={stageFilter} onValueChange={setStageFilter}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Todas</SelectItem>
                    {data.buckets.map((b) => (
                      <SelectItem key={b.key} value={b.key}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Cliente</label>
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Todos</SelectItem>
                    {data.clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  Considerar parado após (dias)
                </label>
                <Select
                  value={String(stalledDays)}
                  onValueChange={(v) => setStalledDays(Number(v))}
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 5, 7, 14].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} dia(s)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} de {data.posts.length} conteúdos
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-h-0">
          {mode === "kanban" ? (
            <UnifiedKanban buckets={data.buckets} posts={filtered} />
          ) : (
            <UnifiedList posts={filtered} />
          )}
        </div>
        <StalledClientsPanel items={data.stalledClients} />
      </div>
    </div>
  );
}

function KpiBar({ snapshot }: { snapshot: AgencyContentSnapshot }) {
  const items: Array<{ label: string; value: number; status: KpiStatus }> = [
    { label: "Em produção", value: snapshot.kpis.inProduction, status: "info" },
    { label: "Aguard. aprovação", value: snapshot.kpis.awaitingApproval, status: "warning" },
    { label: "Atrasadas", value: snapshot.kpis.overdue, status: "danger" },
    { label: "Próx. vencer", value: snapshot.kpis.atRisk, status: "warning" },
    { label: "Clientes parados", value: snapshot.kpis.stalledClients, status: "danger" },
  ];
  return (
    <PageKpiGrid columns={5}>
      {items.map((k) => (
        <PageKpi
          key={k.label}
          label={k.label}
          value={k.value}
          status={k.value > 0 ? k.status : "neutral"}
        />
      ))}
    </PageKpiGrid>
  );
}

function UnifiedKanban({
  buckets,
  posts,
}: {
  buckets: AgencyContentSnapshot["buckets"];
  posts: AgencyPostRow[];
}) {
  const byBucket = useMemo(() => {
    const m = new Map<string, AgencyPostRow[]>();
    for (const b of buckets) m.set(b.key, []);
    for (const p of posts) {
      const key = p.stage_label.trim().toLowerCase();
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(p);
    }
    // Sort each column: overdue first, then at_risk, then most recent stage_entered_at
    const rank = { overdue: 0, at_risk: 1, on_track: 2, none: 3 } as const;
    for (const list of m.values()) {
      list.sort((a, b) => {
        const r = rank[a.sla_status] - rank[b.sla_status];
        if (r !== 0) return r;
        return (
          new Date(b.stage_entered_at ?? b.updated_at).getTime() -
          new Date(a.stage_entered_at ?? a.updated_at).getTime()
        );
      });
    }
    return m;
  }, [buckets, posts]);

  const visibleBuckets = buckets.filter((b) => (byBucket.get(b.key)?.length ?? 0) > 0);

  if (visibleBuckets.length === 0) {
    return (
      <DashboardPanelSurface className="flex min-h-[240px] items-center justify-center p-10">
        <PanelEmptyState
          icon={<LayoutGrid className="h-5 w-5" />}
          text="Nenhum conteúdo em produção nos clientes selecionados."
        />
      </DashboardPanelSurface>
    );
  }

  return (
    <DashboardPanelSurface className="min-h-0">
      <div className="flex min-h-0 gap-4 overflow-x-auto p-4">
        {visibleBuckets.map((b) => {
          const list = byBucket.get(b.key) ?? [];
          return (
            <div
              key={b.key}
              className="flex w-[300px] shrink-0 flex-col rounded-xl border border-border/60 bg-background/60 p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2 border-b border-border/40 pb-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${COLOR_DOT[b.color ?? "muted"] ?? COLOR_DOT.muted}`}
                  />
                  <span className="truncate text-sm font-medium">{b.label}</span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                    {list.length}
                  </Badge>
                </div>
                {b.overdue_count > 0 && (
                  <span className="inline-flex items-center gap-0.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                    <AlarmClock className="h-2.5 w-2.5" />
                    {b.overdue_count}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto pr-1">
                {list.map((p) => (
                  <AgencyCard key={p.id} post={p} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </DashboardPanelSurface>
  );
}

function AgencyCard({ post }: { post: AgencyPostRow }) {
  const { setClientId } = useActiveContext();
  return (
    <div className="group rounded-lg border border-border/60 bg-card p-2.5 shadow-sm transition hover:border-border">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Building2 className="h-3 w-3" />
          <span className="max-w-[130px] truncate">{post.client_name}</span>
        </span>
        {slaBadge(post.sla_status)}
      </div>
      <div className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {post.title}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          {post.assignee_avatar ? (
            <img src={post.assignee_avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
          ) : (
            <UserCircle2 className="h-3.5 w-3.5" />
          )}
          <span className="max-w-[100px] truncate">{post.assignee_name ?? "Sem responsável"}</span>
        </span>
        <span className="tabular-nums">{relTime(post.stage_entered_at)}</span>
      </div>
      <button
        type="button"
        onClick={() => setClientId(post.client_id)}
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-1 text-[11px] font-medium text-foreground/80 opacity-0 transition group-hover:opacity-100 hover:border-border hover:text-foreground"
        title="Abrir cliente e visualizar no Kanban"
      >
        Abrir cliente <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}

function UnifiedList({ posts }: { posts: AgencyPostRow[] }) {
  const { setClientId } = useActiveContext();
  if (posts.length === 0) {
    return (
      <DashboardPanelSurface className="flex min-h-[240px] items-center justify-center p-10">
        <PanelEmptyState
          icon={<ListIcon className="h-5 w-5" />}
          text="Nenhum conteúdo com os filtros atuais."
        />
      </DashboardPanelSurface>
    );
  }
  return (
    <DashboardPanelSurface className="min-h-0 overflow-hidden">
      <div className="max-h-[calc(100vh-24rem)] overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur">
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Título</TableHead>
              <TableHead className="w-[140px]">Etapa</TableHead>
              <TableHead className="w-[130px]">SLA</TableHead>
              <TableHead className="w-[150px]">Responsável</TableHead>
              <TableHead className="w-[110px]">Movida</TableHead>
              <TableHead className="w-[70px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {posts.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-xs font-medium">{p.client_name}</TableCell>
                <TableCell className="max-w-[280px]">
                  <div className="line-clamp-1 text-sm">{p.title}</div>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 text-xs">
                    <span
                      className={`h-2 w-2 rounded-full ${COLOR_DOT[p.stage_color ?? "muted"] ?? COLOR_DOT.muted}`}
                    />
                    {p.stage_label}
                  </span>
                </TableCell>
                <TableCell>
                  {slaBadge(p.sla_status) ?? (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">{p.assignee_name ?? "—"}</TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {relTime(p.stage_entered_at)}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setClientId(p.client_id)}
                  >
                    Abrir
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DashboardPanelSurface>
  );
}

function StalledClientsPanel({ items }: { items: AgencyContentSnapshot["stalledClients"] }) {
  const { setClientId } = useActiveContext();
  return (
    <PanelCard
      title="Clientes parados"
      subtitle="Sem movimentação de etapa recente."
      icon={<Clock className="h-4 w-4" />}
    >
      {items.length === 0 ? (
        <div className="p-4">
          <PanelEmptyState
            icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
            text="Nenhum cliente sem movimentação no período."
          />
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((s) => (
            <li key={s.client_id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.client_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {s.count} em produção · parado há {s.days_stalled}d
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setClientId(s.client_id)}
              >
                Abrir
              </Button>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

export function AgencyContentFallback() {
  return (
    <div className="flex min-h-[400px] items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
