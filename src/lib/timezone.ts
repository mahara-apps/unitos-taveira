/**
 * FUSO OFICIAL DO SISTEMA: Brasília (America/Sao_Paulo, GMT-3).
 *
 * Regra: instantes continuam sendo armazenados em UTC (`timestamptz`), mas toda
 * FRONTEIRA DE CALENDÁRIO (início/fim de dia, mês corrente, agendamento,
 * relatórios) é calculada no fuso de Brasília — nunca no fuso do host, que em
 * servidores serverless é UTC e faz o "dia" virar 3 horas antes.
 */

export const APP_TIMEZONE = "America/Sao_Paulo";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Componentes de data/hora do instante no fuso de Brasília. */
export function zonedParts(d: Date = new Date()): ZonedParts {
  const map: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(d)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return {
    year: Number(map["year"]),
    month: Number(map["month"]),
    day: Number(map["day"]),
    hour: Number(map["hour"] === "24" ? "0" : map["hour"]),
    minute: Number(map["minute"]),
    second: Number(map["second"]),
  };
}

/** Offset do fuso de Brasília, em ms, para o instante informado. */
function zoneOffsetMs(d: Date): number {
  const p = zonedParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, d.getMilliseconds());
  return asUtc - d.getTime();
}

/**
 * Instante UTC correspondente a uma data/hora de parede em Brasília.
 * Resolve o offset iterativamente (cobre eventual mudança de offset).
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let guess = new Date(naive - zoneOffsetMs(new Date(naive)));
  guess = new Date(naive - zoneOffsetMs(guess));
  return guess;
}

/** 00:00:00.000 do dia de Brasília que contém o instante. */
export function startOfDayInTz(d: Date = new Date()): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, 0, 0);
}

/** 23:59:59.999 do dia de Brasília que contém o instante. */
export function endOfDayInTz(d: Date = new Date()): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year, p.month, p.day, 23, 59, 59, 999);
}

/** Soma dias de calendário em Brasília (imune a mudança de offset). */
export function addDaysInTz(d: Date, days: number): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year, p.month, p.day + days, p.hour, p.minute, p.second);
}

/** Primeiro dia do mês corrente em Brasília, no formato `YYYY-MM-DD`. */
export function currentMonthStartISO(d: Date = new Date()): string {
  const p = zonedParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-01`;
}

/** Data de calendário de Brasília em `YYYY-MM-DD`. */
export function isoDateInTz(d: Date = new Date()): string {
  const p = zonedParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Início do mês (00:00 Brasília) do instante informado. */
export function startOfMonthInTz(d: Date = new Date()): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year, p.month, 1, 0, 0, 0, 0);
}

/** Fim do mês (23:59:59.999 Brasília) do instante informado. */
export function endOfMonthInTz(d: Date = new Date()): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year, p.month + 1, 0, 23, 59, 59, 999);
}

/** Início do ano (00:00 Brasília). */
export function startOfYearInTz(d: Date = new Date()): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year, 1, 1, 0, 0, 0, 0);
}

/** Fim do ano (23:59:59.999 Brasília). */
export function endOfYearInTz(d: Date = new Date()): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year, 12, 31, 23, 59, 59, 999);
}

/** Soma meses mantendo o dia 1 (usado nos presets de mês). */
export function addMonthsInTz(d: Date, months: number): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year, p.month + months, Math.min(p.day, 28), 12, 0, 0, 0);
}

/** Soma anos preservando a data de parede em Brasília. */
export function addYearsInTz(d: Date, years: number): Date {
  const p = zonedParts(d);
  return zonedTimeToUtc(p.year + years, p.month, Math.min(p.day, 28), 12, 0, 0, 0);
}

/* --------------------------------------------------- FORMATAÇÃO PARA A TELA */

const dateTimeBrFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: APP_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateBrFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: APP_TIMEZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** `03/09/2026 16:42` no fuso de Brasília. Nunca usa o fuso do host. */
export function formatDateTimeBr(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateTimeBrFormatter.format(d).replace(",", "");
}

/** `03/09/2026` no fuso de Brasília. */
export function formatDateBr(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return dateBrFormatter.format(d);
}
