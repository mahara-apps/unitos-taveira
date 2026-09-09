import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { MediaPlan } from "./media-plans.functions";
import type { GeneratedCampaign, GeneratedPlan } from "./media-plan/plan-schema";

const uuid = z.string().uuid();

const InterviewSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]).optional());

const FunnelSchema = z
  .object({ topo: z.number(), meio: z.number(), fundo: z.number() })
  .nullable()
  .optional();

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta Ads", google: "Google Ads" };

function campaignToItemRow(
  planId: string,
  c: GeneratedCampaign,
  position: number,
  monthlyBudget: number,
) {
  const amount = (monthlyBudget * c.budget_pct) / 100;
  return {
    plan_id: planId,
    position,
    product_service: c.name,
    campaign_type: c.campaign_type,
    funnel_stage: c.funnel_stage,
    objective: c.objective,
    main_kpi: c.main_kpi,
    channel: PLATFORM_LABEL[c.platform] ?? c.platform,
    audience: c.audience,
    budget_pct: c.budget_pct,
    keywords: c.keywords,
    other_refs: c.targeting_notes || null,
    platform: c.platform,
    campaign_subtype: c.campaign_subtype,
    optimization_goal: c.optimization_goal,
    conversion_event: c.conversion_event,
    daily_budget: Math.round((amount / 30) * 100) / 100,
    targeting: { notes: c.targeting_notes, negative_keywords: c.negative_keywords },
    placements: c.placements,
    creative_brief: c.creative,
    estimates: c.estimates,
    prerequisites: c.prerequisites,
    rationale: c.rationale,
  };
}

function strategyPayload(plan: GeneratedPlan, modelId: string) {
  return {
    summary: plan.summary,
    platform_split_rationale: plan.platform_split_rationale,
    funnel_split: plan.funnel_split,
    funnel_rationale: plan.funnel_rationale,
    warnings: plan.warnings,
    generated_at: new Date().toISOString(),
    model: modelId,
  };
}

/**
 * Cria o plano de mídia a partir da entrevista guiada: gera a estratégia com o
 * agente especialista, grava o plano e as campanhas executáveis.
 */
export const createMediaPlanFromInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        brandId: uuid,
        clientId: uuid,
        title: z.string().min(1).max(200),
        period_start: z.string().nullable().optional(),
        period_end: z.string().nullable().optional(),
        monthlyBudget: z.number().positive(),
        interview: InterviewSchema,
        funnelSplit: FunnelSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { generateMediaPlanStrategy } = await import("./media-plan-agent.server");
    const { plan: generated, modelId } = await generateMediaPlanStrategy({
      supabase: context.supabase,
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      monthlyBudget: data.monthlyBudget,
      interview: data.interview,
      funnelSplit: data.funnelSplit ?? null,
    });

    const { data: row, error } = await context.supabase
      .from("media_plans")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        title: data.title,
        period_start: data.period_start ?? null,
        period_end: data.period_end ?? null,
        monthly_budget: data.monthlyBudget,
        interview: data.interview,
        strategy: strategyPayload(generated, modelId),
        plan_version: 1,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const plan = row as MediaPlan;

    const rows = generated.campaigns.map((c, i) =>
      campaignToItemRow(plan.id, c, i, data.monthlyBudget),
    );
    if (rows.length > 0) {
      const { error: itemsErr } = await context.supabase.from("media_plan_items").insert(rows);
      if (itemsErr) throw new Error(itemsErr.message);
    }

    return { plan, campaigns: generated.campaigns.length };
  });

/**
 * Regera a estratégia de um plano existente: reaproveita a entrevista salva,
 * aceita um ajuste em texto livre e substitui as campanhas geradas.
 */
export const regenerateMediaPlanStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        planId: uuid,
        refinement: z.string().max(1000).nullable().optional(),
        funnelSplit: FunnelSchema,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: current, error: readErr } = await context.supabase
      .from("media_plans")
      .select("id, brand_id, client_id, monthly_budget, interview, plan_version")
      .eq("id", data.planId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("plan_not_found");

    const interview = (current.interview ?? {}) as Record<string, string | string[] | undefined>;
    if (Object.keys(interview).length === 0) {
      throw new Error("Este plano não tem entrevista salva. Crie um novo plano com a entrevista.");
    }

    const { generateMediaPlanStrategy } = await import("./media-plan-agent.server");
    const { plan: generated, modelId } = await generateMediaPlanStrategy({
      supabase: context.supabase,
      brandId: String(current.brand_id),
      clientId: String(current.client_id),
      userId: context.userId,
      monthlyBudget: Number(current.monthly_budget) || 0,
      interview,
      funnelSplit: data.funnelSplit ?? null,
      refinement: data.refinement ?? null,
    });

    const { error: delErr } = await context.supabase
      .from("media_plan_items")
      .delete()
      .eq("plan_id", data.planId);
    if (delErr) throw new Error(delErr.message);

    const rows = generated.campaigns.map((c, i) =>
      campaignToItemRow(data.planId, c, i, Number(current.monthly_budget) || 0),
    );
    if (rows.length > 0) {
      const { error: itemsErr } = await context.supabase.from("media_plan_items").insert(rows);
      if (itemsErr) throw new Error(itemsErr.message);
    }

    const { error: updErr } = await context.supabase
      .from("media_plans")
      .update({
        strategy: strategyPayload(generated, modelId),
        plan_version: (Number(current.plan_version) || 1) + 1,
      })
      .eq("id", data.planId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, campaigns: generated.campaigns.length };
  });
