// ⚠️ Brain Reasoning Engine — executores de ferramentas (server-only).
// Cada tool retorna dados ESTRUTURADOS + um `summary` humano curto usado
// pelo Response Generator quando não há LLM.
// Rodam com o supabase autenticado do usuário (RLS aplicada).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainContext } from "../core";
import * as memory from "../memory";
import * as insights from "../insights";
import * as recommendations from "../recommendations";
import * as query from "../query";
import type { PlanStep, ToolName } from "./planner";

export interface ToolResult {
  tool: ToolName;
  ok: boolean;
  summary: string;
  data: unknown;
  count?: number;
  ms: number;
}

export async function executePlan(
  ctx: BrainContext,
  supabase: SupabaseClient,
  steps: PlanStep[],
): Promise<ToolResult[]> {
  const out: ToolResult[] = [];
  for (const step of steps) {
    const t0 = Date.now();
    try {
      const res = await runTool(ctx, supabase, step);
      out.push({ ...res, ms: Date.now() - t0 });
    } catch (err) {
      out.push({
        tool: step.tool,
        ok: false,
        summary: `Falha em ${step.tool}: ${err instanceof Error ? err.message : String(err)}`,
        data: null,
        ms: Date.now() - t0,
      });
    }
  }
  return out;
}

async function runTool(
  ctx: BrainContext,
  supabase: SupabaseClient,
  step: PlanStep,
): Promise<Omit<ToolResult, "ms">> {
  const brandId = ctx.brandId ?? null;
  const scope = <T>(qb: T): T =>
    brandId ? (qb as unknown as { eq: (c: string, v: string) => T }).eq("brand_id", brandId) : qb;

  switch (step.tool) {
    case "tasks.overdue": {
      const nowIso = new Date().toISOString();
      const { data, error } = await scope(
        supabase
          .from("tasks")
          .select("id,title,due_at,priority,assignee_id,client_id,project_id")
          .eq("done", false)
          .lt("due_at", nowIso)
          .order("due_at", { ascending: true })
          .limit(50),
      );
      if (error) throw error;
      const rows = data ?? [];
      return {
        tool: step.tool,
        ok: true,
        count: rows.length,
        summary: rows.length ? `${rows.length} tarefa(s) em atraso.` : "Nenhuma tarefa em atraso.",
        data: rows,
      };
    }
    case "tasks.count": {
      const [all, done, overdue] = await Promise.all([
        scope(supabase.from("tasks").select("*", { count: "exact", head: true })),
        scope(supabase.from("tasks").select("*", { count: "exact", head: true }).eq("done", true)),
        scope(
          supabase
            .from("tasks")
            .select("*", { count: "exact", head: true })
            .eq("done", false)
            .lt("due_at", new Date().toISOString()),
        ),
      ]);
      const total = all.count ?? 0;
      const closed = done.count ?? 0;
      const late = overdue.count ?? 0;
      return {
        tool: step.tool,
        ok: true,
        count: total,
        summary: `${total} tarefa(s): ${closed} concluídas, ${late} em atraso.`,
        data: { total, done: closed, overdue: late, open: total - closed },
      };
    }
    case "tasks.recent": {
      const { data, error } = await scope(
        supabase
          .from("tasks")
          .select("id,title,status,priority,due_at,updated_at")
          .order("updated_at", { ascending: false })
          .limit(10),
      );
      if (error) throw error;
      return {
        tool: step.tool,
        ok: true,
        count: data?.length ?? 0,
        summary: `${data?.length ?? 0} tarefa(s) recentes.`,
        data: data ?? [],
      };
    }
    case "projects.list": {
      const { data, error } = await scope(
        supabase
          .from("projects")
          .select("id,name,status,progress,due_at,client_id")
          .order("updated_at", { ascending: false })
          .limit(20),
      );
      if (error) throw error;
      return {
        tool: step.tool,
        ok: true,
        count: data?.length ?? 0,
        summary: `${data?.length ?? 0} projeto(s) ativos.`,
        data: data ?? [],
      };
    }
    case "projects.status": {
      const { data, error } = await scope(supabase.from("projects").select("status"));
      if (error) throw error;
      const buckets: Record<string, number> = {};
      for (const r of data ?? []) {
        const s = (r as { status?: string | null }).status ?? "desconhecido";
        buckets[s] = (buckets[s] ?? 0) + 1;
      }
      const parts = Object.entries(buckets)
        .map(([k, v]) => `${v} ${k}`)
        .join(", ");
      return { tool: step.tool, ok: true, summary: parts || "Sem projetos.", data: buckets };
    }
    case "content.upcoming": {
      const { data, error } = await scope(
        supabase
          .from("posts")
          .select("id,title,stage,scheduled_at,client_id")
          .is("deleted_at", null)
          .gte("scheduled_at", new Date().toISOString())
          .order("scheduled_at", { ascending: true })
          .limit(10),
      );
      if (error) throw error;
      return {
        tool: step.tool,
        ok: true,
        count: data?.length ?? 0,
        summary: `${data?.length ?? 0} publicação(ões) agendada(s).`,
        data: data ?? [],
      };
    }
    case "content.stage_counts": {
      const { data, error } = await scope(
        supabase.from("posts").select("stage").is("deleted_at", null),
      );
      if (error) throw error;
      const buckets: Record<string, number> = {};
      for (const r of data ?? []) {
        const s = (r as { stage?: string | null }).stage ?? "sem estágio";
        buckets[s] = (buckets[s] ?? 0) + 1;
      }
      const parts = Object.entries(buckets)
        .map(([k, v]) => `${v} em ${k}`)
        .join(", ");
      return { tool: step.tool, ok: true, summary: parts || "Sem posts.", data: buckets };
    }
    case "clients.list": {
      const { data, error } = await scope(
        supabase.from("clients").select("id,name,niche,is_active,archived_at").limit(50),
      );
      if (error) throw error;
      const active = (data ?? []).filter(
        (c) =>
          (c as { is_active?: boolean }).is_active &&
          !(c as { archived_at?: string | null }).archived_at,
      );
      return {
        tool: step.tool,
        ok: true,
        count: active.length,
        summary: `${active.length} cliente(s) ativo(s).`,
        data: active,
      };
    }
    case "clients.summary": {
      const { data, error } = await scope(supabase.from("clients").select("id,name").limit(20));
      if (error) throw error;
      return {
        tool: step.tool,
        ok: true,
        count: data?.length ?? 0,
        summary: `${data?.length ?? 0} cliente(s).`,
        data: data ?? [],
      };
    }
    case "calendar.upcoming": {
      const nowIso = new Date().toISOString();
      const [postsRes, tasksRes] = await Promise.all([
        scope(
          supabase
            .from("posts")
            .select("id,title,scheduled_at")
            .is("deleted_at", null)
            .gte("scheduled_at", nowIso)
            .order("scheduled_at", { ascending: true })
            .limit(10),
        ),
        scope(
          supabase
            .from("tasks")
            .select("id,title,due_at")
            .eq("done", false)
            .gte("due_at", nowIso)
            .order("due_at", { ascending: true })
            .limit(10),
        ),
      ]);
      const posts = postsRes.data ?? [];
      const tasks = tasksRes.data ?? [];
      return {
        tool: step.tool,
        ok: true,
        count: posts.length + tasks.length,
        summary: `${posts.length} publicação(ões) e ${tasks.length} tarefa(s) agendadas.`,
        data: { posts, tasks },
      };
    }
    case "analytics.stats": {
      const stats = await query.stats(ctx);
      const parts = Object.entries(stats)
        .map(([k, v]) => `${v} ${k}`)
        .join(" · ");
      return { tool: step.tool, ok: true, summary: parts || "Sem estatísticas.", data: stats };
    }
    case "brain.memory": {
      const rows = await memory.list(ctx, { limit: 8 });
      return {
        tool: step.tool,
        ok: true,
        count: rows.length,
        summary: `${rows.length} memória(s) recuperada(s).`,
        data: rows,
      };
    }
    case "brain.insights": {
      const rows = await insights.list(ctx, { limit: 8 });
      return {
        tool: step.tool,
        ok: true,
        count: rows.length,
        summary: `${rows.length} insight(s) ativo(s).`,
        data: rows,
      };
    }
    case "brain.recommendations": {
      const rows = await recommendations.list(ctx, { limit: 8 });
      return {
        tool: step.tool,
        ok: true,
        count: rows.length,
        summary: `${rows.length} recomendação(ões) ativa(s).`,
        data: rows,
      };
    }
    case "brain.semantic": {
      const q = (step.args?.query as string) ?? "";
      const hits = q ? await query.semantic(ctx, { query: q, matchCount: 6 }) : [];
      return {
        tool: step.tool,
        ok: true,
        count: hits.length,
        summary: `${hits.length} memória(s) semântica(s).`,
        data: hits,
      };
    }
  }
}
