import type { PublicationItem } from "@/lib/calendar-board.functions";
import type { CalendarEvent } from "@/lib/calendar-events.functions";

export type DayEntry =
  | { kind: "post"; data: PublicationItem }
  | { kind: "event"; data: CalendarEvent };

export type DayMap = Map<string, DayEntry[]>;

/** Chave local (ano-mês-dia) usada para agrupar itens por dia. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const isSameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);
