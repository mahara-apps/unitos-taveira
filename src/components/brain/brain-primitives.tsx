// Primitivas visuais do painel de inteligência do Brain.
// Nenhuma lógica de dados: apenas apresentação de valores reais recebidos.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LearningScope } from "@/lib/brain/overview.types";

export function confidenceTier(value: number): "low" | "moderate" | "high" {
  if (value >= 0.75) return "high";
  if (value >= 0.45) return "moderate";
  return "low";
}

const TIER_LABEL: Record<ReturnType<typeof confidenceTier>, string> = {
  low: "Baixa",
  moderate: "Moderada",
  high: "Alta",
};

const TIER_COLOR: Record<ReturnType<typeof confidenceTier>, string> = {
  low: "var(--chart-5)",
  moderate: "var(--chart-4)",
  high: "var(--chart-2)",
};

export function ConfidenceMeter({
  value,
  showLabel = true,
  className,
}: {
  value: number;
  showLabel?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const tier = confidenceTier(value);
  return (
    <div className={cn("min-w-[120px]", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">{pct}%</span>
        {showLabel && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            confiança {TIER_LABEL[tier].toLowerCase()}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${pct}%`, background: TIER_COLOR[tier] }}
        />
      </div>
    </div>
  );
}

const SCOPE_LABEL: Record<LearningScope, string> = {
  global: "Global",
  brand: "Marca",
  client: "Cliente",
};

export function ScopeBadge({ scope, suffix }: { scope: LearningScope; suffix?: string | null }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-border/70 text-[10px] font-medium uppercase tracking-wider",
        scope === "client" && "border-primary/40 text-primary",
      )}
    >
      {SCOPE_LABEL[scope]}
      {suffix ? ` · ${suffix}` : ""}
    </Badge>
  );
}

export function MetaChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

export function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function BrainEmpty({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}

export function formatDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (same(d, today)) return "Hoje";
  if (same(d, yesterday)) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeFromMinutes(minutes: number | null): string {
  if (minutes == null) return "sem registro";
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
