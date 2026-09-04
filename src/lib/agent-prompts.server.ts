import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fonte única dos prompts dos agentes: `agent_prompts` (default Unitos) com
 * override por marca em `agent_prompt_overrides`. Usado tanto pelos jobs
 * (Pauta / Estratégia) quanto pelo orquestrador da peça, para que não exista
 * prompt hardcoded duplicado no fluxo operacional.
 */
export async function loadAgentPrompts(
  brandId: string,
  agentIds: readonly string[],
  sb?: SupabaseClient,
): Promise<Map<string, string>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const reader = (sb ?? supabaseAdmin) as SupabaseClient;
  const [defaults, overrides] = await Promise.all([
    supabaseAdmin
      .from("agent_prompts")
      .select("agent_id, system_prompt")
      .in("agent_id", agentIds as string[]),
    reader
      .from("agent_prompt_overrides")
      .select("agent_id, system_prompt")
      .eq("brand_id", brandId)
      .in("agent_id", agentIds as string[]),
  ]);
  if (defaults.error) throw defaults.error;

  const map = new Map<string, string>();
  for (const r of (defaults.data ?? []) as { agent_id: string; system_prompt: string }[]) {
    map.set(r.agent_id, r.system_prompt);
  }
  for (const r of (overrides.data ?? []) as { agent_id: string; system_prompt: string }[]) {
    if (r.system_prompt?.trim()) map.set(r.agent_id, r.system_prompt);
  }
  return map;
}

/** Substitui `{{VAR}}` pelos valores de contexto (mesma convenção do vault). */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_m, k) => vars[k] ?? "(não informado)");
}
