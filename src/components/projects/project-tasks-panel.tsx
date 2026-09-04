import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckSquare, User2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { PanelEmptyState } from "@/components/ui/panel-empty";
import { listTasksFn, type TaskRow } from "@/lib/tasks.functions";

const STATUS_LABEL: Record<string, string> = {
  todo: "A fazer",
  in_progress: "Em andamento",
  review: "Revisão",
  done: "Concluída",
};

function fmt(d: string | null) {
  if (!d) return null;
  try {
    return format(new Date(d), "dd/MM", { locale: ptBR });
  } catch {
    return null;
  }
}

export function ProjectTasksPanel({
  brandId,
  projectId,
  clientId,
}: {
  brandId: string;
  projectId: string;
  clientId: string | null;
}) {
  const listTasks = useServerFn(listTasksFn);
  const tasksQ = useQuery({
    queryKey: ["tasks", brandId, clientId],
    queryFn: () => listTasks({ data: { brandId, clientId: clientId ?? null } }),
    enabled: !!brandId,
  });

  const tasks = useMemo(
    () => ((tasksQ.data ?? []) as TaskRow[]).filter((t) => t.project_id === projectId),
    [tasksQ.data, projectId],
  );
  const open = tasks.filter((t) => t.status !== "done").length;

  return (
    <DashboardPanelSurface>
      <div className="flex items-center justify-between border-b border-border/60 bg-background/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-widest text-foreground">
            Tarefas
          </h3>
          <span className="rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-xs tabular-nums text-foreground">
            {tasks.length}
          </span>
          {tasks.length > 0 ? (
            <span className="text-[11px] text-muted-foreground">{open} em aberto</span>
          ) : null}
        </div>
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-[11px]">
          <Link to="/tasks">Ver em Tarefas</Link>
        </Button>
      </div>

      {tasks.length === 0 ? (
        <PanelEmptyState
          icon={<CheckSquare className="h-4 w-4" />}
          text="As tarefas de produção são criadas automaticamente quando o cliente aprova a pauta."
        />
      ) : (
        <div className="divide-y divide-border/60">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.title}</div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User2 className="h-3 w-3" />
                    {t.assignee_name ?? "Sem responsável"}
                  </span>
                  {fmt(t.due_at) ? (
                    <>
                      <span>·</span>
                      <span>{fmt(t.due_at)}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {STATUS_LABEL[t.status] ?? t.status}
              </Badge>
              {t.post_id ? (
                <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-[11px]">
                  <Link to="/content" search={{ post: t.post_id }}>
                    Abrir peça
                  </Link>
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </DashboardPanelSurface>
  );
}
