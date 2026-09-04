import {
  AlertTriangle,
  Facebook,
  Instagram,
  Layers,
  Linkedin,
  Music2,
  Youtube,
} from "lucide-react";

import { PageKpi, PageKpiGrid, type KpiStatus } from "@/components/ui/page-kpi";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PLAN_CHANNELS,
  PLAN_CHANNEL_LABEL,
  type PlanChannel,
  type VolumetryBasis,
} from "@/lib/monthly-plan-fields";
import { CONTENT_FORMATS, CONTENT_FORMAT_LABEL, type ContentFormat } from "@/lib/content-formats";

export type PlanVolumetry = {
  weekly: Record<string, number>;
  monthlyQuota: Record<string, number>;
  volumetryBasis?: VolumetryBasis;
  totalTarget: number;
  hasBriefing: boolean;
  formatsByChannel: Record<string, string[]>;
  /** Cota mensal por canal → formato canônico. */
  formatQuota?: Record<string, Partial<Record<ContentFormat, number>>>;
  generatedThisMonth: Record<string, number>;
  generatedTotal: number;
  /** Excedentes autorizados pelo gestor no mês corrente, por canal. */
  approvedOverage?: Record<string, number>;
  /** `block` = excedente exige liberação; `warn` = volumetria livre (só aviso). */
  overagePolicy?: "block" | "warn";
  /** Super Admin/Owner/Admin geram acima da cota sem pedir liberação. */
  canBypassOverage?: boolean;
};

const CHANNEL_ICON: Partial<Record<PlanChannel, typeof Instagram>> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
  tiktok: Music2,
  youtube: Youtube,
};

function MetricCard({
  label,
  sub,
  quota,
  generated,
  emphasis,
  breakdown,
  icon,
}: {
  label: string;
  sub?: string;
  quota: number;
  generated: number;
  emphasis?: boolean;
  breakdown?: Partial<Record<ContentFormat, number>>;
  icon?: React.ReactNode;
}) {
  const available = Math.max(0, quota - generated);
  const pct = quota > 0 ? Math.min(100, Math.round((generated / quota) * 100)) : 0;
  const status: KpiStatus = emphasis
    ? "success"
    : available === 0 && quota > 0
      ? "warning"
      : generated > 0
        ? "info"
        : "neutral";
  const formats = breakdown ? CONTENT_FORMATS.filter((f) => (breakdown[f] ?? 0) > 0) : [];

  return (
    <PageKpi
      label={label}
      value={quota}
      status={status}
      icon={icon}
      trailing={`${pct}%`}
      className={emphasis ? "bg-health-good/5" : undefined}
      description={
        <span className="block w-full space-y-2">
          {sub ? <span className="block truncate text-[11px]">{sub}</span> : null}
          {formats.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {formats.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] tabular-nums leading-none text-muted-foreground"
                >
                  {CONTENT_FORMAT_LABEL[f]} {breakdown?.[f]}
                </span>
              ))}
            </span>
          ) : null}
          <span className="block h-1 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full ${
                status === "warning"
                  ? "bg-severity-warning"
                  : status === "success"
                    ? "bg-health-good"
                    : "bg-severity-info"
              }`}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="flex items-center justify-between text-[11px]">
            <span className="tabular-nums">{generated} gerados</span>
            <span className="font-medium tabular-nums text-foreground">
              {available} disponíveis
            </span>
          </span>
        </span>
      }
    />
  );
}

export function VolumetryCards({
  volumetry,
  loading,
}: {
  volumetry: PlanVolumetry | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <PageKpiGrid columns={4}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-xl" />
        ))}
      </PageKpiGrid>
    );
  }

  const channels = PLAN_CHANNELS.filter((c) => (volumetry?.monthlyQuota[c] ?? 0) > 0);

  if (!volumetry || channels.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-severity-warning/30 bg-severity-warning/5 p-4 text-xs text-severity-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Volumetria não definida.</p>
          <p className="mt-0.5 text-muted-foreground">
            Defina quantas peças por semana (ou por mês) em cada canal no briefing do cliente (aba
            Briefing → Metas de publicação) para gerar a pauta.
          </p>
        </div>
      </div>
    );
  }

  const columns = Math.min(4, channels.length + 1) as 2 | 3 | 4;

  return (
    <PageKpiGrid columns={columns}>
      <MetricCard
        emphasis
        icon={<Layers />}
        label="Total do cliente"
        sub="Soma das cotas mensais"
        quota={
          volumetry.totalTarget +
          Object.values(volumetry.approvedOverage ?? {}).reduce((a, b) => a + (b || 0), 0)
        }
        generated={volumetry.generatedTotal}
      />
      {channels.map((c: PlanChannel) => {
        const Icon = CHANNEL_ICON[c];
        return (
          <MetricCard
            key={c}
            icon={Icon ? <Icon /> : undefined}
            label={PLAN_CHANNEL_LABEL[c]}
            sub={`${
              volumetry.volumetryBasis === "monthly"
                ? `${volumetry.monthlyQuota[c] ?? 0}/mês (base mensal)`
                : `${volumetry.weekly[c] ?? 0}/semana · ${volumetry.monthlyQuota[c] ?? 0}/mês`
            }${
              (volumetry.approvedOverage?.[c] ?? 0) > 0
                ? ` · +${volumetry.approvedOverage?.[c]} extra`
                : ""
            }`}
            quota={(volumetry.monthlyQuota[c] ?? 0) + (volumetry.approvedOverage?.[c] ?? 0)}
            generated={volumetry.generatedThisMonth[c] ?? 0}
            breakdown={volumetry.formatQuota?.[c]}
          />
        );
      })}
    </PageKpiGrid>
  );
}
