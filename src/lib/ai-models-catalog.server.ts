/**
 * Central catalog of AI model IDs per provider.
 * Single source of truth to avoid deprecated-model errors.
 *
 * Defaults below are the compiled fallback. When a provider deprecates a
 * model, the health check (`/api/public/hooks/ai-models-health`) discovers the
 * successor, stores it in `ai_model_catalog_overrides` and notifies the super
 * admins — every consumer then resolves the new ID with no deploy.
 */

import {
  PROVIDER_CAPABILITIES,
  type ProviderKind,
  type ProviderName,
  type ProviderRole,
} from "./ai-capabilities";

export type { ProviderName, ProviderRole, ProviderKind };
export { PROVIDER_CAPABILITIES };

export const MODEL_CATALOG: Record<ProviderName, Record<ProviderRole, string | null>> = {
  openai: {
    strategic: "gpt-5",
    operational: "gpt-5-mini",
    image: "gpt-image-1",
  },
  anthropic: {
    strategic: "claude-opus-4-1",
    operational: "claude-sonnet-4-5",
    image: null, // Anthropic não gera imagem
  },
  gemini: {
    // `*-latest` acompanha a geração atual do Google. `gemini-2.5-pro` foi
    // descontinuado para novas contas e passou a rejeitar as chamadas.
    // O plano da conta não libera cota nos modelos Pro; flash-latest é o mais
    // capaz disponível e sempre aponta para a geração atual.
    strategic: "gemini-flash-latest",
    operational: "gemini-flash-latest",
    // Imagen exige projeto com faturamento; `gemini-*-image` funciona com a
    // mesma chave da API Gemini e é o padrão de geração de imagem.
    image: "gemini-2.5-flash-image",

  },
  groq: {
    // Groq expõe a API compatível com OpenAI; ids conforme o catálogo atual.
    strategic: "openai/gpt-oss-120b",
    operational: "llama-3.3-70b-versatile",
    image: null, // Groq não gera imagem
  },
};

/**
 * Cadeia de fallback por papel: se o modelo em uso for rejeitado pelo provedor
 * (descontinuado / indisponível para a conta), tentamos o próximo da lista e
 * gravamos o override para as próximas execuções.
 */
export const MODEL_FALLBACKS: Record<ProviderName, Record<ProviderRole, string[]>> = {
  openai: {
    strategic: ["gpt-5", "gpt-5.1", "gpt-4.1"],
    operational: ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini"],
    image: ["gpt-image-1", "dall-e-3"],
  },
  anthropic: {
    strategic: ["claude-opus-4-1", "claude-sonnet-4-5", "claude-3-7-sonnet-latest"],
    operational: ["claude-sonnet-4-5", "claude-3-5-haiku-latest"],
    image: [],
  },
  gemini: {
    strategic: ["gemini-flash-latest", "gemini-3.6-flash", "gemini-2.5-flash"],
    operational: ["gemini-flash-latest", "gemini-3.6-flash", "gemini-2.5-flash"],
    image: [
      "gemini-2.5-flash-image",
      "gemini-2.0-flash-preview-image-generation",
      "imagen-4.0-generate-001",
      "imagen-4.0-fast-generate-001",
    ],

  },
  groq: {
    strategic: [
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
      "moonshotai/kimi-k2-instruct-0905",
    ],
    operational: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b", "llama-3.1-8b-instant"],
    image: [],
  },
};

/** Convenience default for legacy call sites. */
export const DEFAULT_TEXT_MODEL: Record<ProviderName, string> = {
  openai: MODEL_CATALOG.openai.operational!,
  anthropic: MODEL_CATALOG.anthropic.operational!,
  gemini: MODEL_CATALOG.gemini.operational!,
  groq: MODEL_CATALOG.groq.operational!,
};

/** Compiled default (sem overrides). */
export function getModel(
  provider: ProviderName,
  role: ProviderRole = "operational",
): string | null {
  return MODEL_CATALOG[provider][role];
}

/* ------------------------------------------------------------------ */
/* Overrides gravados pelo health check                                */
/* ------------------------------------------------------------------ */

export type CatalogOverride = {
  provider: ProviderName;
  role: ProviderRole;
  modelId: string;
  replacedModelId: string | null;
  reason: string | null;
  updatedAt: string;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: { at: number; rows: CatalogOverride[] } | null = null;

export function invalidateCatalogCache() {
  cache = null;
}

export async function loadCatalogOverrides(): Promise<CatalogOverride[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_model_catalog_overrides")
      .select("provider, role, model_id, replaced_model_id, reason, updated_at");
    const rows: CatalogOverride[] = (data ?? []).map((r) => ({
      provider: r.provider as ProviderName,
      role: r.role as ProviderRole,
      modelId: r.model_id as string,
      replacedModelId: (r.replaced_model_id as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      updatedAt: r.updated_at as string,
    }));
    cache = { at: Date.now(), rows };
    return rows;
  } catch (err) {
    console.error("[ai-models-catalog] falha ao carregar overrides", err);
    return cache?.rows ?? [];
  }
}

/**
 * Resolve o modelo em uso: override do banco quando existir, senão o default
 * compilado. Retorna null quando o provedor não suporta o papel (ex.: imagem
 * na Anthropic).
 */
export async function resolveModel(
  provider: ProviderName,
  role: ProviderRole = "operational",
): Promise<string | null> {
  const fallback = MODEL_CATALOG[provider][role];
  if (role === "image" && !PROVIDER_CAPABILITIES[provider].image) return null;
  const overrides = await loadCatalogOverrides();
  const hit = overrides.find((o) => o.provider === provider && o.role === role);
  return hit?.modelId ?? fallback;
}

/**
 * Próximo modelo da cadeia de fallback do papel, ignorando os já tentados.
 */
export function nextFallbackModel(
  provider: ProviderName,
  role: ProviderRole,
  tried: string[],
): string | null {
  const chain = MODEL_FALLBACKS[provider][role] ?? [];
  const lower = tried.map((t) => t.toLowerCase());
  return chain.find((id) => !lower.includes(id.toLowerCase())) ?? null;
}

/** Grava (upsert) o modelo promovido em runtime e limpa o cache. */
export async function saveCatalogOverride(args: {
  provider: ProviderName;
  role: ProviderRole;
  modelId: string;
  replacedModelId: string | null;
  reason: string | null;
  source?: string;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_model_catalog_overrides").upsert(
      {
        provider: args.provider,
        role: args.role,
        model_id: args.modelId,
        replaced_model_id: args.replacedModelId,
        reason: args.reason?.slice(0, 500) ?? null,
        source: args.source ?? "runtime",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "provider,role" },
    );
    invalidateCatalogCache();
  } catch (err) {
    console.error("[ai-models-catalog] falha ao gravar override", err);
  }
}

/** Erro do provedor indicando modelo descontinuado / indisponível. */
export function isModelUnavailableError(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("quota") || m.includes("billing")) return false;
  if (m.includes("api key") || m.includes("unauthorized") || m.includes("401")) return false;
  return [
    "model_not_found",
    "does not exist",
    "not found",
    "is not supported",
    "deprecated",
    "retired",
    "no longer available",
    "unsupported model",
    "invalid model",
    "404",
  ].some((p) => m.includes(p));
}
