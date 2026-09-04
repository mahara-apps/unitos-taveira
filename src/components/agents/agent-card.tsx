import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Settings2 } from "lucide-react";
import type { AgentPromptRow } from "@/lib/agents.functions";
import { getAgentDescription, getAgentMeta, toTitleCase } from "./agent-meta";

type Props = {
  agent: AgentPromptRow;
  onOpen: (agent: AgentPromptRow) => void;
};

export function AgentCard({ agent, onOpen }: Props) {
  const meta = getAgentMeta(agent.agent_id, agent.agent_name);
  const Icon = meta.icon;
  const synopsis = getAgentDescription(agent.agent_id, agent.agent_name);
  const title = toTitleCase(agent.agent_name);

  return (
    <Card
      onClick={() => onOpen(agent)}
      className="group relative flex h-full cursor-pointer flex-col overflow-hidden p-5 transition-all hover:border-foreground/20 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${meta.iconClass}`}>
          <Icon className="h-5 w-5" />
        </div>
        <Badge
          variant="outline"
          className={`h-5 rounded-full px-2 text-[10px] font-medium ${meta.badgeClass}`}
        >
          {meta.categoryLabel}
        </Badge>
      </div>

      <div className="mt-4 flex-1">
        <h3 className="text-sm font-semibold leading-tight tracking-tight">{title}</h3>
        <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground">{synopsis}</p>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
        {agent.has_override ? (
          <Badge
            variant="outline"
            className="h-5 rounded-md px-1.5 text-[10px] font-normal border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300"
          >
            Prompt customizado
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="h-5 rounded-md px-1.5 font-mono text-[10px] font-normal"
          >
            Padrão Unitos
          </Badge>
        )}
        <Badge
          variant="secondary"
          className="hidden h-5 rounded-md px-1.5 font-mono text-[10px] font-normal"
        >
          {meta.model}
        </Badge>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(agent);
            }}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(agent);
            }}
          >
            <Play className="h-3.5 w-3.5" />
            Testar
          </Button>
        </div>
      </div>
    </Card>
  );
}
