/**
 * Gaveta "Rascunhos" — lista completa com seleção múltipla.
 *
 * Serve como ponto de partida do fluxo em lote: seleciona várias peças e abre
 * "Aplicar em massa", ou abre uma peça já posicionada na fila do wizard (setas).
 */
import { useMemo, useState } from "react";
import { ImageOff, Layers, Loader2, PencilLine } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { relativeLabel } from "@/lib/publication-status-tokens";
import { SOCIAL_NETWORKS, classifySocialNetwork } from "@/lib/calendar-tokens";
import type { PendingSchedulePost } from "@/lib/scheduling-wizard.functions";

type MediaFilter = "all" | "with" | "without";

export function DraftsDrawer({
  open,
  onOpenChange,
  drafts,
  loading,
  selected,
  onToggle,
  onSelectMany,
  onOpenDraft,
  onBulk,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drafts: PendingSchedulePost[];
  loading?: boolean;
  selected: string[];
  onToggle: (postId: string) => void;
  onSelectMany: (postIds: string[]) => void;
  onOpenDraft: (d: PendingSchedulePost, index: number) => void;
  onBulk: () => void;
}) {
  const [media, setMedia] = useState<MediaFilter>("all");
  const [channel, setChannel] = useState<string | null>(null);

  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    drafts.forEach((d) => d.channels.forEach((c) => set.add(classifySocialNetwork(c))));
    return Array.from(set);
  }, [drafts]);

  const visible = useMemo(() => {
    let list = drafts;
    if (media === "with") list = list.filter((d) => !!d.coverUrl);
    if (media === "without") list = list.filter((d) => !d.coverUrl);
    if (channel)
      list = list.filter((d) => d.channels.some((c) => classifySocialNetwork(c) === channel));
    return list;
  }, [drafts, media, channel]);

  const allVisibleSelected =
    visible.length > 0 && visible.every((d) => selected.includes(d.postId));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border/60 px-4 py-3">
          <SheetTitle className="text-sm">Rascunhos ({drafts.length})</SheetTitle>
          <SheetDescription className="text-xs">
            Selecione várias peças para aplicar conta, formato e agenda de uma vez.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-4 py-2">
          {(
            [
              { key: "all", label: "Todos" },
              { key: "with", label: "Com mídia" },
              { key: "without", label: "Sem mídia" },
            ] as Array<{ key: MediaFilter; label: string }>
          ).map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setMedia(f.key)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                media === f.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/70 text-muted-foreground hover:bg-muted/60",
              )}
            >
              {f.label}
            </button>
          ))}
          {channelOptions.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setChannel(channel === k ? null : k)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                channel === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/70 text-muted-foreground hover:bg-muted/60",
              )}
            >
              {SOCIAL_NETWORKS[classifySocialNetwork(k)].label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2">
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={() => {
                const ids = visible.map((d) => d.postId);
                onSelectMany(
                  allVisibleSelected
                    ? selected.filter((id) => !ids.includes(id))
                    : Array.from(new Set([...selected, ...ids])),
                );
              }}

            />
            Selecionar todos os visíveis ({visible.length})
          </label>
          <Button
            size="sm"
            className="h-7 gap-1.5 text-[11px]"
            disabled={selected.length === 0}
            onClick={onBulk}
          >
            <Layers className="h-3 w-3" /> Aplicar em massa ({selected.length})
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando rascunhos…
            </div>
          ) : visible.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted-foreground">
              Nenhum rascunho com esses filtros.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {visible.map((d) => {
                const index = drafts.findIndex((x) => x.postId === d.postId);
                return (
                  <li key={d.postId} className="flex items-center gap-2 px-4 py-2">
                    <Checkbox
                      checked={selected.includes(d.postId)}
                      onCheckedChange={() => onToggle(d.postId)}
                      aria-label={`Selecionar ${d.title}`}
                    />
                    {d.coverUrl ? (
                      <img
                        src={d.coverUrl}
                        alt=""
                        loading="lazy"
                        className="h-9 w-9 shrink-0 rounded border border-border/60 object-cover"
                      />
                    ) : (
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-border/70 text-muted-foreground/60">
                        <ImageOff className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium">{d.title}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {relativeLabel(d.approvedAt) || "—"}
                        {d.channels.length ? ` · ${d.channels.join(", ")}` : " · sem canal"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-[10px]"
                      onClick={() => onOpenDraft(d, index < 0 ? 0 : index)}
                    >
                      <PencilLine className="h-3 w-3" /> Editar
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
