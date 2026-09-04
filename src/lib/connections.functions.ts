import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BrandIdInput = z.object({ brandId: z.string().uuid() });

export type ProviderConfig = {
  connected: boolean;
  masked?: string;
  updatedAt?: string;
  /** Resultado do último teste real contra o provedor. */
  verified?: "valid" | "invalid" | "unverified";
  verifiedAt?: string;
  verifyMessage?: string;
};

export type ChannelConfig = {
  connected: boolean;
  handle?: string;
  updatedAt?: string;
};

export type ConnectionsSettings = {
  brandId: string;
  monthlyBudgetUsd: number;
  textProvider: "openai" | "anthropic" | "gemini" | "groq";
  /** Provedor secundário usado só em falha transitória do principal. */
  textFallbackProvider: "openai" | "anthropic" | "gemini" | "groq" | null;
  imageProvider: "openai" | "gemini";
  providers: Record<string, ProviderConfig>;
  channels: Record<string, ChannelConfig>;
  usage: {
    monthUsd: number;
    monthTokens: number;
    totalCalls: number;
    successCalls: number;
    /** Consumo do mês por provedor (openai | anthropic | gemini). */
    byProvider: Record<string, { usd: number; tokens: number; calls: number }>;
  };
};

/** Deriva o provedor a partir do id do modelo registrado. */
function providerFromModel(model: string | null): string {
  const m = (model ?? "").toLowerCase();
  if (m.includes("claude")) return "anthropic";
  if (m.includes("llama") || m.includes("gpt-oss") || m.includes("kimi") || m.includes("groq"))
    return "groq";
  if (m.includes("gemini") || m.includes("imagen")) return "gemini";
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("dall"))
    return "openai";
  return "outros";
}

function maskKey(key: string): string {
  if (!key) return "";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${"•".repeat(Math.max(4, trimmed.length - 8))}${trimmed.slice(-4)}`;
}

export const getConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandIdInput.parse(input))
  .handler(async ({ data, context }): Promise<ConnectionsSettings> => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("brand_connections")
      .select("*")
      .eq("brand_id", data.brandId)
      .maybeSingle();

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { data: usage } = await supabase
      .from("brand_ai_usage")
      .select("cost_usd, input_tokens, output_tokens, success, model")
      .eq("brand_id", data.brandId)
      .gte("created_at", monthStart.toISOString());

    const rows = usage ?? [];
    const monthUsd = rows.reduce((a, u) => a + Number(u.cost_usd ?? 0), 0);
    const monthTokens = rows.reduce(
      (a, u) => a + Number(u.input_tokens ?? 0) + Number(u.output_tokens ?? 0),
      0,
    );
    const totalCalls = rows.length;
    const successCalls = rows.filter((u) => u.success).length;
    const byProvider: Record<string, { usd: number; tokens: number; calls: number }> = {};
    for (const u of rows) {
      const key = providerFromModel(u.model as string | null);
      const acc = byProvider[key] ?? { usd: 0, tokens: 0, calls: 0 };
      acc.usd += Number(u.cost_usd ?? 0);
      acc.tokens += Number(u.input_tokens ?? 0) + Number(u.output_tokens ?? 0);
      acc.calls += 1;
      byProvider[key] = acc;
    }

    return {
      brandId: data.brandId,
      monthlyBudgetUsd: row ? Number(row.monthly_budget_usd) : 500,
      textProvider: (row?.text_provider as ConnectionsSettings["textProvider"]) ?? "openai",
      textFallbackProvider:
        (row?.text_fallback_provider as ConnectionsSettings["textFallbackProvider"]) ?? null,
      imageProvider: row?.image_provider === "openai" ? "openai" : "gemini",
      providers: (row?.providers as Record<string, ProviderConfig>) ?? {},
      channels: (row?.channels as Record<string, ChannelConfig>) ?? {},
      usage: { monthUsd, monthTokens, totalCalls, successCalls, byProvider },
    };
  });

const UpsertInput = z.object({
  brandId: z.string().uuid(),
  monthlyBudgetUsd: z.number().min(0).max(1_000_000).optional(),
  textProvider: z.enum(["openai", "anthropic", "gemini", "groq"]).optional(),
  /** "none" limpa o fallback. */
  textFallbackProvider: z.enum(["openai", "anthropic", "gemini", "groq", "none"]).optional(),
  // Anthropic não gera imagem — não pode ser selecionada como provedor de imagem.
  imageProvider: z.enum(["openai", "gemini"]).optional(),
});

export const updateConnectionsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpsertInput.parse(input))
  .handler(async ({ data, context }) => {
    const patch = {
      brand_id: data.brandId,
      ...(data.monthlyBudgetUsd !== undefined ? { monthly_budget_usd: data.monthlyBudgetUsd } : {}),
      ...(data.textProvider ? { text_provider: data.textProvider } : {}),
      ...(data.textFallbackProvider
        ? {
            text_fallback_provider:
              data.textFallbackProvider === "none" ? null : data.textFallbackProvider,
          }
        : {}),
      ...(data.imageProvider ? { image_provider: data.imageProvider } : {}),
    };

    const { error } = await context.supabase
      .from("brand_connections")
      .upsert(patch, { onConflict: "brand_id" });
    if (error) throw error;
    return { ok: true };
  });

const ProviderKeyInput = z.object({
  brandId: z.string().uuid(),
  provider: z.enum(["openai", "anthropic", "gemini", "groq"]),
  apiKey: z.string().trim().min(8).max(400),
});

export const saveProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProviderKeyInput.parse(input))
  .handler(async ({ data, context }) => {
    const { encryptCredential, maskCredential } = await import("./credentials-crypto.server");
    const { verifyProviderKey } = await import("./ai-provider-verify.server");

    // Testa a chave contra o provedor ANTES de gravar qualquer coisa.
    const check = await verifyProviderKey(data.provider, data.apiKey);
    if (check.status === "invalid") throw new Error(check.message);

    const ciphertext = await encryptCredential(data.apiKey);
    const masked = maskCredential(data.apiKey);

    // Persist the encrypted secret in brand_api_credentials (server-only read).
    const { error: credErr } = await context.supabase.from("brand_api_credentials").upsert(
      {
        brand_id: data.brandId,
        provider: data.provider,
        ciphertext,
        masked,
        updated_by: context.userId,
      },
      { onConflict: "brand_id,provider" },
    );
    if (credErr) throw credErr;

    const { data: existing } = await context.supabase
      .from("brand_connections")
      .select("providers")
      .eq("brand_id", data.brandId)
      .maybeSingle();
    const providers = ((existing?.providers as Record<string, ProviderConfig>) ?? {}) as Record<
      string,
      ProviderConfig
    >;
    const now = new Date().toISOString();
    providers[data.provider] = {
      connected: true,
      masked,
      updatedAt: now,
      verified: check.status,
      verifiedAt: now,
      verifyMessage: check.message,
    };
    const { error } = await context.supabase
      .from("brand_connections")
      .upsert({ brand_id: data.brandId, providers }, { onConflict: "brand_id" });
    if (error) throw error;
    return {
      ok: true,
      masked: providers[data.provider]!.masked,
      verified: check.status,
      message: check.message,
      models: check.models.length,
    };
  });

const TestProviderInput = z.object({
  brandId: z.string().uuid(),
  provider: z.enum(["openai", "anthropic", "gemini", "groq"]),
});

/** Revalida a chave já salva do provedor, sem precisar redigitá-la. */
export const testProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => TestProviderInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: credRow, error: credErr } = await context.supabase
      .from("brand_api_credentials")
      .select("ciphertext")
      .eq("brand_id", data.brandId)
      .eq("provider", data.provider)
      .maybeSingle();
    if (credErr) throw credErr;
    if (!credRow?.ciphertext) {
      throw new Error("Nenhuma chave cadastrada para este provedor.");
    }

    const { decryptCredential } = await import("./credentials-crypto.server");
    const { verifyProviderKey } = await import("./ai-provider-verify.server");
    const apiKey = await decryptCredential(credRow.ciphertext as string);
    const check = await verifyProviderKey(data.provider, apiKey);

    const { data: existing } = await context.supabase
      .from("brand_connections")
      .select("providers")
      .eq("brand_id", data.brandId)
      .maybeSingle();
    const providers = ((existing?.providers as Record<string, ProviderConfig>) ?? {}) as Record<
      string,
      ProviderConfig
    >;
    const now = new Date().toISOString();
    providers[data.provider] = {
      ...(providers[data.provider] ?? { connected: true }),
      connected: check.status !== "invalid",
      verified: check.status,
      verifiedAt: now,
      verifyMessage: check.message,
    };
    const { error } = await context.supabase
      .from("brand_connections")
      .upsert({ brand_id: data.brandId, providers }, { onConflict: "brand_id" });
    if (error) throw error;

    return { status: check.status, message: check.message, models: check.models.length };
  });

const RemoveProviderInput = z.object({
  brandId: z.string().uuid(),
  provider: z.enum(["openai", "anthropic", "gemini", "groq"]),
});

export const removeProviderKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveProviderInput.parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("brand_api_credentials")
      .delete()
      .eq("brand_id", data.brandId)
      .eq("provider", data.provider);

    const { data: existing } = await context.supabase
      .from("brand_connections")
      .select("providers")
      .eq("brand_id", data.brandId)
      .maybeSingle();
    const providers = ((existing?.providers as Record<string, ProviderConfig>) ?? {}) as Record<
      string,
      ProviderConfig
    >;
    delete providers[data.provider];
    const { error } = await context.supabase
      .from("brand_connections")
      .upsert({ brand_id: data.brandId, providers }, { onConflict: "brand_id" });
    if (error) throw error;
    return { ok: true };
  });

const ChannelInput = z.object({
  brandId: z.string().uuid(),
  channel: z.enum([
    "instagram",
    "facebook",
    "tiktok",
    "youtube",
    "linkedin",
    "twitter",
    "threads",
    "meta",
    "resend",
    "whatsapp_evolution",
    "whatsapp_cloud",
  ]),
  handle: z.string().trim().min(1).max(200).optional(),
  connected: z.boolean(),
});

export const upsertChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ChannelInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("brand_connections")
      .select("channels")
      .eq("brand_id", data.brandId)
      .maybeSingle();
    const channels = ((existing?.channels as Record<string, ChannelConfig>) ?? {}) as Record<
      string,
      ChannelConfig
    >;
    if (data.connected) {
      channels[data.channel] = {
        connected: true,
        handle: data.handle,
        updatedAt: new Date().toISOString(),
      };
    } else {
      delete channels[data.channel];
    }
    const { error } = await context.supabase
      .from("brand_connections")
      .upsert({ brand_id: data.brandId, channels }, { onConflict: "brand_id" });
    if (error) throw error;
    return { ok: true };
  });

// -----------------------------------------------------------------------------
// Tool credentials (Resend, WhatsApp Evolution, WhatsApp Cloud, …)
// Uses the same AES-256-GCM store; metadata carries non-secret fields.
// -----------------------------------------------------------------------------

const ToolProvider = z.enum(["resend", "whatsapp_evolution", "whatsapp_cloud"]);

const SaveToolCredentialInput = z.object({
  brandId: z.string().uuid(),
  provider: ToolProvider,
  apiKey: z.string().trim().min(4).max(800),
  metadata: z.record(z.string().max(400)).optional(),
});

export const saveToolCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveToolCredentialInput.parse(input))
  .handler(async ({ data, context }) => {
    const { encryptCredential, maskCredential } = await import("./credentials-crypto.server");
    const ciphertext = await encryptCredential(data.apiKey);
    const masked = maskCredential(data.apiKey);

    const { error: credErr } = await context.supabase.from("brand_api_credentials").upsert(
      {
        brand_id: data.brandId,
        provider: data.provider,
        ciphertext,
        masked,
        metadata: data.metadata ?? {},
        updated_by: context.userId,
      },
      { onConflict: "brand_id,provider" },
    );
    if (credErr) throw credErr;

    // Mirror connection status in brand_connections.channels for the UI.
    const { data: existing } = await context.supabase
      .from("brand_connections")
      .select("channels")
      .eq("brand_id", data.brandId)
      .maybeSingle();
    const channels = ((existing?.channels as Record<string, ChannelConfig>) ?? {}) as Record<
      string,
      ChannelConfig
    >;
    channels[data.provider] = {
      connected: true,
      handle: data.metadata?.handle ?? masked,
      updatedAt: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("brand_connections")
      .upsert({ brand_id: data.brandId, channels }, { onConflict: "brand_id" });
    if (error) throw error;
    return { ok: true, masked };
  });

const RemoveToolInput = z.object({
  brandId: z.string().uuid(),
  provider: ToolProvider,
});

export const removeToolCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RemoveToolInput.parse(input))
  .handler(async ({ data, context }) => {
    await context.supabase
      .from("brand_api_credentials")
      .delete()
      .eq("brand_id", data.brandId)
      .eq("provider", data.provider);

    const { data: existing } = await context.supabase
      .from("brand_connections")
      .select("channels")
      .eq("brand_id", data.brandId)
      .maybeSingle();
    const channels = ((existing?.channels as Record<string, ChannelConfig>) ?? {}) as Record<
      string,
      ChannelConfig
    >;
    delete channels[data.provider];
    const { error } = await context.supabase
      .from("brand_connections")
      .upsert({ brand_id: data.brandId, channels }, { onConflict: "brand_id" });
    if (error) throw error;
    return { ok: true };
  });
