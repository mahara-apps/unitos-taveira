import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptCredential } from "./credentials-crypto.server";
import {
  resolveModel,
  nextFallbackModel,
  saveCatalogOverride,
  isModelUnavailableError,
  type ProviderName,
  type ProviderRole,
} from "./ai-models-catalog.server";

import { IMAGE_PROVIDERS, supportsKind } from "./ai-capabilities";
import { classifyAiError, unwrapAiError } from "./ai-failures.server";
import {
  isRecoverableFailure,
  logAiFailure,
  logAiRetry,
  redactAiDetail,
} from "./ai-observability";
import { recordAiUsage, type AiUsageContext } from "./ai-usage.server";
import {
  createAiRequestBudget,
  takeAiRequest,
  type AiRequestBudget,
} from "./ai/request-budget";
import {
  EMBED_DIMS,
  EMBED_MAX_ATTEMPTS,
  EMBED_TIMEOUT_MS,
  embeddingBackoffMs,
  isRetryableEmbeddingError,
  isRetryableEmbeddingStatus,
  isValidEmbedding,
  normalizeEmbeddingInput,
} from "./embeddings";

export type { AiUsageContext };

export type { ProviderName, ProviderRole };
export type ProviderKind = "text" | "image";

/** Registro de cada tentativa por provedor — consumido pela observabilidade. */
export type ProviderAttempt = {
  provider: ProviderName;
  model: string;
  attempt: number;
  result: "success" | string;
  /** Diagnóstico técnico limitado; nunca contém a chave do provider. */
  detail?: string;
};

export type BrandAiModel = {
  provider: ProviderName;
  modelId: string;
  model: LanguageModel;
  /** Provedor secundário elegível (fallback), quando configurado. */
  fallbackProvider: ProviderName | null;
  /**
   * Array mutável preenchido em runtime com cada tentativa/troca de provedor.
   * Os pipelines já existentes apenas o leem para gravar em `ai_jobs`.
   */
  providerAttempts: ProviderAttempt[];
};

export type BrandAiCandidate = {
  provider: ProviderName;
  modelId: string;
  model: LanguageModel;
  providerAttempts: ProviderAttempt[];
};

/** Resumo curto (sem segredos) para gravar em ai_jobs. */
export function describeProviderAttempts(attempts: ProviderAttempt[]): string {
  return attempts
    .map(
      (a) =>
        `${a.provider}/${a.model}#${a.attempt}:${a.result}${a.detail ? ` (${a.detail})` : ""}`,
    )
    .join(" → ");
}

export type BrandProviderKey = {
  provider: ProviderName;
  apiKey: string;
};

/**
 * Resolve the brand's configured provider (selector in Conexões) and return
 * its decrypted API key. Throws when nothing usable is configured — the app
 * must NEVER silently fall back to Lovable AI.
 */
export async function getBrandProviderKey(
  supabase: SupabaseClient,
  brandId: string,
  kind: ProviderKind = "text",
  only?: ProviderName[],
): Promise<BrandProviderKey> {
  const { data: conn, error: connErr } = await supabase
    .from("brand_connections")
    .select("text_provider, image_provider, providers")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (connErr) throw connErr;

  const selected = (kind === "image" ? conn?.image_provider : conn?.text_provider) as
    | ProviderName
    | undefined;

  const providers = (conn?.providers ?? {}) as Record<string, { connected?: boolean } | undefined>;
  const allowed = (p: string): p is ProviderName => !only || (only as string[]).includes(p);

  const provider: ProviderName | undefined =
    selected && providers[selected]?.connected && allowed(selected)
      ? selected
      : (Object.entries(providers).find(([k, v]) => v?.connected && allowed(k))?.[0] as
          | ProviderName
          | undefined);

  if (!provider) {
    throw new Error(
      "ai_provider_not_configured: nenhuma IA configurada para esta marca. Configure uma chave em Conexões.",
    );
  }

  const { data: credRow, error: credErr } = await supabase
    .from("brand_api_credentials")
    .select("ciphertext")
    .eq("brand_id", brandId)
    .eq("provider", provider)
    .maybeSingle();
  if (credErr) throw credErr;
  if (!credRow?.ciphertext) {
    throw new Error(
      `ai_provider_key_missing:${provider}: a chave do provedor não foi encontrada. Reconfigure em Conexões.`,
    );
  }

  const apiKey = await decryptCredential(credRow.ciphertext as string);
  return { provider, apiKey };
}

export function instantiateProviderModel(
  provider: ProviderName,
  apiKey: string,
  modelId: string,
): LanguageModel {
  if (provider === "openai") return createOpenAI({ apiKey })(modelId);
  if (provider === "anthropic") return createAnthropic({ apiKey })(modelId);
  if (provider === "groq") return createGroq({ apiKey })(modelId);
  return createGoogleGenerativeAI({ apiKey })(modelId);
}

const instantiateModel = instantiateProviderModel;

/**
 * Provedor secundário da marca (`brand_connections.text_fallback_provider`).
 * Só é elegível quando é diferente do principal, está conectado e possui
 * chave decifrável. Retorna null quando não há fallback usável — marcas com um
 * único provedor continuam funcionando exatamente como antes.
 */
export async function getBrandFallbackProviderKey(
  supabase: SupabaseClient,
  brandId: string,
  primary: ProviderName,
): Promise<BrandProviderKey | null> {
  try {
    const { data: conn } = await supabase
      .from("brand_connections")
      .select("text_fallback_provider, providers")
      .eq("brand_id", brandId)
      .maybeSingle();
    const fallback = (conn as { text_fallback_provider?: string | null } | null)
      ?.text_fallback_provider as ProviderName | null | undefined;
    if (!fallback || fallback === primary) return null;
    const providers = (conn?.providers ?? {}) as Record<
      string,
      { connected?: boolean } | undefined
    >;
    if (!providers[fallback]?.connected) return null;
    if (!supportsKind(fallback, "text")) return null;

    const { data: credRow } = await supabase
      .from("brand_api_credentials")
      .select("ciphertext")
      .eq("brand_id", brandId)
      .eq("provider", fallback)
      .maybeSingle();
    if (!credRow?.ciphertext) return null;
    const apiKey = await decryptCredential(credRow.ciphertext as string);
    return { provider: fallback, apiKey };
  } catch (err) {
    console.warn("[ai-provider] fallback provider indisponível", err);
    return null;
  }
}

type ModelV2 = Extract<LanguageModel, { doGenerate: unknown }>;

/**
 * Formatos de uso vistos na prática:
 * - AI SDK v5: `inputTokens` / `outputTokens` — número OU objeto `{ total }`
 *   (é o caso do provedor OpenAI-compatible usado pelo Groq);
 * - AI SDK v4: `promptTokens` / `completionTokens`;
 * - payload cru OpenAI/Groq (em `usage.raw` ou `providerMetadata`):
 *   `prompt_tokens` / `completion_tokens` / `input_tokens` / `output_tokens`.
 */
type TokenCount = number | { total?: number | null } | null | undefined;

type UsageLike =
  | ({
      inputTokens?: TokenCount;
      outputTokens?: TokenCount;
      promptTokens?: TokenCount;
      completionTokens?: TokenCount;
      prompt_tokens?: TokenCount;
      completion_tokens?: TokenCount;
      input_tokens?: TokenCount;
      output_tokens?: TokenCount;
      totalTokens?: TokenCount;
      total_tokens?: TokenCount;
      raw?: Record<string, unknown> | null;
    } & Record<string, unknown>)
  | null
  | undefined;

/** Lê um contador que pode vir como número ou como `{ total }`. */
function tokenValue(v: unknown): number {
  if (v && typeof v === "object" && "total" in (v as object)) {
    const n = Number((v as { total?: unknown }).total);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function readUsage(usage: UsageLike): { inTok: number; outTok: number } {
  const pick = (...vals: unknown[]) => {
    for (const v of vals) {
      const n = tokenValue(v);
      if (n > 0) return n;
    }
    return 0;
  };
  const raw = (usage?.raw ?? {}) as Record<string, unknown>;
  const inTok = pick(
    usage?.inputTokens,
    usage?.promptTokens,
    usage?.prompt_tokens,
    usage?.input_tokens,
    raw["prompt_tokens"],
    raw["input_tokens"],
  );
  const outTok = pick(
    usage?.outputTokens,
    usage?.completionTokens,
    usage?.completion_tokens,
    usage?.output_tokens,
    raw["completion_tokens"],
    raw["output_tokens"],
  );
  // Alguns provedores reportam só o total: preserva o volume na entrada.
  if (inTok === 0 && outTok === 0) {
    const total = pick(usage?.totalTokens, usage?.total_tokens, raw["total_tokens"]);
    if (total > 0) return { inTok: total, outTok: 0 };
  }
  return { inTok, outTok };
}

/**
 * Envolve o modelo com duas responsabilidades:
 * 1. fallback: se o provedor rejeitar por modelo descontinuado/indisponível,
 *    tenta o próximo da cadeia do papel e promove o modelo no catálogo;
 * 2. medição: grava tokens, custo e sucesso/erro em `brand_ai_usage` para
 *    toda chamada — inclusive streaming — sem tocar nos pontos de chamada.
 */
function withModelInstrumentation(
  base: ModelV2,
  ctx: {
    provider: ProviderName;
    role: ProviderRole;
    apiKey: string;
    brandId: string;
    usage?: AiUsageContext;
    /** Provedor secundário elegível — usado só em falha transitória. */
    fallback?: { provider: ProviderName; apiKey: string; modelId: string } | null;
    attempts: ProviderAttempt[];
    /** Teto de chamadas reais ao provedor na operação (compartilhado). */
    budget: AiRequestBudget;
  },
): ModelV2 {
  const log = (
    modelId: string,
    inTok: number,
    outTok: number,
    success: boolean,
    errorMessage?: string | null,
    meta?: { provider?: ProviderName; kind?: string; attempt?: number },
  ) => {
    void recordAiUsage({
      brandId: ctx.brandId,
      model: modelId,
      inputTokens: inTok,
      outputTokens: outTok,
      success,
      ...(errorMessage ? { errorMessage } : {}),
      ...(success ? {} : { errorKind: meta?.kind ?? "unknown" }),
      provider: meta?.provider ?? ctx.provider,
      step: ctx.usage?.agent ?? ctx.role,
      attempt: meta?.attempt ?? 1,
      agent: ctx.usage?.agent ?? `${ctx.role}.${ctx.provider}`,
      clientId: ctx.usage?.clientId ?? null,
      userId: ctx.usage?.userId ?? null,
    });
  };

  /** Conta tokens ao final do stream sem consumir/alterar o conteúdo. */
  const instrumentStream = (
    result: Awaited<ReturnType<ModelV2["doStream"]>>,
    modelId: string,
  ): Awaited<ReturnType<ModelV2["doStream"]>> => {
    let inTok = 0;
    let outTok = 0;
    let streamError: string | null = null;
    let streamKind: string | null = null;
    const meter = new TransformStream<unknown, unknown>({
      transform(chunk, controller) {
        const part = chunk as { type?: string; usage?: UsageLike; error?: unknown };
        if (part?.type === "finish" && part.usage) {
          const u = readUsage(part.usage);
          inTok = u.inTok || inTok;
          outTok = u.outTok || outTok;
        }
        if (part?.type === "error") {
          streamError =
            part.error instanceof Error ? part.error.message : String(part.error ?? "stream error");
          // Falha DEPOIS de geração parcial: preserva tokens já consumidos e a
          // classificação, para o consumo aparecer com causa no histórico.
          streamKind = classifyAiError(part.error).kind;
        }
        controller.enqueue(chunk);
      },
      flush() {
        if (streamError) {
          logAiFailure({
            op: ctx.usage?.agent ?? `${ctx.role}.stream`,
            step: "stream",
            provider: ctx.provider,
            model: modelId,
            kind: streamKind,
            retryable: streamKind ? isRecoverableFailure(streamKind) : null,
            brandId: ctx.brandId,
            clientId: ctx.usage?.clientId ?? null,
            userId: ctx.usage?.userId ?? null,
            detail: streamError,
          });
        }
        log(modelId, inTok, outTok, !streamError, streamError, {
          ...(streamKind ? { kind: streamKind } : {}),
        });
      },
    });
    return {
      ...result,
      stream: (result.stream as ReadableStream<unknown>).pipeThrough(meter),
    } as Awaited<ReturnType<ModelV2["doStream"]>>;
  };

  const attempt = async <T>(
    op: "doGenerate" | "doStream",
    options: Parameters<ModelV2["doGenerate"]>[0],
  ): Promise<T> => {
    const tried: string[] = [base.modelId];
    let current: ModelV2 = base;
    let provider = ctx.provider;
    let apiKey = ctx.apiKey;
    let switchedProvider = false;
    let call = 0;
    for (;;) {
      const modelId = tried[tried.length - 1] ?? base.modelId;
      call += 1;
      // Teto DURO da operação: verificado antes de cada chamada real, cobrindo
      // retry, troca de modelo do catálogo e troca de provedor.
      takeAiRequest(ctx.budget, {
        op: ctx.usage?.agent ?? `${ctx.role}.${op}`,
        provider,
        model: modelId,
      });
      try {
        const out = (await (current[op] as (o: unknown) => Promise<unknown>)(options)) as T;
        if (op === "doStream") {
          return instrumentStream(out as Awaited<ReturnType<ModelV2["doStream"]>>, modelId) as T;
        }
        const raw = out as {
          usage?: UsageLike;
          providerMetadata?: Record<string, { usage?: UsageLike } | undefined>;
          response?: { body?: { usage?: UsageLike } | null } | null;
        };
        // Groq/OpenAI-compatible às vezes só expõe os tokens no payload cru.
        const { inTok, outTok } = readUsage(
          raw.usage ??
            raw.providerMetadata?.[provider]?.usage ??
            raw.providerMetadata?.["openai"]?.usage ??
            raw.response?.body?.usage,
        );

        if (inTok === 0 && outTok === 0) {
          // Diagnóstico: aponta onde o provedor escondeu os tokens.
          console.warn(
            `[ai-provider] uso sem tokens ${provider}/${modelId} — chaves: ` +
              `raiz=${Object.keys((raw ?? {}) as object).join(",")} ` +
              `usage=${JSON.stringify(raw.usage ?? null)} ` +
              `providerMetadata=${JSON.stringify(raw.providerMetadata ?? null).slice(0, 400)}`,
          );
        }
        log(modelId, inTok, outTok, true, null, { provider, attempt: call });

        ctx.attempts.push({ provider, model: modelId, attempt: call, result: "success" });
        return out;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const { kind, retryable } = classifyAiError(err);
        const detail = redactAiDetail(unwrapAiError(err).text);
        ctx.attempts.push({
          provider,
          model: modelId,
          attempt: call,
          result: kind,
          detail,
        });
        // Consumo é registrado MESMO em falha — inclusive nas tentativas
        // intermediárias que serão seguidas de retry/fallback. Sem isso, um
        // 429 seguido de fallback bem-sucedido desaparecia do histórico.
        log(modelId, 0, 0, false, msg, { provider, kind, attempt: call });
        const logEntry = {
          op: ctx.usage?.agent ?? `${ctx.role}.${op}`,
          step: ctx.role,
          provider,
          model: modelId,
          attempt: call,
          kind,
          retryable,
          brandId: ctx.brandId,
          clientId: ctx.usage?.clientId ?? null,
          userId: ctx.usage?.userId ?? null,
          detail,
        };


        // 1) Modelo descontinuado/indisponível no MESMO provedor: promove o
        //    próximo da cadeia do papel (comportamento já existente).
        if (isModelUnavailableError(msg)) {
          const next = nextFallbackModel(provider, ctx.role, tried);
          if (next) {
            logAiRetry({ ...logEntry, detail: `modelo indisponível — tentando ${next}` });
            await saveCatalogOverride({
              provider,
              role: ctx.role,
              modelId: next,
              replacedModelId: modelId,
              reason: msg,
            });
            tried.push(next);
            current = instantiateModel(provider, apiKey, next) as ModelV2;
            continue;
          }
        }

        // 2) Falha transitória do PROVEDOR (503/429/quota/timeout): tenta uma
        //    única vez o provedor secundário da marca. Erros permanentes
        //    (chave inválida, config, request inválido) nunca trocam provedor.
        const transient =
          retryable &&
          (kind === "provider_unavailable" ||
            kind === "provider_rate_limit" ||
            kind === "provider_quota");
        if (transient && ctx.fallback && !switchedProvider) {
          switchedProvider = true;
          logAiRetry({
            ...logEntry,
            detail: `alternando para ${ctx.fallback.provider}/${ctx.fallback.modelId}`,
          });
          provider = ctx.fallback.provider;
          apiKey = ctx.fallback.apiKey;
          tried.length = 0;
          tried.push(ctx.fallback.modelId);
          current = instantiateModel(provider, apiKey, ctx.fallback.modelId) as ModelV2;
          continue;
        }

        // Terminal: já registrado como consumo com classificação acima.
        logAiFailure(logEntry);
        if (isModelUnavailableError(msg)) {
          throw new Error(
            `ai_model_unavailable:${provider}:${ctx.role}: o modelo ${modelId} foi descontinuado pelo provedor e não há substituto configurado. Detalhe: ${unwrapAiError(err).text.slice(0, 300)}`,
          );
        }
        throw err;
      }
    }
  };

  return {
    ...base,
    specificationVersion: base.specificationVersion,
    provider: base.provider,
    modelId: base.modelId,
    supportedUrls: base.supportedUrls,
    doGenerate: (options: Parameters<ModelV2["doGenerate"]>[0]) =>
      attempt<Awaited<ReturnType<ModelV2["doGenerate"]>>>("doGenerate", options),
    doStream: (options: Parameters<ModelV2["doStream"]>[0]) =>
      attempt<Awaited<ReturnType<ModelV2["doStream"]>>>("doStream", options),
  } as ModelV2;
}

/**
 * Teto mensal: bloqueia a chamada quando a marca/cliente estourou o orçamento.
 * Best-effort — falha de RPC não impede a geração.
 */
async function assertBudget(
  supabase: SupabaseClient,
  brandId: string,
  usage?: AiUsageContext,
): Promise<void> {
  try {
    const { data } = await supabase.rpc("check_ai_usage_budget", {
      _brand_id: brandId,
      _client_id: usage?.clientId ?? null,
      _user_id: usage?.userId ?? null,
    });
    const b = data as {
      allowed?: boolean;
      blocked_by?: string;
      limit_usd?: number;
      spent_usd?: number;
    } | null;
    if (b && b.allowed === false) {
      throw new Error(
        `ai_budget_exceeded:${b.blocked_by ?? "brand"}:${b.spent_usd ?? 0}:${b.limit_usd ?? 0}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("ai_budget_exceeded")) throw err;
    console.warn("[ai-provider] check_ai_usage_budget falhou", msg);
  }
}

/**
 * Load the brand's configured AI provider + decrypted key and return an
 * AI SDK LanguageModel for the requested role from the model catalog.
 */
export async function getBrandAiModel(
  supabase: SupabaseClient,
  brandId: string,
  kind: ProviderKind = "text",
  role: ProviderRole = "operational",
  usage?: AiUsageContext,
): Promise<BrandAiModel> {
  const { provider, apiKey } = await getBrandProviderKey(supabase, brandId, kind);
  const modelId = await resolveModel(provider, role);
  if (!modelId) {
    throw new Error(
      `ai_model_unavailable:${provider}:${role}: o provedor não oferece modelo para esta função.`,
    );
  }

  await assertBudget(supabase, brandId, usage);

  // Provedor secundário (opcional): usado apenas em falha transitória.
  let fallback: { provider: ProviderName; apiKey: string; modelId: string } | null = null;
  if (kind === "text") {
    const cred = await getBrandFallbackProviderKey(supabase, brandId, provider);
    if (cred) {
      const fbModel = await resolveModel(cred.provider, role);
      if (fbModel) fallback = { provider: cred.provider, apiKey: cred.apiKey, modelId: fbModel };
    }
  }

  const providerAttempts: ProviderAttempt[] = [];
  const requestBudget = createAiRequestBudget();
  const base = instantiateModel(provider, apiKey, modelId) as ModelV2;
  const model = withModelInstrumentation(base, {
    provider,
    role,
    apiKey,
    brandId,
    fallback,
    attempts: providerAttempts,
    budget: requestBudget,
    ...(usage ? { usage } : {}),
  });

  return {
    provider,
    modelId,
    model,
    fallbackProvider: fallback?.provider ?? null,
    providerAttempts,
  };
}

/**
 * Resolve os modelos configurados em ordem, sem fallback dentro do wrapper.
 * Chamadas com contratos específicos por provider (como briefing estruturado)
 * usam esta lista para reconstruir as opções a cada tentativa.
 */
export async function getBrandAiCandidates(
  supabase: SupabaseClient,
  brandId: string,
  role: ProviderRole = "operational",
  usage?: AiUsageContext,
): Promise<BrandAiCandidate[]> {
  const primary = await getBrandProviderKey(supabase, brandId, "text");
  const primaryModelId = await resolveModel(primary.provider, role);
  if (!primaryModelId) {
    throw new Error(
      `ai_model_unavailable:${primary.provider}:${role}: o provedor não oferece modelo para esta função.`,
    );
  }

  await assertBudget(supabase, brandId, usage);
  const credentials: BrandProviderKey[] = [primary];
  const fallback = await getBrandFallbackProviderKey(supabase, brandId, primary.provider);
  if (fallback) credentials.push(fallback);

  const candidates: BrandAiCandidate[] = [];
  // Um único budget para TODA a operação: o consumo soma as tentativas de
  // todos os candidatos, não reinicia a cada troca de provedor.
  const requestBudget = createAiRequestBudget();
  for (const credential of credentials) {
    const modelId =
      credential.provider === primary.provider
        ? primaryModelId
        : await resolveModel(credential.provider, role);
    if (!modelId) continue;
    const providerAttempts: ProviderAttempt[] = [];
    const base = instantiateModel(credential.provider, credential.apiKey, modelId) as ModelV2;
    candidates.push({
      provider: credential.provider,
      modelId,
      providerAttempts,
      model: withModelInstrumentation(base, {
        provider: credential.provider,
        role,
        apiKey: credential.apiKey,
        brandId,
        fallback: null,
        attempts: providerAttempts,
        budget: requestBudget,
        ...(usage ? { usage } : {}),
      }),
    });
  }
  return candidates;
}

/* ------------------------------------------------------------------ */
/* Embeddings (1536 dims — matches the brain_embeddings vector column) */
/* ------------------------------------------------------------------ */

const EMBED_PROVIDERS: ProviderName[] = ["openai", "gemini"];

/** Uma chamada de embedding, com timeout duro. Lança em falha. */
async function callEmbeddingProvider(
  provider: ProviderName,
  apiKey: string,
  text: string,
): Promise<number[]> {
  const signal = AbortSignal.timeout(EMBED_TIMEOUT_MS);
  let res: Response;
  let vec: unknown;
  if (provider === "openai") {
    res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text,
        dimensions: EMBED_DIMS,
      }),
      signal,
    });
    if (!res.ok) {
      throw Object.assign(
        new Error(
          `ai_embedding_failed:openai:${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`,
        ),
        { status: res.status },
      );
    }
    vec = ((await res.json()) as { data?: Array<{ embedding: number[] }> }).data?.[0]?.embedding;
  } else {
    res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: EMBED_DIMS,
        }),
        signal,
      },
    );
    if (!res.ok) {
      throw Object.assign(
        new Error(
          `ai_embedding_failed:gemini:${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`,
        ),
        { status: res.status },
      );
    }
    vec = ((await res.json()) as { embedding?: { values?: number[] } }).embedding?.values;
  }
  if (!isValidEmbedding(vec)) {
    throw new Error(`ai_embedding_invalid_output:${provider}: dimensão inesperada`);
  }
  return vec;
}

/**
 * Create an embedding with the brand's own API key. Anthropic has no
 * embedding endpoint, so OpenAI/Gemini keys are used.
 *
 * Cada tentativa tem timeout; falha transitória é repetida com backoff e,
 * esgotado o provider, cai no outro provider de embedding conectado na marca.
 * Retorna null quando nada funcionou — o Brain degrada em vez de quebrar, e
 * NUNCA devolve vetor de dimensão errada (isso corromperia a coluna vector).
 */
export async function embedTextWithBrandKey(
  supabase: SupabaseClient,
  brandId: string,
  text: string,
): Promise<number[] | null> {
  const trimmed = normalizeEmbeddingInput(text);
  if (!trimmed) return null;

  let primary: BrandProviderKey;
  try {
    primary = await getBrandProviderKey(supabase, brandId, "text", EMBED_PROVIDERS);
  } catch (err) {
    logAiFailure({
      op: "embedding",
      step: "credenciais",
      kind: "config",
      retryable: false,
      brandId,
      detail: unwrapAiError(err).text,
    });
    void recordAiUsage({
      brandId,
      model: "embedding",
      inputTokens: 0,
      outputTokens: 0,
      success: false,
      errorKind: "config",
      errorMessage: unwrapAiError(err).text,
      step: "embedding",
      agent: "embedding",
    });
    return null;
  }


  const candidates: BrandProviderKey[] = [primary];
  for (const other of EMBED_PROVIDERS) {
    if (other === primary.provider) continue;
    try {
      candidates.push(await getBrandProviderKey(supabase, brandId, "text", [other]));
    } catch {
      // provider secundário não conectado nesta marca — segue com o principal
    }
  }

  let lastKind = "unknown";
  let lastDetail = "";
  for (const cred of candidates) {
    for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt++) {
      try {
        return await callEmbeddingProvider(cred.provider, cred.apiKey, trimmed);
      } catch (err) {
        const status = (err as { status?: number }).status;
        const retryable =
          typeof status === "number"
            ? isRetryableEmbeddingStatus(status)
            : isRetryableEmbeddingError(err);
        lastKind = classifyAiError(err).kind;
        lastDetail = unwrapAiError(err).text;
        const entry = {
          op: "embedding",
          step: "embed",
          provider: cred.provider,
          model: "embedding",
          attempt,
          kind: lastKind,
          retryable,
          brandId,
          detail: lastDetail,
        };
        if (retryable && attempt < EMBED_MAX_ATTEMPTS) logAiRetry(entry);
        else logAiFailure(entry);
        if (!retryable) break; // erro de request/dimensão: repetir não muda nada
        if (attempt < EMBED_MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, embeddingBackoffMs(attempt)));
        }
      }
    }
  }
  // Degradação continua sendo `null`, mas nunca silenciosa: a tentativa
  // aparece em `brand_ai_usage` com classificação.
  void recordAiUsage({
    brandId,
    model: "embedding",
    inputTokens: 0,
    outputTokens: 0,
    success: false,
    errorKind: lastKind,
    errorMessage: lastDetail,
    step: "embedding",
    agent: "embedding",
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* Image generation                                                    */
/* ------------------------------------------------------------------ */

export type BrandGeneratedImage = {
  provider: ProviderName;
  base64: string;
  contentType: string;
};

const IMAGE_TIMEOUT_MS = 90_000;

async function openaiImage(
  apiKey: string,
  modelId: string,
  prompt: string,
): Promise<BrandGeneratedImage> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelId, prompt, size: "1024x1024", n: 1 }),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `ai_image_failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("ai_image_empty: modelo não retornou imagem");
  return { provider: "openai", base64: b64, contentType: "image/png" };
}

/**
 * Gemini tem DOIS contratos de imagem:
 * - `gemini-*-image` → `:generateContent` com `responseModalities: [IMAGE]`
 *   (funciona com a chave comum da API Gemini);
 * - `imagen-*` → `:predict` (exige projeto com faturamento habilitado).
 */
async function geminiImage(
  apiKey: string,
  modelId: string,
  prompt: string,
): Promise<BrandGeneratedImage> {
  const isImagen = modelId.startsWith("imagen");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:${
    isImagen ? "predict" : "generateContent"
  }`;
  const body = isImagen
    ? { instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: "1:1" } }
    : {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(
      `ai_image_failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    }>;
  };
  const inline = isImagen
    ? (() => {
        const p = json.predictions?.[0];
        return p?.bytesBase64Encoded
          ? { data: p.bytesBase64Encoded, mimeType: p.mimeType }
          : null;
      })()
    : (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.inlineData)
        .find((d): d is { data: string; mimeType?: string } => typeof d?.data === "string") ?? null;
  if (!inline?.data) throw new Error("ai_image_empty: modelo não retornou imagem");
  return { provider: "gemini", base64: inline.data, contentType: inline.mimeType ?? "image/png" };
}

/**
 * Generate an image with the brand's own image provider key.
 * Anthropic has no image model, so only OpenAI/Gemini are eligible.
 *
 * Percorre a cadeia de modelos do catálogo: quando a conta não libera o modelo
 * (404/403 do Imagen, por exemplo), o próximo candidato é tentado antes de
 * devolver erro ao usuário.
 */
export async function generateBrandImage(
  supabase: SupabaseClient,
  brandId: string,
  prompt: string,
  usage: AiUsageContext = {},
): Promise<BrandGeneratedImage> {
  const creds = await getBrandProviderKey(supabase, brandId, "image", IMAGE_PROVIDERS);
  if (!supportsKind(creds.provider, "image")) {
    throw new Error(
      `ai_image_unsupported:${creds.provider}: este provedor não gera imagens. Selecione OpenAI ou Gemini em Conexões.`,
    );
  }
  const primary = await resolveModel(creds.provider, "image");
  const { MODEL_FALLBACKS } = await import("./ai-models-catalog.server");
  const candidates = [
    ...(primary ? [primary] : []),
    ...(MODEL_FALLBACKS[creds.provider].image ?? []),
  ].filter((id, i, arr) => arr.indexOf(id) === i);
  if (candidates.length === 0) {
    throw new Error(`ai_image_unsupported:${creds.provider}: sem modelo de imagem disponível.`);
  }

  let lastError: unknown = null;
  for (const modelId of candidates) {
    try {
      const image =
        creds.provider === "openai"
          ? await openaiImage(creds.apiKey, modelId, prompt)
          : await geminiImage(creds.apiKey, modelId, prompt);
      await recordAiUsage({
        brandId,
        model: modelId,
        inputTokens: 0,
        outputTokens: 0,
        success: true,
        ...usage,
        agent: usage.agent ?? "image.generate",
      });
      return image;
    } catch (err) {
      lastError = err;
      const { kind, retryable } = classifyAiError(err);
      logAiFailure({
        op: usage.agent ?? "image.generate",
        step: "image",
        provider: creds.provider,
        model: modelId,
        kind,
        retryable,
        brandId,
        clientId: usage.clientId ?? null,
        userId: usage.userId ?? null,
        detail: unwrapAiError(err).text,
      });
      await recordAiUsage({
        brandId,
        model: modelId,
        inputTokens: 0,
        outputTokens: 0,
        success: false,
        errorKind: kind,
        provider: creds.provider,
        step: "image",
        errorMessage: unwrapAiError(err).text,
        ...usage,
        agent: usage.agent ?? "image.generate",
      });
    }
  }
  throw lastError ?? new Error("ai_image_failed: nenhum modelo de imagem respondeu.");
}


/* ------------------------------------------------------------------ */
/* Admin variants — for background jobs with no user session           */
/* ------------------------------------------------------------------ */

/** Resolve o modelo da marca usando o client admin (jobs em background). */
export async function getBrandAiModelAdmin(
  brandId: string,
  kind: ProviderKind = "text",
  role: ProviderRole = "operational",
  usage?: AiUsageContext,
): Promise<BrandAiModel> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return getBrandAiModel(supabaseAdmin, brandId, kind, role, usage);
}

/** Candidatos BYOK isolados para chamadas provider-aware em background. */
export async function getBrandAiCandidatesAdmin(
  brandId: string,
  role: ProviderRole = "operational",
  usage?: AiUsageContext,
): Promise<BrandAiCandidate[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return getBrandAiCandidates(supabaseAdmin, brandId, role, usage);
}

/** Embedding com a chave da marca usando o client admin. */
export async function embedTextAdmin(brandId: string, text: string): Promise<number[] | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return embedTextWithBrandKey(supabaseAdmin, brandId, text);
}
