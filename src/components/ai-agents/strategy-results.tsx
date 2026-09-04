import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StrategyTab, TargetTab, MarketTab } from "@/components/ai-agents/strategy-panel";
import {
  StrategySkeleton,
  TargetSkeleton,
  MarketSkeleton,
} from "@/components/ai-agents/tab-skeletons";
import {
  ActiveRunMeta,
  StrategyHistory,
  useStrategyRuns,
} from "@/components/ai-agents/strategy-history";

export function StrategyResults({
  brandId,
  clientId,
  onGenerate,
  onRestored,
}: {
  brandId: string;
  clientId: string;
  onGenerate?: () => void;
  onRestored?: () => void;
}) {
  const runsQ = useStrategyRuns(brandId, clientId);
  const activeRun = (runsQ.data ?? []).find((r) => r.isActive);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {activeRun ? (
            <ActiveRunMeta run={activeRun} />
          ) : (
            <div className="rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
              Nenhuma estratégia gerada ainda para este cliente.
            </div>
          )}
        </div>
        {onGenerate ? (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onGenerate}>
            <Sparkles className="h-3.5 w-3.5" /> Gerar inteligência
          </Button>
        ) : null}
      </div>

      <Tabs defaultValue="atual" className="space-y-4">
        <TabsList variant="bordered">
          <TabsTrigger value="atual">Versão atual</TabsTrigger>
          <TabsTrigger value="historico">
            Histórico
            {runsQ.data ? ` (${runsQ.data.filter((r) => !r.isActive).length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="atual">
          <div className="space-y-10">
            <section id="estrategia" className="scroll-mt-24 space-y-4">
              <h3 className="text-lg font-semibold tracking-tight">Estratégia IA</h3>
              <Suspense fallback={<StrategySkeleton />}>
                <StrategyTab brandId={brandId} clientId={clientId} />
              </Suspense>
            </section>
            <section id="personas" className="scroll-mt-24 space-y-4">
              <h3 className="text-lg font-semibold tracking-tight">Personas & Público IA</h3>
              <Suspense fallback={<TargetSkeleton />}>
                <TargetTab brandId={brandId} clientId={clientId} />
              </Suspense>
            </section>
            <section id="mercado" className="scroll-mt-24 space-y-4">
              <h3 className="text-lg font-semibold tracking-tight">Análise de Mercado</h3>
              <Suspense fallback={<MarketSkeleton />}>
                <MarketTab brandId={brandId} clientId={clientId} />
              </Suspense>
            </section>
          </div>
        </TabsContent>

        <TabsContent value="historico">
          <StrategyHistory brandId={brandId} clientId={clientId} onRestored={onRestored} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
