import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Loader2, Printer, ShieldAlert, Sparkles, CheckCircle2 } from "lucide-react";
import {
  resolveMediaPlanPublic,
  listMediaPlanPublicItems,
  type MediaPlanPublicItem,
  type MediaPlanPublicResolve,
} from "@/lib/media-plan-public.functions";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import { cn } from "@/lib/utils";

const searchSchema = z.object({ token: z.string().min(8) });
type Search = { token: string };

export const Route = createFileRoute("/plano/$planId")({
  validateSearch: (raw: Record<string, unknown>): Search => searchSchema.parse(raw),
  component: PublicMediaPlanPage,
  head: () => ({
    meta: [
      { title: "Plano de Mídia — Apresentação" },
      { name: "description", content: "Apresentação do plano de mídia paga." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

const CURRENCY = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
const PCT = (n: number) => `${(Number.isFinite(n) ? n : 0).toFixed(1)}%`;

const STAGE_LABEL: Record<string, string> = {
  topo: "Topo do funil",
  meio: "Meio do funil",
  fundo: "Fundo do funil",
};
const STAGE_ORDER: Array<"topo" | "meio" | "fundo"> = ["topo", "meio", "fundo"];

function PublicMediaPlanPage() {
  const { token } = Route.useSearch();
  const resolveFn = useServerFn(resolveMediaPlanPublic);
  const itemsFn = useServerFn(listMediaPlanPublicItems);

  const resolveQ = useQuery<MediaPlanPublicResolve>({
    queryKey: ["public-media-plan", token],
    queryFn: () => resolveFn({ data: { token } }),
    retry: false,
  });
  const itemsQ = useQuery<MediaPlanPublicItem[]>({
    queryKey: ["public-media-plan-items", token],
    queryFn: () => itemsFn({ data: { token } }),
    enabled: resolveQ.isSuccess,
  });

  if (resolveQ.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
        Carregando plano…
      </div>
    );
  }
  if (resolveQ.isError || !resolveQ.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background text-foreground">
        <ShieldAlert className="mb-2 h-8 w-8 text-muted-foreground" />
        <div className="text-lg font-medium">Link inválido ou expirado</div>
        <div className="text-sm text-muted-foreground">
          Solicite um novo link ao responsável pela campanha.
        </div>
      </div>
    );
  }

  return (
    <Presentation
      plan={resolveQ.data.plan}
      client={resolveQ.data.client}
      brand={resolveQ.data.brand}
      items={itemsQ.data ?? []}
    />
  );
}

function Presentation({
  plan,
  client,
  brand,
  items,
}: {
  plan: MediaPlanPublicResolve["plan"];
  client: MediaPlanPublicResolve["client"];
  brand: MediaPlanPublicResolve["brand"];
  items: MediaPlanPublicItem[];
}) {
  const totalAmount = useMemo(
    () => items.reduce((s, i) => s + Number(i.budget_amount || 0), 0),
    [items],
  );
  const totalPct = useMemo(() => items.reduce((s, i) => s + Number(i.budget_pct || 0), 0), [items]);
  const byStage = useMemo(() => {
    const g: Record<string, MediaPlanPublicItem[]> = { topo: [], meio: [], fundo: [] };
    for (const i of items) {
      const s = i.funnel_stage ?? "meio";
      (g[s] ||= []).push(i);
    }
    return g;
  }, [items]);
  const byChannel = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      const k = i.channel ?? "Outros";
      m.set(k, (m.get(k) ?? 0) + Number(i.budget_amount || 0));
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const [donutHover, setDonutHover] = useState<number | null>(null);
  const approved = plan.status === "approved";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-after: always; break-after: page; }
        }
      `}</style>

      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur no-print">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2.5 text-sm">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-white shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="font-semibold tracking-tight">Unitos</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{brand.name}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-foreground">{client.name}</span>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Printer className="h-3.5 w-3.5" />
            Exportar PDF
          </button>
        </div>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-12">
        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
            Plano de mídia paga
          </span>
          {approved && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Aprovado
            </span>
          )}
        </div>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{plan.title}</h1>
        <p className="mt-3 text-base text-muted-foreground">
          {client.name}
          {plan.period_start ? ` · ${formatDate(plan.period_start)}` : ""}
          {plan.period_end ? ` — ${formatDate(plan.period_end)}` : ""}
        </p>
        <PageKpiGrid columns={3} className="mt-8">
          <HeroStat label="Investimento mensal" value={CURRENCY(plan.monthly_budget)} />
          <HeroStat label="Alocado" value={CURRENCY(totalAmount)} sub={PCT(totalPct)} />
          <HeroStat label="Iniciativas" value={String(items.length)} />
        </PageKpiGrid>
      </section>

      {/* Funnel */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <SectionTitle kicker="01" title="Estratégia por funil" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          {STAGE_ORDER.map((stage) => {
            const rows = byStage[stage] ?? [];
            const sub = rows.reduce((s, r) => s + Number(r.budget_amount || 0), 0);
            const subPct = rows.reduce((s, r) => s + Number(r.budget_pct || 0), 0);
            return (
              <div key={stage} className="rounded-2xl border border-border/60 bg-card p-5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {STAGE_LABEL[stage]}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {rows.length} iniciativa{rows.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="mt-3 flex items-end justify-between">
                  <div className="text-3xl font-semibold tracking-tight">{CURRENCY(sub)}</div>
                  <div className="text-sm text-muted-foreground">{PCT(subPct)}</div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-indigo-600 dark:bg-indigo-500"
                    style={{ width: `${Math.min(100, subPct)}%` }}
                  />
                </div>
                <div className="mt-5 space-y-2">
                  {rows.slice(0, 4).map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="truncate">
                        {r.product_service || r.campaign_type || "Iniciativa"}
                      </div>
                      <div className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.channel || "—"}
                      </div>
                    </div>
                  ))}
                  {rows.length > 4 && (
                    <div className="text-xs text-muted-foreground">+{rows.length - 4} outras</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="page-break" />

      {/* Channel mix — donut */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <SectionTitle kicker="02" title="Mix de canais" />
        <div className="mt-6 grid grid-cols-1 items-center gap-10 md:grid-cols-2">
          <div className="relative mx-auto h-64 w-64">
            <Donut
              slices={byChannel.map(([k, v]) => ({ label: k, value: v }))}
              onHover={setDonutHover}
              hoverIndex={donutHover}
            />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Total
              </div>
              <div className="text-2xl font-semibold tracking-tight">{CURRENCY(totalAmount)}</div>
            </div>
          </div>
          <div className="space-y-2">
            {byChannel.map(([k, v], idx) => {
              const share = totalAmount > 0 ? (v / totalAmount) * 100 : 0;
              const active = donutHover === idx;
              return (
                <div
                  key={k}
                  onMouseEnter={() => setDonutHover(idx)}
                  onMouseLeave={() => setDonutHover(null)}
                  className={cn(
                    "flex items-center justify-between rounded-xl border px-4 py-3 transition",
                    active ? "border-indigo-500/50 bg-indigo-500/5" : "border-border/60 bg-card",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-2.5 w-2.5 rounded-full bg-indigo-500"
                      style={{ opacity: active ? 1 : 0.55 }}
                    />
                    <div className="text-sm">{k}</div>
                  </div>
                  <div className="flex items-center gap-4 tabular-nums text-muted-foreground">
                    <span>{PCT(share)}</span>
                    <span className="text-foreground">{CURRENCY(v)}</span>
                  </div>
                </div>
              );
            })}
            {byChannel.length === 0 && (
              <div className="text-sm text-muted-foreground">Sem canais definidos.</div>
            )}
          </div>
        </div>
      </section>

      <div className="page-break" />

      {/* Detailed table */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <SectionTitle kicker="03" title="Detalhamento" />
        <div className="mt-6 overflow-hidden rounded-2xl border border-border/60 bg-card">
          <div className="grid grid-cols-[1.4fr_1fr_0.8fr_1fr_0.9fr_0.9fr_1fr] gap-3 border-b border-border/60 bg-muted/40 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Produto</span>
            <span>Campanha</span>
            <span>Etapa</span>
            <span>Canal</span>
            <span>KPI</span>
            <span className="text-right">%</span>
            <span className="text-right">R$</span>
          </div>
          {items.map((i) => (
            <div
              key={i.id}
              className="grid grid-cols-[1.4fr_1fr_0.8fr_1fr_0.9fr_0.9fr_1fr] gap-3 border-b border-border/40 px-5 py-3 text-sm"
            >
              <div>{i.product_service || "—"}</div>
              <div className="text-muted-foreground">{i.campaign_type || "—"}</div>
              <div className="text-muted-foreground">
                {i.funnel_stage ? STAGE_LABEL[i.funnel_stage].split(" ")[0] : "—"}
              </div>
              <div className="text-muted-foreground">{i.channel || "—"}</div>
              <div className="text-muted-foreground">{i.main_kpi || "—"}</div>
              <div className="text-right tabular-nums text-muted-foreground">
                {PCT(Number(i.budget_pct || 0))}
              </div>
              <div className="text-right tabular-nums font-medium">
                {CURRENCY(Number(i.budget_amount || 0))}
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              Nenhuma iniciativa cadastrada.
            </div>
          )}
        </div>
      </section>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 py-6 text-xs text-muted-foreground md:flex-row md:items-center">
          <div>
            © {new Date().getFullYear()} {brand.name}. Documento confidencial.
          </div>
          <div>Atualizado em {formatDate(plan.updated_at)}</div>
        </div>
      </footer>
    </div>
  );
}

/** Adaptador do padrão canônico `PageKpi` (mantém a API local desta página). */
function HeroStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <PageKpi label={label} value={value} description={sub} />;
}

function SectionTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b border-border/60 pb-3">
      <div className="flex items-baseline gap-3">
        <div className="text-xs font-medium tracking-widest text-muted-foreground">{kicker}</div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      </div>
    </div>
  );
}

function Donut({
  slices,
  hoverIndex,
  onHover,
}: {
  slices: Array<{ label: string; value: number }>;
  hoverIndex: number | null;
  onHover: (i: number | null) => void;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const size = 256;
  const stroke = 30;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        className="stroke-muted"
        strokeWidth={stroke}
      />
      {slices.map((s, idx) => {
        const frac = s.value / total;
        const dash = c * frac;
        const el = (
          <circle
            key={s.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            className="stroke-indigo-500"
            strokeOpacity={hoverIndex === null ? 0.55 + idx * 0.08 : hoverIndex === idx ? 1 : 0.2}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            onMouseEnter={() => onHover(idx)}
            onMouseLeave={() => onHover(null)}
            style={{ cursor: "pointer", transition: "stroke-opacity 200ms" }}
          />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
