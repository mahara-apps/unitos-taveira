// Relatório do que foi produzido, com filtros de período, canal e etapa.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { PLAN_CHANNEL_LABEL, PLAN_CHANNELS, type PlanChannel } from "@/lib/monthly-plan-fields";
import { listProductionReportFn, type ProductionRow } from "@/lib/production-report.functions";

type PeriodKey = "current" | "previous" | "last3" | "year";

const PERIOD_LABEL: Record<PeriodKey, string> = {
  current: "Mês atual",
  previous: "Mês anterior",
  last3: "Últimos 3 meses",
  year: "Ano atual",
};

const STAGE_LABEL: Record<string, string> = {
  idea: "Ideia",
  production: "Produção",
  review: "Revisão",
  approved: "Aprovado",
  scheduled: "Agendado",
  published: "Publicado",
};

const STAGE_CLASS: Record<string, string> = {
  published: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  scheduled: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  approved: "border-primary/40 bg-primary/10 text-primary",
  review: "border-amber-500/40 bg-amber-500/10 text-amber-500",
};

export function periodRange(period: PeriodKey, now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "previous") {
    return {
      from: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
      to: new Date(Date.UTC(y, m, 1) - 1).toISOString(),
    };
  }
  if (period === "last3") {
    return {
      from: new Date(Date.UTC(y, m - 2, 1)).toISOString(),
      to: new Date(Date.UTC(y, m + 1, 1) - 1).toISOString(),
    };
  }
  if (period === "year") {
    return {
      from: new Date(Date.UTC(y, 0, 1)).toISOString(),
      to: new Date(Date.UTC(y + 1, 0, 1) - 1).toISOString(),
    };
  }
  return {
    from: new Date(Date.UTC(y, m, 1)).toISOString(),
    to: new Date(Date.UTC(y, m + 1, 1) - 1).toISOString(),
  };
}

function formatDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

type Props = {
  brandId: string;
  clientId: string;
  quotaByChannel?: Record<string, number>;
  onLoaded?: (info: { published: number; total: number }) => void;
};

export function ProductionReport({ brandId, clientId, quotaByChannel }: Props) {
  const [period, setPeriod] = useState<PeriodKey>("current");
  const [channel, setChannel] = useState<string>("all");
  const [stage, setStage] = useState<string>("all");

  const range = useMemo(() => periodRange(period), [period]);
  const load = useServerFn(listProductionReportFn);

  const q = useQuery({
    queryKey: ["production-report", brandId, clientId, period, channel, stage],
    queryFn: () =>
      load({
        data: {
          brandId,
          clientId,
          from: range.from,
          to: range.to,
          ...(channel !== "all" ? { channel } : {}),
          ...(stage !== "all" ? { stage } : {}),
        },
      }),
    staleTime: 20_000,
  });

  const rows = (q.data?.rows ?? []) as ProductionRow[];
  const byChannel = q.data?.byChannel ?? {};

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Relatório de produção</h2>
          <p className="text-xs text-muted-foreground">
            Tudo que foi produzido para este cliente no período selecionado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABEL) as PeriodKey[]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {PERIOD_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={channel} onValueChange={setChannel}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Todos os canais
              </SelectItem>
              {PLAN_CHANNELS.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">
                  {PLAN_CHANNEL_LABEL[c as PlanChannel] ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">
                Todas as etapas
              </SelectItem>
              {Object.keys(STAGE_LABEL).map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {STAGE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <DashboardPanelSurface className="p-6 text-sm text-muted-foreground">
          Nenhuma peça produzida com esses filtros.
        </DashboardPanelSurface>
      ) : (
        <DashboardPanelSurface className="overflow-hidden">
          <div className="divide-y divide-border/60">
            {rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title || "Sem título"}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {r.channels.length
                      ? r.channels.map((c) => PLAN_CHANNEL_LABEL[c as PlanChannel] ?? c).join(" · ")
                      : "Sem canal"}
                    {r.format ? ` · ${r.format}` : ""} ·{" "}
                    {r.origin === "pauta" ? "da pauta" : "criado direto"}
                  </p>
                </div>
                <Badge variant="outline" className={`text-[10px] ${STAGE_CLASS[r.stage] ?? ""}`}>
                  {STAGE_LABEL[r.stage] ?? r.stage}
                </Badge>
                <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                  {formatDate(r.date ?? r.created_at)}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border/60 bg-muted/30 px-4 py-3">
            {Object.entries(byChannel).length === 0 ? (
              <span className="text-[11px] text-muted-foreground">Sem contagem por canal.</span>
            ) : (
              Object.entries(byChannel).map(([c, n]) => {
                const quota = quotaByChannel?.[c];
                const over = typeof quota === "number" && quota > 0 && n > quota;
                return (
                  <span
                    key={c}
                    className={`rounded-full px-2.5 py-1 text-[11px] tabular-nums ring-1 ${
                      over
                        ? "bg-amber-500/10 text-amber-500 ring-amber-500/30"
                        : "bg-muted text-muted-foreground ring-border/60"
                    }`}
                  >
                    {PLAN_CHANNEL_LABEL[c as PlanChannel] ?? c}: {n}
                    {typeof quota === "number" && quota > 0 ? ` / ${quota}` : ""}
                  </span>
                );
              })
            )}
          </div>
        </DashboardPanelSurface>
      )}
    </section>
  );
}
