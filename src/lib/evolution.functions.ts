// Camada de integração da Evolution API exposta ao app (somente configuração e
// teste de conectividade). QR, webhook, inbox e envio ficam para fases futuras.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BrandInput = z.object({ brandId: z.string().uuid() });

export type EvolutionStatus = {
  configured: boolean;
  hasApiKey: boolean;
  baseUrl: string | null;
  baseUrlSource: "workspace" | "installation" | null;
  maskedApiKey: string | null;
  updatedAt: string | null;
  /** Motivo apresentável quando a configuração está incompleta/inválida. */
  message: string | null;
};

/** Estado da configuração da Evolution para o workspace (sem expor segredos). */
export const getEvolutionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }): Promise<EvolutionStatus> => {
    const { assertBrandMember } = await import("@/lib/access-guard");
    await assertBrandMember(context.supabase, context.userId, data.brandId);

    const { EVOLUTION_PROVIDER, resolveEvolutionConfig } =
      await import("@/lib/evolution/config.server");
    const { EvolutionConfigError } = await import("@/lib/evolution/config.server");

    const { data: row, error } = await context.supabase
      .from("brand_api_credentials")
      .select("ciphertext, masked, metadata, updated_at")
      .eq("brand_id", data.brandId)
      .eq("provider", EVOLUTION_PROVIDER)
      .maybeSingle();
    if (error) throw error;

    try {
      const config = await resolveEvolutionConfig(row);
      return {
        configured: true,
        hasApiKey: true,
        baseUrl: config.baseUrl,
        baseUrlSource: config.source.baseUrl,
        maskedApiKey: (row?.masked as string | null) ?? null,
        updatedAt: (row?.updated_at as string | null) ?? null,
        message: null,
      };
    } catch (err) {
      const message =
        err instanceof EvolutionConfigError
          ? err.message
          : "Configuração da Evolution indisponível.";
      if (!(err instanceof EvolutionConfigError)) {
        console.error("[Evolution] falha ao resolver configuração", err);
      }
      return {
        configured: false,
        hasApiKey: Boolean(row?.ciphertext) || Boolean(process.env["EVOLUTION_API_KEY"]),
        baseUrl: null,
        baseUrlSource: null,
        maskedApiKey: (row?.masked as string | null) ?? null,
        updatedAt: (row?.updated_at as string | null) ?? null,
        message,
      };
    }
  });

const SaveInput = z.object({
  brandId: z.string().uuid(),
  baseUrl: z.string().trim().min(4).max(300),
  apiKey: z.string().trim().min(8).max(400).optional(),
});

/**
 * Salva base URL + (opcional) chave da Evolution para o workspace.
 * Somente ADMIN/SUPER ADMIN. A chave é cifrada e a conexão é testada antes de gravar.
 */
export const saveEvolutionConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertBrandAdmin } = await import("@/lib/access-guard");
    await assertBrandAdmin(context.supabase, context.userId, data.brandId, {
      allowManager: false,
    });

    const { EVOLUTION_PROVIDER, normalizeEvolutionBaseUrl, resolveEvolutionConfig } =
      await import("@/lib/evolution/config.server");
    const baseUrl = normalizeEvolutionBaseUrl(data.baseUrl);

    const { data: existing } = await context.supabase
      .from("brand_api_credentials")
      .select("ciphertext, masked, metadata")
      .eq("brand_id", data.brandId)
      .eq("provider", EVOLUTION_PROVIDER)
      .maybeSingle();

    let ciphertext = (existing?.ciphertext as string | null) ?? null;
    let masked = (existing?.masked as string | null) ?? null;
    if (!data.apiKey && !ciphertext) {
      throw new Error("Informe a chave de API da Evolution.");
    }
    if (data.apiKey) {
      const { encryptCredential, maskCredential } = await import("@/lib/credentials-crypto.server");
      ciphertext = await encryptCredential(data.apiKey);
      masked = maskCredential(data.apiKey);
    }

    const metadata = {
      ...(((existing?.metadata as Record<string, unknown> | null) ?? {}) as Record<
        string,
        unknown
      >),
      base_url: baseUrl,
    };

    // Testa antes de gravar: configuração inválida não fica salva como "conectada".
    const config = await resolveEvolutionConfig({ ciphertext, metadata });
    const { checkEvolutionConnectivity } = await import("@/lib/evolution/client.server");
    const check = await checkEvolutionConnectivity(config);
    if (!check.ok && (check.code === "unauthorized" || check.code === "config_error")) {
      throw new Error(check.message);
    }

    const { error } = await context.supabase.from("brand_api_credentials").upsert(
      {
        brand_id: data.brandId,
        provider: EVOLUTION_PROVIDER,
        ciphertext: ciphertext!,
        masked: masked ?? "",
        metadata: { ...metadata, last_check: check.checkedAt, last_check_ok: check.ok },
        updated_by: context.userId,
      },
      { onConflict: "brand_id,provider" },
    );
    if (error) throw error;

    return { ok: true, baseUrl, masked, check };
  });

/** Teste de conectividade contra a Evolution usando a configuração salva. */
export const testEvolutionConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BrandInput.parse(input))
  .handler(async ({ data, context }) => {
    const { assertBrandAdmin } = await import("@/lib/access-guard");
    await assertBrandAdmin(context.supabase, context.userId, data.brandId);

    const { EVOLUTION_PROVIDER, resolveEvolutionConfig, EvolutionConfigError } =
      await import("@/lib/evolution/config.server");

    const { data: row, error } = await context.supabase
      .from("brand_api_credentials")
      .select("ciphertext, metadata")
      .eq("brand_id", data.brandId)
      .eq("provider", EVOLUTION_PROVIDER)
      .maybeSingle();
    if (error) throw error;

    let config;
    try {
      config = await resolveEvolutionConfig(row);
    } catch (err) {
      if (err instanceof EvolutionConfigError) {
        return {
          ok: false,
          code: "config_error" as const,
          message: err.message,
          instances: null,
          checkedAt: new Date().toISOString(),
        };
      }
      throw err;
    }

    const { checkEvolutionConnectivity } = await import("@/lib/evolution/client.server");
    const check = await checkEvolutionConnectivity(config);

    const metadata = {
      ...(((row?.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
      last_check: check.checkedAt,
      last_check_ok: check.ok,
    };
    await context.supabase
      .from("brand_api_credentials")
      .update({ metadata })
      .eq("brand_id", data.brandId)
      .eq("provider", EVOLUTION_PROVIDER);

    return check;
  });
