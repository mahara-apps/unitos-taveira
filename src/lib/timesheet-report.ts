/**
 * Núcleo PURO do relatório de timesheet.
 *
 * Toda agregação (por pessoa, cliente, projeto, tarefa), mapa de calor,
 * fechamento mensal e exportação CSV vive aqui — sem React e sem Supabase,
 * para poder ser testada isoladamente e reutilizada por qualquer tela.
 *
 * Regras:
 * - duração sempre em segundos (registros antigos só têm minutos → normalizados
 *   na fonte, ver `timesheet_report_entries`);
 * - datas agrupadas no fuso oficial (America/Sao_Paulo), armazenamento em UTC;
 * - custo = horas × valor/hora do membro no workspace (0 quando não autorizado).
 */

import { APP_TIMEZONE, isoDateInTz } from "@/lib/timezone";

export type TimesheetEntry = {
  entry_id: string;
  started_at: string;
  ended_at: string | null;
  seconds: number;
  is_rework: boolean;
  source: "timer" | "manual" | string;
  description: string | null;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  avatar_url: string | null;
  hourly_cost_cents: number;
  task_id: string;
  task_title: string | null;
  task_estimated_minutes: number | null;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  client_name: string | null;
};

export type TimesheetGroupBy = "user" | "client" | "project" | "task";

export const TIMESHEET_GROUP_LABEL: Record<TimesheetGroupBy, string> = {
  user: "Pessoa",
  client: "Cliente",
  project: "Projeto",
  task: "Tarefa",
};

export type TimesheetGroup = {
  key: string;
  label: string;
  sublabel?: string | null;
  avatarUrl?: string | null;
  seconds: number;
  costCents: number;
  entries: number;
  reworkSeconds: number;
  estimatedMinutes: number;
  tasksWithEstimate: number;
  tasksWithoutEstimate: number;
  people: number;
};

export type TimesheetTotals = {
  seconds: number;
  costCents: number;
  entries: number;
  reworkSeconds: number;
  people: number;
  clients: number;
  projects: number;
  tasks: number;
  estimatedMinutes: number;
  tasksWithEstimate: number;
  tasksWithoutEstimate: number;
  activeDays: number;
};

export const SECONDS_PER_HOUR = 3600;

export function entryCostCents(e: Pick<TimesheetEntry, "seconds" | "hourly_cost_cents">): number {
  if (!e.hourly_cost_cents) return 0;
  return Math.round((e.seconds / SECONDS_PER_HOUR) * e.hourly_cost_cents);
}

export function hoursFromSeconds(seconds: number): number {
  return Math.round((seconds / SECONDS_PER_HOUR) * 100) / 100;
}

/** "12h 30min" — leitura humana, nunca decimal cru na UI. */
export function formatHours(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  const h = Math.floor(s / SECONDS_PER_HOUR);
  const m = Math.round((s % SECONDS_PER_HOUR) / 60);
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}min`;
}

export function formatCurrencyBRL(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dayKey(iso: string): string {
  return isoDateInTz(new Date(iso));
}

/** Chave de mês (YYYY-MM) no fuso oficial. */
export function monthKey(iso: string): string {
  return dayKey(iso).slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 15, 12));
  const label = d.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: APP_TIMEZONE,
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function groupIdentity(
  e: TimesheetEntry,
  by: TimesheetGroupBy,
): { key: string; label: string; sublabel?: string | null; avatarUrl?: string | null } {
  switch (by) {
    case "user":
      return {
        key: e.user_id,
        label: e.user_name?.trim() || e.user_email?.trim() || "Sem nome",
        sublabel: e.user_email ?? null,
        avatarUrl: e.avatar_url ?? null,
      };
    case "client":
      return {
        key: e.client_id ?? "__none__",
        label: e.client_name?.trim() || "Sem cliente",
      };
    case "project":
      return {
        key: e.project_id ?? "__none__",
        label: e.project_name?.trim() || "Sem projeto",
        sublabel: e.client_name ?? null,
      };
    case "task":
    default:
      return {
        key: e.task_id,
        label: e.task_title?.trim() || "Tarefa sem título",
        sublabel: [e.client_name, e.project_name].filter(Boolean).join(" · ") || null,
      };
  }
}

export function aggregateTimesheet(
  entries: TimesheetEntry[],
  by: TimesheetGroupBy,
): TimesheetGroup[] {
  const map = new Map<
    string,
    TimesheetGroup & { _tasks: Map<string, number | null>; _people: Set<string> }
  >();
  for (const e of entries) {
    const id = groupIdentity(e, by);
    let g = map.get(id.key);
    if (!g) {
      g = {
        key: id.key,
        label: id.label,
        sublabel: id.sublabel ?? null,
        avatarUrl: id.avatarUrl ?? null,
        seconds: 0,
        costCents: 0,
        entries: 0,
        reworkSeconds: 0,
        estimatedMinutes: 0,
        tasksWithEstimate: 0,
        tasksWithoutEstimate: 0,
        people: 0,
        _tasks: new Map(),
        _people: new Set(),
      };
      map.set(id.key, g);
    }
    g.seconds += e.seconds;
    g.costCents += entryCostCents(e);
    g.entries += 1;
    if (e.is_rework) g.reworkSeconds += e.seconds;
    g._people.add(e.user_id);
    if (!g._tasks.has(e.task_id)) g._tasks.set(e.task_id, e.task_estimated_minutes ?? null);
  }
  const out: TimesheetGroup[] = [];
  for (const g of map.values()) {
    for (const est of g._tasks.values()) {
      if (est != null && est > 0) {
        g.estimatedMinutes += est;
        g.tasksWithEstimate += 1;
      } else {
        g.tasksWithoutEstimate += 1;
      }
    }
    g.people = g._people.size;
    const { _tasks, _people, ...rest } = g as TimesheetGroup & {
      _tasks: unknown;
      _people: unknown;
    };
    void _tasks;
    void _people;
    out.push(rest);
  }
  return out.sort((a, b) => b.seconds - a.seconds);
}

export function timesheetTotals(entries: TimesheetEntry[]): TimesheetTotals {
  const people = new Set<string>();
  const clients = new Set<string>();
  const projects = new Set<string>();
  const tasks = new Map<string, number | null>();
  const days = new Set<string>();
  let seconds = 0;
  let costCents = 0;
  let reworkSeconds = 0;
  for (const e of entries) {
    seconds += e.seconds;
    costCents += entryCostCents(e);
    if (e.is_rework) reworkSeconds += e.seconds;
    people.add(e.user_id);
    if (e.client_id) clients.add(e.client_id);
    if (e.project_id) projects.add(e.project_id);
    if (!tasks.has(e.task_id)) tasks.set(e.task_id, e.task_estimated_minutes ?? null);
    days.add(dayKey(e.started_at));
  }
  let estimatedMinutes = 0;
  let tasksWithEstimate = 0;
  let tasksWithoutEstimate = 0;
  for (const est of tasks.values()) {
    if (est != null && est > 0) {
      estimatedMinutes += est;
      tasksWithEstimate += 1;
    } else tasksWithoutEstimate += 1;
  }
  return {
    seconds,
    costCents,
    entries: entries.length,
    reworkSeconds,
    people: people.size,
    clients: clients.size,
    projects: projects.size,
    tasks: tasks.size,
    estimatedMinutes,
    tasksWithEstimate,
    tasksWithoutEstimate,
    activeDays: days.size,
  };
}

export type HeatmapCell = { userId: string; bucket: string; seconds: number };
export type Heatmap = {
  buckets: string[];
  rows: Array<{ userId: string; label: string; avatarUrl: string | null; seconds: number }>;
  cells: Map<string, number>;
  max: number;
};

/** Chave de semana ISO-ish: primeiro dia (domingo) da semana no fuso oficial. */
export function weekKey(iso: string): string {
  const key = dayKey(iso);
  const [y, m, d] = key.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - utc.getUTCDay());
  return utc.toISOString().slice(0, 10);
}

export function buildHeatmap(
  entries: TimesheetEntry[],
  granularity: "day" | "week" = "day",
): Heatmap {
  const bucketOf = granularity === "week" ? weekKey : dayKey;
  const buckets = new Set<string>();
  const rows = new Map<string, { userId: string; label: string; avatarUrl: string | null; seconds: number }>();
  const cells = new Map<string, number>();
  let max = 0;
  for (const e of entries) {
    const b = bucketOf(e.started_at);
    buckets.add(b);
    const row = rows.get(e.user_id) ?? {
      userId: e.user_id,
      label: e.user_name?.trim() || e.user_email?.trim() || "Sem nome",
      avatarUrl: e.avatar_url ?? null,
      seconds: 0,
    };
    row.seconds += e.seconds;
    rows.set(e.user_id, row);
    const ck = `${e.user_id}|${b}`;
    const next = (cells.get(ck) ?? 0) + e.seconds;
    cells.set(ck, next);
    if (next > max) max = next;
  }
  return {
    buckets: Array.from(buckets).sort(),
    rows: Array.from(rows.values()).sort((a, b) => b.seconds - a.seconds),
    cells,
    max,
  };
}

export type MonthlyClosingRow = {
  month: string;
  monthLabel: string;
  clientId: string;
  clientName: string;
  seconds: number;
  costCents: number;
  people: number;
  entries: number;
  prevSeconds: number;
};

export function monthlyClosing(entries: TimesheetEntry[]): MonthlyClosingRow[] {
  const map = new Map<
    string,
    MonthlyClosingRow & { _people: Set<string> }
  >();
  for (const e of entries) {
    const mk = monthKey(e.started_at);
    const cid = e.client_id ?? "__none__";
    const key = `${mk}|${cid}`;
    let row = map.get(key);
    if (!row) {
      row = {
        month: mk,
        monthLabel: monthLabel(mk),
        clientId: cid,
        clientName: e.client_name?.trim() || "Sem cliente",
        seconds: 0,
        costCents: 0,
        people: 0,
        entries: 0,
        prevSeconds: 0,
        _people: new Set(),
      };
      map.set(key, row);
    }
    row.seconds += e.seconds;
    row.costCents += entryCostCents(e);
    row.entries += 1;
    row._people.add(e.user_id);
  }
  const rows = Array.from(map.values()).map((r) => {
    const { _people, ...rest } = r;
    return { ...rest, people: _people.size };
  });
  // comparativo com o mês anterior do MESMO cliente
  const byKey = new Map(rows.map((r) => [`${r.month}|${r.clientId}`, r]));
  for (const r of rows) {
    const [y, m] = r.month.split("-").map(Number);
    const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    r.prevSeconds = byKey.get(`${prevMonth}|${r.clientId}`)?.seconds ?? 0;
  }
  return rows.sort((a, b) =>
    a.month === b.month ? b.seconds - a.seconds : a.month < b.month ? 1 : -1,
  );
}

// ---------------- CSV ----------------

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(rows: Array<Array<unknown>>): string {
  // ';' + BOM para abrir corretamente no Excel pt-BR
  return "\uFEFF" + rows.map((r) => r.map(csvCell).join(";")).join("\n");
}

export function timesheetEntriesCsv(entries: TimesheetEntry[], withCost: boolean): string {
  const head = [
    "Data",
    "Início",
    "Fim",
    "Horas",
    "Pessoa",
    "E-mail",
    "Cliente",
    "Projeto",
    "Tarefa",
    "Retrabalho",
    "Origem",
    "Descrição",
  ];
  if (withCost) head.push("Custo (R$)");
  const rows: Array<Array<unknown>> = [head];
  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("pt-BR", { timeZone: APP_TIMEZONE, hour12: false })
      : "";
  for (const e of entries) {
    const row: Array<unknown> = [
      dayKey(e.started_at).split("-").reverse().join("/"),
      fmt(e.started_at),
      fmt(e.ended_at),
      hoursFromSeconds(e.seconds).toFixed(2).replace(".", ","),
      e.user_name?.trim() || e.user_email || "",
      e.user_email ?? "",
      e.client_name ?? "",
      e.project_name ?? "",
      e.task_title ?? "",
      e.is_rework ? "Sim" : "Não",
      e.source === "manual" ? "Manual" : "Cronômetro",
      e.description ?? "",
    ];
    if (withCost) row.push((entryCostCents(e) / 100).toFixed(2).replace(".", ","));
    rows.push(row);
  }
  return csv(rows);
}

export function timesheetGroupsCsv(
  groups: TimesheetGroup[],
  by: TimesheetGroupBy,
  withCost: boolean,
): string {
  const head = [
    TIMESHEET_GROUP_LABEL[by],
    "Horas",
    "Apontamentos",
    "Retrabalho (horas)",
    "Previsto (horas)",
  ];
  if (withCost) head.push("Custo (R$)");
  const rows: Array<Array<unknown>> = [head];
  for (const g of groups) {
    const row: Array<unknown> = [
      g.label,
      hoursFromSeconds(g.seconds).toFixed(2).replace(".", ","),
      g.entries,
      hoursFromSeconds(g.reworkSeconds).toFixed(2).replace(".", ","),
      (g.estimatedMinutes / 60).toFixed(2).replace(".", ","),
    ];
    if (withCost) row.push((g.costCents / 100).toFixed(2).replace(".", ","));
    rows.push(row);
  }
  return csv(rows);
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
