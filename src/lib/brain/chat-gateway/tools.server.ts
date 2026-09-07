// ⚠️ Server-only: catálogo de ferramentas do Chat.
//
// Todas as tools rodam com o supabase autenticado do usuário (RLS aplicada).
// Nenhuma tool importa supabaseAdmin. `create_task` grava direto — a RLS
// impede que o usuário crie tarefas em brands que não são dele.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainContext } from "../core";
import * as query from "../query";

export interface ToolCallLog {
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  ts: string;
}

/**
 * Constrói o ToolSet com closures sobre o supabase autenticado + brand ativo.
 * O ToolCallLog é populado pelo array `log` fornecido — cada execução empurra
 * um item, o que permite ao caller persistir `chat_messages.tool_calls`.
 */
export function buildChatTools(
  supabase: SupabaseClient,
  ctx: BrainContext,
  log: ToolCallLog[],
): ToolSet {
  const brandId = ctx.brandId ?? null;

  function record(name: string, input: unknown, output: unknown, ok: boolean) {
    log.push({ name, input, output, ok, ts: new Date().toISOString() });
  }

  return {
    search_clients: tool({
      description:
        "Busca clientes/contas do workspace ativo por nome ou nicho. Use quando o usuário pedir 'meus clientes', 'quem é X', ou for necessário resolver um nome antes de outra ação.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Termo de busca (case-insensitive)."),
        limit: z.number().int().min(1).max(20).default(5),
      }),
      execute: async ({ query: q, limit }) => {
        let qb = supabase
          .from("clients")
          .select("id, name, niche, contact_name, is_active")
          .ilike("name", `%${q}%`)
          .limit(limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        const { data, error } = await qb;
        const out = error ? { error: error.message } : { clients: data ?? [] };
        record("search_clients", { query: q, limit }, out, !error);
        return out;
      },
    }),

    search_content: tool({
      description:
        "Busca posts / conteúdos do workspace por título ou estágio (rascunho, aprovação, agendado, publicado).",
      inputSchema: z.object({
        query: z.string().min(1).describe("Termo no título ou copy."),
        stage: z.string().optional().describe("Filtro opcional de estágio."),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ query: q, stage, limit }) => {
        let qb = supabase
          .from("posts")
          .select("id, title, stage, scheduled_at, client_id, priority")
          .ilike("title", `%${q}%`)
          .is("deleted_at", null)
          .order("scheduled_at", { ascending: false, nullsFirst: false })
          .limit(limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (stage) qb = qb.eq("stage", stage);
        const { data, error } = await qb;
        const out = error ? { error: error.message } : { posts: data ?? [] };
        record("search_content", { query: q, stage, limit }, out, !error);
        return out;
      },
    }),

    list_overdue_tasks: tool({
      description: "Lista tarefas em atraso (due_at < agora, não concluídas) do workspace ativo.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ limit }) => {
        let qb = supabase
          .from("tasks")
          .select("id, title, due_at, priority, assignee_id, client_id, status")
          .eq("done", false)
          .lt("due_at", new Date().toISOString())
          .order("due_at", { ascending: true })
          .limit(limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        const { data, error } = await qb;
        const out = error
          ? { error: error.message }
          : { tasks: data ?? [], count: data?.length ?? 0 };
        record("list_overdue_tasks", { limit }, out, !error);
        return out;
      },
    }),

    create_task: tool({
      description:
        "Cria uma nova tarefa no workspace ativo. Use apenas quando o usuário pedir explicitamente para criar/adicionar uma tarefa.",
      inputSchema: z.object({
        title: z.string().min(2).max(200),
        description: z.string().max(2000).optional(),
        due_at: z
          .string()
          .datetime()
          .optional()
          .describe("ISO 8601 com timezone. Ex: '2026-07-20T15:00:00Z'."),
        priority: z.enum(["low", "medium", "high"]).optional(),
        client_id: z.string().uuid().optional(),
        assignee_id: z.string().uuid().optional(),
      }),
      execute: async (input) => {
        if (!brandId) {
          const out = { error: "Nenhum workspace ativo selecionado." };
          record("create_task", input, out, false);
          return out;
        }
        const { data, error } = await supabase
          .from("tasks")
          .insert({
            brand_id: brandId,
            title: input.title,
            description: input.description ?? null,
            due_at: input.due_at ?? null,
            priority: input.priority ?? "medium",
            client_id: input.client_id ?? null,
            assignee_id: input.assignee_id ?? null,
            created_by: ctx.userId,
          })
          .select("id, title, due_at, priority")
          .single();
        const out = error ? { error: error.message } : { task: data, url: `/tasks?id=${data.id}` };
        record("create_task", input, out, !error);
        return out;
      },
    }),

    brain_recall: tool({
      description:
        "Consulta semântica direta ao Brain (memórias consolidadas + eventos). Use quando o usuário pedir 'lembra quando…', 'já discutimos X?', 'cite o que sabemos sobre Y'.",
      inputSchema: z.object({
        query: z.string().min(2),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      execute: async ({ query: q, limit }) => {
        try {
          const hits = await query.semantic(ctx, { query: q, matchCount: limit });
          const out = {
            hits: hits.map((h) => ({
              summary: h.content_summary,
              similarity: h.similarity,
              type: h.event_type,
            })),
          };
          record("brain_recall", { query: q, limit }, out, true);
          return out;
        } catch (err) {
          const out = { error: err instanceof Error ? err.message : String(err) };
          record("brain_recall", { query: q, limit }, out, false);
          return out;
        }
      },
    }),
  };
}
