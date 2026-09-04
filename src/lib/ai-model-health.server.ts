/**
 * AI model health check + auto-healing catalog.
 *
 * For every provider with an active brand key, pings the model of each role
 * (strategic / operational / image). When a model is gone (deprecated /
 * not_found), discovers the newest sibling from the provider's own model
 * listing, promotes it in `ai_model_catalog_overrides` and notifies the super
 * admins in-app.
 */

import { generateText } from "ai";
import { decryptCredential } from "./credentials-crypto.server";
import { filterRowsByPrefs } from "@/lib/notification-prefs";
import {
  PROVIDER_CAPABILITIES,
  invalidateCatalogCache,
  resolveModel,
  type ProviderName,
  type ProviderRole,
} from "./ai-models-catalog.server";

const PROVIDERS: ProviderName[] = ["openai", "anthropic", "gemini", "groq"];
const ROLES: ProviderRole[] = ["strategic", "operational", "image"];

export type HealthCheckEntry = {
  provider: ProviderName;
  role: ProviderRole;
  modelId: string;
  status: "ok" | "deprecated" | "failed" | "skipped";
  replacedWith?: string;
  error?: string;
};

export type HealthCheckResult = {
  checkedAt: string;
  entries: HealthCheckEntry[];
  replacements: number;
};

/* ---------------------------- error triage ---------------------------- */

const DEPRECATED_PATTERNS = [
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
];

function isDeprecationError(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("quota") || m.includes("billing")) return false;
  if (m.includes("api key") || m.includes("unauthorized") || m.includes("401")) return false;
  return DEPRECATED_PATTERNS.some((p) => m.includes(p));
}

/* --------------------------- model listings --------------------------- */

type ListedModel = { id: string; created?: number };

async function listProviderModels(provider: ProviderName, apiKey: string): Promise<ListedModel[]> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ id: string; created?: number }> };
      return (json.data ?? []).map((m) => ({ id: m.id, created: m.created }));
    }
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ id: string; created_at?: string }> };
      return (json.data ?? []).map((m) => ({
        id: m.id,
        created: m.created_at ? Date.parse(m.created_at) / 1000 : undefined,
      }));
    }
    if (provider === "groq") {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ id: string; created?: number }> };
      return (json.data ?? []).map((m) => ({ id: m.id, created: m.created }));
    }
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      { headers: { "x-goog-api-key": apiKey } },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return (json.models ?? []).map((m) => ({ id: m.name.replace(/^models\//, "") }));
  } catch (err) {
    console.error(`[ai-model-health] listagem ${provider} falhou`, err);
    return [];
  }
}

const EXCLUDE = [
  "embedding",
  "embed",
  "tts",
  "audio",
  "realtime",
  "whisper",
  "transcribe",
  "moderation",
  "vision-preview",
  "aqa",
];

function versionScore(id: string): number {
  const nums = id.match(/\d+(\.\d+)?/g) ?? [];
  return nums.reduce((acc, n, i) => acc + Number(n) / Math.pow(100, i), 0);
}

/** Escolhe o sucessor mais recente da mesma família para o papel. */
export function pickSuccessor(
  currentId: string,
  role: ProviderRole,
  listed: ListedModel[],
): string | null {
  const family = currentId.split(/[-.]/)[0]!.toLowerCase();
  const wantsImage = role === "image";

  const candidates = listed
    .filter((m) => {
      const id = m.id.toLowerCase();
      if (id === currentId.toLowerCase()) return false;
      if (!id.startsWith(family)) return false;
      if (EXCLUDE.some((x) => id.includes(x))) return false;
      const isImage = id.includes("image") || id.includes("imagen");
      return wantsImage ? isImage : !isImage;
    })
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || versionScore(b.id) - versionScore(a.id));

  return candidates[0]?.id ?? null;
}

/* ------------------------------ the check ----------------------------- */

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

async function loadKey(supabase: Admin, provider: ProviderName): Promise<string | null> {
  const { data } = await supabase
    .from("brand_api_credentials")
    .select("ciphertext")
    .eq("provider", provider)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.ciphertext) return null;
  try {
    return await decryptCredential(data.ciphertext as string);
  } catch (err) {
    console.error(`[ai-model-health] chave ilegível de ${provider}`, err);
    return null;
  }
}

async function pingTextModel(
  provider: ProviderName,
  apiKey: string,
  modelId: string,
): Promise<void> {
  const { instantiateProviderModel } = await import("./ai-provider.server");
  const model = instantiateProviderModel(provider, apiKey, modelId);
  await generateText({ model, prompt: "ping" });
}

async function notifySuperAdmins(supabase: Admin, entries: HealthCheckEntry[]): Promise<void> {
  const problems = entries.filter((e) => e.status === "deprecated" || e.status === "failed");
  if (!problems.length) return;

  const { data: admins } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("is_super_admin", true);
  if (!admins?.length) return;

  const adminIds = admins.map((a) => a.id as string);
  const { data: memberships } = await supabase
    .from("brand_members")
    .select("user_id, brand_id")
    .in("user_id", adminIds);

  const brandByUser = new Map<string, string>();
  for (const m of memberships ?? []) {
    const uid = m.user_id as string;
    if (!brandByUser.has(uid)) brandByUser.set(uid, m.brand_id as string);
  }

  const swapped = problems.filter((p) => p.replacedWith);
  const title = swapped.length
    ? `Modelo de IA atualizado automaticamente (${swapped.length})`
    : "Modelo de IA com falha — ação necessária";
  const body = problems
    .map((p) =>
      p.replacedWith
        ? `${p.provider}/${p.role}: ${p.modelId} → ${p.replacedWith}`
        : `${p.provider}/${p.role}: ${p.modelId} indisponível (${p.error ?? "erro"})`,
    )
    .join(" · ")
    .slice(0, 900);

  const rows = adminIds
    .filter((id) => brandByUser.has(id))
    .map((id) => ({
      user_id: id,
      brand_id: brandByUser.get(id)!,
      kind: "system" as const,
      title,
      body,
      href: "/connections",
      payload: { source: "ai_model_health", problems } as never,
    }));
  if (!rows.length) return;
  // Preferência do usuário (ai_jobs) é aplicada no servidor, não só na UI.
  const allowed = await filterRowsByPrefs(supabase as never, rows);
  if (!allowed.length) return;
  const { error } = await supabase.from("notifications").insert(allowed as never);
  if (error) console.error("[ai-model-health] falha ao notificar admins", error);
}

/**
 * Propaga o resultado da verificação da chave para `brand_connections.providers`,
 * de modo que a UI de Conexões mostre "Chave inválida" sem novo teste manual.
 */
async function markProviderVerification(
  supabase: Admin,
  provider: ProviderName,
  status: "valid" | "invalid" | "unverified",
  message: string,
): Promise<void> {
  const { data: rows } = await supabase.from("brand_connections").select("brand_id, providers");
  const now = new Date().toISOString();

  for (const row of rows ?? []) {
    const providers = (row.providers ?? {}) as Record<string, Record<string, unknown>>;
    if (!providers[provider]) continue;
    providers[provider] = {
      ...providers[provider],
      connected: status !== "invalid",
      verified: status,
      verifiedAt: now,
      verifyMessage: message,
    };
    await supabase
      .from("brand_connections")
      .update({ providers } as never)
      .eq("brand_id", row.brand_id as string);
  }
}

export async function runAiModelHealthCheck(): Promise<HealthCheckResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const entries: HealthCheckEntry[] = [];
  let replacements = 0;

  for (const provider of PROVIDERS) {
    const apiKey = await loadKey(supabaseAdmin, provider);
    let listed: ListedModel[] | null = null;

    // Confirma que a chave ainda é aceita pelo provedor antes de testar modelos.
    if (apiKey) {
      const { verifyProviderKey } = await import("./ai-provider-verify.server");
      const check = await verifyProviderKey(provider, apiKey);
      await markProviderVerification(supabaseAdmin, provider, check.status, check.message);
      if (check.status === "invalid") {
        for (const role of ROLES) {
          if (role === "image" && !PROVIDER_CAPABILITIES[provider].image) continue;
          const modelId = (await resolveModel(provider, role)) ?? "-";
          const entry: HealthCheckEntry = {
            provider,
            role,
            modelId,
            status: "failed",
            error: check.message.slice(0, 500),
          };
          entries.push(entry);
          await supabaseAdmin.from("ai_model_health").insert({
            provider,
            role,
            model_id: modelId,
            status: "failed",
            error_message: entry.error ?? null,
          } as never);
        }
        continue;
      }
    }

    for (const role of ROLES) {
      if (role === "image" && !PROVIDER_CAPABILITIES[provider].image) continue;
      const modelId = await resolveModel(provider, role);
      if (!modelId) continue;

      if (!apiKey) {
        entries.push({ provider, role, modelId, status: "skipped", error: "no_key_configured" });
        continue;
      }

      let status: HealthCheckEntry["status"] = "ok";
      let error: string | undefined;

      try {
        if (role === "image") {
          listed ??= await listProviderModels(provider, apiKey);
          const exists = listed.some((m) => m.id.toLowerCase() === modelId.toLowerCase());
          if (!exists && listed.length) {
            status = "deprecated";
            error = "modelo de imagem ausente na listagem do provedor";
          }
        } else {
          await pingTextModel(provider, apiKey, modelId);
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        status = isDeprecationError(error) ? "deprecated" : "failed";
      }

      const entry: HealthCheckEntry = { provider, role, modelId, status };
      if (error) entry.error = error.slice(0, 500);

      if (status === "deprecated") {
        listed ??= await listProviderModels(provider, apiKey);
        const successor = pickSuccessor(modelId, role, listed);
        if (successor) {
          const { error: upErr } = await supabaseAdmin.from("ai_model_catalog_overrides").upsert(
            {
              provider,
              role,
              model_id: successor,
              replaced_model_id: modelId,
              reason: entry.error ?? "deprecated",
              source: "auto_health_check",
              updated_at: new Date().toISOString(),
            } as never,
            { onConflict: "provider,role" },
          );
          if (upErr) {
            console.error("[ai-model-health] falha ao gravar override", upErr);
          } else {
            entry.replacedWith = successor;
            replacements += 1;
            invalidateCatalogCache();
          }
        }
      }

      entries.push(entry);

      await supabaseAdmin.from("ai_model_health").insert({
        provider,
        role,
        model_id: entry.replacedWith ?? modelId,
        status: entry.status,
        error_message: entry.error ?? null,
      } as never);
    }
  }

  await notifySuperAdmins(supabaseAdmin, entries);

  return { checkedAt: new Date().toISOString(), entries, replacements };
}
