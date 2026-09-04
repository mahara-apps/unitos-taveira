import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  STAGE_COLORS,
  reorderStagesFn,
  updateStageFn,
  deleteStageFn,
  createStageFn,
  type PipelineStage,
  type StageColor,
} from "@/lib/content.functions";
import { STAGE_BG } from "./stage-colors";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { useAccessRole } from "@/hooks/use-access-role";
import { describeError } from "@/lib/errors";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pipelineId: string;
  stages: PipelineStage[];
  invalidateKey: readonly unknown[];
};

export function ColumnConfigDialog({
  open,
  onOpenChange,
  pipelineId,
  stages,
  invalidateKey,
}: Props) {
  const qc = useQueryClient();
  const { role } = useAccessRole();
  const canEdit = role === "admin";
  const reorder = useServerFn(reorderStagesFn);
  const update = useServerFn(updateStageFn);
  const remove = useServerFn(deleteStageFn);
  const create = useServerFn(createStageFn);

  const [items, setItems] = useState<PipelineStage[]>(stages);
  useEffect(() => setItems(stages), [stages, open]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const dirty = useMemo(() => {
    if (items.length !== stages.length) return true;
    return items.some((it, idx) => it.id !== stages[idx]?.id);
  }, [items, stages]);

  const save = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await reorder({ data: { pipelineId, order: items.map((s) => s.id) } });
      }
    },
    onSuccess: () => {
      toast.success("Colunas salvas");
      qc.invalidateQueries({ queryKey: invalidateKey });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(describeError(e)),
  });

  async function patchStage(stageId: string, patch: Partial<PipelineStage>) {
    await update({ data: { stageId, patch: patch as never } });
    qc.invalidateQueries({ queryKey: invalidateKey });
  }

  async function deleteStage(stageId: string, label: string) {
    if (!confirm(`Excluir "${label}"?`)) return;
    try {
      await remove({ data: { stageId } });
      setItems((prev) => prev.filter((s) => s.id !== stageId));
      qc.invalidateQueries({ queryKey: invalidateKey });
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  async function addColumn() {
    try {
      const st = await create({ data: { pipelineId, label: "Nova coluna", color: "muted" } });
      setItems((prev) => [...prev, st]);
      qc.invalidateQueries({ queryKey: invalidateKey });
    } catch (e) {
      toast.error(describeError(e));
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    setItems(arrayMove(items, oldIndex, newIndex));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto border-border/60 bg-background p-0">
        <DialogHeader className="border-b border-border/60 px-6 py-4">
          <DialogTitle className="text-base">Configurar colunas</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {items.map((stage) => (
                  <SortableRow
                    key={stage.id}
                    stage={stage}
                    canEdit={canEdit}
                    onPatch={(patch) => patchStage(stage.id, patch)}
                    onDelete={() => deleteStage(stage.id, stage.label)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          {canEdit ? (
            <div>
              <Button variant="outline" size="sm" className="h-9" onClick={addColumn}>
                + Adicionar coluna
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Somente owners, managers e admins da marca podem alterar colunas e SLA.
            </p>
          )}
        </div>

        <DialogFooter className="border-t border-border/60 px-6 py-4">
          <Button variant="ghost" className="h-9" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            className="h-9"
            onClick={() => save.mutate()}
            disabled={!canEdit || !dirty || save.isPending}
          >
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Salvar ordem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SLA_PRESETS: Array<{ label: string; hours: number }> = [
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
  { label: "72h", hours: 72 },
  { label: "5d", hours: 120 },
  { label: "7d", hours: 168 },
];

function formatSlaHours(h: number) {
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return r === 0 ? `${d}d` : `${d}d ${r}h`;
}

function SortableRow({
  stage,
  canEdit,
  onPatch,
  onDelete,
}: {
  stage: PipelineStage;
  canEdit: boolean;
  onPatch: (patch: Partial<PipelineStage>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });
  const [label, setLabel] = useState(stage.label);
  const initialHours =
    stage.sla_hours != null
      ? String(stage.sla_hours)
      : stage.sla_days != null
        ? String(stage.sla_days * 24)
        : "";
  const [sla, setSla] = useState<string>(initialHours);

  useEffect(() => setLabel(stage.label), [stage.label]);
  useEffect(() => {
    setSla(
      stage.sla_hours != null
        ? String(stage.sla_hours)
        : stage.sla_days != null
          ? String(stage.sla_days * 24)
          : "",
    );
  }, [stage.sla_hours, stage.sla_days]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <DashboardPanelSurface ref={setNodeRef} style={style} className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Reordenar"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className={`h-3 w-3 rounded-full shrink-0 ${STAGE_BG[stage.color]}`} />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={!canEdit}
          onBlur={() => {
            const v = label.trim();
            if (v && v !== stage.label) onPatch({ label: v });
          }}
          className="h-9 flex-1"
        />
        <div className="flex items-center gap-1">
          {STAGE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              disabled={!canEdit}
              onClick={() => onPatch({ color: c as StageColor })}
              aria-label={c}
              className={`h-5 w-5 rounded-full ${STAGE_BG[c]} ${
                stage.color === c
                  ? "ring-2 ring-foreground ring-offset-1 ring-offset-background"
                  : ""
              }`}
            />
          ))}
        </div>
        <Button
          size="icon"
          variant="ghost"
          disabled={!canEdit}
          onClick={onDelete}
          className="h-9 w-9 text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3 pl-6">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              SLA (horas)
            </Label>
            {sla.trim() !== "" && Number.isFinite(Number(sla)) && Number(sla) > 0 ? (
              <span className="text-[10px] text-muted-foreground">
                {formatSlaHours(Number(sla))}
              </span>
            ) : null}
          </div>
          <Input
            type="number"
            min={0}
            value={sla}
            disabled={!canEdit}
            onChange={(e) => setSla(e.target.value)}
            onBlur={() => {
              const raw = sla === "" ? null : Number(sla);
              const hours = raw === null || Number.isFinite(raw) ? (raw as number | null) : null;
              const days = hours == null ? null : Math.max(1, Math.round(hours / 24));
              onPatch({ sla_hours: hours, sla_days: days });
            }}
            placeholder="—"
            className="h-9"
          />
          {canEdit ? (
            <div className="flex flex-wrap gap-1">
              {SLA_PRESETS.map((p) => (
                <button
                  key={p.hours}
                  type="button"
                  onClick={() => {
                    setSla(String(p.hours));
                    onPatch({
                      sla_hours: p.hours,
                      sla_days: Math.max(1, Math.round(p.hours / 24)),
                    });
                  }}
                  className="rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSla("");
                  onPatch({ sla_hours: null, sla_days: null });
                }}
                className="rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
              >
                sem SLA
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/60 px-3 py-2">
          <Label className="text-xs">Sumir do portal</Label>
          <Switch
            disabled={!canEdit}
            checked={!!stage.hide_in_portal}
            onCheckedChange={(v) => onPatch({ hide_in_portal: v })}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/60 px-3 py-2">
          <Label className="text-xs">Link aprovação</Label>
          <Switch
            disabled={!canEdit}
            checked={!!stage.enables_approval_link}
            onCheckedChange={(v) => onPatch({ enables_approval_link: v })}
          />
        </div>
      </div>
    </DashboardPanelSurface>
  );
}
