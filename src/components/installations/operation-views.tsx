import { Loader2 } from "lucide-react";

import {
  OPERATION_KIND_LABEL,
  OPERATION_STATUS_LABEL,
  STEP_STATE_LABEL,
  type OperationStep,
  type StepState,
} from "@/lib/installation/manager-contract";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const STEP_TONE: Record<StepState, string> = {
  pending: "text-muted-foreground",
  running: "text-severity-info",
  done: "text-health-good",
  error: "text-destructive",
};

/** Etapa em execução (ou a próxima pendente) para o rótulo de progresso. */
export function currentStepLabel(steps: OperationStep[]): string {
  const running = steps.find((step) => step.state === "running");
  if (running) {
    const pct = typeof running.percent === "number" ? ` (${running.percent}%)` : "";
    return `Executando: ${running.label}${pct}${running.detail ? ` — ${running.detail}` : ""}`;
  }
  const pending = steps.find((step) => step.state === "pending");
  return pending ? `Aguardando: ${pending.label}` : "Finalizando…";
}

/** Etapa que falhou, para exibir o motivo objetivo. */
export function failedStepLabel(steps: OperationStep[]): string {
  const failed = steps.find((step) => step.state === "error");
  if (!failed) return "etapa não identificada";
  return `${failed.label}${failed.detail ? ` — ${failed.detail}` : ""}`;
}

export function StepList({ steps }: { steps: OperationStep[] }) {
  return (
    <ol className="space-y-1">
      {steps.map((step, index) => (
        <li
          key={step.id}
          className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 px-3 py-2"
        >
          <span className="w-6 font-mono text-[11px] text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-xs font-medium">{step.label}</span>
          <span className={cn("ml-auto text-[11px]", STEP_TONE[step.state])}>
            {step.state === "running" && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
            {STEP_STATE_LABEL[step.state]}
            {typeof step.percent === "number" && step.state !== "pending" && (
              <span className="ml-1 font-mono tabular-nums">{step.percent}%</span>
            )}
          </span>
          {step.state === "running" && (
            <Progress
              value={typeof step.percent === "number" ? step.percent : 0}
              className="h-1 w-full"
            />
          )}
          {step.detail && (
            <span className="w-full truncate text-[11px] text-muted-foreground">{step.detail}</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Faixa fina de progresso — visível em qualquer aba enquanto algo executa. */
export function LiveOperationBar({
  kind,
  percent,
  done,
  total,
  steps,
  children,
}: {
  kind: keyof typeof OPERATION_KIND_LABEL;
  percent: number;
  done: number;
  total: number;
  steps: OperationStep[];
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <span className="truncate text-xs font-medium">
            {OPERATION_KIND_LABEL[kind]} em andamento
          </span>
          <Badge variant="outline" className="shrink-0 text-[10px] text-primary">
            {done}/{total} · {percent}%
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{children}</div>
      </div>
      <Progress value={percent} className="h-1.5" />
      <p className="truncate text-[11px] text-muted-foreground">{currentStepLabel(steps)}</p>
    </div>
  );
}

export function OperationStatusBadge({
  status,
}: {
  status: keyof typeof OPERATION_STATUS_LABEL;
}) {
  const tone =
    status === "success"
      ? "border-health-good/40 text-health-good"
      : status === "failed"
        ? "border-destructive/40 text-destructive"
        : "border-severity-info/40 text-severity-info";
  return (
    <Badge variant="outline" className={cn("text-[10px]", tone)}>
      {OPERATION_STATUS_LABEL[status]}
    </Badge>
  );
}
