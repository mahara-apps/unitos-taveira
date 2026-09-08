import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock3, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listContentTrashFn, restoreTrashItemsFn } from "@/lib/content.functions";
import { describeError } from "@/lib/errors";

export function ContentTrashDialog({
  open,
  onOpenChange,
  brandId,
  clientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
  clientId: string;
}) {
  const qc = useQueryClient();
  const listTrash = useServerFn(listContentTrashFn);
  const restore = useServerFn(restoreTrashItemsFn);
  const [selected, setSelected] = useState<string[]>([]);
  const queryKey = ["content-trash", brandId, clientId] as const;
  const query = useQuery({
    queryKey,
    queryFn: () => listTrash({ data: { brandId, clientId } }),
    enabled: open,
  });
  const items = query.data ?? [];
  const selectedItems = useMemo(
    () => items.filter((item) => selected.includes(`${item.kind}:${item.id}`)),
    [items, selected],
  );
  const restoreMutation = useMutation({
    mutationFn: () =>
      restore({
        data: {
          brandId,
          clientId,
          items: selectedItems.map(({ id, kind }) => ({ id, kind })),
        },
      }),
    onSuccess: async () => {
      toast.success("Itens restaurados para o pipeline.");
      setSelected([]);
      await Promise.all([
        qc.invalidateQueries({ queryKey }),
        qc.invalidateQueries({ queryKey: ["content-pipelines", brandId, clientId] }),
        qc.invalidateQueries({ queryKey: ["content-board", brandId, clientId] }),
      ]);
    },
    onError: (error) => toast.error(describeError(error)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" /> Lixeira de Conteúdo
          </DialogTitle>
          <DialogDescription>
            Conteúdos e pipelines podem ser restaurados por 30 dias. Depois disso, serão apagados
            automaticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[56vh] overflow-y-auto px-6 py-4">
          {query.isLoading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-muted-foreground">
              <Trash2 className="mb-3 h-8 w-8 opacity-40" />
              <p className="font-medium text-foreground">A Lixeira está vazia</p>
              <p className="text-sm">Itens excluídos aparecerão aqui.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const key = `${item.kind}:${item.id}`;
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selected.includes(key)}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked ? [...current, key] : current.filter((value) => value !== key),
                        )
                      }
                      aria-label={`Selecionar ${item.title}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{item.title}</span>
                        <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {item.kind === "pipeline" ? "Pipeline" : "Conteúdo"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Excluído por {item.deletedByName ?? "usuário"}
                        {item.kind === "pipeline" && item.postCount
                          ? ` · ${item.postCount} conteúdo(s)`
                          : ""}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" /> {item.daysRemaining} dias
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            onClick={() => restoreMutation.mutate()}
            disabled={selectedItems.length === 0 || restoreMutation.isPending}
          >
            {restoreMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Restaurar selecionados
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
