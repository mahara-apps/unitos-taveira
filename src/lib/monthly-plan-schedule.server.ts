/**
 * Converte a sugestão de agenda da IA (dia da semana + hora) em datas concretas
 * do mês da pauta, de forma DETERMINÍSTICA e no fuso oficial (America/Sao_Paulo).
 *
 * Regras:
 *  - o slot cai sempre dentro do mês de referência da pauta;
 *  - quando o mês de referência é o mês corrente, dias já passados são pulados;
 *  - dois itens nunca ficam no mesmo dia+hora: o conflito desloca 30 min e,
 *    esgotadas as tentativas, vai para a próxima ocorrência do mesmo dia da semana;
 *  - sem sugestão utilizável, o item é distribuído de forma estável pelos dias úteis.
 */
import {
  zonedParts,
  zonedTimeToUtc,
  startOfMonthInTz,
  endOfMonthInTz,
} from "@/lib/timezone";

export type SlotSuggestion = {
  /** Chave estável do item (posição/índice na pauta). */
  key: string;
  /** 0 = domingo … 6 = sábado. */
  weekday: number | null;
  /** "HH:MM" no fuso de Brasília. */
  time: string | null;
};

export type ResolvedSlot = { key: string; at: Date };

/** Hora padrão quando a IA não devolve nada utilizável. */
const DEFAULT_TIME = { hour: 19, minute: 0 };
/** Dias úteis preferidos na distribuição de fallback (ter, qua, qui, seg, sex). */
const FALLBACK_WEEKDAYS = [2, 3, 4, 1, 5];

export function parseSuggestedTime(raw: unknown): { hour: number; minute: number } | null {
  const s = (raw ?? "").toString().trim();
  const m = /^(\d{1,2})\s*[:hH]?\s*(\d{2})?$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute: Math.round(minute / 5) * 5 % 60 };
}

export function parseSuggestedWeekday(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 6) return raw;
  const s = (raw ?? "").toString().trim().toLowerCase();
  if (!s) return null;
  const table: Array<[number, string[]]> = [
    [0, ["0", "domingo", "dom", "sunday", "sun"]],
    [1, ["1", "segunda", "segunda-feira", "seg", "monday", "mon"]],
    [2, ["2", "terca", "terça", "terca-feira", "terça-feira", "ter", "tuesday", "tue"]],
    [3, ["3", "quarta", "quarta-feira", "qua", "wednesday", "wed"]],
    [4, ["4", "quinta", "quinta-feira", "qui", "thursday", "thu"]],
    [5, ["5", "sexta", "sexta-feira", "sex", "friday", "fri"]],
    [6, ["6", "sabado", "sábado", "sab", "sáb", "saturday", "sat"]],
  ];
  for (const [n, names] of table) if (names.includes(s)) return n;
  return null;
}

/** Todos os dias do mês de referência que caem em `weekday`, já filtrando o passado. */
function occurrences(monthAnchor: Date, weekday: number, minDay: number): number[] {
  const first = zonedParts(startOfMonthInTz(monthAnchor));
  const last = zonedParts(endOfMonthInTz(monthAnchor));
  const out: number[] = [];
  for (let day = 1; day <= last.day; day++) {
    if (day < minDay) continue;
    const dow = new Date(Date.UTC(first.year, first.month - 1, day)).getUTCDay();
    if (dow === weekday) out.push(day);
  }
  return out;
}

export function resolveMonthlySchedule(args: {
  /** Qualquer instante dentro do mês de referência da pauta. */
  monthAnchor: Date;
  items: SlotSuggestion[];
  /** "Agora" — usado para não propor datas no passado. */
  now?: Date;
}): ResolvedSlot[] {
  const now = args.now ?? new Date();
  const anchorP = zonedParts(args.monthAnchor);
  const nowP = zonedParts(now);
  const sameMonth = anchorP.year === nowP.year && anchorP.month === nowP.month;
  // No mês corrente a proposta começa amanhã (dá folga de produção).
  const minDay = sameMonth ? Math.min(nowP.day + 1, zonedParts(endOfMonthInTz(args.monthAnchor)).day) : 1;
  const lastDay = zonedParts(endOfMonthInTz(args.monthAnchor)).day;

  const taken = new Set<string>();
  const usedByWeekday = new Map<number, number>();
  const out: ResolvedSlot[] = [];

  const place = (day: number, hour: number, minute: number): { day: number; hour: number; minute: number } => {
    let d = day;
    let h = hour;
    let mi = minute;
    for (let attempt = 0; attempt < 96; attempt++) {
      const key = `${d}-${h}-${mi}`;
      if (!taken.has(key)) {
        taken.add(key);
        return { day: d, hour: h, minute: mi };
      }
      mi += 30;
      if (mi >= 60) {
        mi -= 60;
        h += 1;
      }
      if (h > 21) {
        h = 9;
        mi = 0;
        d = d + 7 <= lastDay ? d + 7 : Math.max(minDay, ((d % lastDay) + 1));
      }
    }
    return { day: d, hour: h, minute: mi };
  };

  args.items.forEach((item, index) => {
    const time = parseSuggestedTime(item.time) ?? DEFAULT_TIME;
    const weekday =
      item.weekday ?? FALLBACK_WEEKDAYS[index % FALLBACK_WEEKDAYS.length] ?? 2;

    let days = occurrences(args.monthAnchor, weekday, minDay);
    if (days.length === 0) days = occurrences(args.monthAnchor, weekday, 1);
    if (days.length === 0) days = [Math.max(minDay, 1)];

    const used = usedByWeekday.get(weekday) ?? 0;
    usedByWeekday.set(weekday, used + 1);
    const day = days[used % days.length]!;

    const slot = place(day, time.hour, time.minute);
    out.push({
      key: item.key,
      at: zonedTimeToUtc(anchorP.year, anchorP.month, slot.day, slot.hour, slot.minute, 0, 0),
    });
  });

  return out;
}
