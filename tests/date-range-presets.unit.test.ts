import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESETS,
  dateRangeToDays,
  dateRangeToPeriod,
  daysToDateRange,
} from "@/components/ui/date-range-picker";
import { inclusiveDayCount, lastNDays, resolveInclusiveRange } from "@/lib/date-range";
import { normalizedRangeIso } from "@/lib/range-key";
import { zonedParts, zonedTimeToUtc } from "@/lib/timezone";

/** Data/hora de PAREDE em Brasília (fuso oficial), independente do host. */
const sp = (y: number, m: number, d: number, h = 12, min = 0, s2 = 0, ms = 0) =>
  zonedTimeToUtc(y, m, d, h, min, s2, ms);
/** Componentes lidos no fuso oficial, não no fuso do host. */
const part = (d: Date) => zonedParts(d);

const preset = (key: string) => {
  const p = DEFAULT_PRESETS.find((x) => x.key === key);
  if (!p) throw new Error(`preset ${key} inexistente`);
  return p;
};

// Dia com horário "quebrado" no meio da tarde: expõe erros de horário
// inicial/final e de contagem exclusiva.
const TODAY = sp(2026, 8, 28, 14, 37, 12, 456); // 28/08/2026 em Brasília

/** Dias efetivamente consultados = os que o servidor recebe no payload. */
function queriedDays(range: { from?: Date; to?: Date }) {
  const iso = normalizedRangeIso(range as never)!;
  return resolveInclusiveRange({ from: iso.from, to: iso.to }).days;
}

describe("filtros de período — preset gera exatamente o intervalo correspondente", () => {
  const cases: Array<{ key: string; days: number; label: string }> = [
    { key: "today", days: 1, label: "Hoje" },
    { key: "yesterday", days: 1, label: "Ontem" },
    { key: "7d", days: 7, label: "Últimos 7 dias" },
    { key: "30d", days: 30, label: "Últimos 30 dias" },
    { key: "90d", days: 90, label: "Últimos 90 dias" },
    { key: "mtd", days: 28, label: "Este mês" }, // 01→28 de agosto
    { key: "last-month", days: 31, label: "Mês passado" }, // julho
    { key: "ytd", days: 240, label: "Este ano" }, // 01/01 → 28/08/2026
    { key: "last-year", days: 365, label: "Ano passado" }, // 2025
  ];

  for (const c of cases) {
    it(`${c.label}: UI e query contam ${c.days} dia(s)`, () => {
      const p = preset(c.key);
      expect(p.label).toBe(c.label);
      const r = p.build(TODAY);
      // 1) quantidade de dias exibida na UI
      expect(dateRangeToDays(r)).toBe(Math.min(365, c.days));
      // 2) datas efetivamente consultadas produzem a MESMA contagem
      expect(queriedDays(r)).toBe(c.days);
    });

    it(`${c.label}: intervalo é fechado nos limites do dia`, () => {
      const r = preset(c.key).build(TODAY);
      const f = part(r.from!);
      const t = part(r.to!);
      expect([f.hour, f.minute, f.second]).toEqual([0, 0, 0]);
      expect([t.hour, t.minute, t.second]).toEqual([23, 59, 59]);
      expect(r.from!.getTime()).toBeLessThanOrEqual(r.to!.getTime());
    });
  }

  it("“Últimos 30 dias” termina hoje e começa 29 dias antes (30 dias inclusivos)", () => {
    const r = preset("30d").build(TODAY);
    expect(part(r.to!).day).toBe(28);
    expect(part(r.from!).day).toBe(30); // 30/07/2026
    expect(part(r.from!).month).toBe(7);
  });

  it("“Ontem” consulta apenas o dia anterior", () => {
    const r = preset("yesterday").build(TODAY);
    expect(part(r.from!).day).toBe(27);
    expect(part(r.to!).day).toBe(27);
    expect(dateRangeToDays(r)).toBe(1);
  });
});

describe("contagem inclusiva é imune a horário e fuso", () => {
  it("horas diferentes no mesmo par de dias não mudam a contagem", () => {
    const a = inclusiveDayCount(sp(2026, 8, 1, 0, 0), sp(2026, 8, 30, 23, 59));
    const b = inclusiveDayCount(sp(2026, 8, 1, 23, 59), sp(2026, 8, 30, 0, 1));
    expect(a).toBe(30);
    expect(b).toBe(30);
  });

  it("atravessar horário de verão não gera 29 nem 31 dias", () => {
    // Brasil/EUA: qualquer transição dentro do intervalo permanece 30 dias.
    expect(inclusiveDayCount(sp(2026, 2, 15), sp(2026, 3, 16))).toBe(30);
    expect(inclusiveDayCount(sp(2026, 10, 20), sp(2026, 11, 18))).toBe(30);
  });

  it("mesmo dia é 1 dia (nunca 0)", () => {
    expect(inclusiveDayCount(TODAY, TODAY)).toBe(1);
  });
});

describe("servidor usa a mesma fonte de verdade", () => {
  it("payload de 7 e 30 dias resolve 7 e 30 no servidor", () => {
    expect(queriedDays(lastNDays(7, TODAY))).toBe(7);
    expect(queriedDays(lastNDays(30, TODAY))).toBe(30);
    expect(queriedDays(lastNDays(90, TODAY))).toBe(90);
  });

  it("sem payload, o padrão do servidor é 30 dias inclusivos", () => {
    expect(resolveInclusiveRange(undefined, { defaultDays: 30 }).days).toBe(30);
    expect(resolveInclusiveRange(undefined, { defaultDays: 7 }).days).toBe(7);
  });

  it("intervalo invertido é corrigido em vez de gerar contagem negativa", () => {
    const r = resolveInclusiveRange({
      from: sp(2026, 8, 28).toISOString(),
      to: sp(2026, 8, 1).toISOString(),
    });
    expect(r.days).toBeGreaterThanOrEqual(1);
    expect(r.fromMs).toBeLessThanOrEqual(r.toMs);
  });

  it("maxDays limita apenas o rótulo de dias, sem alterar o intervalo", () => {
    const iso = normalizedRangeIso(lastNDays(120, TODAY) as never)!;
    const capped = resolveInclusiveRange(iso, { maxDays: 90 });
    const raw = resolveInclusiveRange(iso);
    expect(capped.days).toBe(90);
    expect(raw.days).toBe(120);
    expect(capped.fromIso).toBe(raw.fromIso);
  });
});

describe("helpers derivados permanecem coerentes", () => {
  it("daysToDateRange(N) devolve exatamente N dias", () => {
    for (const n of [1, 7, 14, 30, 90, 365]) {
      expect(dateRangeToDays(daysToDateRange(n, TODAY))).toBe(n);
      expect(queriedDays(daysToDateRange(n, TODAY))).toBe(n);
    }
  });

  it("dateRangeToPeriod usa a contagem inclusiva", () => {
    expect(dateRangeToPeriod(preset("30d").build(TODAY))).toBe("30d");
    expect(dateRangeToPeriod(preset("7d").build(TODAY))).toBe("7d");
  });

  it("intervalo indefinido cai no padrão de 30 dias", () => {
    expect(dateRangeToDays(undefined)).toBe(30);
    expect(normalizedRangeIso(undefined)).toBeUndefined();
  });
});
