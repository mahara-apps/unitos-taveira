import { describe, expect, it } from "vitest";
import {
  APP_TIMEZONE,
  currentMonthStartISO,
  endOfDayInTz,
  formatDateBr,
  formatDateOnlyBr,
  formatDateTimeBr,
  formatTimeBr,
  isoDateInTz,
  startOfDayInTz,
  zonedParts,
  zonedTimeToUtc,
} from "@/lib/timezone";
import { currentPeriodMonth } from "@/lib/plan-overage.server";

describe("fuso oficial do sistema — Brasília (GMT-3)", () => {
  it("usa America/Sao_Paulo", () => {
    expect(APP_TIMEZONE).toBe("America/Sao_Paulo");
  });

  it("00:00 de Brasília equivale a 03:00 UTC", () => {
    const d = zonedTimeToUtc(2026, 8, 28, 0, 0, 0, 0);
    expect(d.toISOString()).toBe("2026-08-28T03:00:00.000Z");
  });

  it("instante logo após a virada UTC ainda é o dia anterior em Brasília", () => {
    // 01/09 00:30 UTC = 31/08 21:30 em Brasília.
    const utc = new Date("2026-09-01T00:30:00.000Z");
    expect(isoDateInTz(utc)).toBe("2026-08-31");
    expect(currentMonthStartISO(utc)).toBe("2026-08-01");
    expect(currentPeriodMonth(utc)).toBe("2026-08-01");
  });

  it("início e fim de dia cobrem exatamente 24h do dia de Brasília", () => {
    const ref = new Date("2026-08-28T18:00:00.000Z");
    const from = startOfDayInTz(ref);
    const to = endOfDayInTz(ref);
    expect(from.toISOString()).toBe("2026-08-28T03:00:00.000Z");
    expect(to.toISOString()).toBe("2026-08-29T02:59:59.999Z");
    expect(zonedParts(from).day).toBe(28);
    expect(zonedParts(to).day).toBe(28);
  });

  it("formata datas e horários humanos no padrão completo PT-BR", () => {
    const utc = new Date("2026-09-01T00:30:45.000Z");
    expect(formatDateBr(utc)).toBe("31/08/2026");
    expect(formatTimeBr(utc)).toBe("21:30:45");
    expect(formatDateTimeBr(utc)).toBe("31/08/2026 21:30:45");
    expect(formatDateOnlyBr("2026-09-01")).toBe("01/09/2026");
  });

  it("trata valores ausentes ou inválidos sem quebrar a tela", () => {
    expect(formatDateBr(null)).toBe("—");
    expect(formatTimeBr("inválido")).toBe("—");
    expect(formatDateTimeBr(undefined)).toBe("—");
  });
});
