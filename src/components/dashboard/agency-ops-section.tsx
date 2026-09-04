import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  BadgeCheck,
  Clock,
  Gauge,
  Layers,
  TrendingUp,
  Users,
  ArrowRight,
} from "lucide-react";
import type { DateRange } from "react-day-picker";

import {
  getAgencyOpsDashboardFn,
  type AgencyOpsDashboard,
  type BottleneckStage,
  type OverdueTaskLite,
  type PendingApprovalLite,
  type StageCount,
  type TeamThroughputRow,
} from "@/lib/agency-ops.functions";
import { PanelCard } from "@/components/ui/panel-card";
import { PanelSkeletonList } from "@/components/ui/panel-skeleton";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { cn } from "@/lib/utils";

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  const d = Math.floor(h / 24);
  const r = Math.round(h - d * 24);
  return r ? `${d}d ${r}h` : `${d}d`;
}

export function AgencyOpsSection({
  brandId,
  range,
}: {
  brandId: string;
  range: DateRange | undefined;
}) {
  const fn = useServerFn(getAgencyOpsDashboardFn);
  const rangeKey = [range?.from?.getTime() ?? null, range?.to?.getTime() ?? null] as const;

  const q = useQuery({
    queryKey: ["agency-ops", brandId, ...rangeKey],
    queryFn: () =>
      fn({
        data: {
          brandId,
          range:
            range?.from && range?.to
              ? { from: range.from.toISOString(), to: range.to.toISOString() }
              : undefined,
        },
      }),
    staleTime: 30_000,
  });

  const d = q.data;
  const loading = q.isLoading;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between border-b border-border/40 pb-1.5 pt-2">
        <h2 className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-foreground/80">
          Operação da agência
        </h2>
        <span className="text-[11px] text-muted-foreground">
          Visão consolidada · todos os clientes
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[420px]">
          <OverdueTasksCard data={d} loading={loading} />
        </div>
        <div className="h-[420px]">
          <PendingApprovalCard data={d} loading={loading} />
        </div>
        <div className="h-[380px]">
          <ContentInProductionCard data={d} loading={loading} />
        </div>
        <div className="h-[380px]">
          <SlaSummaryCard data={d} loading={loading} />
        </div>
        <div className="h-[420px]">
          <BottlenecksCard data={d} loading={loading} />
        </div>
        <div className="h-[420px]">
          <TeamThroughputCard data={d} loading={loading} />
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Cards ----------------------------- */

function OverdueTasksCard({
  data,
  loading,
}: {
  data: AgencyOpsDashboard | undefined;
  loading: boolean;
}) {
  const items = data?.overdueTasks.items ?? [];
  const total = data?.overdueTasks.total ?? 0;
  return (
    <PanelCard
      title="Tarefas atrasadas"
      subtitle={`${total} tarefa${total === 1 ? "" : "s"} em atraso`}
      icon={<AlertTriangle className="h-4 w-4" />}
      action={
        <Link
          to="/tasks"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Abrir todas <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <PanelSkeletonList rows={6} />
      ) : items.length === 0 ? (
        <PanelEmptyState
          icon={<AlertTriangle className="h-5 w-5" />}
          text="Nenhuma tarefa atrasada. Excelente ritmo."
        />
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map((t) => (
            <OverdueRow key={t.id} t={t} />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function OverdueRow({ t }: { t: OverdueTaskLite }) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t.title}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {t.client_name && <span className="truncate">{t.client_name}</span>}
          {t.assignee_name && (
            <>
              <span>·</span>
              <span className="truncate">{t.assignee_name}</span>
            </>
          )}
        </div>
      </div>
      <span className="inline-flex shrink-0 items-center rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] text-rose-600 dark:text-rose-400">
        {formatHours(t.hours_overdue)} atraso
      </span>
    </li>
  );
}

function PendingApprovalCard({
  data,
  loading,
}: {
  data: AgencyOpsDashboard | undefined;
  loading: boolean;
}) {
  const items = data?.pendingApproval.items ?? [];
  const total = data?.pendingApproval.total ?? 0;
  const avg = data?.pendingApproval.avgWaitHours ?? 0;
  return (
    <PanelCard
      title="Aguardando aprovação"
      subtitle={
        total
          ? `${total} pendente${total === 1 ? "" : "s"} · espera média ${formatHours(avg)}`
          : "Nenhum post aguardando aprovação"
      }
      icon={<BadgeCheck className="h-4 w-4" />}
      action={
        <Link
          to="/content"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Ver Kanban <ArrowRight className="h-3 w-3" />
        </Link>
      }
    >
      {loading ? (
        <PanelSkeletonList rows={6} />
      ) : items.length === 0 ? (
        <PanelEmptyState
          icon={<BadgeCheck className="h-5 w-5" />}
          text="Fila de aprovação zerada."
        />
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map((p) => (
            <PendingRow key={p.post_id} p={p} />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function PendingRow({ p }: { p: PendingApprovalLite }) {
  const stale = p.waiting_hours >= 48;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{p.title}</div>
        {p.client_name && (
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.client_name}</div>
        )}
      </div>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px]",
          stale
            ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : "border-border/60 bg-muted/40 text-muted-foreground",
        )}
      >
        <Clock className="h-3 w-3" />
        {formatHours(p.waiting_hours)}
      </span>
    </li>
  );
}

function ContentInProductionCard({
  data,
  loading,
}: {
  data: AgencyOpsDashboard | undefined;
  loading: boolean;
}) {
  const total = data?.contentInProduction.total ?? 0;
  const stages = data?.contentInProduction.byStage ?? [];
  const max = stages.reduce((m, s) => Math.max(m, s.count), 0) || 1;
  return (
    <PanelCard
      title="Conteúdos em produção"
      subtitle={`${total} peças ativas no pipeline`}
      icon={<Layers className="h-4 w-4" />}
    >
      {loading ? (
        <PanelSkeletonList rows={5} />
      ) : stages.length === 0 ? (
        <PanelEmptyState
          icon={<Layers className="h-5 w-5" />}
          text="Nenhum conteúdo em produção."
        />
      ) : (
        <ul className="space-y-2 p-4">
          {stages.map((s) => (
            <StageBar key={s.stage_id} s={s} max={max} />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function StageBar({ s, max }: { s: StageCount; max: number }) {
  const pct = Math.round((s.count / max) * 100);
  const color = s.color ?? "hsl(var(--primary))";
  return (
    <li className="flex items-center gap-3 text-xs">
      <div className="w-32 shrink-0 truncate text-muted-foreground" title={s.label}>
        {s.label}
      </div>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(4, pct)}%`, background: color }}
        />
      </div>
      <div className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums">{s.count}</div>
    </li>
  );
}

function SlaSummaryCard({
  data,
  loading,
}: {
  data: AgencyOpsDashboard | undefined;
  loading: boolean;
}) {
  const s = data?.slaSummary;
  const total = s ? s.onTrack + s.atRisk + s.overdue : 0;
  return (
    <PanelCard
      title="SLA médio da operação"
      subtitle="Distribuição do pipeline ativo por status"
      icon={<Gauge className="h-4 w-4" />}
    >
      {loading ? (
        <PanelSkeletonList rows={4} />
      ) : !s || total === 0 ? (
        <PanelEmptyState
          icon={<Gauge className="h-5 w-5" />}
          text="Sem posts ativos com SLA configurado."
        />
      ) : (
        <div className="space-y-4 p-4">
          <div className="flex h-3 w-full overflow-hidden rounded-full border border-border/40">
            <div
              className="bg-emerald-500"
              style={{ width: `${(s.onTrack / total) * 100}%` }}
              title={`No prazo · ${s.onTrack}`}
            />
            <div
              className="bg-amber-500"
              style={{ width: `${(s.atRisk / total) * 100}%` }}
              title={`Em risco · ${s.atRisk}`}
            />
            <div
              className="bg-rose-500"
              style={{ width: `${(s.overdue / total) * 100}%` }}
              title={`Atrasado · ${s.overdue}`}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <SlaStat label="No prazo" value={s.onTrack} tone="emerald" />
            <SlaStat label="Em risco" value={s.atRisk} tone="amber" />
            <SlaStat label="Atrasado" value={s.overdue} tone="rose" />
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            {s.overduePct}% do pipeline em atraso · {s.atRiskPct}% em risco.
          </div>
        </div>
      )}
    </PanelCard>
  );
}

function SlaStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose";
}) {
  const toneMap = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    rose: "text-rose-600 dark:text-rose-400",
  };
  return (
    <div className="rounded-lg border border-border/50 bg-card px-2 py-2">
      <div className={cn("font-mono text-lg tabular-nums", toneMap[tone])}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function BottlenecksCard({
  data,
  loading,
}: {
  data: AgencyOpsDashboard | undefined;
  loading: boolean;
}) {
  const items = data?.bottlenecks ?? [];
  return (
    <PanelCard
      title="Gargalos por etapa"
      subtitle="Etapas com maior atraso e tempo médio no stage"
      icon={<TrendingUp className="h-4 w-4" />}
    >
      {loading ? (
        <PanelSkeletonList rows={5} />
      ) : items.length === 0 ? (
        <PanelEmptyState
          icon={<TrendingUp className="h-5 w-5" />}
          text="Sem gargalos identificados. Fluxo saudável."
        />
      ) : (
        <ul className="divide-y divide-border/50">
          {items.map((b) => (
            <BottleneckRow key={b.stage_id} b={b} />
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function BottleneckRow({ b }: { b: BottleneckStage }) {
  return (
    <li className="px-4 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: b.color ?? "hsl(var(--primary))" }}
            />
            <span className="truncate text-sm font-medium">{b.label}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            SLA {formatHours(b.sla_hours)} · média no stage {formatHours(b.avg_hours_in_stage)}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm tabular-nums text-rose-600 dark:text-rose-400">
            {b.overdue_pct}%
          </div>
          <div className="text-[10px] text-muted-foreground">
            {b.overdue_count}/{b.total} atrasados
          </div>
        </div>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
        <div
          className="h-full rounded-full bg-rose-500/70"
          style={{ width: `${Math.min(100, b.overdue_pct)}%` }}
        />
      </div>
    </li>
  );
}

function TeamThroughputCard({
  data,
  loading,
}: {
  data: AgencyOpsDashboard | undefined;
  loading: boolean;
}) {
  const items = data?.teamThroughput ?? [];
  return (
    <PanelCard
      title="Volume de produção da equipe"
      subtitle={`Tarefas, aprovações e horas registradas · ${data?.rangeDays ?? 30}d`}
      icon={<Users className="h-4 w-4" />}
    >
      {loading ? (
        <PanelSkeletonList rows={5} />
      ) : items.length === 0 ? (
        <PanelEmptyState
          icon={<Users className="h-5 w-5" />}
          text="Nenhuma atividade registrada no período."
        />
      ) : (
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Membro</th>
              <th className="px-2 py-2 text-right font-medium">Tarefas</th>
              <th className="px-2 py-2 text-right font-medium">Aprovadas</th>
              <th className="px-4 py-2 text-right font-medium">Horas</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <TeamRow key={r.user_id} r={r} />
            ))}
          </tbody>
        </table>
      )}
    </PanelCard>
  );
}

function TeamRow({ r }: { r: TeamThroughputRow }) {
  const initials = r.name
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-muted/30">
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          {r.avatar ? (
            <img src={r.avatar} alt="" className="h-6 w-6 rounded-full object-cover" />
          ) : (
            <div className="grid h-6 w-6 place-items-center rounded-full bg-muted text-[10px] font-medium">
              {initials || "?"}
            </div>
          )}
          <span className="truncate text-sm">{r.name}</span>
        </div>
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums">{r.tasks_done}</td>
      <td className="px-2 py-2 text-right font-mono tabular-nums">{r.posts_approved}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{r.hours_logged.toFixed(1)}</td>
    </tr>
  );
}
