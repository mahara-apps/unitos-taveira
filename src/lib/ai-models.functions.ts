import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  IMAGE_PROVIDERS,
  PROVIDER_CAPABILITIES,
  type ProviderName,
  type ProviderRole,
} from "@/lib/ai-capabilities";

export type ActiveModel = {
  provider: ProviderName;
  role: ProviderRole;
  modelId: string;
  replacedModelId: string | null;
  reason: string | null;
  updatedAt: string | null;
};

export type AiModelStatus = {
  models: ActiveModel[];
  lastCheckedAt: string | null;
  imageProviders: ProviderName[];
};

export const getAiModelStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AiModelStatus> => {
    const { MODEL_CATALOG } = await import("@/lib/ai-models-catalog.server");
    // Leitura autenticada (RLS: apenas super admins veem overrides/health).
    // Não usa service role — o painel é read-only para o usuário logado.
    const { data: overrides } = await context.supabase
      .from("ai_model_catalog_overrides")
      .select("provider, role, model_id, replaced_model_id, reason, updated_at");

    const { data: lastCheck } = await context.supabase
      .from("ai_model_health")
      .select("checked_at")
      .order("checked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const models: ActiveModel[] = [];
    for (const provider of Object.keys(PROVIDER_CAPABILITIES) as ProviderName[]) {
      for (const role of ["strategic", "operational", "image"] as ProviderRole[]) {
        const fallback = MODEL_CATALOG[provider][role];
        if (!fallback) continue;
        const hit = (overrides ?? []).find((o) => o.provider === provider && o.role === role);
        models.push({
          provider,
          role,
          modelId: (hit?.model_id as string) ?? fallback,
          replacedModelId: (hit?.replaced_model_id as string | null) ?? null,
          reason: (hit?.reason as string | null) ?? null,
          updatedAt: (hit?.updated_at as string | null) ?? null,
        });
      }
    }

    return {
      models,
      lastCheckedAt: (lastCheck?.checked_at as string | null) ?? null,
      imageProviders: IMAGE_PROVIDERS,
    };
  });

export const runAiModelHealthNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_super_admin", {
      _user_id: context.userId,
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { runAiModelHealthCheck } = await import("@/lib/ai-model-health.server");
    const result = await runAiModelHealthCheck();
    return {
      checkedAt: result.checkedAt,
      replacements: result.replacements,
      problems: result.entries.filter((e) => e.status !== "ok").length,
    };
  });
