import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertBrandAdmin, assertBrandMember, assertClientInBrand } from "@/lib/access-guard";
import { getBrandAiModel } from "./ai-provider.server";
import { generateText } from "ai";
import { renderPrompt } from "./agent-variables";

export type AgentPromptRow = {
  agent_id: string;
  agent_name: string;
  required_fields: string[] | null;
  /** Prompt customizado que a marca criou (visível ao usuário). Nunca contém o prompt original da Unitos. */
  override_prompt: string | null;
  has_override: boolean;
  updated_at: string;
};

export type AgentJobRow = {
  id: string;
  kind: string;
  title: string | null;
  status: string;
  progress: number | null;
  step_label: string | null;
  error: string | null;
  client_id: string | null;
  brand_id: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

/**
 * Lista o catálogo de agentes sem NUNCA expor o system prompt original
 * (que é propriedade intelectual da Unitos). Retorna apenas o override
 * da marca, quando houver — o prompt que o usuário mesmo criou.
 */
export const listAgentPromptsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid().nullable().optional() }).parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<AgentPromptRow[]> => {
    if (data.brandId) {
      await assertBrandMember(context.supabase as never, context.userId, data.brandId);
    }
    const { data: catalog, error } = await context.supabase.rpc("list_agent_catalog");
    if (error) throw error;

    const overridesByAgent = new Map<string, { system_prompt: string; updated_at: string }>();
    if (data.brandId) {
      const { data: ovs, error: ovErr } = await context.supabase
        .from("agent_prompt_overrides")
        .select("agent_id, system_prompt, updated_at")
        .eq("brand_id", data.brandId);
      if (ovErr) throw ovErr;
      for (const o of ovs ?? []) {
        overridesByAgent.set(String(o.agent_id), {
          system_prompt: String(o.system_prompt ?? ""),
          updated_at: String(o.updated_at),
        });
      }
    }

    return ((catalog ?? []) as Array<Record<string, unknown>>).map((r) => {
      const id = String(r.agent_id);
      const ov = overridesByAgent.get(id) ?? null;
      return {
        agent_id: id,
        agent_name: String(r.agent_name),
        required_fields: Array.isArray(r.required_fields) ? (r.required_fields as string[]) : null,
        override_prompt: ov?.system_prompt ?? null,
        has_override: !!ov,
        updated_at: String(ov?.updated_at ?? r.updated_at),
      };
    });
  });

/**
 * Cria/atualiza o prompt customizado da marca para um agente.
 * O prompt original da Unitos permanece intocado e invisível ao usuário.
 */
export const updateAgentPromptFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        agentId: z.string().min(1),
        systemPrompt: z.string().min(1).max(20000),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Prompt de agente é configuração do workspace: só nível administrativo.
    await assertBrandAdmin(context.supabase as never, context.userId, data.brandId);
    const { error } = await context.supabase.from("agent_prompt_overrides").upsert(
      {
        brand_id: data.brandId,
        agent_id: data.agentId,
        system_prompt: data.systemPrompt,
        created_by: context.userId,
      },
      { onConflict: "brand_id,agent_id" },
    );
    if (error) throw error;
    return { ok: true };
  });

/**
 * Remove o override da marca — o agente volta a usar o prompt original
 * da Unitos (que continua invisível ao usuário).
 */
export const resetAgentPromptFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), agentId: z.string().min(1) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertBrandAdmin(context.supabase as never, context.userId, data.brandId);
    const { error } = await context.supabase
      .from("agent_prompt_overrides")
      .delete()
      .eq("brand_id", data.brandId)
      .eq("agent_id", data.agentId);
    if (error) throw error;
    return { ok: true };
  });

export const listAgentJobsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
      .parse(i),
  )
  .handler(async ({ data, context }): Promise<AgentJobRow[]> => {
    await assertBrandMember(context.supabase as never, context.userId, data.brandId);
    if (data.clientId) {
      await assertClientInBrand(
        context.supabase as never,
        context.userId,
        data.brandId,
        data.clientId,
      );
    }
    let q = context.supabase
      .from("ai_jobs")
      .select(
        "id, kind, title, status, progress, step_label, error, client_id, brand_id, started_at, finished_at, created_at",
      )
      .eq("brand_id", data.brandId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.clientId) q = q.eq("client_id", data.clientId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []) as AgentJobRow[];
  });

/**
 * Playground execution for an agent prompt.
 * Uses the agent's current system prompt, injects resolved variables +
 * runtime overrides, and calls the Lovable AI Gateway. Returns the raw
 * text response so the user can inspect exactly what the prompt produces
 * today.
 */
export const runAgentPlaygroundFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        agentId: z.string().min(1),
        userInput: z.string().max(8000).optional(),
        variables: z.record(z.string(), z.string()).optional(),
        model: z.string().optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // Playground consome orçamento/config de IA do workspace: exige membro.
    await assertBrandMember(context.supabase as never, context.userId, data.brandId);
    // Preferência: override da marca (visível ao usuário).
    const { data: ov, error: ovErr } = await context.supabase
      .from("agent_prompt_overrides")
      .select("system_prompt")
      .eq("brand_id", data.brandId)
      .eq("agent_id", data.agentId)
      .maybeSingle();
    if (ovErr) throw ovErr;

    let systemPrompt = ov?.system_prompt ? String(ov.system_prompt) : null;

    // Fallback: prompt original da Unitos — lido apenas server-side via admin,
    // NUNCA retornado ao cliente. O usuário só vê a resposta do modelo.
    if (!systemPrompt) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: original, error: origErr } = await supabaseAdmin
        .from("agent_prompts")
        .select("system_prompt")
        .eq("agent_id", data.agentId)
        .maybeSingle();
      if (origErr) throw origErr;
      if (!original?.system_prompt) throw new Error("Prompt do agente não encontrado.");
      systemPrompt = String(original.system_prompt);
    }

    const rendered = renderPrompt(systemPrompt, data.variables ?? {}, "(não informado)");
    const { model: llm, modelId: model } = await getBrandAiModel(
      context.supabase,
      data.brandId,
      "text",
      "operational",
      { agent: "agent.run", userId: context.userId },
    );

    const started = Date.now();
    const result = await generateText({
      model: llm,
      system: rendered,
      prompt: data.userInput?.trim() || "Execute o agente com o contexto acima.",
    });
    const ms = Date.now() - started;

    return {
      output: result.text,
      usage: result.usage,
      model,
      ms,
    };
  });
