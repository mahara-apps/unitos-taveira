import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import {
  Activity,
  AlertTriangle,
  Brain,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  GitBranch,
  Lightbulb,
  Loader2,
  Network,
  Sparkles,
  Target,
  Waves,
} from "lucide-react";
import { usePageHeader } from "@/hooks/use-page-header";
import { useActiveContext } from "@/hooks/use-active-context";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageKpi, PageKpiGrid, type KpiStatus } from "@/components/ui/page-kpi";
import { brainDiagnosticsFn, type BrainDiagnostics } from "@/lib/brain/diagnostics.functions";

export const Route = createFileRoute("/_authenticated/brain/diagnostics")({
  beforeLoad: () => ensureFeatureEnabled("brain"),
  component: BrainDiagnosticsRoute,
});

function BrainDiagnosticsRoute() {
  usePageHeader(
    {
      title: "Brain Diagnostics",
      subtitle:
        "Painel temporário — pipeline em tempo real (eventos, memórias, embeddings, insights, recomendações e fila).",
    },
    [],
  );
  const { brandId } = useActiveContext();
  const fetchDiag = useServerFn(brainDiagnosticsFn);
  const q = useQuery({
    queryKey: ["brain-diagnostics", brandId ?? "all"],
    queryFn: () => fetchDiag({ data: { brandId: brandId ?? null } }),
    refetchInterval: 3_000,
  });

  const d = q.data;
  const loading = q.isLoading;

  return (
    <div className="space-y-6 p-6">
      {/* Live status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="relative grid h-10 w-10 place-items-center rounded-lg border border-border/60 bg-background">
            <Brain className="h-5 w-5 text-primary" />
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div>
            <div className="text-sm font-medium">Pipeline ativo</div>
            <div className="text-xs text-muted-foreground">
              Atualização a cada 3s ·{" "}
              {d?.generatedAt ? new Date(d.generatedAt).toLocaleTimeString("pt-BR") : "—"}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {brandId ? "Escopo: marca" : "Escopo: global"}
          </Badge>
          {q.isFetching ? (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Sincronizando
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Sincronizado
            </Badge>
          )}
        </div>
      </div>

      {/* Worker health — se o worker parar, o Brain para de aprender em silêncio. */}
      {d?.worker ? (
        <section
          className={`rounded-xl border p-4 ${
            d.worker.healthy
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-destructive/40 bg-destructive/5"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              {d.worker.healthy ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              ) : (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-semibold">
                  {d.worker.healthy
                    ? "Worker de aprendizado ativo"
                    : "Worker de aprendizado parado — o Brain não está aprendendo"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {d.worker.lastRunAt
                    ? `Última execução ${
                        d.worker.minutesSinceLastRun != null
                          ? `há ${d.worker.minutesSinceLastRun} min`
                          : "—"
                      } · status ${d.worker.lastStatus ?? "—"}${
                        d.worker.lastDurationMs != null ? ` · ${d.worker.lastDurationMs} ms` : ""
                      }`
                    : "Nenhuma execução registrada."}
                </p>
                {d.worker.lastError ? (
                  <p className="text-xs font-medium text-destructive">Erro: {d.worker.lastError}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{d.worker.runs24h} execuções / 24h</Badge>
              <Badge variant="secondary">{d.worker.processed24h} eventos</Badge>
              <Badge variant="secondary">{d.worker.discarded24h} descartados (evidência)</Badge>
              <Badge variant="secondary">{d.worker.memoriesTouched24h} memórias sintetizadas</Badge>
              {d.worker.failures24h > 0 ? (
                <Badge variant="destructive">{d.worker.failures24h} falhas</Badge>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* Queue */}
      <PageKpiGrid columns={4}>
        <QueueKpi
          loading={loading}
          icon={<Waves className="h-4 w-4" />}
          status="warning"
          label="Fila pendente"
          value={d?.queue.pending}
          hint={
            d?.queue.oldestPendingAgeSec != null
              ? `mais antigo: ${formatAge(d.queue.oldestPendingAgeSec)}`
              : "sem atrasos"
          }
        />
        <QueueKpi
          loading={loading}
          icon={<Loader2 className="h-4 w-4" />}
          status="info"
          label="Em processamento"
          value={d?.queue.running}
          hint="workers ativos agora"
        />
        <QueueKpi
          loading={loading}
          icon={<Clock className="h-4 w-4" />}
          label="Tempo médio"
          value={d?.queue.avgProcessingMs ?? undefined}
          suffix=" ms"
          hint={
            d?.queue.p95ProcessingMs != null
              ? `p95 ${d.queue.p95ProcessingMs} ms · última hora`
              : "última hora"
          }
        />
        <QueueKpi
          loading={loading}
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Falhas"
          value={d?.queue.failed}
          hint={`${d?.queue.processedLastHour ?? 0} processadas na última hora`}
          tone={d && d.queue.failed > 0 ? "warn" : undefined}
        />
      </PageKpiGrid>

      {/* Pipeline windows table */}
      <section className="rounded-xl border border-border/60 bg-card">
        <div className="flex items-center justify-between border-b border-border/60 p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <div>
              <h3 className="text-sm font-medium">Pipeline por janela de tempo</h3>
              <p className="text-xs text-muted-foreground">
                Contagem por etapa nos últimos 60s / 1h / 24h e total acumulado.
              </p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Etapa</th>
                <th className="px-4 py-2 text-right font-medium">60s</th>
                <th className="px-4 py-2 text-right font-medium">1h</th>
                <th className="px-4 py-2 text-right font-medium">24h</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <PipelineRow
                loading={loading}
                icon={<Cpu className="h-3.5 w-3.5 text-primary" />}
                label="Eventos recebidos"
                get={(w) => w.events}
                d={d}
              />
              <PipelineRow
                loading={loading}
                icon={<Sparkles className="h-3.5 w-3.5" style={{ color: "var(--chart-4)" }} />}
                label="Memórias criadas"
                get={(w) => w.memoriesCreated}
                d={d}
              />
              <PipelineRow
                loading={loading}
                icon={<Database className="h-3.5 w-3.5 text-muted-foreground" />}
                label="Memórias atualizadas"
                get={(w) => w.memoriesUpdated}
                d={d}
              />
              <PipelineRow
                loading={loading}
                icon={<GitBranch className="h-3.5 w-3.5" style={{ color: "var(--chart-2)" }} />}
                label="Relacionamentos criados"
                get={(w) => w.relationshipsCreated}
                d={d}
              />
              <PipelineRow
                loading={loading}
                icon={<Network className="h-3.5 w-3.5" style={{ color: "var(--chart-5)" }} />}
                label="Embeddings gerados"
                get={(w) => w.embeddings}
                d={d}
              />
              <PipelineRow
                loading={loading}
                icon={<Lightbulb className="h-3.5 w-3.5" style={{ color: "var(--chart-3)" }} />}
                label="Insights gerados"
                get={(w) => w.insights}
                d={d}
              />
              <PipelineRow
                loading={loading}
                icon={<Target className="h-3.5 w-3.5" style={{ color: "var(--chart-2)" }} />}
                label="Recomendações geradas"
                get={(w) => w.recommendations}
                d={d}
              />
            </tbody>
          </table>
        </div>
      </section>

      {/* Live streams */}
      <section className="grid gap-4 lg:grid-cols-3">
        <LiveList
          title="Eventos recentes"
          icon={<Cpu className="h-4 w-4 text-primary" />}
          loading={loading}
          empty="Sem eventos ainda."
          items={(d?.recentEvents ?? []).map((e) => ({
            id: e.id,
            primary: e.event_type,
            secondary: e.source_module,
            tail: relTime(e.created_at),
            badge: e.processed_at ? "processado" : "pendente",
            badgeTone: e.processed_at ? "ok" : "warn",
          }))}
        />
        <LiveList
          title="Memórias recentes"
          icon={<Sparkles className="h-4 w-4" style={{ color: "var(--chart-4)" }} />}
          loading={loading}
          empty="Sem memórias consolidadas ainda."
          items={(d?.recentMemories ?? []).map((m) => ({
            id: m.id,
            primary: m.key,
            secondary: `${m.memory_type} · v${m.version} · ${m.reinforcement_count}×`,
            tail: relTime(m.updated_at),
            badge: `${Math.round(m.confidence * 100)}%`,
          }))}
        />
        <LiveList
          title="Insights recentes"
          icon={<Lightbulb className="h-4 w-4" style={{ color: "var(--chart-3)" }} />}
          loading={loading}
          empty="O Brain ainda está reunindo evidências."
          items={(d?.recentInsights ?? []).map((i) => ({
            id: i.id,
            primary: i.description,
            secondary: i.insight_type,
            tail: relTime(i.created_at),
            badge: `${Math.round(i.confidence * 100)}%`,
          }))}
        />
      </section>
    </div>
  );
}

/** Adaptador do padrão canônico `PageKpi` para os KPIs de fila desta página. */
function QueueKpi({
  icon,
  label,
  value,
  suffix,
  hint,
  loading,
  tone,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  suffix?: string;
  hint?: string;
  loading?: boolean;
  tone?: "warn";
  status?: KpiStatus;
}) {
  return (
    <PageKpi
      icon={icon}
      label={label}
      status={tone === "warn" ? "danger" : (status ?? "neutral")}
      value={
        loading || value === undefined ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <>
            {value.toLocaleString("pt-BR")}
            {suffix ? (
              <span className="ml-0.5 text-base font-normal text-muted-foreground">{suffix}</span>
            ) : null}
          </>
        )
      }
      description={hint}
    />
  );
}

function PipelineRow({
  icon,
  label,
  get,
  d,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  get: (w: BrainDiagnostics["windows"]["minute"]) => number;
  d: BrainDiagnostics | undefined;
  loading: boolean;
}) {
  const cell = (n: number | undefined) =>
    loading || n === undefined ? (
      <Skeleton className="ml-auto h-4 w-10" />
    ) : (
      <span className="tabular-nums">{n.toLocaleString("pt-BR")}</span>
    );
  return (
    <tr className="border-t border-border/40">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          {icon}
          <span>{label}</span>
        </div>
      </td>
      <td className="px-4 py-2 text-right">{cell(d ? get(d.windows.minute) : undefined)}</td>
      <td className="px-4 py-2 text-right">{cell(d ? get(d.windows.hour) : undefined)}</td>
      <td className="px-4 py-2 text-right">{cell(d ? get(d.windows.day) : undefined)}</td>
      <td className="px-4 py-2 text-right font-medium">
        {cell(d ? get(d.windows.total) : undefined)}
      </td>
    </tr>
  );
}

function LiveList({
  title,
  icon,
  items,
  empty,
  loading,
}: {
  title: string;
  icon: React.ReactNode;
  loading: boolean;
  empty: string;
  items: Array<{
    id: string;
    primary: string;
    secondary?: string;
    tail?: string;
    badge?: string;
    badgeTone?: "ok" | "warn";
  }>;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border/40 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{it.primary}</div>
                {it.secondary ? (
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {it.secondary}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {it.badge ? (
                  <Badge
                    variant={it.badgeTone === "warn" ? "outline" : "secondary"}
                    className={
                      it.badgeTone === "warn"
                        ? "border-amber-500/50 text-amber-600 text-[10px]"
                        : "text-[10px]"
                    }
                  >
                    {it.badge}
                  </Badge>
                ) : null}
                {it.tail ? (
                  <span className="text-[10px] tabular-nums text-muted-foreground">{it.tail}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5_000) return "agora";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s atrás`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m atrás`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h atrás`;
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
