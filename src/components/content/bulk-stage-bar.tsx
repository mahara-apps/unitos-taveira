import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, MoveRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bulkMoveStageFn, type PipelineStage } from "@/lib/content.functions";
import { describeError } from "@/lib/errors";

const MAX_BULK = 200;

/**
 * Barra de ações em massa do módulo Conteúdo.
 *
 * Só muda o estágio (`stage_id` + espelho legado no servidor). Nenhuma ação
 * aqui publica nada nem altera datas — agendamento continua exclusivo do
 * fluxo de calendário/aprovação.
 */
export function BulkStageBar({
  brandId,
  clientId,
  pipelineId,
  stages,
  selected,
  onClear,
  invalidateKey,
}: {
  brandId: string;
  clientId: string;
  pipelineId: string;
  stages: PipelineStage[];
  selected: string[];
  onClear: () => void;
  invalidateKey: readonly unknown[];
}) {
  const [stageId, setStageId] = useState<string>("");
  const qc = useQueryClient();
  const bulkMove = useServerFn(bulkMoveStageFn);

  const mutation = useMutation({
    mutationFn: () =>
      bulkMove({
        data: {
          brandId,
          clientId,
          pipelineId,
          postIds: selected.slice(0, MAX_BULK),
          toStageId: stageId,
        },
      }),
    onSuccess: (res) => {
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success(`${res.moved} conteúdo(s) movido(s) de estágio.`);
      } else {
        toast.warning(
          `${res.moved} movido(s), ${failed.length} não movido(s): ${failed
            .slice(0, 3)
            .map((f) => f.error ?? "erro")
            .join("; ")}`,
        );
      }
      qc.invalidateQueries({ queryKey: invalidateKey });
      onClear();
    },
    onError: (e) => toast.error(describeError(e)),
  });

  if (selected.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 p-2">
      <span className="text-xs font-semibold tabular-nums text-foreground">
        {selected.length} selecionado(s)
      </span>
      {selected.length > MAX_BULK ? (
        <span className="text-[11px] text-amber-600 dark:text-amber-400">
          Limite de {MAX_BULK} por vez — os primeiros {MAX_BULK} serão movidos.
        </span>
      ) : null}

      <Select value={stageId} onValueChange={setStageId}>
        <SelectTrigger className="h-8 w-[200px] text-xs">
          <SelectValue placeholder="Mover para o estágio…" />
        </SelectTrigger>
        <SelectContent>
          {stages.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        className="h-8 gap-1.5 px-2.5 text-xs"
        disabled={!stageId || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <MoveRight className="h-3.5 w-3.5" />
        )}
        Aplicar
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="ml-auto h-8 gap-1.5 px-2 text-xs text-muted-foreground"
        onClick={onClear}
      >
        <X className="h-3.5 w-3.5" /> Limpar seleção
      </Button>
    </div>
  );
}
