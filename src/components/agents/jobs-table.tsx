import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import type { AgentJobRow } from "@/lib/agents.functions";

function statusBadge(status: string) {
  if (status === "succeeded")
    return (
      <Badge tone="emerald" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Succeeded
      </Badge>
    );
  if (status === "failed")
    return (
      <Badge tone="red" className="gap-1">
        <XCircle className="h-3 w-3" /> Failed
      </Badge>
    );
  if (status === "running")
    return (
      <Badge tone="amber" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="animate-pulse">Running</span>
      </Badge>
    );
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" /> {status}
    </Badge>
  );
}

function formatDuration(a: string | null, b: string | null): string {
  if (!a) return "—";
  const start = new Date(a).getTime();
  const end = b ? new Date(b).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function JobsTable({ jobs }: { jobs: AgentJobRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[minmax(0,1fr)_120px_100px_130px_28px] items-center gap-3 border-b bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Pipeline / Agente</span>
        <span>Trigger</span>
        <span>Duração</span>
        <span>Status</span>
        <span />
      </div>
      <Accordion type="single" collapsible className="divide-y">
        {jobs.map((j) => (
          <AccordionItem key={j.id} value={j.id} className="border-none">
            <AccordionTrigger className="grid grid-cols-[minmax(0,1fr)_120px_100px_130px_28px] items-center gap-3 px-4 py-3 text-sm hover:no-underline hover:bg-muted/30 [&>svg]:ml-auto">
              <div className="min-w-0 text-left">
                <div className="truncate font-medium">{j.title ?? j.kind}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {j.step_label ?? j.kind}
                </div>
              </div>
              <span className="truncate font-mono text-xs text-muted-foreground">{j.kind}</span>
              <span className="tabular-nums text-xs text-muted-foreground">
                {formatDuration(j.started_at, j.finished_at)}
              </span>
              <span>{statusBadge(j.status)}</span>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  <span>console</span>
                  <span>{new Date(j.created_at).toLocaleString("pt-BR")}</span>
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed text-emerald-400">
                  {JSON.stringify(
                    {
                      job_id: j.id,
                      kind: j.kind,
                      status: j.status,
                      progress: j.progress,
                      step: j.step_label,
                      started_at: j.started_at,
                      finished_at: j.finished_at,
                      error: j.error,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
