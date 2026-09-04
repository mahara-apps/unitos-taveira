import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ImageIcon, Loader2, Search, Video as VideoIcon } from "lucide-react";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listBrandMediaFn, type BrandMediaAsset } from "@/lib/brand-media.functions";

type KindFilter = "all" | "image" | "video";

/**
 * Biblioteca completa de mídia do cliente. Sempre escopada em
 * (brandId, clientId) — nunca mostra mídia de outro cliente.
 */
export function MediaLibraryDialog({
  open,
  onOpenChange,
  brandId,
  clientId,
  selectedIds,
  multiple = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  clientId: string;
  selectedIds: string[];
  multiple?: boolean;
  onConfirm: (assets: BrandMediaAsset[]) => void;
}) {
  const listMedia = useServerFn(listBrandMediaFn);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [picked, setPicked] = useState<string[]>(selectedIds);

  useEffect(() => {
    if (open) {
      setPicked(selectedIds);
      setQ("");
      setKind("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const mediaQ = useQuery({
    enabled: open,
    queryKey: ["media-library", brandId, clientId],
    queryFn: () => listMedia({ data: { brandId, clientId, limit: 200 } }),
  });

  const items = useMemo(() => {
    const all = mediaQ.data ?? [];
    const term = q.trim().toLowerCase();
    return all.filter((m) => {
      if (kind !== "all" && m.kind !== kind) return false;
      if (term && !m.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [mediaQ.data, q, kind]);

  function toggle(id: string) {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return multiple ? [...prev, id] : [id];
    });
  }

  function confirm() {
    const all = mediaQ.data ?? [];
    // Preserva a ordem de seleção do usuário.
    const assets = picked
      .map((id) => all.find((m) => m.id === id))
      .filter((m): m is BrandMediaAsset => !!m);
    onConfirm(assets);
    onOpenChange(false);
  }

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      nested
      size="lg"
      title="Biblioteca do cliente"
      description="Selecione a mídia que fará parte desta publicação"
      bodyClassName="flex flex-col gap-3 overflow-hidden p-0"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" disabled={picked.length === 0} onClick={confirm}>
            Usar {picked.length || ""} {picked.length === 1 ? "mídia" : "mídias"}
          </Button>
        </>
      }
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-5 py-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome do arquivo…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/40 p-0.5">
          {(
            [
              ["all", "Tudo"],
              ["image", "Imagens"],
              ["video", "Vídeos"],
            ] as Array<[KindFilter, string]>
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                kind === k
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {mediaQ.isLoading ? (
          <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando biblioteca…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-10 text-center text-xs text-muted-foreground">
            <ImageIcon className="mx-auto mb-2 h-5 w-5" />
            Nenhuma mídia encontrada para este cliente.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((m) => {
              const selected = picked.includes(m.id);
              const order = picked.indexOf(m.id) + 1;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.id)}
                  className={cn(
                    "group overflow-hidden rounded-lg border-2 bg-card text-left transition-all",
                    selected ? "border-primary" : "border-border/60 hover:border-border",
                  )}
                >
                  <div className="relative aspect-square bg-muted">
                    {m.kind === "video" && m.publicUrl ? (
                      <video
                        src={m.publicUrl}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : m.publicUrl ? (
                      <img src={m.publicUrl} alt={m.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-[10px] text-muted-foreground">
                        {m.kind}
                      </div>
                    )}
                    {m.kind === "video" ? (
                      <span className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded bg-black/60 text-white">
                        <VideoIcon className="h-3 w-3" />
                      </span>
                    ) : null}
                    {selected ? (
                      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                        {multiple ? order : <Check className="h-3 w-3" />}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-0.5 px-2 py-1.5">
                    <div className="truncate text-[11px] font-medium">{m.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {m.kind}
                      {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
                      {m.sizeBytes ? ` · ${formatBytes(m.sizeBytes)}` : ""}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </ExpandedModal>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
