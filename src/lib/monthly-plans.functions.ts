import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { errorToMessage } from "@/lib/error-message";
import { brain, type BrainContext } from "@/lib/brain/api";
import { loadBriefingContext } from "@/lib/monthly-plan-context.server";
import { loadStrategyContext } from "@/lib/monthly-plan-strategy.server";
import { loadPerformanceContext } from "@/lib/monthly-plan-performance.server";
import { runPlanAgent } from "@/lib/monthly-plan-agent.server";
import { PLAN_CHANNELS, getWeeksInMonth, type PlanChannel } from "@/lib/monthly-plan-fields";
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABEL,
  describeDistribution,
  normalizeContentFormat,
  formatsForChannel,
  type ContentFormat,
} from "@/lib/content-formats";
import {
  createSlotAllocator,
  channelTotals,
  totalSlots,
  type ChannelFormatQuota,
} from "@/lib/monthly-plan-distribution";
import {
  canBypassOverage,
  currentPeriodMonth,
  loadApprovedOverage,
  resolveOveragePolicy,
} from "@/lib/plan-overage.server";
import {
  acquirePlanGenerationLock,
  releasePlanGenerationLock,
  startPlanLockHeartbeat,
} from "@/lib/monthly-plan-lock.server";
import { runPlanGeneration } from "@/lib/monthly-plan-generate.server";
import { countGeneratedThisMonth } from "@/lib/monthly-plan-generated-count.server";

/* ---------- Types ---------- */

export type MonthlyPlanStatus =
  | "draft"
  | "pending_client"
  | "client_approved"
  | "changes_requested"
  | "client_rejected"
  | "approved"
  | "archived";
export type MonthlyPlanTopicStatus = "pending" | "approved" | "rejected";
export type TopicClientStatus = "pending" | "approved" | "rejected" | "changes";

/** Códigos de falha "esperada" da geração — sempre com mensagem em pt-BR. */
export type GenerateFailureCode =
  | "ai_provider_not_configured"
  | "ai_provider_key_missing"
  | "ai_model_unavailable"
  | "ai_provider_quota"
  | "ai_provider_rate_limit"
  | "ai_provider_unavailable"
  | "ai_invalid_output"
  | "ai_output_truncated"
  | "ai_invalid_request"
  | "ai_generation_failed"
  | "incomplete_generation"
  | "generation_in_progress"
  | "briefing_version_invalid";

export type GenerateMonthlyPlanResult =
  | { ok: true; data: MonthlyPlanWithTopics; resumed?: boolean }
  | {
      ok: false;
      code: GenerateFailureCode;
      /** Falha transitória: a mesma geração pode ser retomada depois. */
      retryable?: boolean;
    }
  | {
      ok: false;
      code: "overage_not_authorized";
      overage: Array<{ channel: PlanChannel; quota: number; requested: number; overage: number }>;
    };

export type MonthlyPlan = {
  id: string;
  brand_id: string;
  client_id: string;
  input_theme: string | null;
  input_briefing_id: string | null;
  title: string;
  description: string | null;
  objectives: string | null;
  status: MonthlyPlanStatus;
  internal_approved_at: string | null;
  project_id?: string | null;
  internal_approved_by: string | null;
  client_decision_at: string | null;
  client_feedback: string | null;
  client_decision_mode?: string | null;

  /** Fontes cruzadas na geração (estratégia IA, métricas por canal, brain). */
  context_sources?: {
    model?: string;
    briefing_version_id?: string | null;
    strategy_blocks?: string[];
    strategy_generated_at?: string | null;
    metrics_channels?: string[];
    channels_without_account?: string[];
    brain_context?: boolean;
    agent?: string;
    generated_at?: string;
  } | null;
  created_at: string;
  updated_at: string;
};

export type MonthlyPlanTopic = {
  id: string;
  monthly_plan_id: string;
  topic_title: string;
  content_format: string | null;
  angle: string | null;
  channel: string | null;
  target_audience?: string | null;
  rationale?: string | null;
  status: MonthlyPlanTopicStatus;
  client_status?: TopicClientStatus;
  client_comment?: string | null;
  client_decision_at?: string | null;
  previous_title: string | null;
  previous_angle: string | null;
  position: number;
};

export type MonthlyPlanWithTopics = {
  plan: MonthlyPlan;
  topics: MonthlyPlanTopic[];
};

/** Itens só podem virar card quando têm plataforma e formato definidos. */
export function isTopicComplete(t: Pick<MonthlyPlanTopic, "channel" | "content_format">): boolean {
  return !!(t.channel && t.channel.trim() && t.content_format && t.content_format.trim());
}

/* ---------- Briefings dropdown ---------- */

export const listBriefingsForPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // FASE 2: as versões do briefing vivem em brand_briefing_versions.
    const { data: rows, error } = await context.supabase
      .from("brand_briefing_versions")
      .select("id, created_at, completion, origin")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (rows ?? []).map((r) => {
      const when = new Date(r.created_at as string).toLocaleString("pt-BR");
      const pct = r.completion == null ? "" : ` — ${r.completion}%`;
      return { id: r.id as string, label: `Versão ${when}${pct}` };
    });
  });

/* ---------- AI generation ---------- */

const GenerateInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  theme: z.string().trim().max(500).optional().default(""),
  briefingId: z.string().uuid().nullable().optional(),
  /** Seleção opcional do wizard: canais, quantidade e cotas por formato. */
  selection: z
    .array(
      z.object({
        channel: z.enum(PLAN_CHANNELS),
        quantity: z.number().int().min(1).max(60),
        /** Formatos permitidos (legado/compatibilidade). */
        formats: z.array(z.string()).default([]),
        /** Cota por formato canônico: { feed: 4, stories: 4, reels: 2 }. */
        formatQuotas: z.record(z.string(), z.number().int().min(0).max(60)).optional(),
      }),
    )
    .min(1)
    .optional(),
  /** Semanas de produção no mês-alvo (4 ou 5 conforme o calendário). */
  weeksPerMonth: z.number().int().min(1).max(6).optional(),
  /** Projeto da pauta: obrigatório e explícito (existente ou novo). */
  organization: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), projectId: z.string().uuid() }),
    z.object({
      mode: z.literal("new"),
      name: z.string().trim().min(1).max(120),
      description: z.string().max(2000).nullable().optional(),
      due_at: z.string().min(4).nullable().optional(),
    }),
  ]),
});

export const generateMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GenerateInput.parse(i))
  .handler(async ({ data, context }): Promise<GenerateMonthlyPlanResult> => {
    const period = currentPeriodMonth();
    // Trava server-side: uma geração por marca + cliente + período.
    const lock = await acquirePlanGenerationLock(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      period,
    });
    if ("conflict" in lock) return { ok: false, code: "generation_in_progress" };
    // Renova a lease durante toda a geração: o reaper só encerra jobs cuja
    // validade expirou de fato, nunca uma geração legítima em andamento.
    const stopHeartbeat = startPlanLockHeartbeat(context.supabase, lock);
    try {
      const result = await runPlanGeneration({
        supabase: context.supabase,
        userId: context.userId,
        input: data,
        period,
        jobId: lock.jobId,
      });
      await releasePlanGenerationLock(context.supabase, lock.jobId, {
        ok: result.ok,
        ...(result.ok ? { planId: result.data.plan.id } : { error: result.code }),
      });
      // Projeto resolvido só após a geração dar certo — nunca sobra projeto órfão.
      if (result.ok) {
        await linkPlanToProject(context.supabase as PlanSupabaseClient, {
          planId: result.data.plan.id,
          brandId: data.brandId,
          clientId: data.clientId,
          userId: context.userId,
          organization: data.organization,
        });
      }
      return result;
    } catch (err) {
      await releasePlanGenerationLock(context.supabase, lock.jobId, {
        ok: false,
        // Erros do PostgREST são objetos simples: `String(err)` gerava "[object Object]".
        error: errorToMessage(err) || "unknown_error",
      });
      throw err;
    } finally {
      stopHeartbeat();
    }
  });


/* ---------- Volumetria (pré-geração) ---------- */

export const getPlanVolumetryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    // Escopo explícito: o cliente precisa pertencer ao workspace informado.
    // A leitura passa por RLS, então um brand/cliente fora do acesso não resolve.
    const { data: owner } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .eq("brand_id", data.brandId)
      .maybeSingle();
    if (!owner) throw new Error("Cliente não pertence ao workspace informado.");

    // Usa o número real de semanas do mês corrente para exibir a cota correta.
    const now = new Date();
    const ctx = await loadBriefingContext(context.supabase, data.clientId, {
      weeksPerMonth: getWeeksInMonth(now.getFullYear(), now.getMonth()),
    });

    // Quantidade já gerada no mês corrente (todas as pautas do cliente).
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const generatedThisMonth = await countGeneratedThisMonth(
      context.supabase,
      data.clientId,
      monthStart,
    );
    const generatedTotal = PLAN_CHANNELS.reduce((s, c) => s + (generatedThisMonth[c] ?? 0), 0);
    const approvedOverage = await loadApprovedOverage(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
    });

    return {
      weekly: ctx.weekly,
      monthlyQuota: ctx.monthlyQuota,
      volumetryBasis: ctx.volumetryBasis,
      totalTarget: ctx.totalTarget,
      hasBriefing: ctx.text.trim().length > 0,
      formatsByChannel: ctx.formatsByChannel,
      /** canal → formato → quantidade MENSAL (fonte da distribuição da pauta). */
      formatQuota: ctx.formatQuota,
      /** canais com breakdown explícito salvo no briefing. */
      channelsWithBreakdown: ctx.channelsWithBreakdown,
      generatedThisMonth,
      generatedTotal,
      approvedOverage,
      /** `block` = excedente exige liberação; `warn` = volumetria livre. */
      overagePolicy: await resolveOveragePolicy(context.supabase, {
        brandId: data.brandId,
        clientId: data.clientId,
      }),
      /** Super Admin/Owner/Admin geram acima da cota sem pedir liberação. */
      canBypassOverage: await canBypassOverage(
        context.supabase,
        context.userId,
        data.brandId,
      ),
    };
  });

/* ---------- CRUD ---------- */

export type MonthlyPlanListItem = {
  id: string;
  title: string;
  status: MonthlyPlanStatus;
  created_at: string;
  created_by: string | null;
  author_name: string | null;
  topics_count: number;
};

export const listMonthlyPlansFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<MonthlyPlanListItem[]> => {
    const { data: rows, error } = await context.supabase
      .from("monthly_plans" as never)
      .select("id, title, status, created_at, created_by")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const list = (rows ?? []) as unknown as Array<{
      id: string;
      title: string;
      status: MonthlyPlanStatus;
      created_at: string;
      created_by: string | null;
    }>;
    if (list.length === 0) return [];

    const userIds = Array.from(
      new Set(list.map((r) => r.created_by).filter((v): v is string => !!v)),
    );
    const authorMap = new Map<string, string>();
    if (userIds.length) {
      const { data: profs } = await context.supabase
        .from("user_profiles")
        .select("id, full_name")
        .in("id", userIds);
      for (const p of profs ?? []) {
        authorMap.set(p.id as string, (p.full_name as string | null) ?? "");
      }
    }

    const planIds = list.map((r) => r.id);
    const countMap = new Map<string, number>();
    if (planIds.length) {
      const { data: tops } = await context.supabase
        .from("monthly_plan_topics" as never)
        .select("monthly_plan_id")
        .in("monthly_plan_id", planIds);
      for (const t of (tops ?? []) as Array<{ monthly_plan_id: string }>) {
        countMap.set(t.monthly_plan_id, (countMap.get(t.monthly_plan_id) ?? 0) + 1);
      }
    }

    return list.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      created_at: r.created_at,
      created_by: r.created_by,
      author_name: r.created_by ? authorMap.get(r.created_by) || null : null,
      topics_count: countMap.get(r.id) ?? 0,
    }));
  });

export const getMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<MonthlyPlanWithTopics | null> => {
    const { data: planRow } = await context.supabase
      .from("monthly_plans" as never)
      .select("*")
      .eq("id", data.planId)
      .maybeSingle();
    if (!planRow) return null;
    const { data: topics } = await context.supabase
      .from("monthly_plan_topics" as never)
      .select("*")
      .eq("monthly_plan_id", data.planId)
      .order("position", { ascending: true });
    return {
      plan: planRow as unknown as MonthlyPlan,
      topics: (topics ?? []) as unknown as MonthlyPlanTopic[],
    };
  });

export const updateMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        title: z.string().trim().min(1).max(240).optional(),
        description: z.string().max(4000).nullable().optional(),
        objectives: z.string().max(4000).nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description;
    if (data.objectives !== undefined) patch.objectives = data.objectives;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("monthly_plans" as never)
      .update(patch as never)
      .eq("id", data.planId);
    if (error) throw error;
    return { ok: true };
  });

export const createTopicFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        topic_title: z.string().trim().min(1).max(240),
        content_format: z.string().max(60).nullable().optional(),
        channel: z.string().max(40).nullable().optional(),
        angle: z.string().max(1000).optional().default(""),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<MonthlyPlanTopic> => {
    const { data: max } = await context.supabase
      .from("monthly_plan_topics" as never)
      .select("position")
      .eq("monthly_plan_id", data.planId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos =
      (((max as unknown as { position: number }[] | null)?.[0]?.position ?? -1) as number) + 1024;
    const { data: row, error } = await context.supabase
      .from("monthly_plan_topics" as never)
      .insert({
        monthly_plan_id: data.planId,
        topic_title: data.topic_title,
        // Fronteira de escrita: sempre chave canônica.
        content_format: data.content_format ? normalizeContentFormat(data.content_format) : null,
        channel: data.channel ?? null,
        angle: data.angle,
        status: "pending",
        position: nextPos,
      } as never)
      .select("*")
      .single();
    if (error) throw error;
    return row as unknown as MonthlyPlanTopic;
  });

export const updateTopicFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        topicId: z.string().uuid(),
        topic_title: z.string().trim().min(1).max(240).optional(),
        content_format: z.string().max(60).nullable().optional(),
        channel: z.string().max(40).nullable().optional(),
        angle: z.string().max(1000).nullable().optional(),
        status: z.enum(["pending", "approved", "rejected"]).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    for (const k of ["topic_title", "content_format", "channel", "angle", "status"] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    // Fronteira de escrita: sempre chave canônica.
    if (data.content_format !== undefined) {
      patch.content_format = data.content_format
        ? normalizeContentFormat(data.content_format)
        : null;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await context.supabase
      .from("monthly_plan_topics" as never)
      .update(patch as never)
      .eq("id", data.topicId);
    if (error) throw error;
    return { ok: true };
  });

/* ---------- Regeneração de um item específico ---------- */

const RegenSchema = z.object({
  topic_title: z.string(),
  angle: z.string(),
  // `.nullable()` sem `.optional()`: JSON Schema estrito (Groq/OpenAI) rejeita
  // o `not` gerado por campos opcionais.
  target_audience: z.string().nullable(),
  rationale: z.string().nullable(),
});


export const regenerateTopicFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        topicId: z.string().uuid(),
        instruction: z.string().trim().max(500).optional().default(""),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<MonthlyPlanTopic> => {
    const { data: topicRow, error: tErr } = await context.supabase
      .from("monthly_plan_topics" as never)
      .select("*")
      .eq("id", data.topicId)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!topicRow) throw new Error("topic_not_found");
    const topic = topicRow as unknown as MonthlyPlanTopic;

    const { data: planRow } = await context.supabase
      .from("monthly_plans" as never)
      .select("*")
      .eq("id", topic.monthly_plan_id)
      .maybeSingle();
    if (!planRow) throw new Error("plan_not_found");
    const plan = planRow as unknown as MonthlyPlan;

    const channel = (topic.channel ?? "").toString().toLowerCase();
    const planChannels = (PLAN_CHANNELS as readonly string[]).includes(channel)
      ? [channel as (typeof PLAN_CHANNELS)[number]]
      : [];

    const [{ data: siblings }, briefingCtx, strategy, performance] = await Promise.all([
      context.supabase
        .from("monthly_plan_topics" as never)
        .select("topic_title, id")
        .eq("monthly_plan_id", plan.id),
      loadBriefingContext(context.supabase, plan.client_id, {
        briefingId:
          plan.context_sources?.briefing_version_id ?? plan.input_briefing_id,
      }),
      loadStrategyContext(context.supabase, plan.brand_id, plan.client_id).catch((err: unknown) => {
        console.warn("[monthly-plan] strategy context failed", err);
        return null;
      }),
      planChannels.length
        ? loadPerformanceContext(context.supabase, {
            brandId: plan.brand_id,
            clientId: plan.client_id,
            channels: planChannels,
            cacheScopeToken: context.userId,
          }).catch((err: unknown) => {
            console.warn("[monthly-plan] performance context failed", err);
            return null;
          })
        : Promise.resolve(null),
    ]);
    const others = ((siblings ?? []) as Array<{ id: string; topic_title: string }>)
      .filter((s) => s.id !== topic.id)
      .map((s) => `- ${s.topic_title}`)
      .join("\n");

    const audienceOptions = [
      ...(strategy?.personaNames ?? []),
      ...(strategy?.cohortNames ?? []),
    ].filter(Boolean);

    const extraContext = [
      strategy?.markdown,
      performance?.markdown,
      `## Briefing consolidado do cliente\n${briefingCtx.text.slice(0, 8000)}`,
    ]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join("\n\n");

    const prompt = [
      `Você é um estrategista de conteúdo sênior.`,
      `Reescreva UMA ideia de post de uma pauta mensal, em português (Brasil).`,
      `Cruze a estratégia IA ativa, o desempenho real do canal e o briefing.`,
      ``,
      `# Pauta`,
      `Título: ${plan.title}`,
      plan.description ? `Contexto: ${plan.description}` : "",
      plan.objectives ? `Objetivos: ${plan.objectives}` : "",
      plan.input_theme ? `Tema do mês: ${plan.input_theme}` : "",
      ``,
      `# Item atual`,
      `Título: ${topic.topic_title}`,
      `Gancho: ${topic.angle ?? "—"}`,
      `Plataforma (NÃO alterar): ${topic.channel ?? "—"}`,
      `Formato (NÃO alterar): ${topic.content_format ?? "—"}`,
      data.instruction ? `\n# O que mudar (pedido do usuário)\n${data.instruction}` : "",
      ``,
      `# Outras ideias da pauta (NÃO repetir temas)`,
      others || "—",
      ``,
      `Regras:`,
      `- Mantenha a mesma plataforma e o mesmo formato.`,
      `- topic_title: título curto e criativo, diferente do atual.`,
      `- angle: gancho estratégico / direcionamento de produção (1-2 frases).`,
      audienceOptions.length
        ? `- target_audience: persona ou cohort da estratégia ativa (${audienceOptions.slice(0, 8).join(", ")}).`
        : `- target_audience: público-alvo principal derivado do briefing.`,
      `- rationale: 1 frase citando a evidência usada (métrica do canal, briefing ou estratégia).`,
      `- Sem markdown. Retorne EXATAMENTE um objeto JSON no schema.`,
    ]
      .filter(Boolean)
      .join("\n");

    const { output: parsed } = await runPlanAgent({
      agent: "content.generate",
      supabase: context.supabase,
      brandId: plan.brand_id,
      clientId: plan.client_id,
      userId: context.userId,
      prompt,
      extraContext,
      schema: RegenSchema,
    });

    const { data: updated, error: uErr } = await context.supabase
      .from("monthly_plan_topics" as never)
      .update({
        topic_title: parsed.topic_title.slice(0, 240),
        angle: parsed.angle.slice(0, 1000),
        target_audience:
          (parsed.target_audience ?? "").toString().trim().slice(0, 240) ||
          (topic as { target_audience?: string | null }).target_audience ||
          null,
        rationale: (parsed.rationale ?? "").toString().trim().slice(0, 600) || null,
        previous_title: topic.topic_title,
        previous_angle: topic.angle,
        status: "pending",
      } as never)
      .eq("id", topic.id)
      .select("*")
      .single();
    if (uErr) throw uErr;
    return updated as unknown as MonthlyPlanTopic;
  });

export const undoTopicRegenerationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ topicId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<MonthlyPlanTopic> => {
    const { data: row } = await context.supabase
      .from("monthly_plan_topics" as never)
      .select("*")
      .eq("id", data.topicId)
      .maybeSingle();
    if (!row) throw new Error("topic_not_found");
    const topic = row as unknown as MonthlyPlanTopic;
    if (!topic.previous_title) throw new Error("no_previous_version");
    const { data: updated, error } = await context.supabase
      .from("monthly_plan_topics" as never)
      .update({
        topic_title: topic.previous_title,
        angle: topic.previous_angle,
        previous_title: null,
        previous_angle: null,
      } as never)
      .eq("id", topic.id)
      .select("*")
      .single();
    if (error) throw error;
    return updated as unknown as MonthlyPlanTopic;
  });

/* ---------- Aprovação interna (item por item) ---------- */

export const setTopicDecisionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        topicId: z.string().uuid(),
        status: z.enum(["pending", "approved", "rejected"]),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    if (data.status === "approved") {
      const { data: row } = await context.supabase
        .from("monthly_plan_topics" as never)
        .select("channel, content_format")
        .eq("id", data.topicId)
        .maybeSingle();
      const t = (row ?? {}) as { channel: string | null; content_format: string | null };
      if (!isTopicComplete(t)) throw new Error("topic_incomplete");
    }
    const { error } = await context.supabase
      .from("monthly_plan_topics" as never)
      .update({ status: data.status } as never)
      .eq("id", data.topicId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteTopicFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ topicId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("monthly_plan_topics" as never)
      .delete()
      .eq("id", data.topicId);
    if (error) throw error;
    return { ok: true };
  });

export const discardMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("monthly_plans" as never)
      .update({ status: "archived" } as never)
      .eq("id", data.planId);
    if (error) throw error;
    return { ok: true };
  });

/* ---------- Envio ao cliente ---------- */

function randomToken(len = 40): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

export type PlanClientLink = {
  token: string;
  url: string;
  expires_at: string | null;
};

export const submitPlanToClientFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        expiresInDays: z.number().int().min(1).max(90).default(14),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PlanClientLink> => {
    const { data: planRow } = await context.supabase
      .from("monthly_plans" as never)
      .select("id, brand_id, client_id, status, title, project_id")
      .eq("id", data.planId)
      .maybeSingle();
    if (!planRow) throw new Error("plan_not_found");
    const plan = planRow as unknown as {
      id: string;
      brand_id: string;
      client_id: string;
      status: MonthlyPlanStatus;
      title: string | null;
      project_id: string | null;
    };

    // Projeto é obrigatório e explícito: nada é gravado antes dessa checagem.
    if (!plan.project_id) throw new Error("project_required");

    const { data: topics } = await context.supabase
      .from("monthly_plan_topics" as never)
      .select("id, status, channel, content_format")
      .eq("monthly_plan_id", plan.id);
    const list = (topics ?? []) as unknown as MonthlyPlanTopic[];
    if (list.length === 0) throw new Error("plan_has_no_topics");
    if (list.some((t) => t.status === "pending")) throw new Error("topics_pending_decision");
    const approved = list.filter((t) => t.status === "approved");
    if (approved.length === 0) throw new Error("no_approved_topics");
    if (approved.some((t) => !isTopicComplete(t))) throw new Error("topics_incomplete");


    // Reaproveita um link válido, se existir.
    const { data: existing } = await context.supabase
      .from("monthly_plan_tokens" as never)
      .select("token, expires_at, revoked_at")
      .eq("monthly_plan_id", plan.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const found = (existing ?? [])[0] as { token: string; expires_at: string | null } | undefined;

    let token = found?.token ?? null;
    let expiresAt = found?.expires_at ?? null;
    if (!token || (expiresAt && new Date(expiresAt).getTime() < Date.now())) {
      token = randomToken(40);
      expiresAt = new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString();
      const { error: insErr } = await context.supabase.from("monthly_plan_tokens" as never).insert({
        monthly_plan_id: plan.id,
        brand_id: plan.brand_id,
        client_id: plan.client_id,
        token,
        expires_at: expiresAt,
        created_by: context.userId,
      } as never);
      if (insErr) throw insErr;
    }

    const { error: upErr } = await context.supabase
      .from("monthly_plans" as never)
      .update({
        status: "pending_client",
        internal_approved_at: new Date().toISOString(),
        internal_approved_by: context.userId,
        client_decision_at: null,
        client_feedback: null,
        client_decision_mode: null,
      } as never)
      .eq("id", plan.id);
    if (upErr) throw upErr;

    // Reenvio: limpa decisões anteriores dos itens que ainda não viraram card.
    await context.supabase
      .from("monthly_plan_topics" as never)
      .update({ client_status: "pending", client_comment: null, client_decision_at: null } as never)
      .eq("monthly_plan_id", plan.id)
      .neq("client_status", "approved");

    // Reconcilia o vínculo do projeto já escolhido (nunca cria projeto sozinho).
    const { reconcilePlanProjectLink } = await import("@/lib/monthly-plan-project.server");
    await reconcilePlanProjectLink(context.supabase as never, {
      planId: plan.id,
      projectId: plan.project_id,
    });

    return { token, url: `/pauta/${plan.id}?token=${token}`, expires_at: expiresAt };
  });

/** Reconcilia o vínculo pauta ↔ projeto já escolhido. Não cria projeto. */
export const ensurePlanProjectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ projectId: string | null; created: boolean }> => {
    const { data: planRow } = await context.supabase
      .from("monthly_plans" as never)
      .select("id, project_id")
      .eq("id", data.planId)
      .maybeSingle();
    if (!planRow) throw new Error("plan_not_found");
    const plan = planRow as unknown as { id: string; project_id: string | null };
    if (!plan.project_id) throw new Error("project_required");

    const { reconcilePlanProjectLink } = await import("@/lib/monthly-plan-project.server");
    await reconcilePlanProjectLink(context.supabase as never, {
      planId: plan.id,
      projectId: plan.project_id,
    });
    return { projectId: plan.project_id, created: false };
  });



export const getPlanClientLinkFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<PlanClientLink | null> => {
    const { data: rows } = await context.supabase
      .from("monthly_plan_tokens" as never)
      .select("token, expires_at")
      .eq("monthly_plan_id", data.planId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = (rows ?? [])[0] as { token: string; expires_at: string | null } | undefined;
    if (!row) return null;
    return {
      token: row.token,
      url: `/pauta/${data.planId}?token=${row.token}`,
      expires_at: row.expires_at,
    };
  });

/* ---------- Approve → Kanban (após aprovação do cliente) ---------- */

export const approveMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ created: number }> => {
    const { materializePlanToKanban } = await import("@/lib/monthly-plan-kanban.server");
    const { data: planRow, error: planErr } = await context.supabase
      .from("monthly_plans" as never)
      .select("id, brand_id, status")
      .eq("id", data.planId)
      .maybeSingle();
    if (planErr) throw planErr;
    if (!planRow) throw new Error("plan_not_found");
    const planStatus = (planRow as unknown as { status: MonthlyPlanStatus }).status;
    if (planStatus !== "client_approved" && planStatus !== "changes_requested") {
      throw new Error("client_approval_required");
    }

    const res = await materializePlanToKanban(
      context.supabase as unknown as import("@supabase/supabase-js").SupabaseClient,
      {
        planId: data.planId,
        brandId: data.brandId,
        clientId: data.clientId,
        userId: context.userId,
        markPlanApproved: planStatus === "client_approved",
      },
    );

    return { created: res.created };
  });

/* ================================================================
 * Organização operacional: PROJETO → TAREFA → SUBTAREFA / PAUTA
 * ----------------------------------------------------------------
 * A pauta (monthly_plans) já possui `project_id`, e `projects` possui
 * `monthly_plan_id`. Os dois lados são mantidos em sincronia aqui —
 * nenhuma tabela nova é criada e nenhum projeto é criado sem intenção
 * explícita do usuário.
 * ============================================================== */

/** Estados canônicos usados pelos filtros da dashboard de pautas. */
export const PLAN_ARCHIVE_FILTERS = ["active", "archived", "all"] as const;
export type PlanArchiveFilter = (typeof PLAN_ARCHIVE_FILTERS)[number];

export type PlanProjectOption = {
  id: string;
  name: string;
  status: string;
  linkedPlanId: string | null;
};

/** Projetos ATIVOS do contexto atual (brand + cliente) para vincular pautas. */
export const listPlanProjectOptionsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        includeArchived: z.boolean().optional().default(false),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PlanProjectOption[]> => {
    let q = context.supabase
      .from("projects")
      .select("id, name, status, monthly_plan_id")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("name", { ascending: true })
      .limit(200);
    if (!data.includeArchived) q = q.neq("status", "archived");
    const { data: rows, error } = await q;
    if (error) throw error;
    return (
      (rows ?? []) as unknown as Array<{
        id: string;
        name: string;
        status: string;
        monthly_plan_id: string | null;
      }>
    ).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      linkedPlanId: r.monthly_plan_id,
    }));
  });

/** Cliente Supabase autenticado injetado pelo middleware. */
type PlanSupabaseClient = SupabaseClient<Database>;

const PlanOrganization = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("existing"), projectId: z.string().uuid() }),
  z.object({
    mode: z.literal("new"),
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).nullable().optional(),
    due_at: z.string().min(4).nullable().optional(),
  }),
]);
export type PlanOrganizationInput = z.infer<typeof PlanOrganization>;

/**
 * Resolve a organização escolhida pelo usuário em um `project_id`.
 * `none` nunca cria projeto. `existing` valida o escopo brand+cliente.
 */
async function resolveProjectForPlan(
  supabase: PlanSupabaseClient,
  args: {
    brandId: string;
    clientId: string;
    userId: string | null;
    organization: PlanOrganizationInput;
  },
): Promise<string | null> {
  const { organization: org } = args;
  if (org.mode === "none") return null;

  if (org.mode === "existing") {
    const { data: row } = await supabase
      .from("projects")
      .select("id")
      .eq("id", org.projectId)
      .eq("brand_id", args.brandId)
      .eq("client_id", args.clientId)
      .maybeSingle();
    if (!row) throw new Error("project_not_in_scope");
    return (row as { id: string }).id;
  }

  const { data: created, error } = await supabase
    .from("projects")
    .insert({
      brand_id: args.brandId,
      client_id: args.clientId,
      name: org.name,
      description: org.description ?? null,
      status: "active",
      color: "#8b5cf6",
      owner_id: args.userId,
      due_at: org.due_at ?? null,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return (created as { id: string }).id;
}

/**
 * Resolve a organização escolhida e grava o vínculo nos dois lados.
 * Usado pela geração por IA, onde o projeto é resolvido após o sucesso.
 */
async function linkPlanToProject(
  supabase: PlanSupabaseClient,
  args: {
    planId: string;
    brandId: string;
    clientId: string;
    userId: string | null;
    organization: PlanOrganizationInput;
  },
): Promise<string | null> {
  const projectId = await resolveProjectForPlan(supabase, {
    brandId: args.brandId,
    clientId: args.clientId,
    userId: args.userId,
    organization: args.organization,
  });
  if (!projectId) return null;
  const { error } = await supabase
    .from("monthly_plans")
    .update({ project_id: projectId } as never)
    .eq("id", args.planId);
  if (error) throw error;
  await supabase
    .from("projects")
    .update({ monthly_plan_id: args.planId } as never)
    .eq("id", projectId)
    .is("monthly_plan_id", null);
  return projectId;
}

/** Criação manual de pauta — fluxo único, com organização explícita. */
export const createMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        title: z.string().trim().min(1).max(240),
        description: z.string().max(4000).nullable().optional(),
        objectives: z.string().max(4000).nullable().optional(),
        organization: PlanOrganization,
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ planId: string; projectId: string | null }> => {
    // Projeto obrigatório na criação: existente ou novo, nunca "nenhum".
    if (data.organization.mode === "none") throw new Error("project_required");

    const projectId = await resolveProjectForPlan(context.supabase as PlanSupabaseClient, {
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      organization: data.organization,
    });


    const { data: row, error } = await context.supabase
      .from("monthly_plans" as never)
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        title: data.title,
        description: data.description ?? null,
        objectives: data.objectives ?? null,
        status: "draft",
        created_by: context.userId,
        project_id: projectId,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    const planId = (row as unknown as { id: string }).id;

    if (projectId) {
      // Mantém o lado `projects.monthly_plan_id` coerente quando ainda está livre.
      await context.supabase
        .from("projects")
        .update({ monthly_plan_id: planId } as never)
        .eq("id", projectId)
        .is("monthly_plan_id", null);
    }
    return { planId, projectId };
  });

/** Vincula/desvincula a pauta a um projeto (sem criar projeto involuntário). */
export const setPlanProjectFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        organization: PlanOrganization,
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ projectId: string | null }> => {
    const { data: planRow } = await context.supabase
      .from("monthly_plans" as never)
      .select("id, brand_id, client_id, project_id")
      .eq("id", data.planId)
      .maybeSingle();
    if (!planRow) throw new Error("plan_not_found");
    const plan = planRow as unknown as {
      id: string;
      brand_id: string;
      client_id: string;
      project_id: string | null;
    };
    if (plan.brand_id !== data.brandId || plan.client_id !== data.clientId) {
      throw new Error("plan_not_in_scope");
    }

    const projectId = await resolveProjectForPlan(context.supabase as PlanSupabaseClient, {
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      organization: data.organization,
    });

    const { error } = await context.supabase
      .from("monthly_plans" as never)
      .update({ project_id: projectId } as never)
      .eq("id", data.planId);
    if (error) throw error;

    // Espelha o vínculo no projeto novo e libera o antigo, quando era exclusivo.
    if (plan.project_id && plan.project_id !== projectId) {
      await context.supabase
        .from("projects")
        .update({ monthly_plan_id: null } as never)
        .eq("id", plan.project_id)
        .eq("monthly_plan_id", data.planId);
    }
    if (projectId) {
      await context.supabase
        .from("projects")
        .update({ monthly_plan_id: data.planId } as never)
        .eq("id", projectId)
        .is("monthly_plan_id", null);
    }
    return { projectId };
  });

/** Arquiva a pauta: sai da operação ativa, nada é apagado. */
export const archiveMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("monthly_plans" as never)
      .update({ status: "archived" } as never)
      .eq("id", data.planId);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Restaura a pauta para a operação ativa. O status de volta é derivado do
 * histórico real da própria pauta (não é uma string arbitrária de UI).
 */
export const restoreMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ planId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ status: MonthlyPlanStatus }> => {
    const { data: row } = await context.supabase
      .from("monthly_plans" as never)
      .select("id, internal_approved_at, client_decision_at, client_decision_mode")
      .eq("id", data.planId)
      .maybeSingle();
    if (!row) throw new Error("plan_not_found");
    const plan = row as unknown as {
      internal_approved_at: string | null;
      client_decision_at: string | null;
      client_decision_mode: string | null;
    };
    const status: MonthlyPlanStatus = plan.client_decision_at
      ? "approved"
      : plan.internal_approved_at
        ? "pending_client"
        : "draft";
    const { error } = await context.supabase
      .from("monthly_plans" as never)
      .update({ status } as never)
      .eq("id", data.planId);
    if (error) throw error;
    return { status };
  });

/* ---------- Dashboard de pautas ---------- */

export type PlanBoardItem = {
  id: string;
  title: string;
  status: MonthlyPlanStatus;
  created_at: string;
  author_name: string | null;
  topics_count: number;
  topics_approved: number;
  posts_count: number;
  project: { id: string; name: string; status: string } | null;
  /** Tarefas do projeto da pauta (execução operacional real). */
  tasks: { total: number; open: number; primary: string | null };
};

export type PlanBoard = {
  items: PlanBoardItem[];
  summary: {
    active: number;
    inProduction: number;
    withClient: number;
    archived: number;
  };
  projects: Array<{ id: string; name: string; status: string }>;
  /** Autoridade do usuário atual para excluir pautas definitivamente. */
  canDelete: boolean;
};

/**
 * Exclusão definitiva da pauta. Só Owner/Admin/Super Admin; recusada quando a
 * pauta já gerou peças de conteúdo (nesse caso o caminho correto é arquivar).
 */
export const deleteMonthlyPlanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        planId: z.string().uuid(),
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { deletePlanHard } = await import("@/lib/monthly-plan-delete.server");
    return deletePlanHard(context.supabase as unknown as SupabaseClient, {
      planId: data.planId,
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
    });
  });

/** Autoridade do usuário atual para excluir pautas do workspace. */
export const canDeletePlansFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ brandId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ canDelete: boolean }> => {
    const { isBrandAdmin } = await import("@/lib/monthly-plan-delete.server");
    return {
      canDelete: await isBrandAdmin(
        context.supabase as unknown as SupabaseClient,
        context.userId,
        data.brandId,
      ),
    };
  });


/** Listagem da dashboard de pautas, escopada em brand + cliente. */
export const listPlanBoardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        archive: z.enum(PLAN_ARCHIVE_FILTERS).default("active"),
        projectId: z.string().uuid().nullable().optional(),
        /** "none" = pautas sem projeto. */
        withoutProject: z.boolean().optional().default(false),
        q: z.string().max(200).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<PlanBoard> => {
    const { data: allRows, error } = await context.supabase
      .from("monthly_plans" as never)
      .select("id, title, status, created_at, created_by, project_id")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    const all = (allRows ?? []) as unknown as Array<{
      id: string;
      title: string;
      status: MonthlyPlanStatus;
      created_at: string;
      created_by: string | null;
      project_id: string | null;
    }>;

    const summary = {
      active: all.filter((p) => p.status !== "archived").length,
      inProduction: all.filter((p) => p.status === "approved").length,
      withClient: all.filter((p) => p.status === "pending_client").length,
      archived: all.filter((p) => p.status === "archived").length,
    };

    let rows = all;
    if (data.archive === "active") rows = rows.filter((p) => p.status !== "archived");
    else if (data.archive === "archived") rows = rows.filter((p) => p.status === "archived");
    if (data.withoutProject) rows = rows.filter((p) => !p.project_id);
    else if (data.projectId) rows = rows.filter((p) => p.project_id === data.projectId);
    const term = (data.q ?? "").trim().toLowerCase();
    if (term) rows = rows.filter((p) => (p.title ?? "").toLowerCase().includes(term));

    // Projetos do contexto (para o filtro e para os rótulos de hierarquia).
    const { data: projectRows } = await context.supabase
      .from("projects")
      .select("id, name, status")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("name", { ascending: true })
      .limit(200);
    const projects = (projectRows ?? []) as unknown as Array<{
      id: string;
      name: string;
      status: string;
    }>;
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    const { isBrandAdmin } = await import("@/lib/monthly-plan-delete.server");
    const canDelete = await isBrandAdmin(
      context.supabase as unknown as SupabaseClient,
      context.userId,
      data.brandId,
    );

    if (rows.length === 0) return { items: [], summary, projects, canDelete };


    const planIds = rows.map((r) => r.id);

    const authorMap = new Map<string, string>();
    const userIds = Array.from(
      new Set(rows.map((r) => r.created_by).filter((v): v is string => !!v)),
    );
    if (userIds.length) {
      const { data: profs } = await context.supabase
        .from("user_profiles")
        .select("id, full_name")
        .in("id", userIds);
      for (const p of profs ?? []) {
        authorMap.set(p.id as string, (p.full_name as string | null) ?? "");
      }
    }

    // Tópicos da pauta (unidade editorial).
    const topicTotals = new Map<string, { total: number; approved: number }>();
    const { data: topicRows } = await context.supabase
      .from("monthly_plan_topics" as never)
      .select("id, monthly_plan_id, status")
      .in("monthly_plan_id", planIds);
    const topics = (topicRows ?? []) as unknown as Array<{
      id: string;
      monthly_plan_id: string;
      status: string | null;
    }>;
    for (const t of topics) {
      const cur = topicTotals.get(t.monthly_plan_id) ?? { total: 0, approved: 0 };
      cur.total += 1;
      if (t.status === "approved") cur.approved += 1;
      topicTotals.set(t.monthly_plan_id, cur);
    }

    // Peças geradas a partir dos tópicos (rastreabilidade pauta → post).
    const postsByPlan = new Map<string, number>();
    const topicToPlan = new Map(topics.map((t) => [t.id, t.monthly_plan_id]));
    if (topics.length) {
      const { data: postRows } = await context.supabase
        .from("posts")
        .select("id, monthly_plan_topic_id")
        .eq("brand_id", data.brandId)
        .in("monthly_plan_topic_id", Array.from(topicToPlan.keys()));
      for (const p of (postRows ?? []) as unknown as Array<{
        monthly_plan_topic_id: string | null;
      }>) {
        const planId = p.monthly_plan_topic_id
          ? topicToPlan.get(p.monthly_plan_topic_id)
          : undefined;
        if (planId) postsByPlan.set(planId, (postsByPlan.get(planId) ?? 0) + 1);
      }
    }

    // Tarefas do projeto vinculado (Projeto → Tarefa).
    const taskAgg = new Map<string, { total: number; open: number; primary: string | null }>();
    const linkedProjectIds = Array.from(
      new Set(rows.map((r) => r.project_id).filter((v): v is string => !!v)),
    );
    if (linkedProjectIds.length) {
      const { data: taskRows } = await context.supabase
        .from("tasks")
        .select("id, title, status, project_id, created_at")
        .eq("brand_id", data.brandId)
        .in("project_id", linkedProjectIds)
        .order("created_at", { ascending: true });
      for (const t of (taskRows ?? []) as unknown as Array<{
        title: string;
        status: string | null;
        project_id: string | null;
      }>) {
        if (!t.project_id) continue;
        const cur = taskAgg.get(t.project_id) ?? { total: 0, open: 0, primary: null };
        cur.total += 1;
        const open = String(t.status ?? "") !== "done";
        if (open) cur.open += 1;
        if (!cur.primary && open) cur.primary = t.title;
        taskAgg.set(t.project_id, cur);
      }
    }

    const items: PlanBoardItem[] = rows.map((r) => {
      const project = r.project_id ? (projectMap.get(r.project_id) ?? null) : null;
      const tCount = topicTotals.get(r.id) ?? { total: 0, approved: 0 };
      const tasks = (r.project_id ? taskAgg.get(r.project_id) : null) ?? {
        total: 0,
        open: 0,
        primary: null,
      };
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        created_at: r.created_at,
        author_name: r.created_by ? authorMap.get(r.created_by) || null : null,
        topics_count: tCount.total,
        topics_approved: tCount.approved,
        posts_count: postsByPlan.get(r.id) ?? 0,
        project: project ? { id: project.id, name: project.name, status: project.status } : null,
        tasks,
      };
    });

    return { items, summary, projects, canDelete };
  });
