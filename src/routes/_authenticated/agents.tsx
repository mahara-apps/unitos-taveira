import { useMemo, useState } from "react";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveContext } from "@/hooks/use-active-context";
import { listAgentPromptsFn, listAgentJobsFn, type AgentPromptRow } from "@/lib/agents.functions";
import { usePageHeader } from "@/hooks/use-page-header";
import { AgentCard } from "@/components/agents/agent-card";
import { AgentDrawer } from "@/components/agents/agent-drawer";
import { JobsTable } from "@/components/agents/jobs-table";
import {
  CATEGORY_ORDER,
  getAgentMeta,
  getCategoryStyle,
  type AgentCategory,
} from "@/components/agents/agent-meta";

export const Route = createFileRoute("/_authenticated/agents")({
  beforeLoad: () => ensureFeatureEnabled("agents"),
  component: AgentsPage,
});

function AgentsPage() {
  const { brandId, clientId } = useActiveContext();
  const listPrompts = useServerFn(listAgentPromptsFn);
  const listJobs = useServerFn(listAgentJobsFn);

  const prompts = useQuery({
    queryKey: ["agent-prompts", brandId],
    queryFn: () => listPrompts({ data: { brandId: brandId ?? null } }),
  });

  const jobs = useQuery({
    enabled: !!brandId,
    queryKey: ["agent-jobs", brandId, clientId],
    queryFn: () => listJobs({ data: { brandId: brandId!, clientId: clientId ?? null, limit: 20 } }),
    refetchInterval: 15000,
  });

  const [selected, setSelected] = useState<AgentPromptRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<AgentCategory | "all">("all");

  const openAgent = (a: AgentPromptRow) => {
    setSelected(a);
    setDrawerOpen(true);
  };

  const countsByCategory = useMemo(() => {
    const map = new Map<AgentCategory, number>();
    for (const a of prompts.data ?? []) {
      const c = getAgentMeta(a.agent_id, a.agent_name).category;
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return map;
  }, [prompts.data]);

  const filteredAgents = useMemo(() => {
    const all = prompts.data ?? [];
    if (tab === "all") return all;
    return all.filter((a) => getAgentMeta(a.agent_id, a.agent_name).category === tab);
  }, [prompts.data, tab]);

  usePageHeader(
    {
      title: "Cérebro de Agentes",
      subtitle: "Especialistas de IA orquestrados a partir do briefing da marca.",
    },
    [],
  );

  if (!brandId) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Selecione um workspace para visualizar os agentes de IA.
      </div>
    );
  }

  const total = prompts.data?.length ?? 0;

  return (
    <div className="flex h-full flex-col gap-8 p-6">
      <section>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as AgentCategory | "all")}
          className="mb-5"
        >
          <TabsList className="flex-wrap gap-1">
            <TabsTrigger value="all">
              Todos
              <span className="ml-1.5 text-[10px] text-muted-foreground">{total}</span>
            </TabsTrigger>
            {CATEGORY_ORDER.map((cat) => {
              const style = getCategoryStyle(cat);
              const n = countsByCategory.get(cat) ?? 0;
              const Icon = style.icon;
              return (
                <TabsTrigger key={cat} value={cat}>
                  <Icon className="h-3.5 w-3.5" />
                  {style.categoryLabel}
                  <span className="ml-1 text-[10px] text-muted-foreground">{n}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>

        {prompts.isLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-lg border bg-muted/30" />
            ))}
          </div>
        ) : filteredAgents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum agente nesta categoria.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredAgents.map((a) => (
              <AgentCard key={a.agent_id} agent={a} onOpen={openAgent} />
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4" /> Execuções recentes
        </h2>
        {jobs.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (jobs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma execução ainda. Comece por{" "}
            <Link to="/content" className="underline">
              Produção
            </Link>{" "}
            ou acione a pauta do mês acima.
          </p>
        ) : (
          <JobsTable jobs={jobs.data ?? []} />
        )}
      </section>

      <AgentDrawer
        agent={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        brandId={brandId ?? null}
        clientId={clientId ?? null}
      />
    </div>
  );
}
