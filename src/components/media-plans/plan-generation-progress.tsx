import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";

/**
 * Painel de progresso da geração do plano de mídia.
 *
 * A geração é uma única chamada longa ao especialista de IA: não há progresso
 * real vindo do servidor. Para o usuário não achar que travou (e não recarregar
 * a página perdendo a entrevista), mostramos etapas em sequência, tempo
 * decorrido e um aviso explícito para manter a janela aberta.
 */

const STEPS = [
  "Lendo o briefing e o contexto do cliente",
  "Escolhendo os tipos de campanha no Meta e no Google",
  "Dividindo o orçamento entre as campanhas",
  "Escrevendo os roteiros de criativo",
  "Revisando e organizando o plano",
] as const;

/** Tempo médio por etapa; a última fica ativa até a resposta chegar. */
const STEP_MS = 22_000;

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlanGenerationProgress({
  error,
  onRetry,
  onBack,
}: {
  /** Mensagem já traduzida quando a geração falhou. */
  error?: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const running = !error;
  const [elapsed, setElapsed] = useState(0);
  useUnsavedGuard(running);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
        <AlertTriangle className="mb-4 h-10 w-10 text-amber-500" />
        <div className="mb-1 text-base font-medium">A geração não terminou</div>
        <div className="mb-6 max-w-md text-sm text-muted-foreground">{error}</div>
        <div className="flex items-center gap-2">
          <Button onClick={onRetry}>
            <RotateCcw className="mr-2 h-4 w-4" /> Tentar de novo
          </Button>
          <Button variant="outline" onClick={onBack}>
            Rever respostas
          </Button>
        </div>
        <div className="mt-4 text-xs text-muted-foreground">
          Suas respostas foram mantidas — nada precisa ser refeito.
        </div>
      </div>
    );
  }

  const activeIndex = Math.min(Math.floor((elapsed * 1000) / STEP_MS), STEPS.length - 1);

  return (
    <div className="px-2 py-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600/10 text-indigo-600">
          <Sparkles className="h-5 w-5 animate-pulse" />
        </span>
        <div>
          <div className="text-base font-medium">Montando o plano de mídia…</div>
          <div className="text-sm text-muted-foreground">
            Isso leva de 1 a 3 minutos. Mantenha esta janela aberta.
          </div>
        </div>
        <div className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
          {formatElapsed(elapsed)}
        </div>
      </div>

      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-[wizard-progress_1.6s_ease-in-out_infinite] rounded-full bg-indigo-600" />
      </div>

      <ol className="space-y-3">
        {STEPS.map((label, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <li
              key={label}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition",
                active && "border-indigo-500/40 bg-indigo-500/5 font-medium",
                done && "border-border/40 text-muted-foreground",
                !active && !done && "border-border/30 text-muted-foreground/60",
              )}
            >
              <span className="flex h-5 w-5 items-center justify-center">
                {done ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>
              {label}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Não feche nem atualize esta página: a entrevista respondida seria perdida.
      </div>
    </div>
  );
}
