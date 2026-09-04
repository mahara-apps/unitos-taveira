// Drawer de detalhe de um aprendizado do Brain (somente leitura).
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { brainLearningDetailFn } from "@/lib/brain/api";
import {
  BrainEmpty,
  ConfidenceMeter,
  MetaChip,
  ScopeBadge,
  formatDateTime,
} from "@/components/brain/brain-primitives";

export function LearningDetailDrawer({
  memoryId,
  onClose,
}: {
  memoryId: string | null;
  onClose: () => void;
}) {
  const fetchDetail = useServerFn(brainLearningDetailFn);
  const q = useQuery({
    queryKey: ["brain-learning-detail", memoryId],
    enabled: !!memoryId,
    queryFn: () => fetchDetail({ data: { memoryId: memoryId! } }),
  });
  const d = q.data ?? null;

  return (
    <Sheet open={!!memoryId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-1 pb-2">
          <SheetTitle className="pr-6 text-base leading-snug">
            {d?.learning.title ?? "Aprendizado"}
          </SheetTitle>
          {d && (
            <div className="flex flex-wrap items-center gap-1.5">
              <ScopeBadge scope={d.learning.scope} suffix={d.learning.clientName} />
              {d.learning.category && <MetaChip>{d.learning.category}</MetaChip>}
              {d.learning.origin && <MetaChip>origem: {d.learning.origin}</MetaChip>}
              <MetaChip>v{d.learning.version}</MetaChip>
            </div>
          )}
        </SheetHeader>

        {q.isLoading ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : !d ? (
          <BrainEmpty title="Aprendizado não encontrado neste escopo." />
        ) : (
          <div className="space-y-5 py-2">
            <p className="text-sm leading-relaxed">{d.learning.conclusion}</p>

            <div className="rounded-xl border border-border/60 p-3">
              <ConfidenceMeter value={d.learning.confidence} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <MetaChip>{d.learning.sample || d.learning.reinforcement} evidências</MetaChip>
                <MetaChip>reforçado {d.learning.reinforcement}×</MetaChip>
                {d.learning.contradictions > 0 && (
                  <MetaChip>{d.learning.contradictions} contradições</MetaChip>
                )}
                {d.learning.windowDays && <MetaChip>janela {d.learning.windowDays} dias</MetaChip>}
                {d.learning.channel && <MetaChip>canal {d.learning.channel}</MetaChip>}
                {d.learning.format && <MetaChip>formato {d.learning.format}</MetaChip>}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Última observação: {formatDateTime(d.learning.lastObservedAt)} · atualizado{" "}
                {formatDateTime(d.learning.updatedAt)}
              </p>
            </div>

            {d.learning.evidence && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Evidências analisadas
                </h4>
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    ["Total", d.learning.evidence.total],
                    ["Aprovadas", d.learning.evidence.approved],
                    ["Ajustes", d.learning.evidence.rework],
                    ["Rejeições", d.learning.evidence.rejected],
                  ].map(([label, value]) => (
                    <div key={label as string} className="rounded-lg border border-border/50 p-2">
                      <div className="text-sm font-semibold tabular-nums">{value as number}</div>
                      <div className="text-[10px] text-muted-foreground">{label as string}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {d.confidenceHistory.length > 1 && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Evolução da confiança
                </h4>
                <ul className="space-y-1.5">
                  {d.confidenceHistory.map((h) => (
                    <li
                      key={`${h.version}-${h.at}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-1.5 text-xs"
                    >
                      <span className="text-muted-foreground">
                        v{h.version} · {formatDateTime(h.at)}
                        {h.changeReason ? ` · ${h.changeReason}` : ""}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {Math.round(h.confidence * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {d.sourceEvents.length > 0 && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Origem
                </h4>
                <ul className="space-y-1.5">
                  {d.sourceEvents.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-1.5 text-xs"
                    >
                      <span className="min-w-0 truncate">
                        {e.eventType}
                        {e.action ? ` · ${e.action}` : ""}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {e.sourceModule} · {formatDateTime(e.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {d.usedBy.length > 0 && (
              <>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  Este aprendizado é utilizado por{" "}
                  <span className="font-medium text-foreground">{d.usedBy.join(", ")}</span>.
                </p>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
