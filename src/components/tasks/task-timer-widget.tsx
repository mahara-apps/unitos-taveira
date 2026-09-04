import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Pause, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getTimerStateFn,
  startTimerFn,
  stopTimerFn,
  formatSeconds,
  formatMinutes,
  type TimerState,
} from "@/lib/timesheet.functions";

function useNowTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

type Props = {
  brandId: string;
  taskId: string;
  estimatedMinutes?: number | null;
  compact?: boolean;
};

/**
 * Timer Play · Pause · Stop de uma tarefa.
 * Estado 100% no servidor: um segmento aberto = rodando; último segmento
 * encerrado com motivo "pause" = pausado; caso contrário = parado.
 * Total = segundos salvos + segundos corridos do segmento aberto.
 */
export function TaskTimerWidget({ brandId, taskId, estimatedMinutes, compact }: Props) {
  const qc = useQueryClient();
  const stateFn = useServerFn(getTimerStateFn);
  const startFn = useServerFn(startTimerFn);
  const stopFn = useServerFn(stopTimerFn);

  const stateQ = useQuery({
    queryKey: ["timer-state", brandId, taskId, "session-v3"],
    queryFn: () => stateFn({ data: { brandId, taskId } }),
    enabled: !!brandId && !!taskId,
    refetchOnMount: "always",
    refetchInterval: 60_000,
  });

  const state = (stateQ.data ?? null) as TimerState | null;
  const active = state?.active ?? null;
  const runningHere = !!active && active.task_id === taskId;
  const now = useNowTick(runningHere);
  const elapsedSec = useMemo(() => {
    if (!runningHere || !active) return 0;
    const baselineSeconds = Math.max(0, active.elapsed_seconds ?? 0);
    const receivedAt = stateQ.dataUpdatedAt || now;
    return baselineSeconds + Math.max(0, Math.floor((now - receivedAt) / 1000));
  }, [active, now, runningHere, stateQ.dataUpdatedAt]);

  const totalSeconds = (state?.totalSeconds ?? 0) + (runningHere ? elapsedSec : 0);
  // Enquanto roda, o relógio principal representa somente a sessão atual.
  // O acumulado continua visível separadamente, evitando a impressão de que
  // uma retomada começou já com um minuto lançado.
  const displayedSeconds = runningHere ? elapsedSec : (state?.totalSeconds ?? 0);
  const status: "running" | "paused" | "idle" = runningHere
    ? "running"
    : state?.paused
      ? "paused"
      : "idle";

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["timer-state", brandId] });
    qc.invalidateQueries({ queryKey: ["time-entries", brandId, taskId] });
    qc.invalidateQueries({ queryKey: ["job-tasks"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  }

  function setLocalState(patch: Partial<TimerState>) {
    qc.setQueryData<TimerState>(["timer-state", brandId, taskId, "session-v3"], (prev) => ({
      totalSeconds: prev?.totalSeconds ?? 0,
      active: prev?.active ?? null,
      paused: prev?.paused ?? false,
      ...patch,
    }));
  }

  const startMut = useMutation({
    mutationFn: () => startFn({ data: { brandId, taskId } }),
    onMutate: () => {
      setLocalState({
        active: {
          id: `local-${taskId}-${Date.now()}`,
          task_id: taskId,
          brand_id: brandId,
          started_at: new Date().toISOString(),
          elapsed_seconds: 0,
        },
        paused: false,
      });
    },
    onSuccess: (started) => {
      setLocalState({ active: started, paused: false });
      invalidateAll();
    },
    onError: (e: Error) => {
      setLocalState({ active: null });
      void stateQ.refetch();
      toast.error(e.message);
    },
  });

  const pauseMut = useMutation({
    mutationFn: () => {
      if (!active) throw new Error("Nenhum timer ativo para pausar.");
      return stopFn({ data: { entryId: active.id, reason: "pause" } });
    },
    onMutate: () => {
      setLocalState({
        active: null,
        paused: true,
        totalSeconds: (state?.totalSeconds ?? 0) + elapsedSec,
      });
    },
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => {
      void stateQ.refetch();
      toast.error(e.message);
    },
  });

  const stopMut = useMutation({
    mutationFn: async () => {
      if (runningHere && active) await stopFn({ data: { entryId: active.id, reason: "stop" } });
      return true;
    },
    onMutate: () => {
      setLocalState({
        active: runningHere ? null : (state?.active ?? null),
        paused: false,
        totalSeconds: (state?.totalSeconds ?? 0) + (runningHere ? elapsedSec : 0),
      });
    },
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => {
      void stateQ.refetch();
      toast.error(e.message);
    },
  });

  const busy = startMut.isPending || pauseMut.isPending || stopMut.isPending;

  return (
    <div
      className={
        compact
          ? "flex items-center gap-2"
          : "flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 p-3"
      }
    >
      <div className="min-w-0">
        <div className="font-mono text-lg tabular-nums leading-none">
          {formatSeconds(displayedSeconds)}
          {estimatedMinutes ? (
            <span className="ml-1 text-xs text-muted-foreground">
              / {formatMinutes(estimatedMinutes)}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          {status === "running" ? "Em execução" : status === "paused" ? "Pausado" : "Parado"}
        </div>
        {runningHere && state?.totalSeconds ? (
          <div className="mt-1 text-[10px] text-muted-foreground">
            Total acumulado: {formatSeconds(totalSeconds)}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        {status === "running" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => pauseMut.mutate()}
            disabled={busy}
            aria-label="Pausar"
          >
            <Pause className="mr-1.5 h-4 w-4" /> Pausar
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => startMut.mutate()}
            disabled={busy}
            aria-label={status === "paused" ? "Retomar" : "Iniciar"}
            title={active && !runningHere ? "Isto vai parar seu timer em outra tarefa" : undefined}
          >
            <Play className="mr-1.5 h-4 w-4" />
            {status === "paused" ? "Retomar" : active ? "Trocar" : "Iniciar"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => stopMut.mutate()}
          disabled={busy || status === "idle"}
          aria-label="Parar"
        >
          <Square className="mr-1.5 h-4 w-4" /> Parar
        </Button>
      </div>
    </div>
  );
}
