import { describe, expect, it } from "vitest";
import {
  aggregateTimesheet,
  buildHeatmap,
  entryCostCents,
  formatHours,
  monthlyClosing,
  timesheetEntriesCsv,
  timesheetGroupsCsv,
  timesheetTotals,
  type TimesheetEntry,
} from "@/lib/timesheet-report";

function entry(over: Partial<TimesheetEntry> = {}): TimesheetEntry {
  return {
    entry_id: crypto.randomUUID(),
    started_at: "2026-09-03T13:00:00.000Z",
    ended_at: "2026-09-03T15:00:00.000Z",
    seconds: 3600,
    is_rework: false,
    source: "timer",
    description: null,
    user_id: "u1",
    user_name: "Ana Souza",
    user_email: "ana@ex.com",
    avatar_url: null,
    hourly_cost_cents: 10000,
    task_id: "t1",
    task_title: "Roteiro",
    task_estimated_minutes: 120,
    project_id: "p1",
    project_name: "Setembro",
    client_id: "c1",
    client_name: "Taveira",
    ...over,
  } as TimesheetEntry;
}

describe("timesheet: custo e duração", () => {
  it("calcula custo proporcional às horas", () => {
    expect(entryCostCents({ seconds: 3600, hourly_cost_cents: 10000 })).toBe(10000);
    expect(entryCostCents({ seconds: 1800, hourly_cost_cents: 10000 })).toBe(5000);
    expect(entryCostCents({ seconds: 3600, hourly_cost_cents: null })).toBe(0);
  });

  it("formata horas em h/min", () => {
    expect(formatHours(3600)).toContain("1");
    expect(formatHours(0)).toBeTruthy();
  });
});

describe("timesheet: totais e agrupamentos", () => {
  const entries = [
    entry({ seconds: 3600 }),
    entry({ seconds: 1800, is_rework: true, source: "manual" }),
    entry({
      seconds: 7200,
      user_id: "u2",
      user_name: "Bruno Lima",
      task_id: "t2",
      task_estimated_minutes: null,
      client_id: "c2",
      client_name: "Outro",
      project_id: "p2",
      started_at: "2026-09-04T13:00:00.000Z",
    }),
  ];

  it("soma horas, custo, pessoas e retrabalho sem contar estimativa duplicada", () => {
    const t = timesheetTotals(entries);
    expect(t.seconds).toBe(12600);
    expect(t.people).toBe(2);
    expect(t.clients).toBe(2);
    expect(t.tasks).toBe(2);
    expect(t.reworkSeconds).toBe(1800);
    expect(t.estimatedMinutes).toBe(120); // t1 conta uma única vez
    expect(t.tasksWithoutEstimate).toBe(1);
    expect(t.activeDays).toBe(2);
  });

  it("agrupa por pessoa e por cliente ordenando por horas", () => {
    const byUser = aggregateTimesheet(entries, "user");
    expect(byUser[0]?.key).toBe("u2");
    expect(byUser.find((g) => g.key === "u1")?.seconds).toBe(5400);
    const byClient = aggregateTimesheet(entries, "client");
    expect(byClient.map((g) => g.key)).toContain("c1");
  });

  it("monta heatmap por pessoa e dia", () => {
    const h = buildHeatmap(entries, "day");
    expect(h.rows.length).toBe(2);
    expect(h.buckets.length).toBe(2);
    expect(h.max).toBeGreaterThan(0);
  });

  it("fecha o mês por cliente", () => {
    const rows = monthlyClosing(entries);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.month === "2026-09")).toBe(true);
  });

  it("exporta CSV com separador ponto e vírgula", () => {
    expect(timesheetEntriesCsv(entries, true).split("\n")[0]).toContain(";");
    expect(timesheetGroupsCsv(aggregateTimesheet(entries, "user"), "user", true)).toContain(";");
  });
});
