/**
 * Primitivas de visualização do painel de Analytics.
 *
 * Regras de dataviz (fixas):
 * - um único eixo por gráfico;
 * - paleta categórica acessível a daltônicos, em ordem fixa, com rótulo direto;
 * - heatmap em matiz único sequencial;
 * - sparklines finos (2px), sem eixos;
 * - legenda sempre que houver 2+ séries;
 * - textos em tons de tinta, nunca na cor da série.
 */
import { useId, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Paleta categórica (Okabe–Ito) em ordem fixa. */
export const CATEGORICAL_PALETTE = ["#0072B2", "#E69F00", "#009E73", "#CC79A7"] as const;
/** Matiz único do heatmap / séries principais. */
export const SEQUENTIAL_HUE = "#0072B2";
export const PREV_SERIES_COLOR = "#B0B8C6";

export function categoryColor(index: number): string {
  return CATEGORICAL_PALETTE[index % CATEGORICAL_PALETTE.length];
}

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (Math.abs(n) >= 1_000)
    return `${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return Math.round(n).toLocaleString("pt-BR");
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  color = SEQUENTIAL_HUE,
  className,
  ariaLabel,
}: {
  values: number[];
  color?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const path = useMemo(() => {
    const pts = values.filter((v) => Number.isFinite(v));
    if (pts.length < 2) return null;
    const max = Math.max(...pts);
    const min = Math.min(...pts);
    const span = max - min || 1;
    const stepX = 100 / (pts.length - 1);
    return pts
      .map((v, i) => {
        const x = (i * stepX).toFixed(2);
        const y = (26 - ((v - min) / span) * 22).toFixed(2);
        return `${i === 0 ? "M" : "L"}${x} ${y}`;
      })
      .join(" ");
  }, [values]);

  if (!path) return <div className={cn("h-[26px]", className)} aria-hidden />;
  return (
    <svg
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className={cn("h-[26px] w-full", className)}
      role="img"
      aria-label={ariaLabel ?? "Tendência do período"}
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// KPI tile
// ---------------------------------------------------------------------------

export function KpiSparklineTile({
  label,
  value,
  deltaPct,
  deltaSuffix = "%",
  series,
  footnote,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  deltaSuffix?: string;
  series: number[];
  footnote?: string;
}) {
  const up = (deltaPct ?? 0) >= 0;
  const DeltaIcon = deltaPct == null ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 flex items-end gap-2">
        <div className="text-2xl font-extrabold leading-none tabular-nums tracking-tight">
          {value}
        </div>
        <div
          className={cn(
            "flex items-center gap-0.5 pb-0.5 text-[11px] font-bold tabular-nums",
            deltaPct == null
              ? "text-muted-foreground"
              : up
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
          )}
          title="Variação vs. período anterior"
        >
          <DeltaIcon className="h-3 w-3" />
          {deltaPct == null
            ? "—"
            : `${Math.abs(deltaPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${deltaSuffix}`}
        </div>
      </div>
      <Sparkline values={series} ariaLabel={`Tendência de ${label}`} className="mt-2" />
      {footnote ? (
        <div className="mt-1 text-[11px] font-medium text-muted-foreground">{footnote}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aviso compacto de reconexão
// ---------------------------------------------------------------------------

export function ReconnectNotice({ accounts }: { accounts: string[] }) {
  if (!accounts.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="min-w-0 flex-1 text-amber-900 dark:text-amber-200">
        <b className="font-semibold">
          {accounts.length === 1
            ? "1 conta precisa ser reconectada."
            : `${accounts.length} contas precisam ser reconectadas.`}
        </b>{" "}
        <span className="text-amber-800/90 dark:text-amber-200/80">
          Nenhum dado histórico é perdido.
        </span>
      </p>
      <Button asChild size="sm" variant="outline" className="h-7 shrink-0 px-2.5 text-[11px]">
        <Link to="/connections">Abrir Integrações</Link>
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Evolução (série temporal, eixo único, comparação tracejada)
// ---------------------------------------------------------------------------

export type EvolutionPoint = { date: string; current: number; previous: number | null };

const AXIS_FMT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const TOOLTIP_FMT = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
});

export function EvolutionChart({
  points,
  showPrevious,
  metricLabel,
}: {
  points: EvolutionPoint[];
  showPrevious: boolean;
  metricLabel: string;
}) {
  const gradientId = useId().replace(/[:]/g, "");
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SEQUENTIAL_HUE} stopOpacity={0.18} />
              <stop offset="100%" stopColor={SEQUENTIAL_HUE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 4" opacity={0.25} vertical={false} />
          <XAxis
            dataKey="date"
            fontSize={11}
            stroke="hsl(var(--muted-foreground))"
            minTickGap={28}
            tickFormatter={(v) => {
              const d = new Date(String(v));
              return Number.isNaN(d.getTime()) ? String(v) : AXIS_FMT.format(d).replace(".", "");
            }}
          />
          <YAxis
            fontSize={11}
            stroke="hsl(var(--muted-foreground))"
            width={48}
            tickFormatter={(v) => formatCompact(Number(v))}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(l) => {
              const d = new Date(String(l));
              return Number.isNaN(d.getTime()) ? String(l) : TOOLTIP_FMT.format(d);
            }}
            formatter={(v: number, name) => [formatCompact(Number(v)), String(name)]}
          />
          {showPrevious ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          <Area
            type="monotone"
            dataKey="current"
            name={showPrevious ? "Período atual" : metricLabel}
            stroke={SEQUENTIAL_HUE}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {showPrevious ? (
            <Line
              type="monotone"
              dataKey="previous"
              name="Período anterior"
              stroke={PREV_SERIES_COLOR}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras horizontais com rótulo direto
// ---------------------------------------------------------------------------

export function HorizontalBarBreakdown({
  rows,
}: {
  rows: { key: string; label: string; value: number; hint?: string }[];
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className="flex w-24 shrink-0 items-center gap-2 text-xs font-semibold text-foreground">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: categoryColor(i) }}
              aria-hidden
            />
            <span className="truncate" title={r.label}>
              {r.label}
            </span>
          </div>
          <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-md bg-muted">
            <div
              className="h-full rounded-md"
              style={{
                width: `${Math.max((r.value / max) * 100, 2)}%`,
                background: categoryColor(i),
              }}
            />
          </div>
          <div className="w-16 shrink-0 text-right text-xs font-bold tabular-nums">
            {formatCompact(r.value)}
          </div>
        </div>
      ))}
      {rows.some((r) => r.hint) ? (
        <ul className="mt-1 space-y-0.5 text-[11px] font-medium text-muted-foreground">
          {rows
            .filter((r) => r.hint)
            .map((r) => (
              <li key={`${r.key}-hint`}>
                {r.label} · {r.hint}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heatmap dias × faixas do dia (matiz único sequencial)
// ---------------------------------------------------------------------------

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const DAY_BUCKET_LABEL: Record<string, string> = {
  madrugada: "Madrugada",
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
};
const BUCKET_ORDER = ["madrugada", "manha", "tarde", "noite"] as const;

export function BestTimeHeatmap({
  cells,
}: {
  cells: { weekday: number; bucket: string; score: number; posts: number }[];
}) {
  const byKey = new Map(cells.map((c) => [`${c.weekday}-${c.bucket}`, c]));
  const max = Math.max(...cells.map((c) => c.score), 1);
  const peak = cells.reduce<(typeof cells)[number] | null>(
    (best, c) => (!best || c.score > best.score ? c : best),
    null,
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] gap-1">
        <span />
        {WEEKDAY_SHORT.map((d) => (
          <span key={d} className="pb-0.5 text-center text-[10px] font-bold text-muted-foreground">
            {d}
          </span>
        ))}
        {BUCKET_ORDER.map((bucket) => (
          <div key={bucket} className="contents">
            <span className="flex items-center text-[11px] font-semibold text-muted-foreground">
              {DAY_BUCKET_LABEL[bucket]}
            </span>
            {WEEKDAY_SHORT.map((_, weekday) => {
              const cell = byKey.get(`${weekday}-${bucket}`);
              const ratio = cell ? cell.score / max : 0;
              const isPeak = !!peak && peak.weekday === weekday && peak.bucket === bucket;
              return (
                <div
                  key={`${weekday}-${bucket}`}
                  className={cn(
                    "aspect-[1.6/1] rounded-md border border-border/40",
                    isPeak && "ring-2 ring-offset-1",
                  )}
                  style={{
                    background:
                      ratio > 0
                        ? `color-mix(in oklab, ${SEQUENTIAL_HUE} ${Math.round(12 + ratio * 88)}%, white)`
                        : "hsl(var(--muted))",
                    ...(isPeak ? { ["--tw-ring-color" as string]: SEQUENTIAL_HUE } : {}),
                  }}
                  title={`${WEEKDAY_SHORT[weekday]} · ${DAY_BUCKET_LABEL[bucket]} — ${formatCompact(cell?.score ?? 0)} eng · ${cell?.posts ?? 0} post(s)`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground">
        <span>
          {peak ? (
            <>
              Pico:{" "}
              <b className="text-foreground">
                {WEEKDAY_SHORT[peak.weekday]} · {DAY_BUCKET_LABEL[peak.bucket]}
              </b>
            </>
          ) : (
            "Sem histórico suficiente."
          )}
        </span>
        <span className="flex items-center gap-1.5">
          menos
          <span
            className="h-2.5 w-16 rounded-full"
            style={{
              background: `linear-gradient(90deg, color-mix(in oklab, ${SEQUENTIAL_HUE} 12%, white), ${SEQUENTIAL_HUE})`,
            }}
            aria-hidden
          />
          mais
        </span>
      </div>
    </div>
  );
}
