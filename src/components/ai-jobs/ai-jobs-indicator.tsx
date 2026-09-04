import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Loader2, Sparkles, CheckCircle2, XCircle, X, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiJobs } from "./ai-jobs-provider";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export function AiJobsIndicator() {
  const { jobs, active, finished, dismiss, clearFinished } = useAiJobs();
  const hasActive = active.length > 0;
  const hasAny = jobs.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative h-9 w-9", hasActive && "text-primary")}
          aria-label="Gerações em andamento"
        >
          {hasActive ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className={cn("h-4 w-4", !hasAny && "text-muted-foreground")} />
          )}
          {hasActive && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {active.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Gerações de IA</div>
            <div className="text-[11px] text-muted-foreground">
              {hasActive ? `${active.length} em andamento` : "Nenhuma tarefa ativa"}
            </div>
          </div>
          {finished.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => void clearFinished()}
            >
              <Trash2 className="mr-1 h-3 w-3" /> Limpar
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {!hasAny && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Suas gerações em segundo plano aparecerão aqui.
            </div>
          )}
          {jobs.map((j) => {
            const isActive = j.status === "queued" || j.status === "running";
            return (
              <div key={j.id} className="group border-b border-border/60 px-4 py-3 last:border-b-0">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5">
                    {j.status === "succeeded" && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                    {j.status === "failed" && <XCircle className="h-4 w-4 text-red-500" />}
                    {isActive && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{j.title}</div>
                    {j.subtitle && (
                      <div className="truncate text-[11px] text-muted-foreground">{j.subtitle}</div>
                    )}
                    {isActive && (
                      <div className="mt-2 space-y-1">
                        <Progress value={j.progress} className="h-1" />
                        <div className="text-[10px] text-muted-foreground">
                          {j.step_label ?? "Processando..."}
                        </div>
                      </div>
                    )}
                    {j.status === "failed" && j.error && (
                      <div className="mt-1 line-clamp-2 text-[11px] text-red-500">{j.error}</div>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {(() => {
                        const created = new Date(j.created_at);
                        const diffMs = Date.now() - created.getTime();
                        // Clamp relógios dessincronizados (sandbox/preview) para evitar "em cerca de X horas"
                        const safe = diffMs < 0 ? new Date() : created;
                        return formatDistanceToNow(safe, { addSuffix: true, locale: ptBR });
                      })()}
                    </div>
                  </div>
                  {!isActive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 transition group-hover:opacity-100"
                      onClick={() => void dismiss(j.id)}
                      aria-label="Remover"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
