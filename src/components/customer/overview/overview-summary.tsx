// Card de saúde da conta. Os números gerais vivem no PageKpiGrid do topo —
// aqui só a leitura de saúde e como ela é composta.
import { Activity } from "lucide-react";
import { HealthBar } from "@/components/dashboard/health-bar";
import { OverviewCard } from "./overview-shared";

const PARTS: Array<{ key: keyof Breakdown; label: string; max: number }> = [
  { key: "onTime", label: "Prazos cumpridos", max: 40 },
  { key: "approvals", label: "Aprovações", max: 30 },
  { key: "briefing", label: "Briefing", max: 15 },
  { key: "schedule", label: "Agenda", max: 15 },
];

type Breakdown = { onTime: number; approvals: number; briefing: number; schedule: number };

export function OverviewSummary({ health, breakdown }: { health: number; breakdown: Breakdown }) {
  const tone =
    health >= 75 ? "text-health-good" : health >= 50 ? "text-severity-warning" : "text-destructive";
  const reading =
    health >= 75
      ? "A conta está saudável."
      : health >= 50
        ? "A conta precisa de atenção em alguns pontos."
        : "A conta está em risco — priorize as pendências.";

  return (
    <OverviewCard title="Saúde da conta" subtitle={reading} icon={<Activity className="h-4 w-4" />}>
      <div className="flex h-full flex-col justify-between gap-6">
        <div>
          <div className={`text-5xl font-semibold leading-none tabular-nums ${tone}`}>
            {health}%
          </div>
          <HealthBar score={health} className="mt-4" />
        </div>
        <ul className="space-y-2.5">
          {PARTS.map((p) => {
            const value = breakdown[p.key];
            const pct = Math.max(0, Math.min(100, (value / p.max) * 100));
            return (
              <li key={p.key} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
                  {p.label}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {value}/{p.max}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </OverviewCard>
  );
}
