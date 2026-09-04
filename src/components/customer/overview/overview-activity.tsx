import { useState } from "react";
import {
  Activity,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  Send,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { OverviewCard, OverviewEmpty } from "./overview-shared";

export type ActivityEvent = {
  id: string;
  entity_type: string;
  verb: string;
  payload: unknown;
  created_at: string;
};

const VERB: Record<string, string> = {
  created: "criado",
  updated: "atualizado",
  deleted: "excluído",
  approved: "aprovado",
  rejected: "rejeitado",
  scheduled: "agendado",
  published: "publicado",
  assigned: "atribuído",
  commented: "comentado",
  stage_changed: "movido de estágio",
  status_changed: "status alterado",
};
const ENTITY: Record<string, string> = {
  post: "Conteúdo",
  task: "Tarefa",
  project: "Projeto",
  customer: "Cliente",
  briefing: "Briefing",
  persona: "Persona",
};

function describe(ev: ActivityEvent) {
  const payload = (ev.payload ?? {}) as Record<string, unknown>;
  const title = (payload.title as string) ?? "";
  const base = `${ENTITY[ev.entity_type] ?? ev.entity_type} ${VERB[ev.verb] ?? ev.verb}`;
  let Icon = Activity;
  let tone = "text-muted-foreground";
  if (ev.verb === "approved") {
    Icon = BadgeCheck;
    tone = "text-emerald-400";
  } else if (ev.verb === "rejected") {
    Icon = AlertTriangle;
    tone = "text-destructive";
  } else if (ev.verb === "published") {
    Icon = Send;
    tone = "text-pink-400";
  } else if (ev.verb === "scheduled") {
    Icon = CalendarClock;
    tone = "text-sky-400";
  } else if (ev.verb === "status_changed") {
    const to = String(payload.to ?? "");
    Icon = to === "done" ? CheckCircle2 : Clock;
    tone = to === "done" ? "text-emerald-400" : "text-amber-400";
  } else if (ev.verb === "created") {
    Icon = Sparkles;
  }
  let when = "";
  try {
    const d = new Date(ev.created_at);
    when = formatDistanceToNow(d.getTime() > Date.now() ? new Date() : d, {
      addSuffix: true,
      locale: ptBR,
    });
  } catch {
    when = "";
  }
  return { title: base, subtitle: title, Icon, tone, when };
}

export function OverviewActivity({
  activity,
  className,
}: {
  activity: ActivityEvent[];
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? activity.slice(0, 20) : activity.slice(0, 5);

  return (
    <OverviewCard
      title="Atividade recente"
      subtitle={activity.length === 0 ? "Sem eventos" : `${activity.length} eventos registrados`}
      icon={<Activity className="h-4 w-4" />}
      footer={
        activity.length > 5 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            {expanded ? "Ver menos" : "Ver atividade completa"}
          </button>
        ) : undefined
      }
      className={cn(expanded && "min-h-[16rem]", className)}
    >
      {activity.length === 0 ? (
        <OverviewEmpty
          icon={<Activity className="h-4 w-4" />}
          title="Nenhum evento ainda"
          hint="As ações desta conta aparecem aqui."
        />
      ) : (
        <ul className={expanded ? "max-h-[22rem] space-y-3 overflow-y-auto pr-1" : "space-y-3"}>
          {shown.map((ev) => {
            const d = describe(ev);
            return (
              <li key={ev.id} className="flex items-start gap-3">
                <d.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${d.tone}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{d.title}</div>
                  {d.subtitle ? (
                    <div className="truncate text-[11px] text-muted-foreground">{d.subtitle}</div>
                  ) : null}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{d.when}</span>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}
