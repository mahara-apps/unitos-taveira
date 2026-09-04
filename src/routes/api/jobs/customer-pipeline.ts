import { createFileRoute } from "@tanstack/react-router";
import { guardClientScope } from "@/lib/http-scope.server";
import { waitUntil } from "@/lib/wait-until.server";
import { createClient } from "@supabase/supabase-js";
import { generateText } from "ai";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { getBrandAiModelAdmin, describeProviderAttempts } from "@/lib/ai-provider.server";
import {
  classifyAiError,
  unwrapAiError,
  FAILURE_MESSAGE_PT,
  SPACING_MS,
  BACKOFF_MS,
  sleep,
  type FailureKind,
} from "@/lib/ai-failures.server";
import { loadCanonicalBriefing } from "@/lib/briefing-source.server";
import { filterRowsByPrefs } from "@/lib/notification-prefs";
import {
  asText,
  asList,
  normalizeCohorts,
  describePayloadKeys,
} from "@/lib/ai-payload-coerce";
import { withPtBr, assertPtBrPayload } from "@/lib/ai-language";
import { isLeaseValid, leaseExpiryIso, newLeaseOwner, type LeaseJob } from "@/lib/ai-job-lease";


// Two-phase pipeline — Phase 1 (Strategy).
// Executa briefing → voz → personas → cohorts → SWOT, mas UMA etapa por
// requisição HTTP: ao terminar a etapa, o runner agenda a próxima chamando
// esta mesma rota. Isso mantém cada execução de fundo curta (o isolate do
// Worker era encerrado no meio quando as 5 chamadas rodavam na mesma
// execução, e o reaper de 5 min marcava o job como "timeout").

const StartSchema = z.object({
  brandId: z.string().uuid(),
  clientId: z.string().uuid(),
  // `texto` é opcional: o backend compõe o briefing a partir de
  // `clients` + `clients.brand_hub` + documentos analisados. Quando enviado,
  // é anexado como "Notas adicionais do usuário" — nunca substitui.
  texto: z.string().trim().max(20000).optional(),
});

const STEPS = ["briefing", "voice", "personas", "cohorts", "swot"] as const;
type Step = (typeof STEPS)[number];

const ContinueSchema = z.object({
  jobId: z.string().uuid(),
  step: z.enum(STEPS),
});

const STEP_META: Record<Step, { label: string; progress: number }> = {
  briefing: { label: "Estruturando briefing", progress: 5 },
  voice: { label: "Modelando a voz da marca", progress: 25 },
  personas: { label: "Desenhando personas", progress: 45 },
  cohorts: { label: "Construindo cohorts", progress: 65 },
  swot: { label: "Analisando SWOT", progress: 85 },
};

function nextStep(step: Step): Step | null {
  const i = STEPS.indexOf(step);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1]! : null;
}

function buildUserClient(token: string) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

// ---------- Server-side briefing composition ----------
// Reads clients + clients.brand_hub + documentos analisados e monta o
// briefing bruto que alimenta o pipeline.
type ClientRow = {
  name: string | null;
  niche: string | null;
  color: string | null;
  logo_url: string | null;
  tone_of_voice: string | null;
  contact_name: string | null;
  contact_email: string | null;
  socials: Record<string, string | null | undefined> | null;
  brand_hub: Record<string, unknown> | null;
};

export type BriefingSources = {
  identidade: boolean;
  produto: boolean;
  publico: boolean;
  concorrentes: boolean;
  estetica: boolean;
  metas: boolean;
  documentos: boolean;
};

function composeBriefingFromRecord(
  row: ClientRow,
  opts: {
    extraNotes?: string;
    documents?: Array<{ name: string | null; summary: unknown }>;
    priorBriefingData?: Record<string, unknown> | null;
  } = {},
): { text: string; sources: BriefingSources } {
  const lines: string[] = [];
  const sources: BriefingSources = {
    identidade: false,
    produto: false,
    publico: false,
    concorrentes: false,
    estetica: false,
    metas: false,
    documentos: false,
  };
  const push = (label: string, value: unknown, block?: keyof BriefingSources) => {
    const mark = () => {
      if (block) sources[block] = true;
    };
    if (value == null) return;
    if (Array.isArray(value)) {
      const arr = value.map((v) => (typeof v === "string" ? v.trim() : v)).filter(Boolean);
      if (arr.length === 0) return;
      lines.push(`${label}: ${arr.join(", ")}`);
      mark();
      return;
    }
    if (typeof value === "string") {
      const t = value.trim();
      if (t) {
        lines.push(`${label}: ${t}`);
        mark();
      }
      return;
    }
    if (typeof value === "number") {
      lines.push(`${label}: ${value}`);
      mark();
    }
  };

  const hub = (row.brand_hub ?? {}) as Record<string, unknown>;
  const socials = (row.socials ?? {}) as Record<string, string | null | undefined>;

  // Identidade
  push("Marca", row.name, "identidade");
  push("Nicho", row.niche, "identidade");
  push("Cor da marca", row.color, "estetica");
  push("Tom de voz", (hub.tone_text as string | undefined) ?? row.tone_of_voice, "identidade");
  push("Missão", hub.mission, "identidade");
  push("Posicionamento", hub.positioning, "identidade");
  push("Valores", hub.values, "identidade");

  // Produto
  push("Oferta / produtos", hub.offer, "produto");
  push("Faixa de preço", hub.price_range, "produto");
  push("Diferenciais", hub.differentials, "produto");
  push("Objeções", hub.objections, "produto");

  // Público
  push("Público", hub.audience, "publico");
  push("Jornada", hub.journey, "publico");
  push("Dores", hub.pain_points, "publico");
  push("Desejos", hub.desires, "publico");

  // Concorrentes / inspirações
  const competitors = Array.isArray(hub.competitors)
    ? (hub.competitors as Array<Record<string, unknown>>)
    : [];
  const compHandles = competitors
    .map((c) => (typeof c.handle === "string" ? c.handle : ""))
    .filter(Boolean);
  push("Concorrentes / referências", compHandles, "concorrentes");
  push("Inspirações", hub.inspirations as unknown, "concorrentes");

  // Estética
  const palette = Array.isArray(hub.palette) ? (hub.palette as Array<Record<string, unknown>>) : [];
  const paletteHex = palette.map((p) => (typeof p.hex === "string" ? p.hex : "")).filter(Boolean);
  push("Paleta", paletteHex, "estetica");
  const hashtags = hub.hashtags as string[] | undefined;
  push(
    "Hashtags",
    hashtags?.map((h) => (h.startsWith("#") ? h : `#${h}`)),
    "estetica",
  );
  const doDont = (hub.do_dont ?? {}) as { do?: string; dont?: string };
  push("Do", doDont.do, "estetica");
  push("Don't", doDont.dont, "estetica");

  // Volumetria, formatos & metas
  const vol = (hub.volumetry ?? {}) as Record<string, number | undefined>;
  const volBasis =
    (hub as { volumetry_basis?: unknown }).volumetry_basis === "monthly" ? "mês" : "sem";
  const volStr = Object.entries(vol)
    .filter(([, n]) => typeof n === "number" && (n as number) > 0)
    .map(([k, n]) => `${k}: ${n}/${volBasis}`)
    .join(", ");
  push(volBasis === "mês" ? "Volumetria mensal" : "Volumetria semanal", volStr, "metas");
  const formats = (hub.formats ?? {}) as Record<string, string[] | undefined>;
  const formatsStr = Object.entries(formats)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]) => `${k}: ${(v as string[]).join("/")}`)
    .join("; ");
  push("Formatos por rede", formatsStr, "metas");
  push("Metas", hub.goals, "metas");

  // Contato + canais reais capturados no cadastro
  push("Contato principal", [row.contact_name, row.contact_email].filter(Boolean).join(" · "));
  const socialLinks = Object.entries(socials)
    .filter(([, v]) => typeof v === "string" && (v as string).trim())
    .map(([k, v]) => `${k}: ${v}`);
  push("Canais sociais informados", socialLinks);

  // Contexto acumulado de briefings anteriores (inclui o que foi aplicado a
  // partir de documentos via "Documentos & Contexto IA").
  const prior = opts.priorBriefingData ?? null;
  if (prior && Object.keys(prior).length > 0) {
    const priorLines = Object.entries(prior)
      .filter(
        ([, v]) => v != null && (Array.isArray(v) ? v.length > 0 : String(v).trim().length > 0),
      )
      .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .slice(0, 40);
    if (priorLines.length) {
      lines.push(
        "",
        "Contexto consolidado do briefing (inclui documentos aplicados):",
        ...priorLines,
      );
      sources.documentos = true;
    }
  }

  // Resumos de documentos analisados pela IA.
  const docs = (opts.documents ?? []).filter((d) => d.summary != null);
  if (docs.length) {
    lines.push("", "Documentos analisados pela IA:");
    for (const d of docs.slice(0, 8)) {
      const raw = JSON.stringify(d.summary);
      lines.push(`- ${d.name ?? "documento"}: ${raw.slice(0, 1500)}`);
    }
    sources.documentos = true;
  }

  const base = lines.join("\n");
  const notes = (opts.extraNotes ?? "").trim();
  const text = notes ? `${base}\n\nNotas adicionais do usuário:\n${notes}` : base;
  return { text, sources };
}

// Trava por etapa. Cada etapa roda sozinha na requisição, então 90s é
// suficiente e ainda falha antes do reaper de 5 min.
const LLM_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout de ${ms}ms em ${label}`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

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
const VoiceSchema = z.object({
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
// Pauta generation moved to generateMonthlyPlanFn (pipeline canônico) — gate humano.

function parseJsonLoose(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("A IA não retornou JSON válido.");
  }
}

/** Falha de etapa já classificada — evita reclassificar mais adiante. */
class StepFailure extends Error {
  kind: FailureKind;
  retryable: boolean;
  detail: string;
  constructor(kind: FailureKind, retryable: boolean, detail: string) {
    super(`ai_strategy_step_failed:${kind}`);
    this.name = "StepFailure";
    this.kind = kind;
    this.retryable = retryable;
    this.detail = detail;
  }
}

/**
 * Executa um agente com o MESMO padrão de resiliência da Copy
 * (`post-agents.server.ts`): 3 tentativas, backoff 15s/45s, retry do SDK
 * desligado (`maxRetries: 0`) e classificação de falha compartilhada.
 *
 * Usa `generateText` (buffered) em vez de streaming: nada é renderizado
 * progressivamente aqui e o streaming era justamente o que fazia o pacote `ai`
 * mascarar 429/503 como "No output generated".
 */
async function runJson(opts: {
  /** Rastreabilidade do consumo de IA (`brand_ai_usage.actor_id`). */
  clientId?: string | null;
  userId?: string | null;
  system: string;
  prompt: string;
  strategic: boolean;
  brandId: string;
  step: Step;
  /**
   * Normalização + validação da etapa. Roda DENTRO da tentativa para que um
   * output estruturalmente inesperado possa ser retentado uma vez (modelos de
   * fallback às vezes devolvem outra forma na primeira resposta).
   */
  validate?: (value: unknown) => void;
  onAttempt?: (info: {
    attempt: number;
    ok: boolean;
    kind?: FailureKind;
    retryable?: boolean;
    message?: string;
  }) => Promise<void>;
}): Promise<{ value: unknown; provider: string; modelId: string }> {
  const maxAttempts = BACKOFF_MS.length + 1;
  const role = opts.strategic ? "strategic" : "operational";
  let lastErr: unknown = null;
  let lastKind: FailureKind = "unknown";
  let lastRetryable = false;
  let invalidOutputRetries = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { provider, modelId, model, providerAttempts } = await getBrandAiModelAdmin(
        opts.brandId,
        "text",
        role,
        {
          agent: opts.strategic ? "customer.pipeline.strategic" : "customer.pipeline",
          clientId: opts.clientId ?? null,
          userId: opts.userId ?? null,
        },
      );
      const res = await withTimeout(
        generateText({
          model,
          system: opts.system,
          prompt: opts.prompt,
          // Retry é controlado aqui (backoff próprio) para respeitar a quota.
          maxRetries: 0,
        }),
        LLM_TIMEOUT_MS,
        `${role} (tentativa ${attempt})`,
      );
      const text = (res.text ?? "").trim();
      if (!text) throw new Error("ai_invalid_output: o provedor não retornou conteúdo.");
      const value = parseJsonLoose(text);
      if (opts.validate) {
        try {
          opts.validate(value);
        } catch (invalid) {
          console.error(
            `[customer-pipeline] etapa=${opts.step} output inesperado — chaves recebidas: ${describePayloadKeys(value)}`,
          );
          throw invalid;
        }
      }
      const trace = describeProviderAttempts(providerAttempts);
      await opts.onAttempt?.({ attempt, ok: true, ...(trace ? { message: trace } : {}) });
      // Provedor efetivamente usado (pode ter havido fallback de provedor).
      const used = providerAttempts[providerAttempts.length - 1];
      return { value, provider: used?.provider ?? provider, modelId: used?.model ?? modelId };
    } catch (err) {
      lastErr = err;
      const { kind } = classifyAiError(err);
      let { retryable } = classifyAiError(err);
      // Output inválido ganha UMA retentativa: normalmente é forma inesperada
      // do modelo, não um problema permanente. Nada inválido é persistido.
      if (kind === "invalid_output" && invalidOutputRetries === 0 && attempt < maxAttempts) {
        invalidOutputRetries += 1;
        retryable = true;
      }
      lastKind = kind;
      lastRetryable = retryable;
      const detail = unwrapAiError(err).text.slice(0, 800);
      console.error(
        `[customer-pipeline] etapa=${opts.step} tentativa=${attempt} motivo=${kind} retryable=${retryable}: ${detail}`,
      );
      await opts.onAttempt?.({ attempt, ok: false, kind, retryable, message: detail });
      if (!retryable || attempt === maxAttempts) break;
      await sleep(BACKOFF_MS[attempt - 1]!);
    }
  }


  throw new StepFailure(lastKind, lastRetryable, unwrapAiError(lastErr).text.slice(0, 800));
}

const P_RAW = {
  briefing:
    "Você é um estrategista de marketing sênior. Estruture o briefing bruto em JSON limpo. Nunca invente informação. Responda SOMENTE JSON, sem markdown, com as chaves: publico_alvo, tom_de_voz, dores_do_cliente_final[], diferenciais[], hashtags_sugeridas[], concorrentes_mencionados[], volume_semanal_estimado (número ou null), completude_percentual (0-100).",
  voice:
    "Você é um redator sênior. A partir do briefing estruturado, gere um Voice Card. Use EXATAMENTE as chaves do schema em inglês: voice_card.brand_personality, tone_characteristics, vocabulary_rules.words_to_use, vocabulary_rules.words_to_avoid, brand_phrases_examples. Não traduza nomes de campos. Responda SOMENTE JSON.",
  personas:
    "Você é um estrategista sênior. Gere 3–5 personas acionáveis a partir do briefing. Use EXATAMENTE as chaves: personas[] com nome, descricao, dores, desejos, canais_preferidos, gatilhos_de_decisao, objecoes_comuns. Não use nome_persona nem biografia. Responda SOMENTE JSON.",
  cohorts:
    "Você é estrategista sênior. Gere 3–5 cohorts comportamentais. Use EXATAMENTE as chaves em inglês: cohorts[] com name, target_personas, behavioral_traits, content_strategy, conversion_criteria. Não traduza chaves. Responda SOMENTE JSON.",
  swot: "Você é estrategista sênior. Gere SWOT + matriz competitiva. Use EXATAMENTE as chaves em inglês: swot_analysis.strengths, weaknesses, opportunities, threats; competitive_matrix[] com competitor_name, our_advantages, vulnerabilities. Não traduza chaves. Responda SOMENTE JSON.",
};

// Toda etapa recebe a diretriz de idioma pt-BR (ver src/lib/ai-language.ts).
const P = Object.fromEntries(
  Object.entries(P_RAW).map(([k, v]) => [k, withPtBr(v)]),
) as typeof P_RAW;


// ---------------- Normalizers ----------------
// Coerce PT-BR aliases into the canonical shape before persisting so the
// strategy panel always finds what it expects.

type AnyRec = Record<string, unknown>;
// Tolerante a string | lista | objeto aninhado (ver ai-payload-coerce).
const asStr = (v: unknown, d = ""): string => asText(v) || d;
const asArr = (v: unknown): string[] => asList(v);
const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;


function normalizeBriefingPayload(raw: unknown): z.infer<typeof BriefingSchema> {
  const r = (raw ?? {}) as AnyRec;
  return {
    publico_alvo: asStr(r.publico_alvo) || asStr(r.publico) || null,
    tom_de_voz: asStr(r.tom_de_voz) || asStr(r.tone_of_voice) || null,
    dores_do_cliente_final: asArr(r.dores_do_cliente_final).length
      ? asArr(r.dores_do_cliente_final)
      : asArr(r.dores),
    diferenciais: asArr(r.diferenciais),
    hashtags_sugeridas: asArr(r.hashtags_sugeridas).length
      ? asArr(r.hashtags_sugeridas)
      : asArr(r.hashtags),
    concorrentes_mencionados: asArr(r.concorrentes_mencionados).length
      ? asArr(r.concorrentes_mencionados)
      : asArr(r.concorrentes),
    volume_semanal_estimado: asNum(r.volume_semanal_estimado),
    completude_percentual: asNum(r.completude_percentual) ?? 0,
  };
}

function normalizeVoicePayload(raw: unknown): z.infer<typeof VoiceSchema> {
  const r = (raw ?? {}) as AnyRec;
  const vc = (r.voice_card as AnyRec | undefined) ?? r;
  const persona = vc.persona as AnyRec | undefined;
  const tom = vc.tom_de_voz as AnyRec | undefined;
  const lingu = vc.guia_linguistico as AnyRec | undefined;
  const ex = vc.exemplos_praticos as AnyRec | undefined;
  const vr = vc.vocabulary_rules as AnyRec | undefined;
  return {
    voice_card: {
      brand_personality:
        asStr(vc.brand_personality) ||
        asStr(persona?.arquetipo) ||
        asStr(persona?.descricao) ||
        asStr(tom?.descricao_detalhada),
      tone_characteristics: asArr(vc.tone_characteristics).length
        ? asArr(vc.tone_characteristics)
        : asArr(tom?.principais),
      vocabulary_rules: {
        words_to_use: asArr(vr?.words_to_use).length
          ? asArr(vr?.words_to_use)
          : asArr(lingu?.vocabulario_usar),
        words_to_avoid: asArr(vr?.words_to_avoid).length
          ? asArr(vr?.words_to_avoid)
          : asArr(lingu?.vocabulario_evitar),
      },
      brand_phrases_examples: asArr(vc.brand_phrases_examples).length
        ? asArr(vc.brand_phrases_examples)
        : [ex?.post_instagram_certo, ex?.resposta_cliente_certo].filter(
            (s): s is string => typeof s === "string" && s.length > 0,
          ),
    },
  };
}

function normalizePersonasPayload(raw: unknown): z.infer<typeof PersonasSchema> {
  const r = raw as AnyRec | AnyRec[] | undefined;
  const arr: AnyRec[] = Array.isArray(r)
    ? (r as AnyRec[])
    : Array.isArray((r as AnyRec | undefined)?.personas)
      ? ((r as AnyRec).personas as AnyRec[])
      : [];
  return {
    personas: arr.map((p) => ({
      nome: asStr(p.nome) || asStr(p.nome_persona) || asStr(p.name) || "Persona",
      descricao: asStr(p.descricao) || asStr(p.biografia) || asStr(p.perfil) || "",
      dores: asArr(p.dores),
      desejos: asArr(p.desejos).length ? asArr(p.desejos) : asArr(p.objetivos),
      canais_preferidos: asArr(p.canais_preferidos).length
        ? asArr(p.canais_preferidos)
        : asArr(p.canais),
      gatilhos_de_decisao: asArr(p.gatilhos_de_decisao).length
        ? asArr(p.gatilhos_de_decisao)
        : asArr(p.gatilhos),
      objecoes_comuns: asArr(p.objecoes_comuns).length
        ? asArr(p.objecoes_comuns)
        : asArr(p.objecoes),
    })),
  };
}

function normalizeCohortsPayload(raw: unknown): z.infer<typeof CohortsSchema> {
  return normalizeCohorts(raw);
}


function normalizeSwotPayload(raw: unknown): z.infer<typeof SwotSchema> {
  const r = (raw ?? {}) as AnyRec;
  const a = (r.swot_analysis as AnyRec | undefined) ?? r;
  const matrixRaw = Array.isArray(r.competitive_matrix)
    ? (r.competitive_matrix as AnyRec[])
    : Array.isArray(r.matriz_competitiva)
      ? (r.matriz_competitiva as AnyRec[])
      : [];
  return {
    swot_analysis: {
      strengths: asArr(a.strengths).length ? asArr(a.strengths) : asArr(a.forcas),
      weaknesses: asArr(a.weaknesses).length ? asArr(a.weaknesses) : asArr(a.fraquezas),
      opportunities: asArr(a.opportunities).length
        ? asArr(a.opportunities)
        : asArr(a.oportunidades),
      threats: asArr(a.threats).length ? asArr(a.threats) : asArr(a.ameacas),
    },
    competitive_matrix: matrixRaw.map((c) => ({
      competitor_name: asStr(c.competitor_name) || asStr(c.nome) || asStr(c.concorrente) || "—",
      our_advantages: asStr(c.our_advantages) || asStr(c.vantagens) || asStr(c.nossas_vantagens),
      vulnerabilities: asStr(c.vulnerabilities) || asStr(c.vulnerabilidades),
    })),
  };
}

// ---------------- Step runner ----------------

type JobState = {
  brandId: string;
  clientId: string;
  texto: string;
  sources?: BriefingSources;
  briefing?: z.infer<typeof BriefingSchema>;
  voice?: z.infer<typeof VoiceSchema>;
  personas?: z.infer<typeof PersonasSchema>;
  cohorts?: z.infer<typeof CohortsSchema>;
  swot?: z.infer<typeof SwotSchema>;
  /** Etapas já concluídas e persistidas — base da retomada idempotente. */
  done?: Step[];
  models?: Record<string, string>;
};

/** Resumo compacto para os prompts seguintes — evita reenviar JSON inteiro. */
function compactPersonas(p: z.infer<typeof PersonasSchema>): string {
  return p.personas
    .map(
      (x) => `${x.nome}: ${x.descricao.slice(0, 180)} | dores: ${x.dores.slice(0, 3).join(", ")}`,
    )
    .join("\n");
}
function compactCohorts(c: z.infer<typeof CohortsSchema>): string {
  return c.cohorts.map((x) => `${x.name}: ${x.behavioral_traits.slice(0, 160)}`).join("\n");
}

// ---------------- Validação mínima de output por agente ----------------
// Output vazio/inválido nunca é persistido: vira `ai_invalid_output` e o
// conteúdo anterior do cliente permanece ativo.

const nonEmpty = (s: unknown): boolean => typeof s === "string" && s.trim().length > 0;

function assertValidOutput(step: Step, payload: unknown): void {
  const fail = (why: string): never => {
    throw new Error(`ai_invalid_output: ${why}`);
  };
  // Idioma faz parte do contrato: saída predominantemente em inglês é output
  // inválido e o runJson retenta (nada em inglês chega a ser persistido).
  assertPtBrPayload(payload, step);
  if (step === "briefing") {
    const b = payload as z.infer<typeof BriefingSchema>;
    const hasAny =
      nonEmpty(b.publico_alvo) ||
      nonEmpty(b.tom_de_voz) ||
      b.dores_do_cliente_final.length > 0 ||
      b.diferenciais.length > 0;
    if (!hasAny) fail("briefing estruturado vazio");
    return;
  }
  if (step === "voice") {
    const vc = (payload as z.infer<typeof VoiceSchema>).voice_card;
    if (!nonEmpty(vc.brand_personality) && vc.tone_characteristics.length === 0) {
      fail("voice card sem personalidade nem características de tom");
    }
    return;
  }
  if (step === "personas") {
    const list = (payload as z.infer<typeof PersonasSchema>).personas;
    if (list.length === 0) fail("nenhuma persona gerada");
    if (!list.some((p) => nonEmpty(p.descricao) || p.dores.length > 0))
      fail("personas sem conteúdo");
    return;
  }
  if (step === "cohorts") {
    const list = (payload as z.infer<typeof CohortsSchema>).cohorts;
    if (list.length === 0) fail("nenhum cohort gerado");
    if (!list.some((c) => nonEmpty(c.behavioral_traits) || nonEmpty(c.content_strategy))) {
      fail("cohorts sem conteúdo");
    }
    return;
  }
  const s = (payload as z.infer<typeof SwotSchema>).swot_analysis;
  const total =
    s.strengths.length + s.weaknesses.length + s.opportunities.length + s.threats.length;
  if (total === 0) fail("SWOT vazio");
}

/**
 * Substituição segura do card ativo (P-05).
 *
 * Ordem: insere o novo registro JÁ VALIDADO e só depois desativa os
 * anteriores. Se o insert falhar, o card anterior continua ativo — nunca
 * deixamos o cliente sem voz/personas por causa de um erro do provedor.
 */
async function replaceActive(
  supabase: ReturnType<typeof buildUserClient>,
  table: "brand_voice_cards" | "brand_personas" | "brand_cohorts" | "brand_swot",
  state: JobState,
  userId: string,
  data: unknown,
) {
  const { data: inserted, error } = await supabase
    .from(table)
    .insert({
      brand_id: state.brandId,
      client_id: state.clientId,
      data: data as never,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? `Falha ao salvar em ${table}`);

  const { error: deactErr } = await supabase
    .from(table)
    .update({ is_active: false })
    .eq("brand_id", state.brandId)
    .eq("client_id", state.clientId)
    .eq("is_active", true)
    .neq("id", inserted.id);
  if (deactErr)
    console.warn(`[customer-pipeline] falha ao desativar registros antigos em ${table}`, deactErr);
}

/** Auditoria de tentativa em `activity_events` — mesmo padrão da Copy. */
async function logStrategyAttempt(
  state: Pick<JobState, "brandId" | "clientId">,
  info: {
    agent: string;
    step: Step;
    attempt: number;
    ok: boolean;
    kind?: FailureKind;
    retryable?: boolean;
    message?: string;
  },
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await (supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient)
      .from("activity_events")
      .insert({
        brand_id: state.brandId,
        client_id: state.clientId,
        entity_type: "client_strategy",
        entity_id: state.clientId,
        verb: info.ok ? "ai_agent_succeeded" : "ai_generation_failed",
        payload: {
          agent: info.agent,
          step: info.step,
          attempt: info.attempt,
          ok: info.ok,
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

async function runStep(params: {
  jobId: string;
  step: Step;
  token: string;
  userId: string;
  baseUrl: string;
}) {
  const { jobId, step, token, userId, baseUrl } = params;
  const supabase = buildUserClient(token);
  const patch = (fields: Partial<Database["public"]["Tables"]["ai_jobs"]["Update"]>) =>
    supabase.from("ai_jobs").update(fields).eq("id", jobId);

  // Heartbeat: renova a lease do job. O reaper só encerra jobs cuja validade
  // expirou de fato, então um job apenas esperando o provedor nunca é morto.
  const beat = setInterval(() => {
    void patch({
      updated_at: new Date().toISOString(),
      heartbeat_at: new Date().toISOString(),
      lease_expires_at: leaseExpiryIso(120),
    });
  }, 20_000);

  try {
    const { data: jobRow, error: jobErr } = await supabase
      .from("ai_jobs")
      .select("input, status")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) throw new Error(jobErr.message);
    if (!jobRow) throw new Error("Job não encontrado");
    const state = (jobRow.input ?? {}) as unknown as JobState;
    if (!state.brandId || !state.clientId) throw new Error("Estado do job inválido");

    const done = new Set<Step>(Array.isArray(state.done) ? state.done : []);

    // Retomada idempotente: etapa já concluída não é regerada nem duplicada.
    if (done.has(step)) {
      console.info(`[customer-pipeline] etapa ${step} já concluída — pulando (retomada)`);
      const skipNext = nextStep(step);
      clearInterval(beat);
      if (skipNext) {
        await scheduleStep({ baseUrl, token, jobId, step: skipNext, userId });
        return;
      }
      await finishJob(supabase, patch, state, userId);
      return;
    }

    const meta = STEP_META[step];
    await patch({
      status: "running",
      ...(step === "briefing" ? { started_at: new Date().toISOString() } : {}),
      progress: meta.progress,
      step_label: meta.label,
    });

    // Espaçamento entre agentes (mesmo conceito da Copy): evita rajada de
    // chamadas seguidas ao provedor, que é o que dispara o 429.
    if (step !== "briefing") await sleep(SPACING_MS);

    const briefingJson = () => JSON.stringify(state.briefing ?? {}, null, 2);
    const models = { ...(state.models ?? {}) };
    const onAttempt = (info: {
      attempt: number;
      ok: boolean;
      kind?: FailureKind;
      retryable?: boolean;
      message?: string;
    }) =>
      logStrategyAttempt(state, {
        agent: step === "briefing" ? "customer.pipeline" : "customer.pipeline.strategic",
        step,
        ...info,
      });

    if (step === "briefing") {
      const { value, provider, modelId } = await runJson({
        system: P.briefing,
        prompt: `Texto bruto do briefing:\n"""\n${state.texto}\n"""`,
        strategic: false,
        brandId: state.brandId,
        clientId: state.clientId,
        userId,
        step,
        onAttempt,
        validate: (v) => assertValidOutput(step, normalizeBriefingPayload(v)),
      });
      const briefing = normalizeBriefingPayload(value);
      assertValidOutput(step, briefing);
      models[step] = `${provider}:${modelId}`;
      state.briefing = briefing;

      // FASE 2: escreve na fonte única (clients.brand_hub) + versão auditável.
      const { writeCanonicalBriefing } = await import("@/lib/briefing-write.server");
      const { legacyToHubPatch } = await import("@/lib/briefing-source.server");
      await writeCanonicalBriefing(supabase, {
        brandId: state.brandId,
        clientId: state.clientId,
        patch: legacyToHubPatch(briefing as unknown as Record<string, unknown>),
        authorId: userId,
        origin: "ai.pipeline",
      });
    } else if (step === "voice") {
      const { value, provider, modelId } = await runJson({
        system: P.voice,
        prompt: `Briefing estruturado:\n${briefingJson()}`,
        strategic: true,
        brandId: state.brandId,
        clientId: state.clientId,
        userId,
        step,
        onAttempt,
        validate: (v) => assertValidOutput(step, normalizeVoicePayload(v)),
      });
      const voice = normalizeVoicePayload(value);
      assertValidOutput(step, voice);
      models[step] = `${provider}:${modelId}`;
      state.voice = voice;
      await replaceActive(supabase, "brand_voice_cards", state, userId, voice);
    } else if (step === "personas") {
      const { value, provider, modelId } = await runJson({
        system: P.personas,
        prompt: `Briefing:\n${briefingJson()}`,
        strategic: true,
        brandId: state.brandId,
        clientId: state.clientId,
        userId,
        step,
        onAttempt,
        validate: (v) => assertValidOutput(step, normalizePersonasPayload(v)),
      });
      const personas = normalizePersonasPayload(value);
      assertValidOutput(step, personas);
      models[step] = `${provider}:${modelId}`;
      state.personas = personas;
      await replaceActive(supabase, "brand_personas", state, userId, personas);
    } else if (step === "cohorts") {
      const { value, provider, modelId } = await runJson({
        system: P.cohorts,
        prompt: `Briefing:\n${briefingJson()}\n\nPersonas:\n${compactPersonas(state.personas ?? { personas: [] })}`,
        strategic: true,
        brandId: state.brandId,
        clientId: state.clientId,
        userId,
        step,
        onAttempt,
        validate: (v) => assertValidOutput(step, normalizeCohortsPayload(v)),
      });
      const cohorts = normalizeCohortsPayload(value);
      assertValidOutput(step, cohorts);
      models[step] = `${provider}:${modelId}`;
      state.cohorts = cohorts;
      await replaceActive(supabase, "brand_cohorts", state, userId, cohorts);
    } else {
      const { value, provider, modelId } = await runJson({
        system: P.swot,
        prompt: [
          `Briefing:\n${briefingJson()}`,
          `Personas:\n${compactPersonas(state.personas ?? { personas: [] })}`,
          `Cohorts:\n${compactCohorts(state.cohorts ?? { cohorts: [] })}`,
        ].join("\n\n"),
        strategic: true,
        brandId: state.brandId,
        clientId: state.clientId,
        userId,
        step,
        onAttempt,
        validate: (v) => assertValidOutput(step, normalizeSwotPayload(v)),
      });
      const swot = normalizeSwotPayload(value);
      assertValidOutput(step, swot);
      models[step] = `${provider}:${modelId}`;
      state.swot = swot;
      await replaceActive(supabase, "brand_swot", state, userId, swot);
    }

    // Etapa concluída E persistida — registra para a retomada idempotente.
    done.add(step);
    state.done = STEPS.filter((s) => done.has(s));
    state.models = models;
    await patch({ input: state as never });

    const next = nextStep(step);
    if (next) {
      await patch({ progress: STEP_META[next].progress, step_label: STEP_META[next].label });
      clearInterval(beat);
      await scheduleStep({ baseUrl, token, jobId, step: next, userId });
      return;
    }

    await finishJob(supabase, patch, state, userId);
  } catch (err) {
    // Interrupção segura: a cadeia PARA aqui. Nada é apagado, nada falso é
    // gravado e as etapas restantes ficam retomáveis.
    const { kind, retryable } = classifyAiError(err);
    const detail = err instanceof StepFailure ? err.detail : unwrapAiError(err).text.slice(0, 800);
    const m = FAILURE_MESSAGE_PT[kind];
    const message = `${m.title} — etapa "${STEP_META[step].label}". ${m.body}`;

    console.error(
      `[customer-pipeline] etapa=${step} FALHOU motivo=${kind} retryable=${retryable}: ${detail}`,
    );

    const { data: current } = await supabase
      .from("ai_jobs")
      .select("input")
      .eq("id", jobId)
      .maybeSingle();
    const st = (current?.input ?? {}) as unknown as JobState;

    await patch({
      status: "failed",
      error: message,
      finished_at: new Date().toISOString(),
      step_label: null,
      lease_owner: null,
      lease_expires_at: null,
      result: {
        failure_kind: kind,
        retryable,
        failed_step: step,
        completed_steps: st.done ?? [],
        detail: detail.slice(0, 500),
      } as never,
    });
  } finally {
    clearInterval(beat);
  }
}

/** Conclui o job: notifica e marca sucesso. */
async function finishJob(
  supabase: ReturnType<typeof buildUserClient>,
  patch: (fields: Partial<Database["public"]["Tables"]["ai_jobs"]["Update"]>) => unknown,
  state: JobState,
  userId: string,
) {
  const reviewRoute = `/customers/${state.clientId}/briefing`;
  // Respeita a preferência `ai_jobs` do usuário (aplicada no servidor).
  const rows = await filterRowsByPrefs(supabase as never, [
    {
      user_id: userId,
      brand_id: state.brandId,
      kind: "system",
      title: "Estratégia gerada — revise antes de criar ideias",
      body: "Voice card, personas, cohorts e SWOT prontos. Confira, ajuste e depois clique em Gerar ideias.",
      href: reviewRoute,
      payload: { event: "strategy_ready", client_id: state.clientId },
    },
  ]);
  if (rows.length) {
    const { error: notifErr } = await supabase.from("notifications").insert(rows as never);
    if (notifErr) console.warn("[notifications] insert failed", notifErr);
  }

  await patch({
    status: "succeeded",
    progress: 100,
    step_label: null,
    lease_owner: null,
    lease_expires_at: null,
    finished_at: new Date().toISOString(),
    target_route: reviewRoute,
    result: {
      title: "Estratégia pronta para revisão",
      content: "Revise voice, personas, cohorts e SWOT. Depois clique em Gerar ideias.",
      sources: state.sources ?? null,
      models: state.models ?? null,
    } as never,
  });
}

/**
 * Agenda a próxima etapa como uma nova requisição a esta mesma rota.
 * Se a subrequisição falhar (rede/isolate/401), executa a etapa inline no
 * mesmo processo em vez de marcar o job como falho — o encadeamento continua.
 */
async function scheduleStep(opts: {
  baseUrl: string;
  token: string;
  jobId: string;
  step: Step;
  userId: string;
}) {
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(`${opts.baseUrl}/api/jobs/customer-pipeline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.token}`,
        },
        body: JSON.stringify({ jobId: opts.jobId, step: opts.step }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.error("[customer-pipeline] falha ao agendar etapa", opts.step, lastErr);
    }
  }

  // Fallback: roda a etapa aqui mesmo. runStep já trata seus próprios erros.
  console.warn("[customer-pipeline] executando etapa inline após falha de agendamento", opts.step);
  try {
    await runStep({
      jobId: opts.jobId,
      step: opts.step,
      token: opts.token,
      userId: opts.userId,
      baseUrl: opts.baseUrl,
    });
  } catch (err) {
    const { kind, retryable } = classifyAiError(err);
    const detail = unwrapAiError(err).text.slice(0, 500) || lastErr;
    const m = FAILURE_MESSAGE_PT[kind];
    console.error(`[customer-pipeline] etapa inline ${opts.step} falhou motivo=${kind}: ${detail}`);
    const supabase = buildUserClient(opts.token);
    await supabase
      .from("ai_jobs")
      .update({
        status: "failed",
        error: `${m.title} — etapa "${STEP_META[opts.step].label}". ${m.body}`,
        finished_at: new Date().toISOString(),
        step_label: null,
        result: { failure_kind: kind, retryable, failed_step: opts.step, detail } as never,
      })
      .eq("id", opts.jobId);
  }
}

export const Route = createFileRoute("/api/jobs/customer-pipeline")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        if (token.split(".").length !== 3) return new Response("Unauthorized", { status: 401 });

        const raw = await request.json().catch(() => null);
        const baseUrl = new URL(request.url).origin;

        const supabase = buildUserClient(token);
        const { data: claims } = await supabase.auth.getClaims(token);
        const userId = claims?.claims?.sub;
        if (!userId) return new Response("Unauthorized", { status: 401 });

        // --- Início: valida escopo do cliente antes de enfileirar ---
        const start = StartSchema.safeParse(raw);
        if (start.success) {
          const denied = await guardClientScope(supabase, userId, start.data.clientId);
          if (denied) return denied;
        }

        // --- Continuação de etapa (chamada interna) ---
        const cont = ContinueSchema.safeParse(raw);
        if (cont.success) {
          waitUntil(
            runStep({
              jobId: cont.data.jobId,
              step: cont.data.step,
              token,
              userId,
              baseUrl,
            }),
          );
          return new Response(JSON.stringify({ jobId: cont.data.jobId, step: cont.data.step }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          });
        }

        // --- Início do pipeline ---
        const parsed = StartSchema.safeParse(raw);
        if (!parsed.success) {
          return new Response(JSON.stringify(parsed.error.format()), { status: 400 });
        }
        const input = parsed.data;

        // Fonte de verdade: cadastro + Cérebro da Marca + documentos.
        const [clientRes, docsRes, priorRes] = await Promise.all([
          supabase
            .from("clients")
            .select(
              "name, niche, color, logo_url, tone_of_voice, contact_name, contact_email, socials, brand_hub" as never,
            )
            .eq("id", input.clientId)
            .maybeSingle(),
          supabase
            .from("client_documents")
            .select("name, ai_summary")
            .eq("brand_id", input.brandId)
            .eq("client_id", input.clientId)
            .not("ai_summary", "is", null)
            .order("created_at", { ascending: false })
            .limit(8),
          // Briefing canônico derivado de clients.brand_hub (brand_briefings
          // permanece apenas como fallback interno de compatibilidade).
          loadCanonicalBriefing(supabase, {
            clientId: input.clientId,
            brandId: input.brandId,
          }),
        ]);
        if (clientRes.error || !clientRes.data) {
          return new Response(clientRes.error?.message ?? "Cliente não encontrado", {
            status: 404,
          });
        }

        const documents = (
          (docsRes.data ?? []) as Array<{ name: string | null; ai_summary: unknown }>
        ).map((d) => ({ name: d.name, summary: d.ai_summary }));
        const canonicalBriefing = priorRes;
        const { text: composed, sources } = composeBriefingFromRecord(
          {
            ...(clientRes.data as unknown as ClientRow),
            brand_hub: canonicalBriefing.hub as unknown as ClientRow["brand_hub"],
          },
          {
            ...(input.texto ? { extraNotes: input.texto } : {}),
            documents,
            priorBriefingData: canonicalBriefing.legacy as unknown as Record<string, unknown>,
          },
        );
        if (composed.length < 40) {
          return new Response(
            "Preencha ao menos Nome + Nicho e um bloco do Cérebro da Marca antes de gerar a estratégia.",
            { status: 400 },
          );
        }

        // --- Proteção contra dupla execução ---
        // Reutiliza `ai_jobs` (nenhuma tabela nova): um job queued/running com
        // heartbeat recente significa que já existe geração em andamento.
        // Validade é decidida pela LEASE (mesmo critério do reaper), não por
        // uma janela fixa de 5 min: job com lease viva bloqueia, job órfão não.
        const staleCutoff = new Date(Date.now() - 60 * 60_000).toISOString();
        const { data: candidates } = await supabase
          .from("ai_jobs")
          .select("id, kind, status, updated_at, heartbeat_at, lease_owner, lease_expires_at")
          .eq("client_id", input.clientId)
          .eq("kind", "customer_strategy")
          .in("status", ["queued", "running"])
          .gt("updated_at", staleCutoff)
          .order("updated_at", { ascending: false })
          .limit(5);
        const activeJob = ((candidates ?? []) as unknown as Array<LeaseJob & { id: string }>).find(
          (j) => isLeaseValid(j),
        );
        if (activeJob) {
          return new Response(
            JSON.stringify({
              error: "strategy_already_running",
              jobId: activeJob.id,
              message: "Já existe uma geração de estratégia em andamento.",
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }

        // --- Retomada idempotente ---
        // Se a última execução falhou no meio, preserva as etapas concluídas e
        // continua da primeira pendente, sem regerar nem duplicar nada.
        const { data: lastJob } = await supabase
          .from("ai_jobs")
          .select("input, status")
          .eq("client_id", input.clientId)
          .eq("kind", "customer_strategy")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastState = (lastJob?.input ?? null) as unknown as JobState | null;
        const resumeDone: Step[] =
          lastJob?.status === "failed" && Array.isArray(lastState?.done)
            ? STEPS.filter((s) => lastState!.done!.includes(s))
            : [];
        const startStep: Step = STEPS.find((s) => !resumeDone.includes(s)) ?? "briefing";

        const state: JobState = {
          brandId: input.brandId,
          clientId: input.clientId,
          texto: composed,
          sources,
          ...(resumeDone.length > 0
            ? {
                done: resumeDone,
                ...(lastState?.briefing ? { briefing: lastState.briefing } : {}),
                ...(lastState?.voice ? { voice: lastState.voice } : {}),
                ...(lastState?.personas ? { personas: lastState.personas } : {}),
                ...(lastState?.cohorts ? { cohorts: lastState.cohorts } : {}),
                ...(lastState?.swot ? { swot: lastState.swot } : {}),
                ...(lastState?.models ? { models: lastState.models } : {}),
              }
            : {}),
        };

        const { data: job, error: jobErr } = await supabase
          .from("ai_jobs")
          .insert({
            brand_id: input.brandId,
            client_id: input.clientId,
            user_id: userId,
            kind: "customer_strategy",
            title: "Estratégia do cliente",
            subtitle: "Briefing · Voz · Personas · Cohorts · SWOT",
            status: "queued",
            progress: resumeDone.length > 0 ? STEP_META[startStep].progress : 0,
            lease_owner: newLeaseOwner("customer-strategy"),
            lease_expires_at: leaseExpiryIso(120),
            heartbeat_at: new Date().toISOString(),
            input: state as unknown as Database["public"]["Tables"]["ai_jobs"]["Insert"]["input"],
          })
          .select("id")
          .single();
        if (jobErr || !job) {
          return new Response(jobErr?.message ?? "Failed to enqueue", { status: 500 });
        }

        waitUntil(runStep({ jobId: job.id, step: startStep, token, userId, baseUrl }));

        return new Response(JSON.stringify({ jobId: job.id }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
