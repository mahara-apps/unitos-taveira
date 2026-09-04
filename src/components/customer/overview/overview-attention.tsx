import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { formatDistanceToNow, isPast } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OverviewCard, OverviewEmpty } from "./overview-shared";

export type AttentionAlert = {
  severity: "critical" | "warning" | "info";
  title: string;
  description?: string;
  count?: number;
};

export type OverdueTask = { id: string; title: string; due_at: string | null };

const SEV_STYLE: Record<AttentionAlert["severity"], string> = {
  critical: "border-destructive/40 bg-destructive/5 text-destructive",
  warning: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  info: "border-border/50 bg-muted/30 text-muted-foreground",
};

export function OverviewAttention({
  alerts,
  overdue,
  onOpenTasks,
  className,
}: {
  className?: string;
  alerts: AttentionAlert[];
  overdue: OverdueTask[];
  onOpenTasks?: () => void;
}) {
  const ordered = [...alerts].sort(
    (a, b) =>
      ["critical", "warning", "info"].indexOf(a.severity) -
      ["critical", "warning", "info"].indexOf(b.severity),
  );
  const shown = ordered.slice(0, 3);
  const rest = ordered.length - shown.length;

  return (
    <OverviewCard
      className={cn(className)}
      title="Precisa da sua atenção"
      subtitle={
        ordered.length > 0
          ? `${ordered.length} ${ordered.length === 1 ? "ponto pendente" : "pontos pendentes"}`
          : "Nada pendente agora"
      }
      icon={<ShieldCheck className="h-4 w-4" />}
    >
      {ordered.length === 0 && overdue.length === 0 ? (
        <OverviewEmpty
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
          title="Operação em dia"
          hint="Nenhuma pendência crítica no momento."
        />
      ) : (
        <div className="space-y-2.5">
          {shown.map((a, i) => (
            <div
              key={`${a.severity}-${i}`}
              className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 ${SEV_STYLE[a.severity]}`}
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{a.title}</div>
                {a.description ? (
                  <div className="truncate text-[11px] opacity-80">{a.description}</div>
                ) : null}
              </div>
              {typeof a.count === "number" ? (
                <span className="shrink-0 text-sm font-semibold tabular-nums">{a.count}</span>
              ) : null}
            </div>
          ))}

          {overdue.length > 0 ? (
            <div className="rounded-xl bg-muted/30 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Tarefas atrasadas
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {overdue.slice(0, 3).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                    <span className="shrink-0 text-[11px] text-amber-400">
                      {t.due_at && isPast(new Date(t.due_at))
                        ? `venceu ${formatDistanceToNow(new Date(t.due_at), { addSuffix: true, locale: ptBR })}`
                        : "sem prazo"}
                    </span>
                  </li>
                ))}
              </ul>
              {onOpenTasks ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2.5 h-7 text-[12px]"
                  onClick={onOpenTasks}
                >
                  Ver tarefas
                </Button>
              ) : null}
            </div>
          ) : null}

          {rest > 0 ? (
            <div className="text-[11px] text-muted-foreground">+{rest} outro(s) alerta(s)</div>
          ) : null}
        </div>
      )}
    </OverviewCard>
  );
}
