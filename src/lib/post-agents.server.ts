import { contentFormatLabel } from "@/lib/content-formats";
import { generateText, NoObjectGeneratedError } from "ai";
import { withPtBr } from "@/lib/ai-language";
import { z } from "zod";
import { getBrandAiModelAdmin, describeProviderAttempts } from "@/lib/ai-provider.server";
import { loadAgentPrompts, fillTemplate } from "@/lib/agent-prompts.server";
import { buildBrandContextBlueprint } from "@/lib/ai-agents.functions";
import { loadBriefingContext } from "@/lib/monthly-plan-context.server";
import { loadBrainAgentContext } from "@/lib/brain/agent-context.server";
import { loadStrategyContext } from "@/lib/monthly-plan-strategy.server";

/** Tempo após o qual uma geração marcada como em andamento é considerada presa. */
const STALE_LOCK_MS = 10 * 60 * 1000;

/**
 * ORQUESTRADOR DA PEÇA — cérebro único do fluxo operacional.
 *
 * Pauta aprovada → materialização → esta função. Monta o contexto real
 * (marca + briefing + pauta + tópico + canal/formato) e executa os agentes
 * cadastrados em `agent_prompts`:
 *   - roteirista_social    (somente formatos de vídeo)
 *   - art_director_social  (somente quando falta direção visual)
 *   - copywriter_senior    (sempre — produz a LEGENDA final)
 *
 * O resultado é persistido no próprio post (`copy`, `script`, `design_brief`).
 * Falhas nunca gravam legenda genérica: o post fica com `ai_phase='copy_failed'`
 * e o erro é registrado em `activity_events` para rastreio.
 */

const CopySchema = z.object({
  caption: z.string(),
  reasoning_summary: z.string().nullable().optional(),
});
const ScriptSchema = z.object({ script: z.string() });
const VisualSchema = z.object({ visual_direction: z.string() });

type TopicRow = {
  topic_title: string;
  angle: string | null;
  target_audience: string | null;
  rationale: string | null;
  channel: string | null;
  content_format: string | null;
  monthly_plan_id: string | null;
};

type PostRow = {
  id: string;
  brand_id: string;
  client_id: string;
  project_id: string | null;
  title: string;
  format: string | null;
  channels: string[] | null;
  copy: string | null;
  script: unknown;
  design_brief: string | null;
  internal_briefing: string | null;
  client_briefing: string | null;
  monthly_plan_topic_id: string | null;
};

function isVideoFormat(format: string | null, channels: string[] | null): boolean {
  const s = `${format ?? ""} ${(channels ?? []).join(" ")}`.toLowerCase();
  return /reel|tiktok|short|v[ií]deo|video|youtube/.test(s);
}

/**
 * Classificação de falha, espaçamento e backoff vivem em `ai-failures.server.ts`
 * (fonte única compartilhada com o pipeline de Estratégia). Reexportados aqui
 * para preservar os pontos de importação existentes desta Copy.
 */
import {
  classifyAiError,
  sleep,
  SPACING_MS,
  BACKOFF_MS,
  type FailureKind,
} from "@/lib/ai-failures.server";

export { classifyAiError };
export type { FailureKind };

type RunTrace = {
  provider: string | null;
  model: string | null;
  fallbackProvider: string | null;
  /** Resumo `provedor/modelo#tentativa:resultado → …` da chamada real. */
  providerTrace: string | null;
};

/**
 * Escapa quebras de linha e tabs literais que aparecem DENTRO de strings JSON.
 * Modelos frequentemente devolvem roteiros com `\n` reais, o que invalida o
 * JSON — a estrutura está correta, só a serialização está errada.
 */
function repairJsonStringLiterals(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of input) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t";
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Extrai o primeiro objeto JSON de uma resposta em texto, tolerando cercas de
 * código, comentários antes/depois e quebras de linha literais dentro das
 * strings. Devolve `null` se não houver JSON aproveitável.
 */
function extractJsonObject(text: string): unknown {
  const cleaned = (text ?? "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!cleaned) return null;
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(repairJsonStringLiterals(candidate));
    } catch {
      return null;
    }
  }
}

/**
 * Último recurso para agentes de campo textual único (roteiro, direção
 * visual): o modelo escreveu o conteúdo pedido, mas em prosa, sem JSON.
 * Usa o próprio texto como valor do campo — nunca inventa conteúdo.
 */
function coerceSingleField(text: string, key: string): unknown | null {
  const cleaned = (text ?? "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (cleaned.length < 20) return null;
  return { [key]: cleaned };
}


/**
 * Chamada estruturada agnóstica de provedor: pede JSON no prompt e valida o
 * texto com o schema. Não usa structured output nativo — o provedor
 * OpenAI-compatible (Groq) devolve saída vazia nesse modo, o que travava a
 * cadeia de copy inteira.
 */
async function runStructured<T extends z.ZodTypeAny>(opts: {
  brandId: string;
  /** Quem originou a geração — vira `actor_id` em `brand_ai_usage`. */
  clientId?: string | null;
  userId?: string | null;
  system: string;
  prompt: string;
  schema: T;
  /** Campo único do schema — permite aceitar resposta em prosa (sem JSON). */
  textFallbackKey?: string;
  onAttempt?: (
    attempt: number,
    kind: FailureKind,
    message: string,
    trace: RunTrace,
  ) => Promise<void> | void;
}): Promise<{ output: z.infer<T>; attempts: number; trace: RunTrace }> {
  const maxAttempts = BACKOFF_MS.length + 1;
  let lastErr: unknown = null;
  let trace: RunTrace = {
    provider: null,
    model: null,
    fallbackProvider: null,
    providerTrace: null,
  };

  const parseAny = (text: string): z.infer<T> | null => {
    const raw = extractJsonObject(text);
    if (raw !== null) {
      const parsed = opts.schema.safeParse(raw);
      if (parsed.success) return parsed.data as z.infer<T>;
    }
    if (opts.textFallbackKey) {
      const coerced = coerceSingleField(text, opts.textFallbackKey);
      if (coerced !== null) {
        const parsed = opts.schema.safeParse(coerced);
        if (parsed.success) return parsed.data as z.infer<T>;
      }
    }
    return null;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let handle: Awaited<ReturnType<typeof getBrandAiModelAdmin>> | null = null;
    try {
      handle = await getBrandAiModelAdmin(opts.brandId, "text", "operational", {
        agent: "post.agent",
        clientId: opts.clientId ?? null,
        userId: opts.userId ?? null,
      });
      trace = {
        provider: handle.provider,
        model: handle.modelId,
        fallbackProvider: handle.fallbackProvider,
        providerTrace: null,
      };
      const res = await generateText({
        model: handle.model,
        system: withPtBr(opts.system),
        prompt: opts.prompt,
        // Retry é controlado aqui (backoff próprio) para respeitar a quota do provedor.
        maxRetries: 0,
      });
      trace.providerTrace = describeProviderAttempts(handle.providerAttempts) || null;

      const output = parseAny(res.text ?? "");
      if (output === null) throw new Error("ai_invalid_output");
      return { output, attempts: attempt, trace };
    } catch (err) {
      if (handle) trace.providerTrace = describeProviderAttempts(handle.providerAttempts) || null;
      // Saída malformada emitida como erro do SDK: tenta recuperar o JSON bruto.
      if (NoObjectGeneratedError.isInstance(err)) {
        const recovered = parseAny(err.text ?? "");
        if (recovered !== null) {
          return { output: recovered, attempts: attempt, trace };
        }
        lastErr = new Error("ai_invalid_output");
      } else {
        lastErr = err;
      }



      const { retryable, kind } = classifyAiError(lastErr);
      const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
      await opts.onAttempt?.(attempt, kind, message, trace);
      if (!retryable || attempt === maxAttempts) break;
      await sleep(BACKOFF_MS[attempt - 1]!);
    }
  }
  throw lastErr ?? new Error("ai_unknown_error");
}

async function logAttempt(
  admin: import("@supabase/supabase-js").SupabaseClient,
  post: Pick<PostRow, "id" | "brand_id" | "client_id">,
  info: {
    agent: string;
    step: string;
    channel: string;
    format: string;
    attempt: number;
    ok: boolean;
    kind?: FailureKind;
    retryable?: boolean;
    message?: string;
    /** Identificador da execução da peça (todas as etapas compartilham). */
    jobId?: string;
    trace?: RunTrace | null;
    /** Contexto/etapas concluídas até aqui. */
    completedSteps?: string[];
    contextParts?: string[];
    degraded?: string[];
  },
) {
  if (!info.ok) {
    console.error(
      `[post-agents] falha agente=${info.agent} etapa=${info.step} tentativa=${info.attempt} ` +
        `provider=${info.trace?.provider ?? "?"}/${info.trace?.model ?? "?"} ` +
        `motivo=${info.kind} retryable=${info.retryable} post=${post.id}: ${info.message}`,
    );
  }
  try {
    await admin.from("activity_events").insert({
      brand_id: post.brand_id,
      client_id: post.client_id,
      entity_type: "post",
      entity_id: post.id,
      verb: info.ok ? "ai_agent_succeeded" : "ai_generation_failed",
      payload: {
        post_id: post.id,
        job_id: info.jobId ?? null,
        agent: info.agent,
        step: info.step,
        channel: info.channel,
        format: info.format,
        attempt: info.attempt,
        ok: info.ok,
        provider: info.trace?.provider ?? null,
        model: info.trace?.model ?? null,
        fallback_provider: info.trace?.fallbackProvider ?? null,
        provider_trace: info.trace?.providerTrace ?? null,
        completed_steps: info.completedSteps ?? null,
        context_parts: info.contextParts ?? null,
        degraded: info.degraded?.length ? info.degraded : null,
        failure_kind: info.kind ?? null,
        retryable: info.retryable ?? null,
        error: info.message ? info.message.slice(0, 800) : null,
        at: new Date().toISOString(),
      },
    } as never);
  } catch {
    // auditoria não crítica
  }
}

export type GeneratePostResult =
  | { status: "generated"; agents: string[] }
  | { status: "skipped"; reason: string }
  | {
      status: "failed";
      agent: string;
      error: string;
      kind: FailureKind;
      retryable: boolean;
    };

/** Fases persistidas em `posts.ai_phase`. */
export const AI_PHASE = {
  idea: "idea",
  running: "copy_running",
  ready: "copy_ready",
  retryable: "copy_failed_retryable",
  permanent: "copy_failed_permanent",
} as const;

/** Fases que podem ser retomadas pelo pipeline oficial. */
export const RESUMABLE_AI_PHASES = ["idea", "copy_failed", "copy_failed_retryable"] as const;

/**
 * Gera o conteúdo de uma peça. Idempotente: se a legenda já existe e
 * `force` é falso, não reexecuta nem duplica nada.
 */
export async function generatePostContent(
  postId: string,
  opts: { force?: boolean; userId?: string | null } = {},
): Promise<GeneratePostResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;

  const { data: postData, error: postErr } = await admin
    .from("posts")
    .select(
      "id, brand_id, client_id, project_id, title, format, channels, copy, script, design_brief, internal_briefing, client_briefing, monthly_plan_topic_id",
    )
    .eq("id", postId)
    .maybeSingle();
  if (postErr) throw postErr;
  const post = postData as unknown as PostRow | null;
  if (!post) return { status: "skipped", reason: "post_not_found" };
  if (!opts.force && (post.copy ?? "").trim().length > 0) {
    return { status: "skipped", reason: "copy_already_present" };
  }

  // ---- Trava de execução: claim atômico da peça -------------------------
  // Só assume a geração quem conseguir marcar `copy_running`. Uma execução
  // presa (worker morto/timeout) é reclamada após STALE_LOCK_MS.
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const { data: claimed } = await admin
    .from("posts")
    .update({ ai_phase: AI_PHASE.running, ai_phase_at: new Date().toISOString() } as never)
    .eq("id", post.id)
    .or(`ai_phase.neq.${AI_PHASE.running},ai_phase_at.lt.${staleBefore},ai_phase_at.is.null`)
    .select("id");
  if (!claimed || (claimed as unknown as { id: string }[]).length === 0) {
    return { status: "skipped", reason: "already_running" };
  }

  /** Identificador da execução — une todas as etapas na telemetria. */
  const jobId = crypto.randomUUID();
  /** Contexto opcional que falhou — nunca silenciado. */
  const degraded: string[] = [];

  // ---- Contexto: tópico da pauta + pauta + briefing + blueprint da marca ----
  let topic: TopicRow | null = null;
  let planTitle: string | null = null;
  let planBriefingId: string | null = null;

  if (post.monthly_plan_topic_id) {
    const { data: t } = await admin
      .from("monthly_plan_topics")
      .select(
        "topic_title, angle, target_audience, rationale, channel, content_format, monthly_plan_id",
      )
      .eq("id", post.monthly_plan_topic_id)
      .maybeSingle();
    topic = (t as unknown as TopicRow | null) ?? null;
    if (topic?.monthly_plan_id) {
      const { data: plan } = await admin
        .from("monthly_plans")
        .select("title, input_briefing_id, context_sources")
        .eq("id", topic.monthly_plan_id)
        .maybeSingle();
      const p = plan as unknown as {
        title: string | null;
        input_briefing_id: string | null;
        context_sources: Record<string, unknown> | null;
      } | null;
      planTitle = p?.title ?? null;
      const currentVersion = p?.context_sources?.["briefing_version_id"];
      planBriefingId =
        (typeof currentVersion === "string" ? currentVersion : null) ??
        p?.input_briefing_id ??
        null;
    }
  } else {
    degraded.push("topic:missing (peça sem tópico de pauta vinculado)");
  }

  const noteDegraded = (part: string) => (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    degraded.push(`${part}:${msg.slice(0, 200)}`);
    console.warn(`[post-agents] contexto degradado (${part}) post=${post.id}: ${msg}`);
    return null;
  };

  const [blueprintRes, briefingRes, strategyRes, brainRes] = await Promise.all([
    buildBrandContextBlueprint(admin, post.brand_id, post.client_id).catch(
      noteDegraded("blueprint"),
    ),
    loadBriefingContext(admin, post.client_id, { briefingId: planBriefingId }).catch(
      noteDegraded("briefing"),
    ),
    // Estratégia IA já validada (voz, personas, cohorts, SWOT) — mesma fonte da Pauta.
    loadStrategyContext(admin, post.brand_id, post.client_id).catch(noteDegraded("strategy")),
    // Aprendizado consolidado do Brain, selecionado para o copywriter.
    loadBrainAgentContext(admin, {
      brandId: post.brand_id,
      clientId: post.client_id,
      agent: "copywriter_senior",
    }).catch(noteDegraded("brain")),
  ]);
  if (strategyRes && strategyRes.blocks.length === 0) {
    degraded.push("strategy:sem blocos ativos de Estratégia IA para este cliente");
  }

  const channel = (post.channels ?? [])[0] ?? topic?.channel ?? "instagram";
  // Prompt recebe o LABEL derivado da chave canônica (nunca rótulo legado).
  const format = contentFormatLabel(post.format ?? topic?.content_format ?? "feed");

  const pieceBriefing = [
    post.internal_briefing?.trim() ? `Briefing interno:\n${post.internal_briefing.trim()}` : "",
    post.client_briefing?.trim() ? `Briefing do cliente:\n${post.client_briefing.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const pieceContext = [
    `Título da peça: ${post.title}`,
    `Canal: ${channel}`,
    `Formato: ${format}`,
    planTitle ? `Pauta: ${planTitle}` : "",
    topic?.angle ? `Ângulo/estratégia do tópico: ${topic.angle}` : "",
    topic?.target_audience ? `Público-alvo do tópico: ${topic.target_audience}` : "",
    topic?.rationale ? `Racional estratégico: ${topic.rationale}` : "",
    pieceBriefing ||
      "Briefing específico da peça: (vazio — use o contexto da pauta e da marca, sem inventar fatos)",
  ]
    .filter(Boolean)
    .join("\n");

  const contextBlock = [
    blueprintRes?.blueprint ?? "",
    briefingRes?.text ? `## Briefing da marca\n${briefingRes.text}` : "",
    strategyRes?.markdown ? `## Estratégia IA da marca\n${strategyRes.markdown}` : "",
    brainRes?.markdown ?? "",
    `## Briefing desta peça\n${pieceContext}`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  /** Partes de contexto realmente entregues aos agentes (telemetria). */
  const contextParts = [
    blueprintRes?.blueprint ? "brand_blueprint" : "",
    briefingRes?.text ? "briefing" : "",
    strategyRes?.markdown ? `strategy(${strategyRes.blocks.join("+")})` : "",
    brainRes?.used
      ? `brain(${brainRes.used}/${brainRes.candidates}:${brainRes.scopes.join("+")})`
      : "",
    topic ? "plan_topic" : "",
    pieceBriefing ? "piece_briefing" : "",
  ].filter(Boolean);

  const needsScript = isVideoFormat(format, post.channels);
  const needsVisual = !needsScript && !(post.design_brief ?? "").trim();

  const agentIds = [
    "copywriter_senior",
    ...(needsScript ? ["roteirista_social"] : []),
    ...(needsVisual ? ["art_director_social"] : []),
  ] as const;

  let prompts: Map<string, string>;
  try {
    prompts = await loadAgentPrompts(post.brand_id, agentIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const { kind, retryable } = classifyAiError(err);
    await logAttempt(admin, post, {
      agent: "agent_prompts",
      step: "load_prompts",
      channel: String(channel),
      format: String(format),
      attempt: 1,
      ok: false,
      kind,
      retryable,
      message: msg,
    });
    await admin
      .from("posts")
      .update({ ai_phase: retryable ? AI_PHASE.retryable : AI_PHASE.permanent } as never)
      .eq("id", post.id);
    return { status: "failed", agent: "agent_prompts", error: msg, kind, retryable };
  }

  const vars = () => ({
    CONTEXT: contextBlock,
    BRIEFING: pieceBriefing || "(sem briefing específico)",
    TITULO: post.title,
    CANAL: String(channel),
    FORMATO: String(format),
    PLATAFORMA: String(channel),
    OBJETIVO: topic?.angle ?? "",
    // Personas reais da Estratégia IA; público do tópico como segunda fonte.
    PERSONAS: strategyRes?.personaNames?.length
      ? strategyRes.personaNames.join(", ")
      : (topic?.target_audience ?? ""),
    COHORTS: strategyRes?.cohortNames?.length ? strategyRes.cohortNames.join(", ") : "",
    MARCA: briefingRes?.clientName ?? "",
  });

  const used: string[] = [];
  const patch: Record<string, unknown> = {};
  const onAttempt =
    (agent: string, step: string) =>
    async (attempt: number, kind: FailureKind, message: string, trace: RunTrace) => {
      await logAttempt(admin, post, {
        agent,
        step,
        channel: String(channel),
        format: String(format),
        attempt,
        ok: false,
        kind,
        retryable: classifyAiError(new Error(message)).retryable,
        message,
        jobId,
        trace,
        completedSteps: [...used],
        contextParts,
        degraded,
      });
    };

  // 1) Roteirista (somente vídeo) — o roteiro alimenta a legenda depois.
  let scriptText = "";
  if (needsScript && prompts.get("roteirista_social")) {
    try {
      const { output, attempts, trace } = await runStructured({
        brandId: post.brand_id,
        clientId: post.client_id,
        userId: opts.userId ?? null,
        system: fillTemplate(prompts.get("roteirista_social")!, vars()),
        prompt:
          `${contextBlock}\n\nEscreva o roteiro completo desta peça de vídeo (${format} / ${channel}).\n` +
          `Responda EXCLUSIVAMENTE em JSON: {"script":"roteiro completo em texto, com cenas e falas"}`,
        schema: ScriptSchema,
        textFallbackKey: "script",
        onAttempt: onAttempt("roteirista_social", "script"),
      });
      scriptText = (output.script ?? "").trim();
      if (scriptText) {
        patch.script = [{ cena: 1, fala: scriptText }];
        used.push("roteirista_social");
        await logAttempt(admin, post, {
          agent: "roteirista_social",
          step: "script",
          channel: String(channel),
          format: String(format),
          attempt: attempts,
          ok: true,
          jobId,
          trace,
          completedSteps: [...used],
          contextParts,
          degraded,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { kind, retryable } = classifyAiError(err);
      await admin
        .from("posts")
        .update({
          ai_phase: retryable ? AI_PHASE.retryable : AI_PHASE.permanent,
          ai_phase_at: new Date().toISOString(),
        } as never)
        .eq("id", post.id);
      return { status: "failed", agent: "roteirista_social", error: msg, kind, retryable };
    }
  }

  // 2) Direção de arte (somente peças estáticas sem briefing visual).
  if (needsVisual && prompts.get("art_director_social")) {
    try {
      await sleep(SPACING_MS);
      const { output, attempts, trace } = await runStructured({
        brandId: post.brand_id,
        clientId: post.client_id,
        userId: opts.userId ?? null,
        system: fillTemplate(prompts.get("art_director_social")!, vars()),
        prompt:
          `${contextBlock}\n\nDescreva a direção visual desta peça (${format} / ${channel}).\n` +
          `Responda EXCLUSIVAMENTE em JSON: {"visual_direction":"orientação visual objetiva para o designer"}`,
        schema: VisualSchema,
        textFallbackKey: "visual_direction",
        onAttempt: onAttempt("art_director_social", "visual_direction"),
      });
      const vd = (output.visual_direction ?? "").trim();
      if (vd) {
        patch.design_brief = vd;
        used.push("art_director_social");
        await logAttempt(admin, post, {
          agent: "art_director_social",
          step: "visual_direction",
          channel: String(channel),
          format: String(format),
          attempt: attempts,
          ok: true,
          jobId,
          trace,
          completedSteps: [...used],
          contextParts,
          degraded,
        });
      }
    } catch (err) {
      // Direção visual é complementar: registra a degradação e segue para a copy.
      const msg = err instanceof Error ? err.message : String(err);
      degraded.push(`art_director_social:${msg.slice(0, 200)}`);
    }
  }

  // 3) Copywriter — LEGENDA final, campo único e pronto para publicação.
  const copyPrompt = prompts.get("copywriter_senior");
  if (!copyPrompt) {
    await logAttempt(admin, post, {
      agent: "copywriter_senior",
      step: "load_prompt",
      channel: String(channel),
      format: String(format),
      attempt: 1,
      ok: false,
      kind: "config",
      retryable: false,
      message: "prompt_missing",
      jobId,
      completedSteps: [...used],
      contextParts,
      degraded,
    });
    await admin
      .from("posts")
      .update({ ai_phase: AI_PHASE.permanent, ai_phase_at: new Date().toISOString() } as never)
      .eq("id", post.id);
    return {
      status: "failed",
      agent: "copywriter_senior",
      error: "prompt_missing",
      kind: "config",
      retryable: false,
    };
  }

  /** Provedor/modelo que efetivamente escreveu a legenda. */
  let copyTrace: RunTrace | null = null;
  try {
    if (used.length > 0) await sleep(SPACING_MS);
    const { output, attempts, trace } = await runStructured({
      brandId: post.brand_id,
      clientId: post.client_id,
      userId: opts.userId ?? null,
      system: fillTemplate(copyPrompt, vars()),
      prompt:
        `${contextBlock}\n\n` +
        (scriptText ? `Roteiro aprovado desta peça:\n${scriptText}\n\n` : "") +
        (patch.design_brief ? `Direção visual:\n${patch.design_brief as string}\n\n` : "") +
        `Escreva a LEGENDA FINAL desta peça, pronta para publicar em ${channel} (${format}).\n` +
        `A legenda deve ser um texto único e contínuo contendo: abertura de impacto, desenvolvimento, ` +
        `argumentos, chamada para ação e hashtags no final. Use emojis somente quando fizer sentido para a marca. ` +
        `Respeite tom de voz, posicionamento e restrições da marca. Não invente dados que não estejam no contexto. ` +
        `Não use rótulos como "Hook:", "CTA:" ou "Hashtags:".\n` +
        `Responda EXCLUSIVAMENTE em JSON: {"caption":"legenda completa","reasoning_summary":"1 frase explicando a escolha"}`,
      schema: CopySchema,
      textFallbackKey: "caption",

      onAttempt: onAttempt("copywriter_senior", "caption"),
    });
    const caption = (output.caption ?? "").trim();
    if (!caption) throw new Error("empty_caption");
    patch.copy = caption;
    used.push("copywriter_senior");
    copyTrace = trace;
    await logAttempt(admin, post, {
      agent: "copywriter_senior",
      step: "caption",
      channel: String(channel),
      format: String(format),
      attempt: attempts,
      ok: true,
      jobId,
      trace,
      completedSteps: [...used],
      contextParts,
      degraded,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const { kind, retryable } = classifyAiError(err);
    // Persiste o que já foi produzido (roteiro/visual) — nunca legenda genérica.
    delete patch.copy;
    if (Object.keys(patch).length > 0) {
      await admin
        .from("posts")
        .update(patch as never)
        .eq("id", post.id);
    }
    await admin
      .from("posts")
      .update({
        ai_phase: retryable ? AI_PHASE.retryable : AI_PHASE.permanent,
        ai_phase_at: new Date().toISOString(),
      } as never)
      .eq("id", post.id);
    return { status: "failed", agent: "copywriter_senior", error: msg, kind, retryable };
  }

  patch.ai_phase = AI_PHASE.ready;
  patch.ai_phase_at = new Date().toISOString();
  const { error: updErr } = await admin
    .from("posts")
    .update(patch as never)
    .eq("id", post.id);
  if (updErr) {
    await logAttempt(admin, post, {
      agent: "persist",
      step: "update_post",
      channel: String(channel),
      format: String(format),
      attempt: 1,
      ok: false,
      kind: "unknown",
      retryable: true,
      message: updErr.message,
      jobId,
      completedSteps: [...used],
      contextParts,
      degraded,
    });
    return {
      status: "failed",
      agent: "persist",
      error: updErr.message,
      kind: "unknown",
      retryable: true,
    };
  }

  try {
    await admin.from("activity_events").insert({
      brand_id: post.brand_id,
      client_id: post.client_id,
      actor_id: opts.userId ?? null,
      entity_type: "post",
      entity_id: post.id,
      verb: "ai_generated",
      payload: {
        post_id: post.id,
        job_id: jobId,
        agents: used,
        channel,
        format,
        provider: copyTrace?.provider ?? null,
        model: copyTrace?.model ?? null,
        provider_trace: copyTrace?.providerTrace ?? null,
        context_parts: contextParts,
        degraded: degraded.length ? degraded : null,
        ok: true,
        at: new Date().toISOString(),
      },
    } as never);
  } catch {
    // auditoria não crítica
  }

  return { status: "generated", agents: used };
}

/**
 * Executa a geração para várias peças em série, com espaçamento centralizado.
 * Se o provedor esgotar a quota, interrompe a fila: as peças restantes ficam
 * em estado retryable e são retomadas depois (manual ou nova execução).
 */
export async function generatePostsContentSequential(
  postIds: string[],
  opts: { userId?: string | null } = {},
): Promise<{ generated: number; retryable: number; permanent: number; stopped: boolean }> {
  let generated = 0;
  let retryable = 0;
  let permanent = 0;
  let first = true;

  for (const id of postIds) {
    if (!first) await sleep(SPACING_MS);
    first = false;
    try {
      const res = await generatePostContent(id, { userId: opts.userId ?? null });
      if (res.status === "generated") generated++;
      else if (res.status === "failed") {
        if (res.retryable) retryable++;
        else permanent++;
        if (res.kind === "provider_quota") {
          console.warn("[post-agents] quota do provedor esgotada — fila interrompida", id);
          return { generated, retryable, permanent, stopped: true };
        }
      }
    } catch (err) {
      console.error("[post-agents] erro inesperado", id, err);
      permanent++;
    }
  }
  return { generated, retryable, permanent, stopped: false };
}

/**
 * Fila de retomada: peças em `idea` / `copy_failed*` voltam ao MESMO pipeline.
 * Idempotente — nunca cria post ou task, apenas completa a peça existente.
 */
export async function resumePendingPostContent(args: {
  brandId?: string | null;
  clientId?: string | null;
  projectId?: string | null;
  planId?: string | null;
  limit?: number;
  userId?: string | null;
}): Promise<{
  candidates: number;
  generated: number;
  retryable: number;
  permanent: number;
  stopped: boolean;
}> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;

  // Travas órfãs: peças marcadas como em andamento há mais de STALE_LOCK_MS
  // (worker morto/timeout) voltam a ser retomáveis antes da varredura.
  const staleBefore = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  let stale = admin
    .from("posts")
    .update({ ai_phase: AI_PHASE.retryable } as never)
    .eq("ai_phase", AI_PHASE.running)
    .is("deleted_at", null)
    .or("copy.is.null,copy.eq.")
    .or(`ai_phase_at.lt.${staleBefore},ai_phase_at.is.null`);
  if (args.brandId) stale = stale.eq("brand_id", args.brandId);
  if (args.clientId) stale = stale.eq("client_id", args.clientId);
  if (args.projectId) stale = stale.eq("project_id", args.projectId);
  const { error: staleErr } = await stale;
  if (staleErr) console.warn("[post-agents] falha ao liberar travas órfãs", staleErr.message);

  let q = admin
    .from("posts")
    .select("id, monthly_plan_topic_id")
    .in("ai_phase", RESUMABLE_AI_PHASES as unknown as string[])
    .is("deleted_at", null)
    .or("copy.is.null,copy.eq.")
    .order("created_at", { ascending: true })
    .limit(args.limit ?? 10);
  if (args.brandId) q = q.eq("brand_id", args.brandId);
  if (args.clientId) q = q.eq("client_id", args.clientId);
  if (args.projectId) q = q.eq("project_id", args.projectId);

  const { data, error } = await q;
  if (error) throw error;
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);

  const res = await generatePostsContentSequential(ids, { userId: args.userId ?? null });
  return { candidates: ids.length, ...res };
}
