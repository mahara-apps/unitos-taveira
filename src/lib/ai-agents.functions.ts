import { createServerFn } from "@tanstack/react-start";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getBrandAiModel } from "./ai-provider.server";
import {
  BACKOFF_MS,
  FAILURE_MESSAGE_PT,
  classifyAiError,
  sleep,
} from "./ai-failures.server";
import type { Json } from "@/integrations/supabase/types";
import { loadCanonicalBriefing, projectCanonicalBriefingRow } from "@/lib/briefing-source.server";

import { brain } from "@/lib/brain/api";

/* ---------------- Limites e resiliência dos agentes ---------------- */
/** Teto de entrada: evita estourar a janela de contexto e o custo por chamada. */
const AGENT_MAX_SYSTEM_CHARS = 40_000;
const AGENT_MAX_PROMPT_CHARS = 24_000;
const AGENT_MAX_OUTPUT_TOKENS = 8_000;
/** Nenhuma chamada de agente pode pendurar a request do usuário. */
const AGENT_TIMEOUT_MS = 90_000;
const AGENT_MAX_ATTEMPTS = 3;

function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[conteúdo truncado]`;
}

/** Recupera JSON de respostas com markdown/ruído em volta. */
function salvageJson(raw: string): unknown | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  for (const candidate of [cleaned, cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}


/**
 * Unitos — 8 agentes de IA.
 * Cada função é isolada, valida input com Zod, chama o gateway Lovable AI
 * (Gemini Pro para estratégia; GPT-5.4-mini para operacional com structured
 * outputs) e loga uso em `brand_ai_usage`. Falha de parsing cai para
 * `error.text` para preservar a resposta bruta.
 */

// ---------- Model routing ----------

const STRATEGIC_MODEL = "google/gemini-2.5-pro";
const OPERATIONAL_MODEL = "google/gemini-2.5-flash";

type AgentName =
  | "briefing.parse"
  | "voice.generate"
  | "personas.generate"
  | "cohorts.generate"
  | "swot.generate"
  | "pauta.suggest"
  | "content.generate"
  | "competitor.extract";

const AGENT_MODEL: Record<AgentName, { model: string; structuredOutputs: boolean }> = {
  "briefing.parse": { model: OPERATIONAL_MODEL, structuredOutputs: true },
  "voice.generate": { model: STRATEGIC_MODEL, structuredOutputs: false },
  "personas.generate": { model: STRATEGIC_MODEL, structuredOutputs: false },
  "cohorts.generate": { model: STRATEGIC_MODEL, structuredOutputs: false },
  "swot.generate": { model: STRATEGIC_MODEL, structuredOutputs: false },
  "pauta.suggest": { model: OPERATIONAL_MODEL, structuredOutputs: true },
  "content.generate": { model: OPERATIONAL_MODEL, structuredOutputs: true },
  "competitor.extract": { model: OPERATIONAL_MODEL, structuredOutputs: true },
};

// ---------- Helpers ----------

/**
 * BRAND CONTEXT BLUEPRINT — unified corporate strategic memory
 *
 * Aggregates in a single pass everything the AI generation layer needs to
 * ground ideas, roadmaps and copies in the client's real strategy:
 *   1. [Client identity] — name, niche, tone, color, palette
 *   2. [Briefing & Tone]  — brand_hub description, audience, pain points,
 *                           tone tags, mission, positioning, differentials,
 *                           objections, hashtags, do/don'ts
 *   3. [Competitors]      — registered competitor handles + engagement
 *                           metrics (position-differentiation signals)
 *   4. [Knowledge Base]   — private files metadata (filename catalog for
 *                           retrieval-ready future step)
 *
 * Returns a markdown blueprint ready to be prepended to any agent prompt,
 * plus counts for audit logging. Empty sections are skipped.
 */
export async function buildBrandContextBlueprint(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  brandId: string,
  clientId: string,
): Promise<{
  blueprint: string;
  counts: {
    tone_tags: number;
    pain_points: number;
    competitors: number;
    documents: number;
    hashtags: number;
  };
}> {
  const [{ data: client }, { data: docs }] = await Promise.all([
    supabase
      .from("clients")
      .select("name, niche, color, tone_of_voice, socials, brand_hub" as never)
      .eq("id", clientId)
      .eq("brand_id", brandId)
      .maybeSingle(),
    supabase
      .from("client_documents")
      .select("name, mime_type, size_bytes, created_at" as never)
      .eq("brand_id", brandId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const row = (client ?? {}) as {
    name?: string;
    niche?: string | null;
    color?: string | null;
    tone_of_voice?: string | null;
    socials?: Record<string, unknown> | null;
    brand_hub?: Record<string, unknown> | null;
  };
  const hub = (row.brand_hub ?? {}) as Record<string, unknown>;
  const documents = (docs ?? []) as unknown as Array<{
    name: string;
    mime_type: string;
    size_bytes: number;
  }>;

  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

  const toneTags = arr(hub.tone_tags);
  const painPoints = (str(hub.pain_points) ?? "")
    .split(/\n+|•|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hashtags = arr(hub.hashtags);
  const competitors = Array.isArray(hub.competitors)
    ? (hub.competitors as Array<Record<string, unknown>>)
    : [];
  const palette = Array.isArray(hub.palette)
    ? (hub.palette as Array<{ label: string; hex: string }>)
    : [];

  const sections: string[] = [];

  sections.push(
    `# BRAND STRATEGIC CONTEXT — ${row.name ?? "cliente"}\n` +
      `> This blueprint is the single source of truth for tone, audience and strategy. ` +
      `Every idea, roadmap or copy you produce MUST reflect these constraints and ` +
      `avoid generic outputs.`,
  );

  const identity: Array<[string, string | null | undefined]> = [
    ["Name", row.name ?? null],
    ["Niche", row.niche ?? null],
    ["Brand color", row.color ?? null],
    ["Default tone", row.tone_of_voice ?? null],
  ];
  const identityLines = identity.filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`);
  if (identityLines.length) sections.push(`## Client identity\n${identityLines.join("\n")}`);
  if (palette.length) {
    sections.push(
      `## Visual palette\n${palette
        .slice(0, 12)
        .map((p) => `- ${p.label}: ${p.hex}`)
        .join("\n")}`,
    );
  }

  const briefingLines: string[] = [];
  const push = (label: string, v: string | null) => {
    if (v) briefingLines.push(`**${label}:** ${v}`);
  };
  push("Core description", str(hub.description));
  push("Mission", str(hub.mission));
  push("Positioning", str(hub.positioning));
  push("Values", str(hub.values));
  push("Target audience", str(hub.audience));
  push("Demographics", str(hub.demographics));
  push("Offer / product", str(hub.offer));
  push("Price range", str(hub.price_range));
  push("Differentials", str(hub.differentials));
  push("Common objections", str(hub.objections));
  push("Customer journey", str(hub.journey));
  push("Desires", str(hub.desires));
  push("Goals", str(hub.goals));
  push("Tone (freeform)", str(hub.tone_text));
  if (toneTags.length) briefingLines.push(`**Tone tags:** ${toneTags.join(", ")}`);
  if (painPoints.length) {
    briefingLines.push(
      `**Pain points:**\n${painPoints
        .slice(0, 12)
        .map((p) => `  - ${p}`)
        .join("\n")}`,
    );
  }
  if (hashtags.length)
    briefingLines.push(`**Approved hashtags:** ${hashtags.slice(0, 20).join(" ")}`);
  const doDont = (hub.do_dont ?? {}) as { do?: string; dont?: string };
  if (doDont.do) briefingLines.push(`**Do:** ${doDont.do}`);
  if (doDont.dont) briefingLines.push(`**Don't:** ${doDont.dont}`);
  if (briefingLines.length) sections.push(`## [Briefing & Tone]\n${briefingLines.join("\n")}`);

  if (competitors.length) {
    const summary = competitors.slice(0, 15).map((c) => {
      const m = (c.last_metrics ?? {}) as Record<string, unknown>;
      const engagement =
        typeof m.engagement_rate === "number" ? `${(m.engagement_rate * 100).toFixed(2)}%` : "n/a";
      const hooks = Array.isArray(m.recurring_hooks)
        ? (m.recurring_hooks as string[]).slice(0, 3)
        : [];
      return {
        handle: `@${String(c.handle ?? "")}`,
        platform: c.platform ?? "instagram",
        notes: c.notes ?? null,
        followers: m.followers ?? null,
        avg_likes: m.avg_likes ?? null,
        avg_comments: m.avg_comments ?? null,
        engagement_rate: engagement,
        recurring_hooks: hooks,
      };
    });
    sections.push(
      `## [Competitor Benchmarking]\n` +
        `Use these real handles and engagement patterns to run position ` +
        `differentiation. Do NOT copy their voice — extract structural patterns ` +
        `(hooks, formats, cadence) and propose differentiated angles for our client.\n` +
        `\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\``,
    );
  }

  if (documents.length) {
    sections.push(
      `## [Knowledge Base]\n` +
        `Private documents uploaded for this client (filenames catalog — content ` +
        `retrieval will augment this section in a future step). Assume these ` +
        `assets contain proprietary product/brand knowledge and prefer aligned ` +
        `references over invented ones.\n` +
        documents
          .slice(0, 20)
          .map(
            (d) =>
              `- ${d.name} (${d.mime_type || "file"}, ${Math.round((d.size_bytes ?? 0) / 1024)} KB)`,
          )
          .join("\n"),
    );
  }

  const blueprint = sections.join("\n\n");

  // Brain memory — active insights for this brand (top 6, non-expired).
  try {
    const active = await brain.insights.list(
      { supabase, userId: "", brandId, clientId, projectId: null, module: "ai-agents" },
      { limit: 6 },
    );
    if (active.length) {
      const lines = active
        .map(
          (i) =>
            `- (${i.insight_type}${i.confidence != null ? ` · conf ${Math.round((i.confidence as number) * 100)}%` : ""}) ${i.description}`,
        )
        .join("\n");
      return {
        blueprint: `${blueprint}\n\n## Memória do Brain — insights ativos\n${lines}`,
        counts: {
          tone_tags: toneTags.length,
          pain_points: painPoints.length,
          competitors: competitors.length,
          documents: documents.length,
          hashtags: hashtags.length,
        },
      };
    }
  } catch (err) {
    console.warn("[buildBrandContextBlueprint] brain insights fetch failed", err);
  }

  return {
    blueprint,
    counts: {
      tone_tags: toneTags.length,
      pain_points: painPoints.length,
      competitors: competitors.length,
      documents: documents.length,
      hashtags: hashtags.length,
    },
  };
}

/**
 * Emits an audit event on `activity_events` after a successful blueprint
 * assembly so the ops team can see, per client, which agents ran on top of
 * which slice of the corporate memory. Best-effort — swallowed on failure to
 * never block AI generation.
 */
async function logContextAssembled(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  brandId: string,
  clientId: string,
  userId: string,
  agent: AgentName,
  counts: Record<string, number>,
) {
  try {
    await supabase.from("activity_events").insert({
      brand_id: brandId,
      client_id: clientId,
      actor_id: userId,
      entity_type: "ai_context",
      entity_id: clientId,
      verb: "assembled",
      payload: { agent, ...counts },
    });
  } catch {
    // silent — audit is non-critical
  }
}

async function runAgent<T extends z.ZodTypeAny>(opts: {
  agent: AgentName;
  brandId: string;
  clientId: string;
  userId: string;
  system: string;
  prompt: string;
  schema: T;
  supabase: import("@supabase/supabase-js").SupabaseClient;
  /** Skip the brand-context blueprint (e.g. briefing.parse consumes raw text). */
  skipBrandContext?: boolean;
}): Promise<z.infer<T>> {
  // Autorização: usuário precisa ser membro da marca.
  const { data: member, error: memberErr } = await opts.supabase
    .from("brand_members")
    .select("role")
    .eq("brand_id", opts.brandId)
    .eq("user_id", opts.userId)
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!member) throw new Error("Você não tem acesso a esta marca");

  // Autorização: cliente precisa pertencer à mesma marca.
  const { data: client, error: clientErr } = await opts.supabase
    .from("clients")
    .select("id")
    .eq("id", opts.clientId)
    .eq("brand_id", opts.brandId)
    .maybeSingle();
  if (clientErr) throw clientErr;
  if (!client) throw new Error("Cliente inválido para esta marca");

  // ---- Brand Context Blueprint injection ----
  let brandBlueprint = "";
  if (!opts.skipBrandContext) {
    const { blueprint, counts } = await buildBrandContextBlueprint(
      opts.supabase,
      opts.brandId,
      opts.clientId,
    );
    if (blueprint) {
      brandBlueprint = blueprint;
      await logContextAssembled(
        opts.supabase,
        opts.brandId,
        opts.clientId,
        opts.userId,
        opts.agent,
        counts,
      );
    }
  }

  const finalSystem = clampText(
    brandBlueprint ? `${brandBlueprint}\n\n---\n\n${opts.system}` : opts.system,
    AGENT_MAX_SYSTEM_CHARS,
  );
  const finalPrompt = clampText(opts.prompt, AGENT_MAX_PROMPT_CHARS);
  if (!finalPrompt.trim()) throw new Error("ai_empty_prompt: nada para enviar à IA.");

  // structuredOutputs kept for backwards-compat but ignored (each provider
  // enforces its own structured-output flow via the ai-sdk Output helper).
  void AGENT_MODEL[opts.agent];

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= AGENT_MAX_ATTEMPTS; attempt++) {
    try {
      // O provider já mede tokens/custo e aplica o teto mensal para toda chamada.
      // Resolvido por tentativa: assim o fallback de provider/modelo vale no retry.
      const { model } = await getBrandAiModel(opts.supabase, opts.brandId, "text", "operational", {
        agent: opts.agent,
        clientId: opts.clientId,
        userId: opts.userId,
      });
      const res = await generateText({
        model,
        system: finalSystem,
        prompt: finalPrompt,
        output: Output.object({ schema: opts.schema }),
        maxOutputTokens: AGENT_MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(AGENT_TIMEOUT_MS),
        // O backoff é controlado aqui para respeitar a quota do provedor.
        maxRetries: 0,
      });
      return res.output as z.infer<T>;
    } catch (error) {
      // Saída malformada: tenta recuperar o JSON bruto antes de considerar falha.
      if (NoObjectGeneratedError.isInstance(error)) {
        const salvaged = salvageJson(error.text ?? "");
        if (salvaged !== null) {
          const parsed = opts.schema.safeParse(salvaged);
          if (parsed.success) return parsed.data as z.infer<T>;
        }
      }
      lastError = error;
      const { kind, retryable } = classifyAiError(error);
      console.error(
        `[ai-agents] ${opts.agent} attempt ${attempt}/${AGENT_MAX_ATTEMPTS} kind=${kind}`,
        error instanceof Error ? error.message : String(error),
      );
      if (!retryable || attempt === AGENT_MAX_ATTEMPTS) {
        throw new Error(`${FAILURE_MESSAGE_PT[kind].body} (${kind})`, { cause: error });
      }
      await sleep(BACKOFF_MS[attempt - 1] ?? 15_000);
    }
  }

  throw new Error(FAILURE_MESSAGE_PT.unknown.body, { cause: lastError });

}

// ---------- Schemas ----------

const BriefingSchema = z.object({
  publico_alvo: z.string().nullable(),
  tom_de_voz: z.string().nullable(),
  dores_do_cliente_final: z.array(z.string()),
  diferenciais: z.array(z.string()),
  hashtags_sugeridas: z.array(z.string()),
  concorrentes_mencionados: z.array(z.string()),
  volume_semanal_estimado: z.number().nullable(),
  completude_percentual: z.number(),
});

const VoiceCardSchema = z.object({
  voice_card: z.object({
    brand_personality: z.string(),
    tone_characteristics: z.array(z.string()),
    vocabulary_rules: z.object({
      words_to_use: z.array(z.string()),
      words_to_avoid: z.array(z.string()),
    }),
    brand_phrases_examples: z.array(z.string()),
  }),
});

const PersonasSchema = z.object({
  personas: z.array(
    z.object({
      nome: z.string(),
      descricao: z.string(),
      dores: z.array(z.string()),
      desejos: z.array(z.string()),
      canais_preferidos: z.array(z.string()),
      gatilhos_de_decisao: z.array(z.string()),
      objecoes_comuns: z.array(z.string()),
    }),
  ),
});

const CohortsSchema = z.object({
  cohorts: z.array(
    z.object({
      name: z.string(),
      target_personas: z.array(z.string()),
      behavioral_traits: z.string(),
      content_strategy: z.string(),
      conversion_criteria: z.string(),
    }),
  ),
});

const SwotSchema = z.object({
  swot_analysis: z.object({
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    opportunities: z.array(z.string()),
    threats: z.array(z.string()),
  }),
  competitive_matrix: z.array(
    z.object({
      competitor_name: z.string(),
      our_advantages: z.string(),
      vulnerabilities: z.string(),
    }),
  ),
});

const PautasSchema = z.object({
  pautas: z.array(
    z.object({
      titulo: z.string(),
      pilar_type: z.string(),
      cohort_alvo: z.string(),
      formato: z.string(),
      plataforma: z.string(),
      gancho: z.string(),
    }),
  ),
});

const CompetitorSchema = z.object({
  snapshot: z.object({
    bio_resumo: z.string(),
    oferta_principal: z.string().nullable(),
    tom_percebido: z.string(),
    ganchos_recorrentes: z.array(z.string()),
    formatos_observados: z.array(z.string()),
    frequencia_estimada: z.string().nullable(),
  }),
  pautas_inspiradas: z.array(z.object({ titulo: z.string(), angulo_diferenciado: z.string() })),
});

// ---------- Prompts ----------

const P = {
  briefing: `Você é um estrategista de marketing sênior lendo o briefing de um cliente novo de uma agência de conteúdo. Sua tarefa é estruturar o texto bruto abaixo em um JSON limpo, sem inventar informação que não esteja implícita ou explícita no texto.

Regras:
- Se um campo não puder ser inferido com confiança, retorne null ou array vazio — nunca invente.
- "volume_semanal_estimado" é um palpite baseado em pistas do texto (ex: "postamos bastante", "3x por semana"); se não houver pista nenhuma, retorne null.
- "completude_percentual" reflete quantos dos campos vieram preenchidos com confiança (0-100).
- Responda SOMENTE com o JSON, sem markdown, sem comentário, sem texto antes ou depois.`,

  voice: `Você é um redator sênior especialista em brand voice. A partir do briefing estruturado abaixo, crie um "Voice Card" retornando EXATAMENTE este JSON:

{
  "voice_card": {
    "brand_personality": "1-2 frases descrevendo a personalidade da marca",
    "tone_characteristics": ["array de 4-6 traços de tom específicos"],
    "vocabulary_rules": {
      "words_to_use": ["array de 6-10 palavras/expressões preferidas da marca"],
      "words_to_avoid": ["array de 6-10 palavras a evitar"]
    },
    "brand_phrases_examples": ["array de 8-12 frases de exemplo que poderiam aparecer em posts desta marca"]
  }
}

Seja específico ao negócio do cliente — nada de adjetivos vagos. Responda SOMENTE com o JSON, sem markdown, sem texto antes ou depois.`,

  personas: `Você é um estrategista de marketing sênior. A partir do briefing estruturado abaixo, gere de 3 a 5 personas de público-alvo para este cliente. Cada persona deve ser acionável para produção de conteúdo — ou seja, alguém da equipe de conteúdo precisa conseguir olhar para a persona e saber que tipo de post, gancho e linguagem usar para ela.

Não gere personas genéricas ou intercambiáveis entre clientes diferentes. Ancore cada persona em detalhes do briefing (dores, diferenciais, contexto do negócio).

Responda SOMENTE com o JSON, sem markdown, sem texto antes ou depois.`,

  cohorts: `Você é um estrategista de marketing sênior especializado em segmentação comportamental. A partir do briefing e das personas abaixo, gere 3 a 5 cohorts comportamentais retornando EXATAMENTE este JSON:

{
  "cohorts": [
    {
      "name": "nome curto e memorável do cohort",
      "target_personas": ["array com nomes das personas conectadas a este cohort"],
      "behavioral_traits": "descrição curta dos comportamentos que caracterizam este cohort",
      "content_strategy": "estratégia editorial recomendada para este cohort",
      "conversion_criteria": "sinal ou ação que indica que o cohort avançou/converteu"
    }
  ]
}

Cada cohort precisa ser distinto dos demais. Responda SOMENTE com o JSON, sem markdown.`,

  swot: `Você é um estrategista de marketing sênior. A partir do briefing, personas e cohorts abaixo, gere a Matriz SWOT e uma tabela competitiva retornando EXATAMENTE este JSON:

{
  "swot_analysis": {
    "strengths": ["3-5 forças específicas do cliente"],
    "weaknesses": ["3-5 fraquezas específicas"],
    "opportunities": ["3-5 oportunidades de mercado"],
    "threats": ["3-5 ameaças externas"]
  },
  "competitive_matrix": [
    {
      "competitor_name": "nome do concorrente",
      "our_advantages": "onde este cliente vence este concorrente (frase curta)",
      "vulnerabilities": "onde este cliente perde para este concorrente (frase curta)"
    }
  ]
}

Se não houver concorrentes mencionados, retorne competitive_matrix como array vazio. Responda SOMENTE com o JSON, sem markdown.`,

  pauta: `Você é um estrategista de conteúdo. A partir da estratégia deste cliente (briefing, personas, cohorts, SWOT), gere sugestões de pauta retornando EXATAMENTE este JSON:

{
  "pautas": [
    {
      "titulo": "título curto e específico da pauta",
      "gancho": "gancho de abertura (1 frase forte)",
      "plataforma": "instagram | tiktok | linkedin | youtube | blog",
      "formato": "reels | carrossel | post estático | artigo | short | live",
      "cohort_alvo": "nome do cohort alvo (deve bater com um cohort existente)",
      "pilar_type": "Authority | Connection | Education | Conversion | Entertainment"
    }
  ]
}

Diversifique pilares e cohorts entre as pautas. Responda SOMENTE com o JSON, sem markdown.`,

  competitor: `Você é um analista de inteligência competitiva para agências de marketing. A partir do texto colado abaixo (bio de perfil + posts recentes de um concorrente), extraia um snapshot estruturado e gere sugestões de pauta inspiradas nesse concorrente para o cliente da agência.

Não copie frases do concorrente literalmente nas pautas sugeridas — use os padrões identificados (ganchos, formatos, ofertas) como inspiração estrutural, nunca como texto a reproduzir.

Responda SOMENTE com o JSON, sem markdown, sem texto antes ou depois.`,
};

// ---------- Server functions ----------

// 1. briefing.parse
export const briefingParseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        texto: z.string().min(20),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const out = await runAgent({
      agent: "briefing.parse",
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      supabase: context.supabase,
      system: P.briefing,
      prompt: `Texto bruto do briefing:\n"""\n${data.texto}\n"""`,
      schema: BriefingSchema,
    });

    // FASE 2: escrita canônica em clients.brand_hub + versão de auditoria.
    const { writeCanonicalBriefing } = await import("@/lib/briefing-write.server");
    const { legacyToHubPatch, loadCanonicalBriefing, projectCanonicalBriefingRow } =
      await import("@/lib/briefing-source.server");
    await writeCanonicalBriefing(context.supabase, {
      brandId: data.brandId,
      clientId: data.clientId,
      patch: legacyToHubPatch(out as unknown as Record<string, unknown>),
      authorId: context.userId,
      origin: "ai.briefing",
    });
    const canonical = await loadCanonicalBriefing(context.supabase, {
      clientId: data.clientId,
      brandId: data.brandId,
    });
    const row = projectCanonicalBriefingRow(canonical, null, {
      brandId: data.brandId,
      clientId: data.clientId,
    });
    return { row, output: out };
  });

// 2. voice.generate
export const voiceGenerateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        briefingJson: z.unknown(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const out = await runAgent({
      agent: "voice.generate",
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      supabase: context.supabase,
      system: P.voice,
      prompt: `Briefing estruturado do cliente:\n${JSON.stringify(data.briefingJson, null, 2)}`,
      schema: VoiceCardSchema,
    });

    await context.supabase
      .from("brand_voice_cards")
      .update({ is_active: false })
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .eq("is_active", true);

    const { data: row, error } = await context.supabase
      .from("brand_voice_cards")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        data: out,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return { row, output: out };
  });

// 3. personas.generate
export const personasGenerateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        briefingJson: z.unknown(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const out = await runAgent({
      agent: "personas.generate",
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      supabase: context.supabase,
      system: P.personas,
      prompt: `Briefing estruturado do cliente:\n${JSON.stringify(data.briefingJson, null, 2)}`,
      schema: PersonasSchema,
    });

    await context.supabase
      .from("brand_personas")
      .update({ is_active: false })
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .eq("is_active", true);

    const { data: row, error } = await context.supabase
      .from("brand_personas")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        data: out,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return { row, output: out };
  });

// 4. cohorts.generate
export const cohortsGenerateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        briefingJson: z.unknown(),
        personasJson: z.unknown(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const out = await runAgent({
      agent: "cohorts.generate",
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      supabase: context.supabase,
      system: P.cohorts,
      prompt: `Briefing estruturado:\n${JSON.stringify(data.briefingJson, null, 2)}\n\nPersonas geradas:\n${JSON.stringify(data.personasJson, null, 2)}`,
      schema: CohortsSchema,
    });

    await context.supabase
      .from("brand_cohorts")
      .update({ is_active: false })
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .eq("is_active", true);

    const { data: row, error } = await context.supabase
      .from("brand_cohorts")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        data: out,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return { row, output: out };
  });

// 5. swot.generate
export const swotGenerateFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        briefingJson: z.unknown(),
        personasJson: z.unknown(),
        cohortsJson: z.unknown(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const out = await runAgent({
      agent: "swot.generate",
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      supabase: context.supabase,
      system: P.swot,
      prompt: [
        `Briefing estruturado:\n${JSON.stringify(data.briefingJson, null, 2)}`,
        `Personas:\n${JSON.stringify(data.personasJson, null, 2)}`,
        `Cohorts:\n${JSON.stringify(data.cohortsJson, null, 2)}`,
      ].join("\n\n"),
      schema: SwotSchema,
    });

    await context.supabase
      .from("brand_swot")
      .update({ is_active: false })
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .eq("is_active", true);

    const { data: row, error } = await context.supabase
      .from("brand_swot")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        data: out,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return { row, output: out };
  });

// 6. pauta.suggest
export const pautaSuggestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        briefingJson: z.unknown(),
        personasJson: z.unknown(),
        cohortsJson: z.unknown(),
        swotJson: z.unknown(),
        quantidade: z.number().int().min(1).max(30),
        periodo: z.string(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const out = await runAgent({
      agent: "pauta.suggest",
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      supabase: context.supabase,
      system: P.pauta,
      prompt: [
        `Briefing: ${JSON.stringify(data.briefingJson)}`,
        `Personas: ${JSON.stringify(data.personasJson)}`,
        `Cohorts: ${JSON.stringify(data.cohortsJson)}`,
        `SWOT: ${JSON.stringify(data.swotJson)}`,
        `Quantidade de pautas desejadas: ${data.quantidade}`,
        `Período: ${data.periodo}`,
      ].join("\n"),
      schema: PautasSchema,
    });

    if (Array.isArray(out.pautas) && out.pautas.length) {
      await context.supabase.from("brand_pautas").insert(
        out.pautas.map((p) => ({
          brand_id: data.brandId,
          client_id: data.clientId,
          titulo: p.titulo,
          pilar: p.pilar_type,
          pilar_type: p.pilar_type,
          status: "backlog",
          cohort_alvo: p.cohort_alvo,
          formato_recomendado: p.formato,
          formato: p.formato,
          plataforma: p.plataforma,
          gancho: p.gancho,
          data: p,
          created_by: context.userId,
        })),
      );
    }

    return { output: out };
  });

// 7. (removido) content.generate — a geração de peça agora é orquestrada por
// `src/lib/post-agents.server.ts` consumindo os prompts reais de `agent_prompts`
// (copywriter_senior / roteirista_social / art_director_social).

// 8. competitor.extract
export const competitorExtractFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        handle: z.string().optional(),
        bioColada: z.string().min(1),
        postsColados: z.string().min(1),
        briefingJson: z.unknown(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const out = await runAgent({
      agent: "competitor.extract",
      brandId: data.brandId,
      clientId: data.clientId,
      userId: context.userId,
      supabase: context.supabase,
      system: P.competitor,
      prompt: [
        `Bio do perfil do concorrente:\n"""\n${data.bioColada}\n"""`,
        `Posts recentes (texto colado, um por linha ou bloco):\n"""\n${data.postsColados}\n"""`,
        `Briefing do cliente da agência (para contraste/diferenciação):\n${JSON.stringify(data.briefingJson, null, 2)}`,
      ].join("\n\n"),
      schema: CompetitorSchema,
    });

    const { data: row, error } = await context.supabase
      .from("brand_competitors")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        handle: data.handle ?? null,
        bio_colada: data.bioColada,
        posts_colados: data.postsColados,
        snapshot: out.snapshot,
        pautas_inspiradas: out.pautas_inspiradas,
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return { row, output: out };
  });

// ---------- Utilitário: salvar edição manual + criar versão ----------

export const saveArtifactVersionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        entityType: z.enum(["voice", "personas", "cohorts", "swot"]),
        entityId: z.string().uuid(),
        data: z.unknown(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    // FASE 2: o briefing não é mais editado por aqui — sua fonte única é
    // clients.brand_hub (writeCanonicalBriefing + brand_briefing_versions).
    const tableMap = {
      voice: "brand_voice_cards",
      personas: "brand_personas",
      cohorts: "brand_cohorts",
      swot: "brand_swot",
    } as const;
    const table = tableMap[data.entityType];

    // snapshot da versão anterior
    const { data: prev } = await context.supabase
      .from(table)
      .select("data")
      .eq("id", data.entityId)
      .eq("client_id", data.clientId)
      .single();
    if (prev) {
      await context.supabase.from("brand_ai_versions").insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        entity_type: data.entityType,
        entity_id: data.entityId,
        data: prev.data,
        changed_by: context.userId,
      });
    }

    const { error } = await context.supabase
      .from(table)
      .update({ data: data.data as never })
      .eq("id", data.entityId)
      .eq("client_id", data.clientId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Loader: contexto atual do CLIENTE ----------

export const loadClientContextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const [voice, personas, cohorts, swot, usage] = await Promise.all([
      context.supabase
        .from("brand_voice_cards")
        .select("*")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("is_active", true)
        .maybeSingle(),
      context.supabase
        .from("brand_personas")
        .select("*")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("is_active", true)
        .maybeSingle(),
      context.supabase
        .from("brand_cohorts")
        .select("*")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("is_active", true)
        .maybeSingle(),
      context.supabase
        .from("brand_swot")
        .select("*")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("is_active", true)
        .maybeSingle(),
      context.supabase
        .from("brand_ai_usage")
        .select("cost_usd,created_at,agent,model,input_tokens,output_tokens,success")
        .eq("brand_id", data.brandId)
        .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()),
    ]);

    const totalCost = (usage.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);

    // Fonte única do briefing: clients.brand_hub.
    const canonical = await loadCanonicalBriefing(context.supabase, {
      clientId: data.clientId,
      brandId: data.brandId,
    });

    return {
      briefing: projectCanonicalBriefingRow(canonical, null, {
        brandId: data.brandId,
        clientId: data.clientId,
      }),
      voice: voice.data,
      personas: personas.data,
      cohorts: cohorts.data,
      swot: swot.data,
      usage: { last30d: usage.data ?? [], totalCostUsd: totalCost },
    };
  });

// ---------- Loaders fatiados (streaming por aba) ----------
//
// Divisão intencional: `core` traz apenas o essencial para renderizar o
// header + decidir se mostra onboarding (rápido). `target` e `market` são
// pesados e ficam por trás de Suspense em cada aba. Cada fatia usa
// `Promise.all` internamente para eliminar waterfall no Supabase.

const clientScopeInput = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
});

export const loadCustomerCoreFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => clientScopeInput.parse(i))
  .handler(async ({ data, context }) => {
    const [voice, usage] = await Promise.all([
      context.supabase
        .from("brand_voice_cards")
        .select("*")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("is_active", true)
        .maybeSingle(),
      context.supabase
        .from("brand_ai_usage")
        .select("cost_usd,created_at,agent,model,input_tokens,output_tokens,success")
        .eq("brand_id", data.brandId)
        .gte("created_at", new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()),
    ]);
    const totalCost = (usage.data ?? []).reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
    // Fonte única do briefing: clients.brand_hub.
    const canonical = await loadCanonicalBriefing(context.supabase, {
      clientId: data.clientId,
      brandId: data.brandId,
    });
    return {
      briefing: projectCanonicalBriefingRow(canonical, null, {
        brandId: data.brandId,
        clientId: data.clientId,
      }),
      voice: voice.data,
      usage: { last30d: usage.data ?? [], totalCostUsd: totalCost },
    };
  });

export const loadCustomerTargetFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => clientScopeInput.parse(i))
  .handler(async ({ data, context }) => {
    const [personas, cohorts] = await Promise.all([
      context.supabase
        .from("brand_personas")
        .select("*")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("is_active", true)
        .maybeSingle(),
      context.supabase
        .from("brand_cohorts")
        .select("*")
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    return { personas: personas.data, cohorts: cohorts.data };
  });

export const loadCustomerMarketFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => clientScopeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: swot } = await context.supabase
      .from("brand_swot")
      .select("*")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .eq("is_active", true)
      .maybeSingle();
    return { swot };
  });

// ---------- Unified pipeline (one-click onboarding) ----------
//
// Runs briefing.parse → voice → personas → cohorts → swot → pauta sequentially,
// persisting each artifact scoped to (brandId, clientId). Fails fast on the
// first agent that errors; whatever succeeded stays persisted. UI-visible
// per-step progress is driven client-side by orchestrating the individual
// server fns above — this unified entry point is here for programmatic/API
// use where a single atomic call is preferable.
// ---------- Topics → Content Pipeline ----------
//
// Copies a pauta (topic idea) into the global posts board at stage "idea".
// Also marks the source pauta as sent so it isn't queued twice.
export const sendPautaToContentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        pautaId: z.string().uuid(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: pauta, error: pErr } = await context.supabase
      .from("brand_pautas")
      .select("*")
      .eq("id", data.pautaId)
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .single();
    if (pErr) throw pErr;

    const platformMap: Record<string, string> = {
      instagram: "instagram",
      tiktok: "tiktok",
      linkedin: "linkedin",
      x: "x",
      twitter: "x",
      youtube: "youtube",
      blog: "blog",
    };
    const raw = (pauta.plataforma ?? "").toLowerCase().trim();
    const channel = platformMap[raw] ?? "instagram";

    const { data: post, error: postErr } = await context.supabase
      .from("posts")
      .insert({
        brand_id: data.brandId,
        client_id: data.clientId,
        title: pauta.titulo,
        copy: pauta.gancho,
        stage: "idea",
        channels: [channel as never],
        created_by: context.userId,
      })
      .select()
      .single();
    if (postErr) throw postErr;

    await context.supabase
      .from("brand_pautas")
      .update({ status: "sent_to_content" })
      .eq("id", data.pautaId);

    return { post };
  });

// ---------- Loader: pautas backlog do cliente ----------
export const listCustomerPautasFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("brand_pautas")
      .select("*")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });
// ---------- Histórico de gerações de estratégia ----------
//
// O pipeline preserva versões: ao gravar uma nova geração, marca as linhas
// anteriores como `is_active = false`. Agrupamos as linhas das 4 tabelas por
// proximidade de `created_at` (janela de 15 min) para reconstruir "gerações".

const STRATEGY_BLOCK_TABLES = {
  voice: "brand_voice_cards",
  personas: "brand_personas",
  cohorts: "brand_cohorts",
  swot: "brand_swot",
} as const;

type StrategyBlock = keyof typeof STRATEGY_BLOCK_TABLES;

export const listStrategyRunsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ brandId: z.string().uuid(), clientId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const blocks = Object.keys(STRATEGY_BLOCK_TABLES) as StrategyBlock[];
    const results = await Promise.all(
      blocks.map((b) =>
        context.supabase
          .from(STRATEGY_BLOCK_TABLES[b])
          .select("id,created_at,is_active,created_by")
          .eq("brand_id", data.brandId)
          .eq("client_id", data.clientId)
          .order("created_at", { ascending: false })
          .limit(60),
      ),
    );

    type Row = {
      block: StrategyBlock;
      id: string;
      created_at: string;
      is_active: boolean;
      created_by: string | null;
    };
    const rows: Row[] = [];
    results.forEach((res, idx) => {
      for (const r of res.data ?? []) {
        rows.push({
          block: blocks[idx],
          id: r.id as string,
          created_at: (r.created_at as string) ?? new Date(0).toISOString(),
          is_active: !!r.is_active,
          created_by: (r.created_by as string | null) ?? null,
        });
      }
    });
    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const WINDOW_MS = 15 * 60 * 1000;
    type Run = {
      key: string;
      created_at: string;
      is_active: boolean;
      created_by: string | null;
      blocks: Partial<Record<StrategyBlock, string>>;
    };
    const runs: Run[] = [];
    for (const r of rows) {
      const t = Date.parse(r.created_at);
      let run = runs.find(
        (x) =>
          Math.abs(Date.parse(x.created_at) - t) <= WINDOW_MS &&
          x.is_active === r.is_active &&
          !x.blocks[r.block],
      );
      if (!run) {
        run = {
          key: r.id,
          created_at: r.created_at,
          is_active: r.is_active,
          created_by: r.created_by,
          blocks: {},
        };
        runs.push(run);
      }
      run.blocks[r.block] = r.id;
      // a geração é datada pelo bloco mais antigo do grupo (início do pipeline)
      if (r.created_at < run.created_at) run.created_at = r.created_at;
      if (!run.created_by) run.created_by = r.created_by;
    }
    runs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    // Provedor/modelo por etapa fica em ai_jobs.result — casa por proximidade.
    const { data: jobs } = await context.supabase
      .from("ai_jobs")
      .select("created_at,finished_at,result,status")
      .eq("brand_id", data.brandId)
      .eq("client_id", data.clientId)
      .eq("kind", "customer_strategy")
      .order("created_at", { ascending: false })
      .limit(40);

    const authorIds = [...new Set(runs.map((r) => r.created_by).filter(Boolean))] as string[];
    const profiles = authorIds.length
      ? (await context.supabase.from("user_profiles").select("id,full_name").in("id", authorIds))
          .data
      : [];
    const nameById = new Map(
      (profiles ?? []).map((p) => [p.id, (p.full_name as string | null) || null]),
    );

    return runs.map((run) => {
      const t = Date.parse(run.created_at);
      const job = (jobs ?? []).find((j) => {
        const jt = Date.parse((j.created_at as string) ?? "");
        return Number.isFinite(jt) && Math.abs(jt - t) <= 60 * 60 * 1000;
      });
      const models =
        job && job.result && typeof job.result === "object"
          ? ((job.result as Record<string, unknown>)["models"] as
              | Record<string, string>
              | undefined)
          : undefined;
      return {
        key: run.key,
        createdAt: run.created_at,
        isActive: run.is_active,
        author: run.created_by ? (nameById.get(run.created_by) ?? null) : null,
        blocks: run.blocks,
        models: models ?? null,
      };
    });
  });

export const getStrategyRunFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        blocks: z.object({
          voice: z.string().uuid().optional(),
          personas: z.string().uuid().optional(),
          cohorts: z.string().uuid().optional(),
          swot: z.string().uuid().optional(),
        }),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const entries = Object.entries(data.blocks).filter(([, v]) => !!v) as Array<
      [StrategyBlock, string]
    >;
    const rows = await Promise.all(
      entries.map(([block, id]) =>
        context.supabase
          .from(STRATEGY_BLOCK_TABLES[block])
          .select("id,data,created_at")
          .eq("id", id)
          .eq("brand_id", data.brandId)
          .eq("client_id", data.clientId)
          .maybeSingle(),
      ),
    );
    const out: Record<string, Json | null> = {};
    entries.forEach(([block], idx) => {
      out[block] = (rows[idx].data?.data as Json | null) ?? null;
    });
    return out;
  });

export const restoreStrategyRunFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        blocks: z.object({
          voice: z.string().uuid().optional(),
          personas: z.string().uuid().optional(),
          cohorts: z.string().uuid().optional(),
          swot: z.string().uuid().optional(),
        }),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const entries = Object.entries(data.blocks).filter(([, v]) => !!v) as Array<
      [StrategyBlock, string]
    >;
    if (!entries.length) throw new Error("Nenhum bloco para restaurar");

    for (const [block, id] of entries) {
      const table = STRATEGY_BLOCK_TABLES[block];
      const { error: offErr } = await context.supabase
        .from(table)
        .update({ is_active: false })
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId)
        .eq("is_active", true);
      if (offErr) throw offErr;
      const { error: onErr } = await context.supabase
        .from(table)
        .update({ is_active: true })
        .eq("id", id)
        .eq("brand_id", data.brandId)
        .eq("client_id", data.clientId);
      if (onErr) throw onErr;
    }
    return { ok: true, restored: entries.map(([b]) => b) };
  });
