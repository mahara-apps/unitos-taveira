import { normalizeContentFormat, defaultFormatForChannel } from "@/lib/content-formats";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Materializa os itens aprovados de uma pauta em cards do Kanban de conteúdo.
 * Usado tanto pelo fluxo interno (botão "Enviar para produção") quanto pela
 * aprovação pública do cliente (automática). É idempotente: tópicos que já
 * possuem post não geram card novo.
 */

export type PlanTopicForKanban = {
  id: string;
  topic_title: string;
  content_format: string | null;
  channel: string | null;
  angle: string | null;
  target_audience?: string | null;
  rationale?: string | null;
  /** Data/hora sugerida pela IA (proposta de agenda, ainda não aprovada). */
  suggested_at?: string | null;
  suggested_slot_rationale?: string | null;
  position: number;
};

const POST_CHANNELS = ["instagram", "tiktok", "linkedin", "x", "youtube", "blog"] as const;

/** Converte o canal do tópico da pauta no enum `post_channel` (quando existir). */
function normalizeChannel(raw: string | null): string[] {
  const s = (raw ?? "").trim().toLowerCase();
  const hit = POST_CHANNELS.find((c) => s.includes(c)) ?? (s.includes("twitter") ? "x" : null);
  return hit ? [hit] : [];
}

export function isKanbanReady(t: Pick<PlanTopicForKanban, "channel" | "content_format">): boolean {
  return !!(t.channel && t.channel.trim() && t.content_format && t.content_format.trim());
}

export async function ensureDefaultPipeline(
  sb: SupabaseClient,
  brandId: string,
  clientId: string,
  userId: string | null,
): Promise<string> {
  const { data: pipes } = await sb
    .from("content_pipelines")
    .select("id")
    .eq("brand_id", brandId)
    .eq("client_id", clientId)
    .order("position", { ascending: true })
    .limit(1);
  const existing = (pipes ?? [])[0] as { id: string } | undefined;
  if (existing) return existing.id;

  const { data: newPipe, error } = await sb
    .from("content_pipelines")
    .insert({
      brand_id: brandId,
      client_id: clientId,
      name: "Pipeline principal",
      slug: "main",
      is_default: true,
      position: 0,
      created_by: userId,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const pipelineId = (newPipe as unknown as { id: string }).id;

  await sb.from("content_pipeline_stages").insert([
    {
      pipeline_id: pipelineId,
      key: "briefing",
      label: "Ideia",
      color: "muted",
      position: 0,
      is_terminal: false,
    },
    {
      pipeline_id: pipelineId,
      key: "writing",
      label: "Produção",
      color: "indigo",
      position: 1024,
      is_terminal: false,
    },
    {
      pipeline_id: pipelineId,
      key: "review",
      label: "Revisão",
      color: "amber",
      position: 2048,
      is_terminal: false,
    },
    {
      pipeline_id: pipelineId,
      key: "approved",
      label: "Aprovado",
      color: "emerald",
      position: 3072,
      is_terminal: false,
    },
  ] as never);

  return pipelineId;
}

export async function materializePlanToKanban(
  sb: SupabaseClient,
  args: {
    planId: string;
    brandId: string;
    clientId: string;
    userId: string | null;
    /** Se informado, só estes tópicos são considerados. */
    topics?: PlanTopicForKanban[];
    /** Marca a pauta como "Em produção" ao final (default: true). */
    markPlanApproved?: boolean;
  },
): Promise<{ created: number; skipped: number }> {
  let list = args.topics ?? null;
  if (!list) {
    const { data, error } = await sb
      .from("monthly_plan_topics")
      .select(
        "id, topic_title, content_format, channel, angle, target_audience, rationale, suggested_at, suggested_slot_rationale, position",
      )
      .eq("monthly_plan_id", args.planId)
      .eq("status", "approved")
      .not("client_status", "in", '("rejected","changes")')
      .order("position", { ascending: true });
    if (error) throw error;
    list = (data ?? []) as unknown as PlanTopicForKanban[];
  }
  if (list.length === 0) return { created: 0, skipped: 0 };
  if (list.some((t) => !isKanbanReady(t))) throw new Error("topics_incomplete");

  // Idempotência: ignora tópicos que já viraram card.
  const { data: existingPosts } = await sb
    .from("posts")
    .select("monthly_plan_topic_id")
    .in(
      "monthly_plan_topic_id",
      list.map((t) => t.id),
    );
  const already = new Set(
    ((existingPosts ?? []) as unknown as { monthly_plan_topic_id: string | null }[])
      .map((p) => p.monthly_plan_topic_id)
      .filter(Boolean) as string[],
  );
  const pending = list.filter((t) => !already.has(t.id));
  // Sem `return` antecipado quando não há pendências: a reexecução ainda
  // precisa garantir projeto, tarefas e conclusão de gerações que falharam.

  const pipelineId = await ensureDefaultPipeline(sb, args.brandId, args.clientId, args.userId);

  // Vincula as peças ao projeto da pauta (projeto = execução da pauta).
  // O projeto é escolhido na criação da pauta; aqui nunca criamos um sozinho.
  let projectId: string | null = null;
  {
    const { reconcilePlanProjectLink } = await import("@/lib/monthly-plan-project.server");
    const { data: planRow } = await sb
      .from("monthly_plans")
      .select("project_id")
      .eq("id", args.planId)
      .maybeSingle();
    projectId = (planRow as unknown as { project_id: string | null } | null)?.project_id ?? null;
    if (!projectId) throw new Error("project_required");
    await reconcilePlanProjectLink(sb, { planId: args.planId, projectId });
  }
  if (!projectId) throw new Error("plan_project_missing");


  const { data: stages } = await sb
    .from("content_pipeline_stages")
    .select("id, position, is_terminal")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });
  const stageList = (stages ?? []) as unknown as {
    id: string;
    position: number;
    is_terminal: boolean;
  }[];
  const stage = stageList.find((s) => !s.is_terminal) ?? stageList[0];
  if (!stage) throw new Error("no_stage_available");

  const { data: maxPost } = await sb
    .from("posts")
    .select("position")
    .eq("stage_id", stage.id)
    .order("position", { ascending: false })
    .limit(1);
  let nextPos = (((maxPost ?? [])[0] as { position: number } | undefined)?.position ?? -1) + 1024;

  const rows = pending.map((t) => {
    const pos = nextPos;
    nextPos += 1024;
    return {
      brand_id: args.brandId,
      client_id: args.clientId,
      project_id: projectId,
      pipeline_id: pipelineId,
      stage_id: stage.id,
      stage: "idea",
      title: t.topic_title,
      // Fronteira de escrita: posts.format SEMPRE em chave canônica.
      format:
        normalizeContentFormat(t.content_format) ??
        defaultFormatForChannel(normalizeChannel(t.channel)[0] ?? "instagram"),
      channels: normalizeChannel(t.channel),
      internal_briefing: [
        t.angle,
        t.target_audience ? `Público-alvo: ${t.target_audience}` : "",
        t.rationale ? `Por quê: ${t.rationale}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      monthly_plan_topic_id: t.id,
      // Proposta de agenda: reserva NADA e não publica — só entra no calendário
      // como sugestão à espera de aprovação interna e do cliente.
      proposed_at: t.suggested_at ?? null,
      schedule_status: t.suggested_at ? "proposed" : "none",
      position: pos,
      created_by: args.userId,
      assignee_id: args.userId,
      assignees: args.userId ? [args.userId] : [],
    };
  });

  let insertedPosts: unknown[] = [];
  if (rows.length > 0) {
    const { data, error: insErr } = await sb
      .from("posts")
      .insert(rows as never)
      .select("id, title, monthly_plan_topic_id");
    if (insErr) throw insErr;
    insertedPosts = (data ?? []) as unknown[];
  }

  // Uma tarefa de produção por peça da pauta (idempotente: inclui peças já
  // existentes que ainda não tenham tarefa, e nunca duplica).
  const topicIds = list.map((t) => t.id);
  const { data: planPosts } = await sb
    .from("posts")
    .select("id, title, copy, scheduled_at, monthly_plan_topic_id")
    .in(
      "monthly_plan_topic_id",
      topicIds.length > 0 ? topicIds : ["00000000-0000-0000-0000-000000000000"],
    );
  const allPlanPosts = (planPosts ?? []) as unknown as Array<{
    id: string;
    title: string | null;
    copy: string | null;
    scheduled_at: string | null;
    monthly_plan_topic_id: string | null;
  }>;

  // Backfill de vínculo: peças antigas da pauta sem projeto passam a apontar
  // para o projeto da pauta (validação no backend, não só na UI).
  if (allPlanPosts.length > 0) {
    await sb
      .from("posts")
      .update({ project_id: projectId, pipeline_id: pipelineId } as never)
      .in(
        "id",
        allPlanPosts.map((p) => p.id),
      )
      .is("project_id", null);
  }

  if (allPlanPosts.length > 0) {
    const postIds = allPlanPosts.map((p) => p.id);
    const { data: existingTasks } = await sb.from("tasks").select("post_id").in("post_id", postIds);
    const withTask = new Set(
      ((existingTasks ?? []) as unknown as { post_id: string | null }[])
        .map((t) => t.post_id)
        .filter(Boolean) as string[],
    );

    const taskRows = allPlanPosts
      .filter((p) => !withTask.has(p.id))
      .map((p) => ({
        brand_id: args.brandId,
        client_id: args.clientId,
        project_id: projectId,
        post_id: p.id,
        title: `Produzir: ${(p.title ?? "Peça").trim()}`.slice(0, 200),
        description: "Tarefa criada automaticamente após a aprovação da pauta pelo cliente.",
        status: "todo",
        priority: "medium",
        // Prazo somente quando a peça já tem data de publicação definida.
        due_at: p.scheduled_at ?? null,
        created_by: args.userId,
      }));

    // Não bloqueia a materialização das peças caso a criação de tarefas falhe.
    if (taskRows.length > 0) await sb.from("tasks").insert(taskRows as never);

    // Tarefas antigas da pauta sem projeto herdam o projeto da pauta.
    await sb
      .from("tasks")
      .update({ project_id: projectId } as never)
      .in("post_id", postIds)
      .is("project_id", null);
  }

  // Orquestração dos agentes (agent_prompts): cada peça nova nasce com a
  // legenda produzida pelo cérebro. Idempotente — peças com copy são ignoradas.
  const newPostIds = ((insertedPosts ?? []) as unknown as { id: string }[]).map((p) => p.id);
  const emptyPlanPostIds = allPlanPosts.filter((p) => !(p.copy ?? "").trim()).map((p) => p.id);
  const toGenerate = Array.from(new Set([...newPostIds, ...emptyPlanPostIds]));
  if (toGenerate.length > 0) {
    const [{ waitUntil }, { generatePostsContentSequential }] = await Promise.all([
      import("@/lib/wait-until.server"),
      import("@/lib/post-agents.server"),
    ]);
    waitUntil(generatePostsContentSequential(toGenerate, { userId: args.userId }));
  }

  if (args.markPlanApproved !== false) {
    await sb
      .from("monthly_plans")
      .update({ status: "approved" } as never)
      .eq("id", args.planId);
  }

  return { created: rows.length, skipped: list.length - rows.length };
}
