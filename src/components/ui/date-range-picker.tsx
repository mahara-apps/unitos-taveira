"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import {
  addDaysInTz as shiftDays,
  addMonthsInTz,
  addYearsInTz,
  endOfMonthInTz,
  endOfYearInTz,
  startOfMonthInTz,
  startOfYearInTz,
} from "@/lib/timezone";

import { cn } from "@/lib/utils";
import { endOfDay, inclusiveDayCount, lastNDays, startOfDay } from "@/lib/date-range";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// ---------------------------------------------------------------------------
// Presets — 100% PT-BR. Cada preset produz um DateRange FECHADO e INCLUSIVO,
// sempre normalizado por `src/lib/date-range.ts` (fonte de verdade única):
// `from` às 00:00:00.000 e `to` às 23:59:59.999. É o mesmo intervalo usado
// pelas queries e pela contagem de dias exibida na tela.
// ---------------------------------------------------------------------------

export type DateRangePreset = {
  key: string;
  label: string;
  build: (today: Date) => DateRange;
};

/** Todo preset passa por aqui: nenhum intervalo escapa da normalização. */
const closed = (from: Date, to: Date): DateRange => ({
  from: startOfDay(from),
  to: endOfDay(to),
});

export const DEFAULT_PRESETS: DateRangePreset[] = [
  { key: "today", label: "Hoje", build: (t) => closed(t, t) },
  {
    key: "yesterday",
    label: "Ontem",
    build: (t) => closed(shiftDays(t, -1), shiftDays(t, -1)),
  },
  { key: "7d", label: "Últimos 7 dias", build: (t) => lastNDays(7, t) },
  { key: "30d", label: "Últimos 30 dias", build: (t) => lastNDays(30, t) },
  { key: "90d", label: "Últimos 90 dias", build: (t) => lastNDays(90, t) },
  {
    key: "mtd",
    label: "Este mês",
    build: (t) => closed(startOfMonthInTz(t), t),
  },
  {
    key: "last-month",
    label: "Mês passado",
    build: (t) => closed(startOfMonthInTz(addMonthsInTz(t, -1)), endOfMonthInTz(addMonthsInTz(t, -1))),
  },
  {
    key: "ytd",
    label: "Este ano",
    build: (t) => closed(startOfYearInTz(t), t),
  },
  {
    key: "last-year",
    label: "Ano passado",
    build: (t) => closed(startOfYearInTz(addYearsInTz(t, -1)), endOfYearInTz(addYearsInTz(t, -1))),
  },
];

// ---------------------------------------------------------------------------
// Helpers de conversão para APIs que aceitam period="Nd" ou days=N
// ---------------------------------------------------------------------------

export function dateRangeToDays(range: DateRange | undefined): number {
  if (!range?.from || !range?.to) return 30;
  // Contagem inclusiva em dias de calendário — mesma função usada no servidor.
  return Math.min(365, inclusiveDayCount(range.from, range.to));
}

export function dateRangeToPeriod(range: DateRange | undefined): string {
  return `${dateRangeToDays(range)}d`;
}

export function daysToDateRange(days: number, today: Date = new Date()): DateRange {
  return lastNDays(Math.min(365, Math.max(1, Math.round(days))), today);
}

function matchPreset(
  range: DateRange | undefined,
  presets: DateRangePreset[],
  today: Date,
): DateRangePreset | null {
  if (!range?.from || !range?.to) return null;
  for (const p of presets) {
    const built = p.build(today);
    if (
      built.from &&
      built.to &&
      isSameDay(built.from, range.from) &&
      isSameDay(built.to, range.to)
    ) {
      return p;
    }
  }
  return null;
}

function formatRange(range: DateRange | undefined): string {
  if (!range?.from) return "Selecionar período";
  if (!range.to || isSameDay(range.from, range.to)) {
    return format(range.from, "d 'de' MMM, yyyy", { locale: ptBR });
  }
  const sameYear = range.from.getFullYear() === range.to.getFullYear();
  const from = format(range.from, sameYear ? "d MMM" : "d MMM yyyy", { locale: ptBR });
  const to = format(range.to, "d MMM yyyy", { locale: ptBR });
  return `${from} — ${to}`;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  presets?: DateRangePreset[];
  align?: "start" | "center" | "end";
  className?: string;
  triggerClassName?: string;
  size?: "sm" | "default";
  maxDate?: Date;
  disabled?: boolean;
  numberOfMonths?: number;
  placeholder?: string;
}

export function DateRangePicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  align = "end",
  className,
  triggerClassName,
  size = "sm",
  maxDate,
  disabled,
  numberOfMonths = 2,
  placeholder = "Selecionar período",
}: DateRangePickerProps) {
  const today = React.useMemo(() => new Date(), []);
  const [open, setOpen] = React.useState(false);
  const [month, setMonth] = React.useState<Date>(value?.to ?? value?.from ?? today);

  const activePreset = matchPreset(value, presets, today);
  const label = value?.from ? formatRange(value) : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          disabled={disabled}
          className={cn(
            "gap-2 font-normal",
            !value?.from && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">{activePreset ? activePreset.label : label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("flex w-auto flex-col p-0 sm:flex-row", className)}
      >
        <div className="flex max-h-[380px] flex-col gap-0.5 border-b border-border p-2 sm:max-h-none sm:w-40 sm:border-b-0 sm:border-r">
          <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Períodos
          </p>
          <div className="flex flex-row flex-wrap gap-1 sm:flex-col">
            {presets.map((p) => {
              const active = activePreset?.key === p.key;
              return (
                <Button
                  key={p.key}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-8 justify-start px-2 text-xs font-normal",
                    active && "font-medium",
                  )}
                  onClick={() => {
                    const built = p.build(today);
                    onChange(built);
                    if (built.to) setMonth(built.to);
                  }}
                >
                  {p.label}
                </Button>
              );
            })}
          </div>
        </div>
        <div className="pointer-events-auto p-2">
          <Calendar
            mode="range"
            selected={value}
            onSelect={(next) => onChange(next)}
            month={month}
            onMonthChange={setMonth}
            numberOfMonths={numberOfMonths}
            locale={ptBR}
            disabled={maxDate ? { after: maxDate } : undefined}
            weekStartsOn={0}
          />
          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                onChange(undefined);
              }}
            >
              Limpar
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
              disabled={!value?.from || !value?.to}
            >
              Aplicar
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
