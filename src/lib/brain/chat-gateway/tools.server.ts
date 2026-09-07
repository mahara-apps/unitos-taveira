// ⚠️ Server-only: catálogo de ferramentas do Chat.
//
// Regras invioláveis:
// - Toda tool roda com o supabase autenticado do usuário (RLS aplicada).
//   Nenhuma tool importa supabaseAdmin.
// - A tool só é registrada se o usuário tiver nível suficiente no módulo
//   correspondente (`effective_module_permissions`). Módulo em "none" não
//   existe para ele no chat — o modelo nem sabe que a consulta é possível.
// - Nível "own" restringe às linhas do próprio usuário; escrita exige "full".
// - Escopo por cliente continua garantido pela RLS (Manager/Usuário só veem
//   clientes atribuídos).
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainContext } from "../core";
import * as query from "../query";
import type { ModuleKey, ModuleLevel, ModulePermissions } from "@/lib/module-permissions";

export interface ToolCallLog {
  name: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  ts: string;
}

const LEVEL_RANK: Record<ModuleLevel, number> = { none: 0, view: 1, own: 2, full: 3 };

/**
 * Constrói o ToolSet com closures sobre o supabase autenticado + brand ativo.
 * `permissions` é o mapa efetivo por módulo; quando ausente, apenas as tools
 * de leitura básica do Brain ficam disponíveis (fail-closed).
 */
export function buildChatTools(
  supabase: SupabaseClient,
  ctx: BrainContext,
  log: ToolCallLog[],
  permissions?: ModulePermissions | null,
): ToolSet {
  const brandId = ctx.brandId ?? null;
  const userId = ctx.userId ?? null;

  const levelOf = (m: ModuleKey): ModuleLevel => permissions?.[m] ?? "none";
  /** Tem pelo menos o nível pedido (default: qualquer leitura). */
  const can = (m: ModuleKey, min: ModuleLevel = "view") =>
    LEVEL_RANK[levelOf(m)] >= LEVEL_RANK[min];
  /** Nível "own" (ou "view" com escopo próprio) → limitar às linhas do usuário. */
  const onlyOwn = (m: ModuleKey) => levelOf(m) === "own";

  function record(name: string, input: unknown, output: unknown, ok: boolean) {
    log.push({ name, input, output, ok, ts: new Date().toISOString() });
  }

  /** Aplica brand + devolve resultado padronizado. */
  const done = (name: string, input: unknown, error: { message: string } | null, payload: object) => {
    const out = error ? { error: error.message } : payload;
    record(name, input, out, !error);
    return out;
  };

  const tools: ToolSet = {};

  // ---------------------------------------------------------------- Brain
  if (can("brain")) {
    tools['brain_recall'] = tool({
      description:
        "Consulta semântica ao Brain (memórias consolidadas + eventos). Use para 'lembra quando…', 'já discutimos X?', 'o que sabemos sobre Y'.",
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
    });
  }

  // -------------------------------------------------------------- Clientes
  if (can("clients")) {
    tools['search_clients'] = tool({
      description:
        "Busca clientes/contas do workspace por nome ou nicho. Use para 'meus clientes', 'quem é X', ou para resolver um nome antes de outra ação.",
      inputSchema: z.object({
        query: z.string().default("").describe("Termo de busca; vazio lista os primeiros."),
        limit: z.number().int().min(1).max(30).default(10),
      }),
      execute: async ({ query: q, limit }) => {
        let qb = supabase
          .from("clients")
          .select(
            "id, name, niche, contact_name, contact_email, is_active, briefing_status, journey_stage, owner_user_id",
          )
          .is("archived_at", null)
          .order("name")
          .limit(limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (q) qb = qb.ilike("name", `%${q}%`);
        if (onlyOwn("clients") && userId) qb = qb.eq("owner_user_id", userId);
        const { data, error } = await qb;
        return done("search_clients", { query: q, limit }, error, {
          clients: (data ?? []).map((c) => ({ ...c, url: `/customers/${c.id}` })),
        });
      },
    });
  }

  // -------------------------------------------------------------- Projetos
  if (can("projects")) {
    tools['list_projects'] = tool({
      description:
        "Lista projetos do workspace com status, prazo e andamento. Filtre por cliente ou status quando o usuário indicar.",
      inputSchema: z.object({
        client_id: z.string().uuid().nullable().default(null),
        status: z.string().nullable().default(null),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (input) => {
        let qb = supabase
          .from("projects")
          .select("id, name, status, progress, due_at, start_date, client_id, owner_id")
          .is("archived_at", null)
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(input.limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (input.client_id) qb = qb.eq("client_id", input.client_id);
        if (input.status) qb = qb.eq("status", input.status);
        if (onlyOwn("projects") && userId) qb = qb.eq("owner_id", userId);
        const { data, error } = await qb;
        return done("list_projects", input, error, {
          projects: (data ?? []).map((p) => ({ ...p, url: `/projects?id=${p.id}` })),
        });
      },
    });
  }

  // --------------------------------------------------------------- Tarefas
  if (can("tasks")) {
    tools['list_tasks'] = tool({
      description:
        "Lista tarefas do workspace. Use `only_overdue` para atrasos, `mine` para as do próprio usuário, e filtros de cliente/projeto/status.",
      inputSchema: z.object({
        mine: z.boolean().default(false),
        only_overdue: z.boolean().default(false),
        include_done: z.boolean().default(false),
        client_id: z.string().uuid().nullable().default(null),
        project_id: z.string().uuid().nullable().default(null),
        search: z.string().nullable().default(null),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (input) => {
        let qb = supabase
          .from("tasks")
          .select(
            "id, title, status, done, due_at, priority, assignee_id, client_id, project_id, total_minutes",
          )
          .is("archived_at", null)
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(input.limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (!input.include_done) qb = qb.eq("done", false);
        if (input.only_overdue) qb = qb.lt("due_at", new Date().toISOString());
        if (input.client_id) qb = qb.eq("client_id", input.client_id);
        if (input.project_id) qb = qb.eq("project_id", input.project_id);
        if (input.search) qb = qb.ilike("title", `%${input.search}%`);
        if ((input.mine || onlyOwn("tasks")) && userId) qb = qb.eq("assignee_id", userId);
        const { data, error } = await qb;
        return done("list_tasks", input, error, {
          count: data?.length ?? 0,
          tasks: (data ?? []).map((t) => ({ ...t, url: `/tasks?id=${t.id}` })),
        });
      },
    });

    // Compatibilidade: atalho ainda usado em prompts antigos.
    tools['list_overdue_tasks'] = tool({
      description: "Lista tarefas em atraso (vencidas e não concluídas) do workspace.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
      execute: async ({ limit }) => {
        let qb = supabase
          .from("tasks")
          .select("id, title, due_at, priority, assignee_id, client_id, status")
          .eq("done", false)
          .lt("due_at", new Date().toISOString())
          .order("due_at", { ascending: true })
          .limit(limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (onlyOwn("tasks") && userId) qb = qb.eq("assignee_id", userId);
        const { data, error } = await qb;
        return done("list_overdue_tasks", { limit }, error, {
          count: data?.length ?? 0,
          tasks: (data ?? []).map((t) => ({ ...t, url: `/tasks?id=${t.id}` })),
        });
      },
    });
  }

  if (can("tasks", "full")) {
    tools['create_task'] = tool({
      description:
        "Cria uma tarefa no workspace ativo. Use apenas quando o usuário pedir explicitamente para criar/adicionar uma tarefa.",
      inputSchema: z.object({
        title: z.string().min(2).max(200),
        description: z.string().max(2000).nullable().default(null),
        due_at: z
          .string()
          .nullable()
          .default(null)
          .describe("ISO 8601 com timezone. Ex: '2026-07-20T15:00:00Z'."),
        priority: z.enum(["low", "medium", "high"]).nullable().default(null),
        client_id: z.string().uuid().nullable().default(null),
        project_id: z.string().uuid().nullable().default(null),
        assignee_id: z.string().uuid().nullable().default(null),
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
            description: input.description,
            due_at: input.due_at,
            priority: input.priority ?? "medium",
            client_id: input.client_id,
            project_id: input.project_id,
            assignee_id: input.assignee_id,
            created_by: userId,
          })
          .select("id, title, due_at, priority")
          .single();
        return done("create_task", input, error, {
          task: data,
          url: data ? `/tasks?id=${data.id}` : null,
        });
      },
    });
  }

  // ------------------------------------------------------- Conteúdo / posts
  if (can("content")) {
    tools['search_content'] = tool({
      description:
        "Busca posts/conteúdos por título, estágio (rascunho, aprovação, agendado, publicado) ou cliente.",
      inputSchema: z.object({
        query: z.string().default(""),
        stage: z.string().nullable().default(null),
        client_id: z.string().uuid().nullable().default(null),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: async (input) => {
        let qb = supabase
          .from("posts")
          .select("id, title, stage, scheduled_at, client_id, priority, format, channels")
          .is("deleted_at", null)
          .order("scheduled_at", { ascending: false, nullsFirst: false })
          .limit(input.limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (input.query) qb = qb.ilike("title", `%${input.query}%`);
        if (input.stage) qb = qb.eq("stage", input.stage);
        if (input.client_id) qb = qb.eq("client_id", input.client_id);
        const { data, error } = await qb;
        return done("search_content", input, error, {
          posts: (data ?? []).map((p) => ({ ...p, url: `/content?post=${p.id}` })),
        });
      },
    });
  }

  // ------------------------------------------------------------ Calendário
  if (can("calendar")) {
    tools['list_calendar'] = tool({
      description:
        "Agenda do período: publicações agendadas e compromissos/prazos do calendário. Datas em ISO (America/Sao_Paulo é o fuso oficial).",
      inputSchema: z.object({
        from: z.string().describe("Início do período em ISO 8601."),
        to: z.string().describe("Fim do período em ISO 8601."),
        client_id: z.string().uuid().nullable().default(null),
        limit: z.number().int().min(1).max(60).default(40),
      }),
      execute: async (input) => {
        let postsQb = supabase
          .from("posts")
          .select("id, title, stage, scheduled_at, client_id")
          .is("deleted_at", null)
          .gte("scheduled_at", input.from)
          .lte("scheduled_at", input.to)
          .order("scheduled_at", { ascending: true })
          .limit(input.limit);
        let evQb = supabase
          .from("calendar_events")
          .select("id, title, type, starts_at, ends_at, client_id, all_day")
          .gte("starts_at", input.from)
          .lte("starts_at", input.to)
          .order("starts_at", { ascending: true })
          .limit(input.limit);
        if (brandId) {
          postsQb = postsQb.eq("brand_id", brandId);
          evQb = evQb.eq("brand_id", brandId);
        }
        if (input.client_id) {
          postsQb = postsQb.eq("client_id", input.client_id);
          evQb = evQb.eq("client_id", input.client_id);
        }
        const [postsRes, evRes] = await Promise.all([postsQb, evQb]);
        const error = postsRes.error ?? evRes.error;
        return done("list_calendar", input, error, {
          scheduled_posts: (postsRes.data ?? []).map((p) => ({
            ...p,
            url: `/content?post=${p.id}`,
          })),
          events: evRes.data ?? [],
          url: "/calendar",
        });
      },
    });
  }

  // ------------------------------------------------- Planejamento / pautas
  if (can("planning")) {
    tools['list_monthly_plans'] = tool({
      description:
        "Lista pautas/planejamentos mensais com status (rascunho, aprovação interna, enviado ao cliente, aprovado) e, opcionalmente, os temas de uma pauta.",
      inputSchema: z.object({
        client_id: z.string().uuid().nullable().default(null),
        status: z.string().nullable().default(null),
        plan_id: z
          .string()
          .uuid()
          .nullable()
          .default(null)
          .describe("Quando informado, retorna os temas dessa pauta."),
        limit: z.number().int().min(1).max(30).default(15),
      }),
      execute: async (input) => {
        if (input.plan_id) {
          const { data, error } = await supabase
            .from("monthly_plan_topics")
            .select(
              "id, topic_title, channel, content_format, status, client_status, position, suggested_at",
            )
            .eq("monthly_plan_id", input.plan_id)
            .order("position", { ascending: true });
          return done("list_monthly_plans", input, error, {
            topics: data ?? [],
            url: `/monthly-plan?plan=${input.plan_id}`,
          });
        }
        let qb = supabase
          .from("monthly_plans")
          .select(
            "id, title, status, client_id, project_id, internal_approved_at, client_decision_at, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(input.limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (input.client_id) qb = qb.eq("client_id", input.client_id);
        if (input.status) qb = qb.eq("status", input.status);
        const { data, error } = await qb;
        return done("list_monthly_plans", input, error, {
          plans: (data ?? []).map((p) => ({ ...p, url: `/monthly-plan?plan=${p.id}` })),
        });
      },
    });
  }

  // ------------------------------------------------------------ Aprovações
  if (can("approvals")) {
    tools['list_pending_approvals'] = tool({
      description:
        "Itens aguardando aprovação: posts em estágio de aprovação e decisões pendentes do cliente.",
      inputSchema: z.object({
        client_id: z.string().uuid().nullable().default(null),
        limit: z.number().int().min(1).max(50).default(25),
      }),
      execute: async (input) => {
        let qb = supabase
          .from("posts")
          .select("id, title, stage, scheduled_at, client_id, review_status, client_due_at")
          .is("deleted_at", null)
          .in("stage", ["review", "approved"])
          .order("scheduled_at", { ascending: true, nullsFirst: false })
          .limit(input.limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (input.client_id) qb = qb.eq("client_id", input.client_id);
        const { data, error } = await qb;
        return done("list_pending_approvals", input, error, {
          count: data?.length ?? 0,
          items: (data ?? []).map((p) => ({ ...p, url: `/content?post=${p.id}` })),
        });
      },
    });
  }

  // -------------------------------------------------------------- Briefing
  if (can("briefing")) {
    tools['get_briefing_status'] = tool({
      description:
        "Situação do briefing de um cliente: completude, última atualização e se há dados registrados.",
      inputSchema: z.object({ client_id: z.string().uuid() }),
      execute: async (input) => {
        const { data, error } = await supabase
          .from("brand_briefings")
          .select("id, client_id, completude, updated_at, created_at")
          .eq("client_id", input.client_id)
          .maybeSingle();
        return done("get_briefing_status", input, error, {
          briefing: data ?? null,
          url: `/customers/${input.client_id}?tab=briefing`,
        });
      },
    });
  }

  // ------------------------------------------- Área do cliente / pedidos
  if (can("portal")) {
    tools['list_client_requests'] = tool({
      description:
        "Pedidos e solicitações vindos da Área do Cliente, com status e prazo desejado pelo cliente.",
      inputSchema: z.object({
        client_id: z.string().uuid().nullable().default(null),
        status: z.string().nullable().default(null),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async (input) => {
        let qb = supabase
          .from("client_requests")
          .select(
            "id, title, status, client_id, desired_due_at, created_at, created_by_name, last_team_reply_at",
          )
          .order("created_at", { ascending: false })
          .limit(input.limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if (input.client_id) qb = qb.eq("client_id", input.client_id);
        if (input.status) qb = qb.eq("status", input.status);
        const { data, error } = await qb;
        return done("list_client_requests", input, error, {
          requests: (data ?? []).map((r) => ({ ...r, url: `/inbox?request=${r.id}` })),
        });
      },
    });
  }

  // ------------------------------------------------- Horas / relatórios
  if (can("reports")) {
    tools['timesheet_summary'] = tool({
      description:
        "Horas apontadas no período, agrupadas por pessoa, cliente, projeto ou tarefa. Datas em ISO.",
      inputSchema: z.object({
        from: z.string(),
        to: z.string(),
        group_by: z.enum(["user", "client", "project", "task"]).default("user"),
        mine: z.boolean().default(false),
        limit: z.number().int().min(1).max(1000).default(500),
      }),
      execute: async (input) => {
        let qb = supabase
          .from("task_time_entries")
          .select("id, user_id, minutes, seconds, started_at, task_id, tasks(client_id, project_id)")
          .gte("started_at", input.from)
          .lte("started_at", input.to)
          .limit(input.limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        if ((input.mine || onlyOwn("reports")) && userId) qb = qb.eq("user_id", userId);
        const { data, error } = await qb;
        if (error) return done("timesheet_summary", input, error, {});
        type Joined = { client_id: string | null; project_id: string | null };
        const rows = (data ?? []) as unknown as Array<{
          user_id: string | null;
          minutes: number | null;
          seconds: number | null;
          task_id: string | null;
          tasks?: Joined | Joined[] | null;
        }>;
        const buckets = new Map<string, number>();
        for (const r of rows) {
          const min = r.minutes ?? Math.round((r.seconds ?? 0) / 60);
          const joined = Array.isArray(r.tasks) ? (r.tasks[0] ?? null) : (r.tasks ?? null);
          const key =
            input.group_by === "user"
              ? (r.user_id ?? "—")
              : input.group_by === "client"
                ? (joined?.client_id ?? "—")
                : input.group_by === "project"
                  ? (joined?.project_id ?? "—")
                  : (r.task_id ?? "—");
          buckets.set(key, (buckets.get(key) ?? 0) + min);
        }
        const totalMinutes = [...buckets.values()].reduce((a, b) => a + b, 0);
        return done("timesheet_summary", input, null, {
          group_by: input.group_by,
          entries: rows.length,
          total_hours: Math.round((totalMinutes / 60) * 100) / 100,
          groups: [...buckets.entries()]
            .map(([key, minutes]) => ({
              key,
              hours: Math.round((minutes / 60) * 100) / 100,
            }))
            .sort((a, b) => b.hours - a.hours)
            .slice(0, 50),
          url: "/analytics?tab=timesheet",
        });
      },
    });
  }

  // ---------------------------------------------------- Equipe / usuários
  if (can("users")) {
    tools['list_team'] = tool({
      description:
        "Pessoas do workspace com papel e nome/e-mail. Use para saber quem é quem antes de atribuir tarefas.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
      execute: async (input) => {
        if (!brandId) {
          const out = { error: "Nenhum workspace ativo selecionado." };
          record("list_team", input, out, false);
          return out;
        }
        const { data, error } = await supabase
          .from("brand_members")
          .select("user_id, role, is_active")
          .eq("brand_id", brandId)
          .limit(input.limit);
        if (error) return done("list_team", input, error, {});
        const ids = (data ?? []).map((m) => m.user_id).filter(Boolean) as string[];
        const { data: profiles } = ids.length
          ? await supabase
              .from("user_profiles")
              .select("id, full_name, email, job_title")
              .in("id", ids)
          : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
        const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
        return done("list_team", input, null, {
          members: (data ?? []).map((m) => ({
            user_id: m.user_id,
            role: m.role,
            is_active: m.is_active,
            name: byId.get(m.user_id ?? "")?.full_name ?? null,
            email: byId.get(m.user_id ?? "")?.email ?? null,
          })),
          url: "/settings/team",
        });
      },
    });
  }

  // ------------------------------------------------------------- Conexões
  if (can("connections")) {
    tools['list_connections_status'] = tool({
      description:
        "Situação das contas conectadas (Meta/Instagram/Facebook/WhatsApp) e a qual cliente estão vinculadas. Nunca retorna tokens ou chaves.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
      execute: async (input) => {
        let qb = supabase
          .from("social_connections")
          .select(
            "id, provider, channel, channel_name, account_username, client_id, status, last_error, last_synced_at, token_expires_at",
          )
          .order("updated_at", { ascending: false })
          .limit(input.limit);
        if (brandId) qb = qb.eq("brand_id", brandId);
        const { data, error } = await qb;
        return done("list_connections_status", input, error, {
          connections: data ?? [],
          url: "/connections",
        });
      },
    });
  }

  return tools;
}
