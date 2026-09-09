import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  Image as ImageIcon,
  MousePointerClick,
  RefreshCw,
  Target,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import {
  DEFAULT_PRESETS,
  DateRangePicker,
  type DateRangePreset,
} from "@/components/ui/date-range-picker";
import { lastNDays } from "@/lib/date-range";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import { cn } from "@/lib/utils";
import {
  discoverAdAccounts,
  getAdsReport,
  listAdAccounts,
  syncAdAccount,
  type AdsLevel,
  type AdsRowItem,
} from "@/lib/ads/ads.functions";
import { LEVEL_LABELS, objectiveLabel, statusLabel } from "@/lib/ads/ads-shared";

// Presets do relatório: os padrões do sistema + "Últimos 15 dias".
const REPORT_PRESETS: DateRangePreset[] = (() => {
  const out = [...DEFAULT_PRESETS];
  const at = out.findIndex((p) => p.key === "30d");
  const fifteen: DateRangePreset = {
    key: "15d",
    label: "Últimos 15 dias",
    build: (t) => lastNDays(15, t),
  };
  out.splice(at < 0 ? out.length : at, 0, fifteen);
  return out;
})();

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const money = (n: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(
    Number.isFinite(n) ? n : 0,
  );
const int = (n: number) => new Intl.NumberFormat("pt-BR").format(Math.round(n || 0));
const dec = (n: number, digits = 2) =>
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(
    Number.isFinite(n) ? n : 0,
  );

function trendOf(current: number, previous: number | undefined | null) {
  if (previous === undefined || previous === null) return undefined;
  if (previous === 0) return undefined;
  return { value: ((current - previous) / previous) * 100, label: "vs. período anterior" };
}

export function AdsReportPanel() {
  const { brandId, clientId } = useActiveContext();
  const queryClient = useQueryClient();

  const listFn = useServerFn(listAdAccounts);
  const reportFn = useServerFn(getAdsReport);
  const discoverFn = useServerFn(discoverAdAccounts);
  const syncFn = useServerFn(syncAdAccount);

  const [range, setRange] = useState<DateRange | undefined>(() => lastNDays(30));
  const [compare, setCompare] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ level: AdsLevel; parentId: string | null; trail: string[] }>(
    {
      level: "campaign",
      parentId: null,
      trail: [],
    },
  );
  const [detail, setDetail] = useState<AdsRowItem | null>(null);

  const accountsQ = useQuery({
    queryKey: ["ad-accounts", brandId],
    queryFn: () => listFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const accounts = useMemo(() => {
    const all = accountsQ.data?.accounts ?? [];
    if (!clientId) return all;
    const scoped = all.filter((a) => a.clients.some((c) => c.clientId === clientId));
    return scoped.length ? scoped : all;
  }, [accountsQ.data, clientId]);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null,
    [accounts, accountId],
  );

  const since = range?.from ? iso(range.from) : iso(lastNDays(30).from!);
  const until = range?.to ? iso(range.to) : iso(new Date());

  const reportQ = useQuery({
    queryKey: [
      "ads-report",
      brandId,
      activeAccount?.id,
      since,
      until,
      drill.level,
      drill.parentId,
      compare,
    ],
    queryFn: () =>
      reportFn({
        data: {
          brandId: brandId!,
          adAccountId: activeAccount!.id,
          since,
          until,
          level: drill.level,
          parentExternalId: drill.parentId,
          compare,
        },
      }),
    enabled: !!brandId && !!activeAccount,
  });

  const discover = useMutation({
    mutationFn: () => discoverFn({ data: { brandId: brandId! } }),
    onSuccess: (res) => {
      toast.success(
        res.found > 0
          ? `${res.found} conta(s) de anúncio encontradas na Meta.`
          : "Nenhuma conta de anúncio encontrada para esta autorização.",
      );
      void queryClient.invalidateQueries({ queryKey: ["ad-accounts", brandId] });
    },
    onError: (err: Error) =>
      toast.error(
        err.message.replace("ADS_SCOPE_REQUIRED:", "").trim() || "Falha ao buscar contas.",
      ),
  });

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { brandId: brandId!, adAccountId: activeAccount!.id } }),
    onSuccess: (res) => {
      toast.success(`Dados atualizados: ${res.insights} registros dos últimos ${res.days} dias.`);
      void queryClient.invalidateQueries({ queryKey: ["ads-report"] });
      void queryClient.invalidateQueries({ queryKey: ["ad-accounts", brandId] });
    },
    onError: (err: Error) =>
      toast.error(err.message.replace("ADS_SCOPE_REQUIRED:", "").trim() || "Falha ao atualizar."),
  });

  const report = reportQ.data;
  const currency = report?.account?.currency ?? "BRL";
  const totals = report?.totals;
  const prev = report?.previous ?? null;

  usePageHeader(
    {
      title: "Mídia paga",
      subtitle: activeAccount
        ? `Relatório de anúncios — ${activeAccount.name ?? activeAccount.externalId}`
        : "Relatório de anúncios",
      actions: (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => discover.mutate()}
            disabled={!brandId || discover.isPending}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", discover.isPending && "animate-spin")} />
            Buscar contas
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => sync.mutate()}
            disabled={!activeAccount || sync.isPending}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} />
            Atualizar dados
          </Button>
        </div>
      ),
    },
    [activeAccount?.id, discover.isPending, sync.isPending, brandId],
  );

  const maxSpend = Math.max(1, ...(report?.series ?? []).map((p) => p.spend));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 p-2">
        <Select
          value={activeAccount?.id ?? ""}
          onValueChange={(v) => {
            setAccountId(v);
            setDrill({ level: "campaign", parentId: null, trail: [] });
          }}
          disabled={!accounts.length}
        >
          <SelectTrigger className="h-8 w-[260px] text-xs">
            <SelectValue placeholder="Selecionar conta de anúncio" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs">
                {a.name ?? a.externalId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DateRangePicker value={range} onChange={setRange} presets={REPORT_PRESETS} />

        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={compare} onCheckedChange={setCompare} />
          Comparar com período anterior
        </label>
      </div>

      {!accounts.length && !accountsQ.isLoading ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">Nenhuma conta de anúncio conectada</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Clique em “Buscar contas” para trazer as contas de anúncio que a autorização da Meta
            deste workspace alcança. Se nada aparecer, autorize novamente a Meta escolhendo o canal
            de anúncios.
          </p>
        </div>
      ) : null}

      {/* Resumo em linguagem simples */}
      {activeAccount ? (
        <div className="rounded-lg border border-border bg-card/40 p-3 text-xs text-muted-foreground">
          {reportQ.isLoading ? (
            <Skeleton className="h-4 w-2/3" />
          ) : totals && report?.hasData ? (
            <span>
              No período você investiu <strong>{money(totals.spend, currency)}</strong>, apareceu{" "}
              <strong>{int(totals.impressions)}</strong> vezes para{" "}
              <strong>{int(totals.reach)}</strong> pessoas e recebeu{" "}
              <strong>{int(totals.clicks)}</strong> cliques
              {totals.results > 0 ? (
                <>
                  , gerando <strong>{int(totals.results)}</strong>{" "}
                  {(report.resultLabel ?? "resultados").toLowerCase()} a{" "}
                  <strong>{money(totals.costPerResult, currency)}</strong> cada
                </>
              ) : null}
              .
            </span>
          ) : (
            <span>
              Ainda não há dados para este período. Use “Atualizar dados” para buscar os números da
              Meta.
              {activeAccount.lastSyncedAt
                ? ` Última atualização: ${new Date(activeAccount.lastSyncedAt).toLocaleString("pt-BR")}.`
                : ""}
            </span>
          )}
        </div>
      ) : null}

      {/* KPIs */}
      {activeAccount ? (
        <PageKpiGrid>
          <PageKpi
            label="Investimento"
            value={reportQ.isLoading ? "—" : money(totals?.spend ?? 0, currency)}
            icon={<Wallet className="h-3.5 w-3.5" />}
            status="info"
            trend={trendOf(totals?.spend ?? 0, prev?.spend)}
          />
          <PageKpi
            label="Pessoas alcançadas"
            value={reportQ.isLoading ? "—" : int(totals?.reach ?? 0)}
            icon={<Eye className="h-3.5 w-3.5" />}
            description={totals ? `${int(totals.impressions)} exibições` : undefined}
            trend={trendOf(totals?.reach ?? 0, prev?.reach)}
          />
          <PageKpi
            label="Cliques"
            value={reportQ.isLoading ? "—" : int(totals?.clicks ?? 0)}
            icon={<MousePointerClick className="h-3.5 w-3.5" />}
            description={totals ? `${dec(totals.ctr)}% de cliques por exibição` : undefined}
            trend={trendOf(totals?.clicks ?? 0, prev?.clicks)}
          />
          <PageKpi
            label={report?.resultLabel ?? "Resultados"}
            value={reportQ.isLoading ? "—" : int(totals?.results ?? 0)}
            icon={<Target className="h-3.5 w-3.5" />}
            status={(totals?.results ?? 0) > 0 ? "success" : "neutral"}
            description={
              totals && totals.results > 0
                ? `${money(totals.costPerResult, currency)} por resultado`
                : undefined
            }
            trend={trendOf(totals?.results ?? 0, prev?.results)}
          />
        </PageKpiGrid>
      ) : null}

      {/* Evolução diária */}
      {activeAccount && (report?.series.length ?? 0) > 0 ? (
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Investimento por dia
          </p>
          <div className="mt-4 flex h-32 items-end gap-1">
            {report!.series.map((p) => (
              <div key={p.date} className="group relative flex-1">
                <div
                  className="w-full rounded-sm bg-primary/70 transition group-hover:bg-primary"
                  style={{ height: `${Math.max(2, (p.spend / maxSpend) * 120)}px` }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-[10px] shadow group-hover:block">
                  {new Date(`${p.date}T12:00:00`).toLocaleDateString("pt-BR")} ·{" "}
                  {money(p.spend, currency)} · {int(p.clicks)} cliques
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Navegação campanha → conjunto → anúncio */}
      {activeAccount ? (
        <div className="rounded-lg border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            {drill.parentId ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={() =>
                  setDrill((d) => ({
                    level: d.level === "ad" ? "adset" : "campaign",
                    parentId: null,
                    trail: d.trail.slice(0, -1),
                  }))
                }
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </Button>
            ) : null}
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {LEVEL_LABELS[drill.level === "account" ? "campaign" : drill.level]}s
            </span>
            {drill.trail.map((name) => (
              <Badge key={name} variant="outline" className="text-[10px]">
                {name}
              </Badge>
            ))}
          </div>

          {reportQ.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (report?.rows.length ?? 0) === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              Nada para mostrar neste período.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {report!.rows.map((row) => {
                const canDrill = row.level !== "ad";
                return (
                  <li key={row.externalId}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-muted/40"
                      onClick={() => {
                        if (canDrill) {
                          setDrill((d) => ({
                            level: row.level === "campaign" ? "adset" : "ad",
                            parentId: row.externalId,
                            trail: [...d.trail, row.name],
                          }));
                        } else {
                          setDetail(row);
                        }
                      }}
                    >
                      {row.creative?.thumbnailUrl ? (
                        <img
                          src={row.creative.thumbnailUrl}
                          alt={`Prévia do anúncio ${row.name}`}
                          loading="lazy"
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      ) : row.level === "ad" ? (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-muted">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                        </span>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {statusLabel(row.status)}
                          {objectiveLabel(row.objective)
                            ? ` · ${objectiveLabel(row.objective)}`
                            : ""}
                        </p>
                      </div>
                      <div className="hidden shrink-0 gap-6 text-right sm:flex">
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Investido</p>
                          <p className="text-sm font-medium">
                            {money(row.metrics.spend, currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Cliques</p>
                          <p className="text-sm font-medium">{int(row.metrics.clicks)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-muted-foreground">Resultados</p>
                          <p className="text-sm font-medium">{int(row.metrics.results)}</p>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {/* Detalhe do anúncio + prévia do criativo */}
      <Sheet open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-base">{detail?.name}</SheetTitle>
            <SheetDescription className="text-xs">
              {detail ? statusLabel(detail.status) : ""}
            </SheetDescription>
          </SheetHeader>
          {detail ? (
            <div className="mt-4 space-y-4">
              {detail.creative?.imageUrl || detail.creative?.thumbnailUrl ? (
                <img
                  src={detail.creative.imageUrl ?? detail.creative.thumbnailUrl ?? ""}
                  alt={`Criativo do anúncio ${detail.name}`}
                  className="w-full rounded-lg border border-border object-cover"
                />
              ) : null}
              {detail.creative?.title ? (
                <p className="text-sm font-medium">{detail.creative.title}</p>
              ) : null}
              {detail.creative?.body ? (
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                  {detail.creative.body}
                </p>
              ) : null}
              {detail.creative?.linkUrl ? (
                <a
                  href={detail.creative.linkUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block truncate text-xs text-primary underline"
                >
                  {detail.creative.linkUrl}
                </a>
              ) : null}
              <dl className="grid grid-cols-2 gap-3 text-xs">
                {[
                  ["Investido", money(detail.metrics.spend, currency)],
                  ["Exibições", int(detail.metrics.impressions)],
                  ["Pessoas alcançadas", int(detail.metrics.reach)],
                  ["Cliques", int(detail.metrics.clicks)],
                  ["Cliques no link", int(detail.metrics.linkClicks)],
                  ["Cliques por exibição", `${dec(detail.metrics.ctr)}%`],
                  ["Custo por clique", money(detail.metrics.cpc, currency)],
                  ["Custo por mil exibições", money(detail.metrics.cpm, currency)],
                  ["Resultados", int(detail.metrics.results)],
                  ["Custo por resultado", money(detail.metrics.costPerResult, currency)],
                  ["Vezes por pessoa", dec(detail.metrics.frequency, 1)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded border border-border/60 p-2">
                    <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
                    <dd className="text-sm font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
