// ⚠️ Brain Reasoning Engine — Response Generator determinístico.
// Gera respostas objetivas em pt-BR a partir dos ToolResults.
// Nunca começa com "Não encontrei informações suficientes..." quando
// existem dados no banco — usa a ausência real como informação.
import type { ReasoningIntent } from "./intent";
import type { ToolResult } from "./tools.server";

function rowsOf<T = Record<string, unknown>>(results: ToolResult[], tool: string): T[] {
  const r = results.find((x) => x.tool === tool && x.ok);
  if (!r) return [];
  const d = r.data;
  return Array.isArray(d) ? (d as T[]) : [];
}
function pickOf<T = Record<string, unknown>>(results: ToolResult[], tool: string): T | null {
  const r = results.find((x) => x.tool === tool && x.ok);
  return (r?.data as T) ?? null;
}
function fmtDate(iso?: string | null): string {
  if (!iso) return "sem data";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR");
}
function daysAgo(iso?: string | null): number | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / 86_400_000);
}

export function renderAnswer(
  intent: ReasoningIntent,
  question: string,
  results: ToolResult[],
): string {
  switch (intent) {
    case "consulta_tarefa":
      return renderTasks(question, results);
    case "consulta_projeto":
      return renderProjects(results);
    case "consulta_conteudo":
      return renderContent(results);
    case "consulta_cliente":
      return renderClients(results);
    case "consulta_calendario":
      return renderCalendar(results);
    case "consulta_metrica":
    case "consulta_status":
      return renderMetrics(results);
    case "resumo":
      return renderSummary(results);
    case "recomendacao":
      return renderRecommendations(results);
    default:
      return renderFallback(results);
  }
}

function renderTasks(q: string, r: ToolResult[]): string {
  const overdue = rowsOf<{
    title: string;
    due_at: string | null;
    assignee_id: string | null;
    project_id: string | null;
  }>(r, "tasks.overdue");
  const counts = pickOf<{ total: number; done: number; overdue: number; open: number }>(
    r,
    "tasks.count",
  );

  if (/atrasad|vencid|em atraso/i.test(q) || overdue.length > 0) {
    if (!overdue.length) return "Não há tarefas em atraso no momento.";
    const first = overdue[0];
    const dias = daysAgo(first.due_at);
    const lines = [`Existem **${overdue.length} tarefa(s) em atraso**.`];
    if (dias !== null)
      lines.push(`A mais antiga (“${first.title}”) está vencida há ${dias} dia(s).`);
    const preview = overdue.slice(0, 5).map((t) => `- ${t.title} — venc. ${fmtDate(t.due_at)}`);
    lines.push("", ...preview);
    if (overdue.length > 5) lines.push(`… e mais ${overdue.length - 5}.`);
    return lines.join("\n");
  }

  if (counts) {
    return `Você tem **${counts.total} tarefa(s)** no total: ${counts.done} concluída(s), ${counts.open} aberta(s), ${counts.overdue} em atraso.`;
  }
  return "Sem tarefas encontradas no workspace atual.";
}

function renderProjects(r: ToolResult[]): string {
  const list = rowsOf<{
    name: string;
    status: string;
    progress: number | null;
    due_at: string | null;
  }>(r, "projects.list");
  const buckets = pickOf<Record<string, number>>(r, "projects.status") ?? {};
  if (!list.length && !Object.keys(buckets).length)
    return "Nenhum projeto encontrado no workspace.";
  const status = Object.entries(buckets)
    .map(([k, v]) => `${v} ${k}`)
    .join(" · ");
  const lines = [`**${list.length} projeto(s)** — ${status || "sem status"}.`];
  for (const p of list.slice(0, 5)) {
    lines.push(
      `- ${p.name} · ${p.status}${p.progress != null ? ` · ${p.progress}%` : ""}${p.due_at ? ` · entrega ${fmtDate(p.due_at)}` : ""}`,
    );
  }
  return lines.join("\n");
}

function renderContent(r: ToolResult[]): string {
  const counts = pickOf<Record<string, number>>(r, "content.stage_counts") ?? {};
  const upcoming = rowsOf<{ title: string; scheduled_at: string | null; stage: string }>(
    r,
    "content.upcoming",
  );
  if (!Object.keys(counts).length && !upcoming.length)
    return "Nenhum conteúdo cadastrado no workspace.";
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const byStage = Object.entries(counts)
    .map(([k, v]) => `${v} em ${k}`)
    .join(", ");
  const lines = [`**${total} publicação(ões)** no pipeline: ${byStage}.`];
  if (upcoming.length) {
    lines.push("", "Próximos agendamentos:");
    for (const p of upcoming.slice(0, 5)) {
      lines.push(`- ${p.title || "(sem título)"} · ${fmtDate(p.scheduled_at)}`);
    }
  }
  return lines.join("\n");
}

function renderClients(r: ToolResult[]): string {
  const list = rowsOf<{ name: string; niche: string | null }>(r, "clients.list");
  if (!list.length) return "Nenhum cliente ativo no workspace.";
  const lines = [`**${list.length} cliente(s) ativo(s)**.`];
  for (const c of list.slice(0, 8)) {
    lines.push(`- ${c.name}${c.niche ? ` — ${c.niche}` : ""}`);
  }
  if (list.length > 8) lines.push(`… e mais ${list.length - 8}.`);
  return lines.join("\n");
}

function renderCalendar(r: ToolResult[]): string {
  const data = pickOf<{
    posts: Array<{ title: string; scheduled_at: string | null }>;
    tasks: Array<{ title: string; due_at: string | null }>;
  }>(r, "calendar.upcoming");
  if (!data || (!data.posts.length && !data.tasks.length))
    return "Nada agendado na janela consultada.";
  const lines: string[] = [];
  if (data.posts.length) {
    lines.push(`**Publicações agendadas (${data.posts.length}):**`);
    for (const p of data.posts.slice(0, 5))
      lines.push(`- ${p.title || "(sem título)"} · ${fmtDate(p.scheduled_at)}`);
  }
  if (data.tasks.length) {
    if (lines.length) lines.push("");
    lines.push(`**Tarefas agendadas (${data.tasks.length}):**`);
    for (const t of data.tasks.slice(0, 5)) lines.push(`- ${t.title} · ${fmtDate(t.due_at)}`);
  }
  return lines.join("\n");
}

function renderMetrics(r: ToolResult[]): string {
  const stats = pickOf<Record<string, number>>(r, "analytics.stats") ?? {};
  const counts = pickOf<{ total: number; done: number; overdue: number; open: number }>(
    r,
    "tasks.count",
  );
  const content = pickOf<Record<string, number>>(r, "content.stage_counts") ?? {};
  const lines: string[] = ["**Panorama operacional:**"];
  if (stats.projects != null) lines.push(`- Projetos: ${stats.projects}`);
  if (counts)
    lines.push(
      `- Tarefas: ${counts.total} (${counts.overdue} em atraso, ${counts.done} concluídas)`,
    );
  const contentTotal = Object.values(content).reduce((a, b) => a + b, 0);
  if (contentTotal) lines.push(`- Conteúdos: ${contentTotal} no pipeline`);
  if (lines.length === 1) lines.push("Sem métricas disponíveis para o escopo atual.");
  return lines.join("\n");
}

function renderSummary(r: ToolResult[]): string {
  const parts: string[] = [];
  const stats = pickOf<Record<string, number>>(r, "analytics.stats");
  const overdue = rowsOf(r, "tasks.overdue");
  const upcoming = rowsOf<{ title: string; scheduled_at: string | null }>(r, "content.upcoming");
  const ins = rowsOf<{ description: string }>(r, "brain.insights");
  const recs = rowsOf<{ title?: string; description?: string }>(r, "brain.recommendations");
  if (stats)
    parts.push(
      `Operação: ${Object.entries(stats)
        .map(([k, v]) => `${v} ${k}`)
        .join(" · ")}.`,
    );
  if (overdue.length) parts.push(`Atenção: ${overdue.length} tarefa(s) em atraso.`);
  if (upcoming.length)
    parts.push(
      `Próxima publicação: “${upcoming[0].title || "(sem título)"}” em ${fmtDate(upcoming[0].scheduled_at)}.`,
    );
  if (ins.length) parts.push(`Insights ativos: ${ins.length}. Ex.: ${ins[0].description}`);
  if (recs.length) parts.push(`${recs.length} recomendação(ões) pendente(s).`);
  return parts.length ? parts.join("\n\n") : "Sem dados suficientes para um resumo agora.";
}

function renderRecommendations(r: ToolResult[]): string {
  const recs = rowsOf<{ title?: string; description?: string }>(r, "brain.recommendations");
  if (!recs.length) return "Nenhuma recomendação ativa neste momento.";
  const lines = [`**${recs.length} recomendação(ões) do Brain:**`];
  for (const rec of recs.slice(0, 6))
    lines.push(`- ${rec.title ?? rec.description ?? "(sem título)"}`);
  return lines.join("\n");
}

function renderFallback(r: ToolResult[]): string {
  const hits: string[] = [];
  for (const res of r) if (res.ok && res.summary) hits.push(`- ${res.summary}`);
  return hits.length ? `**O Brain consultou:**\n${hits.join("\n")}` : "";
}
