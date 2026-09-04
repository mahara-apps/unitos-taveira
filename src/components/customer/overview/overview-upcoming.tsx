import { CalendarClock, CalendarDays, Plus } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { OverviewCard, OverviewEmpty, OverviewLink } from "./overview-shared";

export type UpcomingKind = "task" | "post" | "appointment" | "seasonal";

export type UpcomingItem = {
  id: string;
  title: string;
  when: string;
  kind: UpcomingKind;
  allDay?: boolean;
};

const KIND_META: Record<UpcomingKind, { label: string; dot: string }> = {
  task: { label: "Tarefa", dot: "bg-amber-400" },
  post: { label: "Publicação", dot: "bg-sky-400" },
  appointment: { label: "Compromisso", dot: "bg-violet-400" },
  seasonal: { label: "Data sazonal", dot: "bg-emerald-400" },
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return "Hoje";
  if (isTomorrow(d)) return "Amanhã";
  return format(d, "EEEE, dd/MM", { locale: ptBR });
}

export function OverviewUpcoming({
  items,
  onNewAppointment,
}: {
  items: UpcomingItem[];
  onNewAppointment?: () => void;
}) {
  const shown = items.slice(0, 6);
  return (
    <OverviewCard
      title="Próximas atividades"
      subtitle={items.length === 0 ? "Nada agendado" : `${items.length} nos próximos dias`}
      icon={<CalendarClock className="h-4 w-4" />}
      action={
        onNewAppointment ? (
          <button
            type="button"
            onClick={onNewAppointment}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Compromisso
          </button>
        ) : undefined
      }
      footer={<OverviewLink label="Ver agenda" href="/calendar" />}
    >
      {shown.length === 0 ? (
        <OverviewEmpty
          icon={<CalendarDays className="h-4 w-4" />}
          title="Nenhuma atividade próxima"
          hint="Tarefas com prazo, publicações agendadas, compromissos e datas sazonais aparecem aqui."
        />
      ) : (
        <ul className="divide-y divide-border/40">
          {shown.map((it) => {
            const meta = KIND_META[it.kind];
            return (
              <li key={`${it.kind}-${it.id}`} className="flex items-start gap-3 py-2 first:pt-0">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{it.title}</div>
                  <div className="text-[11px] capitalize text-muted-foreground">
                    {dayLabel(it.when)}
                    {it.allDay
                      ? " · dia inteiro"
                      : ` · ${format(new Date(it.when), "HH:mm")}`} · {meta.label}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </OverviewCard>
  );
}
