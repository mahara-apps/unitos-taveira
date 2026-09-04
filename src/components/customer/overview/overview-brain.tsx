import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Brain, Lightbulb } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { loadBrainWidget } from "@/lib/brain/api";
import { OverviewCard, OverviewEmpty, OverviewLink } from "./overview-shared";

const TOPIC = "comportamento do cliente, engajamento e histórico recente";

export function OverviewBrain({ brandId, clientId }: { brandId: string; clientId: string }) {
  const load = useServerFn(loadBrainWidget);
  const q = useQuery({
    queryKey: ["overview-brain", brandId, clientId],
    queryFn: () =>
      load({
        data: { topic: TOPIC, module: "customers", brandId, clientId, maxItems: 3 },
      }),
    staleTime: 120_000,
  });

  const items = q.data?.items ?? [];

  return (
    <OverviewCard
      title="Brain"
      subtitle={
        q.data?.hasData ? `${q.data.candidateCount} sinais identificados` : "Inteligência da conta"
      }
      icon={<Brain className="h-4 w-4" />}
      footer={<OverviewLink label="Ver insights" href="/brain" />}
    >
      {q.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : !q.data?.hasData ? (
        <OverviewEmpty
          icon={<Lightbulb className="h-4 w-4" />}
          title="Sem sinais suficientes"
          hint="O Brain ainda está aprendendo sobre esta conta."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-foreground/90">“{q.data.headline}”</p>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={`${it.kind}-${i}`} className="rounded-xl bg-muted/30 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-medium">{it.label}</span>
                  {typeof it.confidence === "number" ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {Math.round(it.confidence * 100)}% confiança
                    </span>
                  ) : null}
                </div>
                {it.detail ? (
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {it.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </OverviewCard>
  );
}
