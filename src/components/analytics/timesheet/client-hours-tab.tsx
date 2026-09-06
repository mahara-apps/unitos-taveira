import { useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { TimesheetPanel } from "@/components/analytics/timesheet/timesheet-panel";
import { endOfMonthInTz, startOfMonthInTz } from "@/lib/timezone";

/**
 * Horas apontadas de UM cliente — mesmo relatório de Análises → Timesheet,
 * já filtrado, com período padrão do mês corrente (fechamento).
 */
export function ClientHoursTab({ brandId, clientId }: { brandId: string; clientId: string }) {
  const [range, setRange] = useState<DateRange | undefined>(() => ({
    from: startOfMonthInTz(new Date()),
    to: new Date(),
  }));

  const { start, end } = useMemo(() => {
    const to = range?.to ?? endOfMonthInTz(new Date());
    const from = range?.from ?? startOfMonthInTz(to);
    return { start: from.toISOString(), end: to.toISOString() };
  }, [range]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Horas da equipe neste cliente</h3>
          <p className="text-[11px] text-muted-foreground">
            Tempo apontado nas tarefas do cliente — use para o fechamento do mês.
          </p>
        </div>
        <DateRangePicker
          value={range}
          onChange={(r: DateRange | undefined) => r && setRange(r)}
          maxDate={new Date()}
        />
      </div>
      <TimesheetPanel
        brandId={brandId}
        start={start}
        end={end}
        clientIds={[clientId]}
        defaultGroupBy="user"
      />
    </div>
  );
}
