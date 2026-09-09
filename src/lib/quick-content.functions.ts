/**
 * ROTA RÁPIDA — peça expressa (uma ideia em uma linha → peça já escrita).
 *
 * Encurta o caminho, sem fluxo paralelo:
 *  - limite de produção contratado aplicado pelo MESMO guard da criação manual
 *    (`checkManualScope`, que respeita a regra de escopo do cliente);
 *  - projeto obrigatório (a peça é execução de um projeto), como na pauta;
 *  - a legenda é escrita pelos MESMOS agentes de conteúdo (`post-agents`), com
 *    a peça nascendo no primeiro estágio de Produção — nunca agendada nem
 *    publicada, então a aprovação do cliente continua valendo adiante;
 *  - tarefa de produção criada junto, igual à materialização da pauta.
 *
 * Nada é privilegiado: todas as escritas usam o client do usuário (RLS).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PLAN_CHANNELS } from "@/lib/monthly-plan-fields";
import { CONTENT_FORMATS, type ContentFormat } from "@/lib/content-formats";

const QuickPostInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  projectId: z.string().uuid(),
  /** A ideia em uma linha — é o briefing interno da peça. */
  idea: z.string().trim().min(4).max(2000),
  /** Título opcional: sem ele, a própria ideia (encurtada) vira o título. */
  title: z.string().trim().max(160).optional(),
  channel: z.enum(PLAN_CHANNELS),
  format: z.custom<ContentFormat>(
    (v) => typeof v === "string" && (CONTENT_FORMATS as readonly string[]).includes(v),
    "formato inválido",
  ),
});

export type QuickPostResult = {
  postId: string;
  title: string;
  copy: string | null;
  /** Mensagem quando a redação falhou — a peça continua criada e retomável. */
  copyError: string | null;
};

function titleFromIdea(idea: string): string {
  const flat = idea.replace(/\s+/g, " ").trim();
  if (flat.length <= 80) return flat;
  return `${flat.slice(0, 77)}...`;
}

export const quickPostFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => QuickPostInput.parse(i))
  .handler(async ({ data, context }): Promise<QuickPostResult> => {
    const sb = context.supabase as unknown as SupabaseClient;

    // Escopo explícito: cliente e projeto precisam pertencer ao workspace.
    const { data: client } = await sb
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (!client) throw new Error("Cliente não pertence ao workspace informado.");
    const { data: project } = await sb
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!project) throw new Error("Projeto não pertence a este cliente.");

    // Limite de produção contratado (mesmo guard da criação manual).
    const { checkManualScope } = await import("@/lib/scope-manual.server");
    const scope = await checkManualScope(sb, {
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
    });
    if (scope.blocked) {
      throw new Error(
        `scope_limit_reached: limite de produção do mês atingido (${scope.used}/${scope.quota}). Solicite liberação em Produção.`,
      );
    }

    const { ensureDefaultPipeline } = await import("@/lib/monthly-plan-kanban.server");
    const pipelineId = await ensureDefaultPipeline(sb, data.brandId, data.clientId, context.userId);

    const { data: stages } = await sb
      .from("content_pipeline_stages")
      .select("id, position, is_terminal")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true });
    const stageList = (stages ?? []) as unknown as Array<{ id: string; is_terminal: boolean }>;
    const stage = stageList.find((s) => !s.is_terminal) ?? stageList[0];
    if (!stage) throw new Error("no_stage_available");

    const { data: maxPost } = await sb
      .from("posts")
      .select("position")
      .eq("stage_id", stage.id)
      .order("position", { ascending: false })
      .limit(1);
    const position =
      (((maxPost ?? [])[0] as { position: number } | undefined)?.position ?? -1) + 1024;

    const title = data.title?.trim() || titleFromIdea(data.idea);

    const { data: inserted, error: insErr } = await sb
      .from("posts")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        project_id: data.projectId,
        pipeline_id: pipelineId,
        stage_id: stage.id,
        stage: "idea",
        title,
        format: data.format,
        channels: [data.channel],
        internal_briefing: data.idea,
        position,
        created_by: context.userId,
        assignee_id: context.userId,
        assignees: [context.userId],
      } as never)
      .select("id")
      .single();
    if (insErr) throw insErr;
    const postId = (inserted as unknown as { id: string }).id;

    // Tarefa de produção — mesmo padrão da materialização da pauta.
    await sb.from("tasks").insert({
      brand_id: data.brandId,
      client_id: data.clientId,
      project_id: data.projectId,
      post_id: postId,
      title: `Produzir: ${title}`.slice(0, 200),
      description: "Tarefa criada automaticamente pela criação expressa de peça.",
      status: "todo",
      priority: "medium",
      created_by: context.userId,
    } as never);

    // Redação pelos agentes — aguardada, para a prévia já voltar pronta.
    let copyError: string | null = null;
    const { generatePostContent } = await import("@/lib/post-agents.server");
    try {
      const res = await generatePostContent(postId, { force: true, userId: context.userId });
      if (res.status === "failed") {
        copyError =
          res.kind === "provider_quota"
            ? "A cota da API de IA da marca foi atingida. A peça ficou pendente e pode ser retomada."
            : res.kind === "provider_rate_limit" || res.kind === "provider_unavailable"
              ? "O provedor de IA está indisponível agora. A peça ficou pendente e pode ser retomada."
              : `A geração falhou no agente ${res.agent}: ${res.error}`;
      }
    } catch (err) {
      copyError = err instanceof Error ? err.message : String(err);
    }

    const { data: finalRow } = await sb
      .from("posts")
      .select("copy, title")
      .eq("id", postId)
      .maybeSingle();
    const final = (finalRow ?? {}) as { copy: string | null; title: string | null };

    return {
      postId,
      title: final.title ?? title,
      copy: final.copy ?? null,
      copyError,
    };
  });

/** Progresso da redação das peças de uma pauta (rota rápida e retomadas). */
export const planCopyProgressFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: topics } = await context.supabase
      .from("monthly_plan_topics")
      .select("id")
      .eq("monthly_plan_id", data.planId);
    const topicIds = ((topics ?? []) as unknown as Array<{ id: string }>).map((t) => t.id);
    if (topicIds.length === 0) return { total: 0, written: 0, failed: 0, running: 0 };

    const { data: posts } = await context.supabase
      .from("posts")
      .select("id, copy, ai_phase")
      .in("monthly_plan_topic_id", topicIds);
    const list = (posts ?? []) as unknown as Array<{
      copy: string | null;
      ai_phase: string | null;
    }>;
    const written = list.filter((p) => (p.copy ?? "").trim().length > 0).length;
    const failed = list.filter(
      (p) => !(p.copy ?? "").trim() && String(p.ai_phase ?? "").startsWith("copy_failed"),
    ).length;
    return {
      total: list.length,
      written,
      failed,
      running: Math.max(0, list.length - written - failed),
    };
  });
