/**
 * Chip de prazo para listas densas de tarefas.
 *
 * Mostra a data de entrega (dd/mm) direto na linha e permite ajustá-la sem
 * abrir a tarefa. Vermelho quando atrasada; "prazo" quando ainda não há data.
 */
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatShortDate } from "./work-item-row";

/** `2026-09-09` -> Date local (evita o deslocamento de fuso do parse ISO). */
function toDate(iso?: string | null) {
  if (!iso) return undefined;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

function toIso(date: Date) {
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function DueDateChip({
  value,
  overdue = false,
  disabled = false,
  onChange,
}: {
  value?: string | null;
  overdue?: boolean;
  disabled?: boolean;
  onChange: (iso: string | null) => void;
}) {
  const label = formatShortDate(value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={label ? `Entrega em ${label}` : "Definir prazo"}
          aria-label={label ? `Prazo: ${label}` : "Definir prazo"}
          className={cn(
            "h-7 shrink-0 gap-1 px-2 text-[11px] font-medium tabular-nums",
            label
              ? overdue
                ? "text-destructive hover:text-destructive"
                : "text-muted-foreground"
              : "text-muted-foreground/60",
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {label ?? "prazo"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={toDate(value)}
          onSelect={(d) => onChange(d ? toIso(d) : null)}
          initialFocus
          className={cn("pointer-events-auto p-3")}
        />
        {value ? (
          <div className="border-t border-border/60 p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-xs"
              onClick={() => onChange(null)}
            >
              Remover prazo
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
