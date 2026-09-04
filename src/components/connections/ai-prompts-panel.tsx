import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Bot, ExternalLink, Loader2, ScrollText } from "lucide-react";

import { listAgentPromptsFn } from "@/lib/agents.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * AiPromptsPanel — espaço do Centro de IA para Prompts/Overrides dos agentes.
 * Somente leitura: usa o catálogo já exposto por `listAgentPromptsFn` (RBAC/RLS
 * inalterados) e envia a edição para a tela de Agentes, onde ela já existe.
 */
export function AiPromptsPanel({ brandId }: { brandId: string | null }) {
  const listPrompts = useServerFn(listAgentPromptsFn);
  const q = useQuery({
    queryKey: ["agent-prompts", brandId],
    queryFn: () => listPrompts({ data: { brandId } }),
    enabled: !!brandId,
  });

  const rows = q.data ?? [];
  const overrides = rows.filter((r) => r.has_override).length;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <CardTitle className="text-base">Prompts & Overrides dos agentes</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {overrides > 0
              ? `${overrides} de ${rows.length} agentes usam prompt customizado desta marca.`
              : "Nenhum agente usa prompt customizado — todos seguem o padrão Unitos."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/agents">
            Editar em Agentes <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="pt-4">
        {!brandId ? (
          <p className="text-sm text-muted-foreground">
            Selecione uma agência para ver os prompts dos agentes.
          </p>
        ) : q.isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
            <ScrollText className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum agente disponível.</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((r) => (
              <li key={r.agent_id} className="flex items-center gap-3 px-3 py-2.5">
                <Bot className="h-4 w-4 shrink-0 text-violet-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.agent_name}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">
                    {r.agent_id}
                  </div>
                </div>
                <Badge variant={r.has_override ? "secondary" : "outline"} className="text-[10px]">
                  {r.has_override ? "Customizado" : "Padrão Unitos"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
