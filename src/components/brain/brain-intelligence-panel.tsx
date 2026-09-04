// Centro de Inteligência do Brain — camada de apresentação.
// Regra: todo elemento aqui é sustentado por dado real vindo de `brainOverviewFn`.
// Nenhum número calculado para "preencher" gráfico, nenhum placeholder.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Activity, ChevronRight, Lightbulb, Target } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { brainOverviewFn } from "@/lib/brain/api";
import type { BrainScopeFilter } from "@/lib/brain/overview.types";
import {
  BrainEmpty,
  ConfidenceMeter,
  MetaChip,
  ScopeBadge,
  SectionHeader,
  formatDateTime,
  formatDay,
  relativeFromMinutes,
} from "@/components/brain/brain-primitives";
import { LearningDetailDrawer } from "@/components/brain/learning-detail-drawer";

const HEALTH_DOT: Record<string, string> = {
  healthy: "var(--chart-2)",
  warning: "var(--chart-4)",
  critical: "var(--destructive)",
};
const HEALTH_LABEL: Record<string, string> = {
  healthy: "Saudável",
  warning: "Atenção",
  critical: "Problema",
};

export function BrainIntelligencePanel({
  brandId,
  clientId: activeClientId = null,
  lockClient = false,
}: {
  brandId?: string | null;
  clientId?: string | null;
  lockClient?: boolean;
}) {
  const [scope, setScope] = useState<BrainScopeFilter>(activeClientId ? "client" : "brand");
  const [clientId, setClientId] = useState<string | null>(activeClientId);
  const [days, setDays] = useState(30);
  const [openLearning, setOpenLearning] = useState<string | null>(null);
  const [healthOpen, setHealthOpen] = useState(false);

  useEffect(() => {
    setClientId(activeClientId);
    if (activeClientId) setScope("client");
  }, [activeClientId]);

  const fetchOverview = useServerFn(brainOverviewFn);
  const q = useQuery({
    queryKey: ["brain-overview", brandId ?? "all", scope, clientId, days],
    queryFn: () =>
      fetchOverview({
        data: { brandId: brandId ?? null, clientId, scope, days },
      }),
  });
  const d = q.data;
  const health = d?.health;

  const evidence = d?.evidenceOutcomes ?? null;
  const evidenceChart = useMemo(
    () =>
      evidence
        ? [
            { name: "Aprovado", value: evidence.approved },
            { name: "Ajuste", value: evidence.rework },
            { name: "Rejeitado", value: evidence.rejected },
          ]
        : [],
    [evidence],
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-8 p-4 md:p-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Brain</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Inteligência contínua baseada nos dados, resultados e comportamento da sua operação.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border/60 p-0.5">
            {(["global", "brand", "client"] as BrainScopeFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                disabled={s === "client" && !clientId}
                onClick={() => setScope(s)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  scope === s
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "global" ? "Global" : s === "brand" ? "Marca" : "Cliente"}
              </button>
            ))}
          </div>

          {!lockClient && (d?.clientsAvailable?.length ?? 0) > 0 && (
            <Select
              value={clientId ?? "__none__"}
              onValueChange={(v) => {
                const next = v === "__none__" ? null : v;
                setClientId(next);
                if (!next && scope === "client") setScope("brand");
                if (next) setScope("client");
              }}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Todos os clientes</SelectItem>
                {d!.clientsAvailable.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 dias</SelectItem>
              <SelectItem value="90">90 dias</SelectItem>
              <SelectItem value="180">180 dias</SelectItem>
            </SelectContent>
          </Select>

          <button
            type="button"
            onClick={() => setHealthOpen(true)}
            className="flex h-8 items-center gap-2 rounded-lg border border-border/60 px-2.5 text-xs font-medium transition-colors hover:bg-muted/50"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: HEALTH_DOT[health?.status ?? "warning"] }}
            />
            {health ? HEALTH_LABEL[health.status] : "Saúde"}
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* ── O que o Brain sabe ─────────────────────────────── */}
      <section>
        <SectionHeader
          title="O que o Brain sabe"
          hint={
            d?.avgConfidence != null
              ? `${d.learnings.length} aprendizados ativos · confiança média ${Math.round(
                  d.avgConfidence * 100,
                )}%`
              : "Aprendizados consolidados a partir das evidências da operação."
          }
        />
        {q.isLoading ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        ) : (d?.learnings.length ?? 0) === 0 ? (
          <BrainEmpty
            title="Ainda não há aprendizado suficiente neste escopo."
            description="O Brain precisa de mais evidências para identificar padrões confiáveis."
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {d!.learnings.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setOpenLearning(l.id)}
                className="group rounded-xl border border-border/60 p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ScopeBadge scope={l.scope} suffix={l.clientName} />
                      {l.category && <MetaChip>{l.category}</MetaChip>}
                    </div>
                    <h4 className="mt-1.5 text-sm font-semibold leading-snug">{l.title}</h4>
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                      {l.conclusion}
                    </p>
                  </div>
                  <ConfidenceMeter value={l.confidence} className="w-28 shrink-0" />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {(l.sample || l.reinforcement) > 0 && (
                    <MetaChip>{l.sample || l.reinforcement} evidências</MetaChip>
                  )}
                  {l.windowDays != null && <MetaChip>{l.windowDays} dias</MetaChip>}
                  {l.channel && <MetaChip>canal {l.channel}</MetaChip>}
                  {l.format && <MetaChip>formato {l.format}</MetaChip>}
                  {l.contradictions > 0 && <MetaChip>{l.contradictions} contradições</MetaChip>}
                  <span className="ml-auto text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                    Ver evidências →
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── Evolução + Timeline ────────────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <SectionHeader
            title="Evolução do Brain"
            hint={`Aprendizados registrados nos últimos ${days} dias.`}
          />
          {q.isLoading ? (
            <Skeleton className="h-56" />
          ) : (d?.timeline.length ?? 0) === 0 ? (
            <BrainEmpty
              title="O histórico de aprendizado ainda está sendo construído."
              description="Assim que novas evidências forem processadas, elas aparecerão aqui."
            />
          ) : (
            <ol className="space-y-4">
              {d!.timeline.map((day) => (
                <li key={day.day} className="relative pl-5">
                  <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-primary" />
                  <span className="absolute left-[3px] top-4 h-[calc(100%-0.5rem)] w-px bg-border" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {formatDay(day.day)}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {day.items.map((it, i) => (
                      <li key={`${day.day}-${i}`} className="text-sm leading-snug">
                        {it.text}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <SectionHeader title="Aprendizados ao longo do tempo" />
            {q.isLoading ? (
              <Skeleton className="h-40" />
            ) : (d?.learningTrend.length ?? 0) < 2 ? (
              <BrainEmpty title="Ainda não há histórico suficiente para desenhar uma evolução." />
            ) : (
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={d!.learningTrend}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(v: string) => formatDay(v)}
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10 }}
                    width={22}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    labelFormatter={(v) => formatDay(String(v))}
                  />
                  <Bar
                    dataKey="created"
                    name="Novos"
                    stackId="a"
                    fill="var(--primary)"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="updated"
                    name="Atualizações"
                    stackId="a"
                    fill="var(--chart-4)"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div>
            <SectionHeader title="Confiança ao longo do tempo" />
            {q.isLoading ? (
              <Skeleton className="h-40" />
            ) : (d?.confidenceTrend.length ?? 0) < 2 ? (
              <BrainEmpty title="A confiança só é representada quando existe histórico de revisões." />
            ) : (
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={d!.confidenceTrend}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(v: string) => formatDay(v)}
                    tick={{ fontSize: 10 }}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    domain={[0, 1]}
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    tick={{ fontSize: 10 }}
                    width={34}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => `${Math.round(v * 100)}%`}
                    labelFormatter={(v) => formatDay(String(v))}
                  />
                  <Line
                    type="monotone"
                    dataKey="confidence"
                    stroke="var(--chart-2)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </section>

      {/* ── Evidências ─────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Evidências"
          hint="Resultados reais que sustentam os aprendizados em escopo."
        />
        {q.isLoading ? (
          <Skeleton className="h-32" />
        ) : !evidence ? (
          <BrainEmpty
            title="Nenhuma evidência de decisão consolidada neste escopo."
            description="Aprovações, ajustes e rejeições passam a alimentar esta visão conforme as peças são avaliadas."
          />
        ) : (
          <div className="grid gap-4 rounded-xl border border-border/60 p-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <div className="text-2xl font-semibold tabular-nums">{evidence.total}</div>
              <p className="text-xs text-muted-foreground">evidências analisadas</p>
              <div className="space-y-1 pt-1 text-xs">
                <Row label="Aprovadas" value={evidence.approved} />
                <Row label="Ajustes" value={evidence.rework} />
                <Row label="Rejeições" value={evidence.rejected} />
              </div>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={evidenceChart} layout="vertical" margin={{ left: 8 }}>
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  width={72}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="value" fill="var(--primary)" radius={[0, 3, 3, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ── Insights + Recomendações ──────────────────────── */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader title="Insights" hint="Somente insights ativos, com validade vigente." />
          {q.isLoading ? (
            <Skeleton className="h-32" />
          ) : (d?.insights.length ?? 0) === 0 ? (
            <BrainEmpty title="Nenhum insight relevante no momento." />
          ) : (
            <ul className="space-y-2">
              {d!.insights.map((i) => (
                <li key={i.id} className="rounded-xl border border-border/60 p-3">
                  <div className="flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5 text-primary" />
                    <Badge variant="secondary" className="text-[10px]">
                      {i.type}
                    </Badge>
                    <ScopeBadge scope={i.scope} />
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatDateTime(i.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-snug">{i.description}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <ConfidenceMeter
                      value={i.confidence}
                      showLabel={false}
                      className="max-w-[140px]"
                    />
                    {i.basedOnEvents > 0 && <MetaChip>{i.basedOnEvents} eventos</MetaChip>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionHeader title="Recomendações" hint="Ações sugeridas com base em evidências." />
          {q.isLoading ? (
            <Skeleton className="h-32" />
          ) : (d?.recommendations.length ?? 0) === 0 ? (
            <BrainEmpty title="O Brain ainda não possui recomendações suficientes com base em evidências." />
          ) : (
            <ul className="space-y-2">
              {d!.recommendations.map((r) => (
                <li key={r.id} className="rounded-xl border border-border/60 p-3">
                  <div className="flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-primary" />
                    <Badge variant="secondary" className="text-[10px]">
                      {r.type}
                    </Badge>
                    <ScopeBadge scope={r.scope} />
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </span>
                  </div>
                  <h4 className="mt-1.5 text-sm font-semibold leading-snug">{r.title}</h4>
                  {r.description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {r.description}
                    </p>
                  )}
                  {r.confidence > 0 && (
                    <ConfidenceMeter
                      value={r.confidence}
                      showLabel={false}
                      className="mt-2 max-w-[140px]"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <LearningDetailDrawer memoryId={openLearning} onClose={() => setOpenLearning(null)} />

      {/* ── Saúde do Brain (drawer) ───────────────────────── */}
      <Sheet open={healthOpen} onOpenChange={setHealthOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Saúde do Brain
            </SheetTitle>
          </SheetHeader>
          {!health ? (
            <Skeleton className="mt-4 h-40" />
          ) : (
            <div className="space-y-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: HEALTH_DOT[health.status] }}
                />
                <span className="font-medium">{HEALTH_LABEL[health.status]}</span>
              </div>
              {health.reasons.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-border/60 p-3 text-xs text-muted-foreground">
                  {health.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
              )}
              <Separator />
              <dl className="space-y-2 text-xs">
                <Row label="Eventos processados (24h)" value={health.eventsProcessed24h} />
                <Row
                  label="Última execução do worker"
                  value={`${relativeFromMinutes(health.minutesSinceWorkerRun)}${
                    health.lastWorkerStatus ? ` · ${health.lastWorkerStatus}` : ""
                  }`}
                />
                <Row label="Última mineração" value={formatDateTime(health.lastMiningAt)} />
                <Row label="Memórias ativas" value={health.activeMemories} />
                <Row label="Insights ativos" value={health.activeInsights} />
                <Row label="Fila aguardando" value={health.queuePending} />
                <Row label="Fila com falha" value={health.queueFailed} />
                <Row label="Falhas do worker (24h)" value={health.failures24h} />
              </dl>
              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to="/brain/diagnostics">Ver detalhes técnicos</Link>
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
