import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Send,
  Users,
  Layers,
  Target,
  TrendingUp,
  ShieldAlert,
  Zap,
  Sparkles,
  CheckCircle2,
  Eye,
  Shield,
  Clock,
  BadgeCheck,
  MessageSquare,
  ArrowRight,
  Sprout,
  AlertTriangle,
  Lightbulb,
  Flame,
  Ban,
  Check,
  User,
  Pencil,
} from "lucide-react";
import { ExpandedModal } from "@/components/ui/expanded-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";
import { sendPautaToContentFn } from "@/lib/ai-agents.functions";
import {
  customerCoreQuery,
  customerTargetQuery,
  customerMarketQuery,
  customerPautasQuery,
} from "@/lib/customer-queries";
import { ContextSourceBadge } from "./context-source-badge";
import {
  VoiceEditor,
  PersonasEditor,
  CohortsEditor,
  SwotEditor,
  type VoiceState,
  type PersonaState,
  type CohortState,
  type SwotState,
} from "./strategy-editors";

type Scope = { brandId: string; clientId: string };

// ---------- normalizers (tolerate `{__raw: "..."}` payloads from AI) ----------

function tryParseJson(input: string): unknown {
  // Strip markdown fences
  const s = input
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(s);
  } catch {
    /* try repair */
  }
  // Remove trailing junk after last balanced brace/bracket
  const lastCurly = s.lastIndexOf("}");
  const lastSquare = s.lastIndexOf("]");
  const end = Math.max(lastCurly, lastSquare);
  if (end > 0) {
    try {
      return JSON.parse(s.slice(0, end + 1));
    } catch {
      /* noop */
    }
  }
  return null;
}

function extractRaw<T = unknown>(data: unknown): T | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.__raw === "string") {
    const parsed = tryParseJson(d.__raw);
    return (parsed as T) ?? null;
  }
  return data as T;
}

type RawPersona = Record<string, unknown>;
type NormalizedPersona = {
  nome: string;
  arquetipo: string;
  descricao: string;
  motivacao: string;
  dor_principal: string;
  dores: string[];
  canais_preferidos: string[];
  logica_compra: string;
  fator_confianca: string;
  como_decide: string;
  objecao_dominante: string;
  estilo_comunicacao: string;
  ciclo_compra: string;
  nivel_consciencia: string;
};

function pickString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      // nested descriptor object
      const nested = v as Record<string, unknown>;
      for (const nk of ["descricao", "texto", "value", "resumo"]) {
        const nv = nested[nk];
        if (typeof nv === "string" && nv.trim()) return nv;
      }
    }
  }
  return "";
}

/** Primeiro item textual de uma das chaves em formato de lista. */
function firstOfList(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) return item;
        if (item && typeof item === "object") {
          const s = pickString(item as Record<string, unknown>, [
            "descricao",
            "texto",
            "objecao",
            "value",
          ]);
          if (s) return s;
        }
      }
    }
  }
  return "";
}

function normalizePersonas(data: unknown): NormalizedPersona[] {
  const parsed = extractRaw<unknown>(data);
  if (!parsed) return [];
  const arr: RawPersona[] = Array.isArray(parsed)
    ? (parsed as RawPersona[])
    : Array.isArray((parsed as { personas?: unknown }).personas)
      ? (parsed as { personas: RawPersona[] }).personas
      : [];
  return arr.map((p) => {
    const dorPrincipal = pickString(p, ["dor_principal", "dor", "main_pain"]);
    const dores = Array.isArray(p.dores)
      ? (p.dores as string[])
      : Array.isArray(p.pain_points)
        ? (p.pain_points as string[])
        : dorPrincipal
          ? [dorPrincipal]
          : [];
    return {
      nome: pickString(p, ["nome", "nome_persona", "name"]) || "Persona",
      arquetipo: pickString(p, ["arquetipo", "archetype", "arquétipo"]),
      descricao: pickString(p, ["perfil", "descricao", "biografia", "description", "resumo"]),
      motivacao: pickString(p, [
        "motivacao",
        "motivation",
        "desejo",
        "desejo_principal",
        "aspiracao",
      ]),
      dor_principal: dorPrincipal,
      dores,
      canais_preferidos: Array.isArray(p.canais_preferidos)
        ? (p.canais_preferidos as string[])
        : Array.isArray(p.canais)
          ? (p.canais as string[])
          : Array.isArray(p.channels)
            ? (p.channels as string[])
            : [],
      logica_compra: pickString(p, [
        "logica_compra",
        "logica_de_compra",
        "buying_logic",
        "raciocinio_compra",
      ]),
      fator_confianca: pickString(p, [
        "fator_confianca",
        "trust_factor",
        "confianca",
        "gatilho_confianca",
      ]),
      como_decide: pickString(p, [
        "como_decide",
        "decision_process",
        "processo_decisao",
        "processo_decisorio",
      ]),
      // A IA às vezes devolve as objeções como LISTA (`objecoes_comuns`);
      // sem este fallback o card "Barreira principal" ficava vazio.
      objecao_dominante:
        pickString(p, ["objecao_dominante", "objecao", "main_objection", "objecao_principal"]) ||
        firstOfList(p, ["objecoes_comuns", "objecoes", "objections", "common_objections"]),
      estilo_comunicacao: pickString(p, [
        "estilo_comunicacao",
        "communication_style",
        "estilo_de_comunicacao",
        "tom_esperado",
      ]),
      ciclo_compra: pickString(p, [
        "ciclo_compra",
        "ciclo_de_compra",
        "buying_cycle",
        "tempo_decisao",
      ]),
      nivel_consciencia: pickString(p, [
        "nivel_consciencia",
        "nivel_de_consciencia",
        "awareness_level",
        "consciencia",
      ]),
    };
  });
}

type NormalizedCohort = {
  name: string;
  target_personas: string[];
  behavioral_traits: string;
  content_strategy: string;
  conversion_criteria: string;
};

function normalizeCohorts(data: unknown): NormalizedCohort[] {
  const parsed = extractRaw<unknown>(data);
  if (!parsed) return [];
  const arr: Record<string, unknown>[] = Array.isArray(parsed)
    ? (parsed as Record<string, unknown>[])
    : Array.isArray((parsed as { cohorts?: unknown }).cohorts)
      ? (parsed as { cohorts: Record<string, unknown>[] }).cohorts
      : [];
  return arr.map((c) => ({
    name: (c.name as string) ?? (c.nome as string) ?? (c.nome_cohort as string) ?? "Cohort",
    target_personas: Array.isArray(c.target_personas)
      ? (c.target_personas as string[])
      : Array.isArray(c.personas_alvo)
        ? (c.personas_alvo as string[])
        : Array.isArray(c.personas)
          ? (c.personas as string[])
          : [],
    behavioral_traits:
      (c.behavioral_traits as string) ??
      (c.comportamento as string) ??
      (c.tracos_comportamentais as string) ??
      "",
    content_strategy:
      (c.content_strategy as string) ??
      (c.estrategia_conteudo as string) ??
      (c.estrategia_de_conteudo as string) ??
      "",
    conversion_criteria:
      (c.conversion_criteria as string) ??
      (c.criterio_conversao as string) ??
      (c.criterio_de_conversao as string) ??
      "",
  }));
}

// Voice card can arrive canonical (voice_card.*) or as a PT-BR shape
// (persona.arquetipo, tom_de_voz.principais, guia_linguistico.*, exemplos_praticos.*).
type NormalizedVoice = {
  brand_personality: string;
  tone_characteristics: string[];
  vocabulary_rules: { words_to_use: string[]; words_to_avoid: string[] };
  brand_phrases_examples: string[];
};

function normalizeVoice(data: unknown): NormalizedVoice | null {
  const parsed = extractRaw<Record<string, unknown>>(data);
  if (!parsed) return null;
  const vc = (parsed.voice_card as Record<string, unknown> | undefined) ?? parsed;
  const persona = vc.persona as Record<string, unknown> | undefined;
  const tom = vc.tom_de_voz as Record<string, unknown> | undefined;
  const lingu = vc.guia_linguistico as Record<string, unknown> | undefined;
  const ex = vc.exemplos_praticos as Record<string, unknown> | undefined;

  const brand_personality =
    (vc.brand_personality as string) ??
    (persona?.arquetipo as string) ??
    (persona?.descricao as string) ??
    (tom?.descricao_detalhada as string) ??
    "";
  const tone_characteristics = Array.isArray(vc.tone_characteristics)
    ? (vc.tone_characteristics as string[])
    : Array.isArray(tom?.principais)
      ? (tom!.principais as string[])
      : [];
  const vr = vc.vocabulary_rules as Record<string, unknown> | undefined;
  const words_to_use = Array.isArray(vr?.words_to_use)
    ? (vr!.words_to_use as string[])
    : Array.isArray(lingu?.vocabulario_usar)
      ? (lingu!.vocabulario_usar as string[])
      : [];
  const words_to_avoid = Array.isArray(vr?.words_to_avoid)
    ? (vr!.words_to_avoid as string[])
    : Array.isArray(lingu?.vocabulario_evitar)
      ? (lingu!.vocabulario_evitar as string[])
      : [];
  const brand_phrases_examples = Array.isArray(vc.brand_phrases_examples)
    ? (vc.brand_phrases_examples as string[])
    : ex
      ? [ex.post_instagram_certo, ex.resposta_cliente_certo].filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [];

  if (!brand_personality && !tone_characteristics.length && !words_to_use.length) return null;
  return {
    brand_personality,
    tone_characteristics,
    vocabulary_rules: { words_to_use, words_to_avoid },
    brand_phrases_examples,
  };
}

// SWOT: canonical { swot_analysis, competitive_matrix } or PT-BR
// { forcas/fraquezas/oportunidades/ameacas, matriz_competitiva[] }.
type NormalizedSwot = {
  analysis: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
  matrix: Array<{ competitor_name: string; our_advantages: string; vulnerabilities: string }>;
};

function normalizeSwot(data: unknown): NormalizedSwot {
  const parsed = extractRaw<Record<string, unknown>>(data) ?? {};
  const analysisRaw = (parsed.swot_analysis as Record<string, unknown> | undefined) ?? parsed;
  const list = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
  const analysis = {
    strengths: list(analysisRaw.strengths ?? analysisRaw.forcas ?? analysisRaw.forças),
    weaknesses: list(analysisRaw.weaknesses ?? analysisRaw.fraquezas),
    opportunities: list(analysisRaw.opportunities ?? analysisRaw.oportunidades),
    threats: list(analysisRaw.threats ?? analysisRaw.ameacas ?? analysisRaw.ameaças),
  };
  const rawMatrix = Array.isArray(parsed.competitive_matrix)
    ? (parsed.competitive_matrix as Record<string, unknown>[])
    : Array.isArray(parsed.matriz_competitiva)
      ? (parsed.matriz_competitiva as Record<string, unknown>[])
      : [];
  const matrix = rawMatrix.map((c) => ({
    competitor_name:
      (c.competitor_name as string) ?? (c.nome as string) ?? (c.concorrente as string) ?? "—",
    our_advantages:
      (c.our_advantages as string) ??
      (c.vantagens as string) ??
      (c.nossas_vantagens as string) ??
      "",
    vulnerabilities: (c.vulnerabilities as string) ?? (c.vulnerabilidades as string) ?? "",
  }));
  return { analysis, matrix };
}

// ---------- helpers ----------

function SectionCard({
  title,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "danger" | "success" | "info";
}) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : tone === "success"
        ? "border-[--health-good]/40 bg-[--health-good]/10 text-[--health-good]"
        : tone === "info"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${toneClass}`}
    >
      {children}
    </span>
  );
}

// ---------- OVERVIEW ----------

export function OverviewTab({ brandId, clientId }: Scope) {
  // Suspende paralelamente nas três fatias — TanStack Query dispara em paralelo.
  const { data: core } = useSuspenseQuery(customerCoreQuery({ brandId, clientId }));
  const { data: target } = useSuspenseQuery(customerTargetQuery({ brandId, clientId }));
  const { data: market } = useSuspenseQuery(customerMarketQuery({ brandId, clientId }));

  const briefing = (core.briefing?.data ?? {}) as Record<string, unknown>;
  const voice = normalizeVoice(core.voice?.data);
  const personas = normalizePersonas(target.personas?.data);
  const cohorts = normalizeCohorts(target.cohorts?.data);
  const swot = normalizeSwot(market.swot?.data).analysis;

  const kpis = [
    { label: "Completude briefing", value: `${core.briefing?.completude ?? 0}%` },
    { label: "Personas", value: personas.length },
    { label: "Cohorts", value: cohorts.length },
    { label: "Forças (SWOT)", value: swot.strengths.length },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {k.label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Brand personality" icon={Sparkles}>
          <div className="mb-3">
            <ContextSourceBadge source="persona" />
          </div>
          {voice?.brand_personality ? (
            <p className="text-sm leading-relaxed text-foreground">{voice.brand_personality}</p>
          ) : (
            <EmptyHint text="Voice card ainda não gerado." />
          )}
          {voice?.tone_characteristics?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {voice.tone_characteristics.map((t, i) => (
                <Chip key={i} tone="info">
                  {t}
                </Chip>
              ))}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title="Público-alvo" icon={Target}>
          <div className="mb-3">
            <ContextSourceBadge source="persona" />
          </div>
          <p className="text-sm text-foreground">
            {(briefing.publico_alvo as string | null) ?? (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
          {Array.isArray(briefing.diferenciais) && (briefing.diferenciais as string[]).length ? (
            <div className="mt-3">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Diferenciais
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(briefing.diferenciais as string[]).map((d, i) => (
                  <Chip key={i}>{d}</Chip>
                ))}
              </div>
            </div>
          ) : null}
        </SectionCard>
      </div>
    </div>
  );
}

// ---------- STRATEGY ----------

export function StrategyTab({ brandId, clientId }: Scope) {
  const { data: core } = useSuspenseQuery(customerCoreQuery({ brandId, clientId }));
  const briefing = (core.briefing?.data ?? {}) as Record<string, unknown>;
  const voice = normalizeVoice(core.voice?.data);
  const voiceId = (core.voice as { id?: string } | null | undefined)?.id;
  const [voiceOpen, setVoiceOpen] = useState(false);

  const wordsUse = voice?.vocabulary_rules?.words_to_use ?? [];
  const wordsAvoid = voice?.vocabulary_rules?.words_to_avoid ?? [];
  const tone = voice?.tone_characteristics ?? [];
  const personality = voice?.brand_personality ?? "";
  const phrases = voice?.brand_phrases_examples ?? [];
  const diferenciais = Array.isArray(briefing.diferenciais)
    ? (briefing.diferenciais as string[])
    : [];
  const hashtags = Array.isArray(briefing.hashtags_sugeridas)
    ? (briefing.hashtags_sugeridas as string[])
    : [];

  const voiceInitial: VoiceState = {
    brand_personality: personality,
    tone_characteristics: tone,
    words_to_use: wordsUse,
    words_to_avoid: wordsAvoid,
    brand_phrases_examples: phrases,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <ContextSourceBadge source="persona" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setVoiceOpen(true)}
          disabled={!voiceId}
          className="h-8 gap-1.5"
        >
          <Pencil className="h-3.5 w-3.5" /> Editar tom & vocabulário
        </Button>
      </div>

      {/* Tom de voz e personalidade */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border/60 bg-slate-50 dark:bg-muted/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Personalidade da marca
            </div>
            <p className="mt-3 text-sm leading-relaxed text-foreground">
              {personality || (
                <span className="text-muted-foreground">Voice card ainda não gerado.</span>
              )}
            </p>
            {tone.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {tone.map((t, i) => (
                  <Badge key={i} variant="secondary" className="rounded-full font-normal">
                    {t}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-slate-50 dark:bg-muted/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" /> Frases assinatura
            </div>
            {phrases.length ? (
              <ul className="mt-3 space-y-2">
                {phrases.map((p, i) => (
                  <li
                    key={i}
                    className="border-l-2 border-primary/50 pl-3 text-sm italic text-foreground/90"
                  >
                    “{p}”
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Nenhuma frase-exemplo gerada.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Diretrizes de marca — tags */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Termos preferidos
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Vocabulário que reforça o posicionamento.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {wordsUse.length ? (
                wordsUse.map((w, i) => (
                  <Badge
                    key={i}
                    className="rounded-full border border-emerald-200 bg-emerald-50 font-normal text-emerald-800 hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                  >
                    <Check className="mr-1 h-3 w-3" /> {w}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-rose-700 dark:text-rose-400">
              <Ban className="h-3.5 w-3.5" /> Palavras proibidas
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Termos que devem ser evitados na comunicação.
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {wordsAvoid.length ? (
                wordsAvoid.map((w, i) => (
                  <Badge
                    key={i}
                    className="rounded-full border border-rose-200 bg-rose-50 font-normal text-rose-800 hover:bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                  >
                    <Ban className="mr-1 h-3 w-3" /> {w}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Diferenciais + Hashtags */}
      {diferenciais.length || hashtags.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {diferenciais.length ? (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  <Sprout className="h-3.5 w-3.5" /> Diferenciais competitivos
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {diferenciais.map((d, i) => (
                    <Badge key={i} variant="outline" className="rounded-full font-normal">
                      {d}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
          {hashtags.length ? (
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  <Flame className="h-3.5 w-3.5" /> Hashtags recomendadas
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {hashtags.map((h, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="rounded-full font-mono text-[11px] font-normal"
                    >
                      {h.startsWith("#") ? h : `#${h}`}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <VoiceEditor
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        scope={{ brandId, clientId }}
        entityId={voiceId}
        initial={voiceInitial}
      />
    </div>
  );
}

// ---------- TARGET ----------

export function TargetTab({ brandId, clientId }: Scope) {
  const { data: target } = useSuspenseQuery(customerTargetQuery({ brandId, clientId }));
  const personas = normalizePersonas(target.personas?.data);
  const cohorts = normalizeCohorts(target.cohorts?.data);
  const [selected, setSelected] = useState<NormalizedPersona | null>(null);
  const personasId = (target.personas as { id?: string } | null | undefined)?.id;
  const cohortsId = (target.cohorts as { id?: string } | null | undefined)?.id;
  const [personasOpen, setPersonasOpen] = useState(false);
  const [cohortsOpen, setCohortsOpen] = useState(false);

  // Diagnóstico global — agrega as personas
  const diagnostic = summarizeDiagnostic(personas);

  return (
    <div className="space-y-8">
      {/* Diagnóstico global */}
      <div className="grid gap-3 md:grid-cols-3">
        <DiagnosticCard
          icon={Eye}
          label="Nível de consciência"
          value={diagnostic.consciencia}
          className="bg-rose-50/70 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900/40"
          iconClass="text-rose-500"
        />
        <DiagnosticCard
          icon={Shield}
          label="Barreira principal"
          value={diagnostic.barreira}
          className="bg-amber-50/70 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/40"
          iconClass="text-amber-500"
        />
        <DiagnosticCard
          icon={Clock}
          label="Ciclo de compra"
          value={diagnostic.ciclo}
          className="bg-emerald-50/70 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/40"
          iconClass="text-emerald-500"
        />
      </div>

      {/* Personas */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="h-4 w-4 text-primary" /> Personas
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Clique em um card para abrir o dossiê psicológico completo.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ContextSourceBadge source="persona" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPersonasOpen(true)}
              disabled={!personasId}
              className="h-8 gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
          </div>
        </div>
        {personas.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {personas.map((p, i) => (
              <PersonaCard key={i} persona={p} onOpen={() => setSelected(p)} />
            ))}
          </div>
        ) : (
          <EmptyHint text="Personas ainda não geradas." />
        )}
      </div>

      {/* Cohorts */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Layers className="h-4 w-4 text-primary" /> Cohorts comportamentais
          </h3>
          <div className="flex items-center gap-2">
            <ContextSourceBadge source="persona" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCohortsOpen(true)}
              disabled={!cohortsId}
              className="h-8 gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" /> Editar
            </Button>
          </div>
        </div>
        {cohorts.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {cohorts.map((c, i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-foreground">{c.name}</div>
                    <div className="flex flex-wrap gap-1">
                      {(c.target_personas ?? []).map((tp, j) => (
                        <Badge key={j} variant="secondary" className="rounded-full font-normal">
                          {tp}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Separator className="my-4" />
                  <dl className="space-y-3 text-xs">
                    {c.behavioral_traits ? (
                      <div>
                        <dt className="font-medium text-foreground">Comportamento</dt>
                        <dd className="mt-0.5 text-muted-foreground">{c.behavioral_traits}</dd>
                      </div>
                    ) : null}
                    {c.content_strategy ? (
                      <div>
                        <dt className="font-medium text-foreground">Estratégia de conteúdo</dt>
                        <dd className="mt-0.5 text-muted-foreground">{c.content_strategy}</dd>
                      </div>
                    ) : null}
                    {c.conversion_criteria ? (
                      <div>
                        <dt className="font-medium text-foreground">Critério de conversão</dt>
                        <dd className="mt-0.5 text-muted-foreground">{c.conversion_criteria}</dd>
                      </div>
                    ) : null}
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyHint text="Cohorts ainda não gerados." />
        )}
      </div>

      <PersonaDrawer persona={selected} onClose={() => setSelected(null)} />

      <PersonasEditor
        open={personasOpen}
        onClose={() => setPersonasOpen(false)}
        scope={{ brandId, clientId }}
        entityId={personasId}
        initial={personas as PersonaState[]}
      />
      <CohortsEditor
        open={cohortsOpen}
        onClose={() => setCohortsOpen(false)}
        scope={{ brandId, clientId }}
        entityId={cohortsId}
        initial={cohorts as CohortState[]}
      />
    </div>
  );
}

function DiagnosticCard({
  icon: Icon,
  label,
  value,
  className,
  iconClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  className?: string;
  iconClass?: string;
}) {
  return (
    <div className={`rounded-xl border p-5 ${className ?? ""}`}>
      <div className="flex items-center gap-2">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full bg-white/70 dark:bg-background/40 ${iconClass ?? ""}`}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
      </div>
      <p className="mt-3 text-sm font-medium leading-snug text-foreground">
        {value || <span className="text-muted-foreground">—</span>}
      </p>
    </div>
  );
}

function summarizeDiagnostic(personas: NormalizedPersona[]) {
  const first = (fn: (p: NormalizedPersona) => string): string => {
    for (const p of personas) {
      const v = fn(p).trim();
      if (v) return v;
    }
    return "";
  };
  return {
    consciencia:
      first((p) => p.nivel_consciencia) || (personas.length ? "Consciência do problema" : ""),
    barreira:
      first((p) => p.objecao_dominante) ||
      first((p) => p.dor_principal) ||
      first((p) => p.dores[0] ?? ""),
    ciclo: first((p) => p.ciclo_compra) || (personas.length ? "Decisão considerada" : ""),
  };
}

function personaInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function PersonaCard({ persona, onOpen }: { persona: NormalizedPersona; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full flex-col rounded-xl border border-border bg-card p-5 text-left transition-all hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary">
          {personaInitials(persona.nome) || <User className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{persona.nome}</div>
          {persona.arquetipo ? (
            <Badge
              variant="secondary"
              className="mt-1 rounded-full border border-sky-200 bg-sky-50 font-normal text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300"
            >
              {persona.arquetipo}
            </Badge>
          ) : null}
        </div>
      </div>

      {persona.motivacao || persona.descricao ? (
        <div className="mt-4">
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Motivação
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-foreground/80">
            {persona.motivacao || persona.descricao}
          </p>
        </div>
      ) : null}

      {persona.dor_principal || persona.dores[0] ? (
        <div className="mt-3">
          <div className="text-[10px] font-medium uppercase tracking-widest text-rose-500">
            Dor principal
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-foreground/80">
            {persona.dor_principal || persona.dores[0]}
          </p>
        </div>
      ) : null}

      <div className="mt-auto pt-4">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 group-hover:text-sky-700 dark:text-sky-400">
          Ver detalhamento completo{" "}
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </button>
  );
}

function DrawerSection({
  icon: Icon,
  label,
  iconClass,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  iconClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${iconClass ?? "text-primary"}`} />
        <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
      </div>
      <div className="mt-2 text-sm leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

function PersonaDrawer({
  persona,
  onClose,
}: {
  persona: NormalizedPersona | null;
  onClose: () => void;
}) {
  const open = !!persona;
  return (
    <ExpandedModal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      size="sm"
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-xs font-semibold text-primary">
            {personaInitials(persona?.nome ?? "") || <User className="h-4 w-4" />}
          </span>
          <span className="truncate text-base">{persona?.nome ?? "Persona"}</span>
        </span>
      }
      description={
        persona?.arquetipo ? (
          <span className="flex items-center gap-1">
            Arquétipo:{" "}
            <Badge
              variant="secondary"
              className="rounded-full border border-sky-200 bg-sky-50 font-normal text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300"
            >
              {persona.arquetipo}
            </Badge>
          </span>
        ) : (
          "Dossiê psicológico da persona."
        )
      }
    >
      {persona ? (
        <>
          <div className="space-y-5">
            {persona.logica_compra ? (
              <blockquote className="rounded-r-md border-l-4 border-primary/60 bg-primary/5 px-4 py-3 text-sm italic leading-relaxed text-foreground/90">
                “{persona.logica_compra}”
                <footer className="mt-1 text-[11px] not-italic uppercase tracking-widest text-muted-foreground">
                  Lógica de compra
                </footer>
              </blockquote>
            ) : null}

            {persona.descricao || persona.motivacao ? (
              <DrawerSection icon={Sparkles} label="Perfil & motivação" iconClass="text-primary">
                <p>{persona.motivacao || persona.descricao}</p>
              </DrawerSection>
            ) : null}

            <Separator />

            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Psicologia da compra
            </div>

            {persona.fator_confianca ? (
              <DrawerSection
                icon={BadgeCheck}
                label="Fator de confiança"
                iconClass="text-emerald-500"
              >
                <p>{persona.fator_confianca}</p>
              </DrawerSection>
            ) : null}

            {persona.como_decide ? (
              <DrawerSection icon={Target} label="Como decide" iconClass="text-sky-500">
                <p>{persona.como_decide}</p>
              </DrawerSection>
            ) : null}

            {persona.objecao_dominante ? (
              <DrawerSection
                icon={AlertTriangle}
                label="Objeção dominante"
                iconClass="text-amber-500"
              >
                <p>{persona.objecao_dominante}</p>
              </DrawerSection>
            ) : null}

            {persona.estilo_comunicacao ? (
              <DrawerSection
                icon={MessageSquare}
                label="Estilo de comunicação esperado"
                iconClass="text-violet-500"
              >
                <p>{persona.estilo_comunicacao}</p>
              </DrawerSection>
            ) : null}

            {persona.dores.length || persona.dor_principal ? (
              <>
                <Separator />
                <DrawerSection icon={Flame} label="Dores mapeadas" iconClass="text-rose-500">
                  <ul className="space-y-1.5">
                    {(persona.dores.length ? persona.dores : [persona.dor_principal]).map(
                      (d, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rose-400" />
                          <span>{d}</span>
                        </li>
                      ),
                    )}
                  </ul>
                </DrawerSection>
              </>
            ) : null}

            {persona.canais_preferidos.length ? (
              <DrawerSection
                icon={Layers}
                label="Canais preferidos"
                iconClass="text-muted-foreground"
              >
                <div className="flex flex-wrap gap-1.5">
                  {persona.canais_preferidos.map((c, i) => (
                    <Badge key={i} variant="outline" className="rounded-full font-normal">
                      {c}
                    </Badge>
                  ))}
                </div>
              </DrawerSection>
            ) : null}

            {persona.nivel_consciencia || persona.ciclo_compra ? (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  {persona.nivel_consciencia ? (
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                        <Eye className="h-3 w-3" /> Consciência
                      </div>
                      <p className="mt-1 text-xs text-foreground">{persona.nivel_consciencia}</p>
                    </div>
                  ) : null}
                  {persona.ciclo_compra ? (
                    <div className="rounded-lg border border-border bg-muted/40 p-3">
                      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                        <Clock className="h-3 w-3" /> Ciclo
                      </div>
                      <p className="mt-1 text-xs text-foreground">{persona.ciclo_compra}</p>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </ExpandedModal>
  );
}

// ---------- MARKET ----------

export function MarketTab({ brandId, clientId }: Scope) {
  const { data: market } = useSuspenseQuery(customerMarketQuery({ brandId, clientId }));
  const { analysis, matrix } = normalizeSwot(market.swot?.data);
  const swotId = (market.swot as { id?: string } | null | undefined)?.id;
  const [swotOpen, setSwotOpen] = useState(false);
  const swotInitial: SwotState = {
    strengths: analysis.strengths,
    weaknesses: analysis.weaknesses,
    opportunities: analysis.opportunities,
    threats: analysis.threats,
    matrix,
  };

  const quadrants = [
    {
      key: "strengths",
      label: "Forças",
      hint: "O que nos diferencia hoje",
      items: analysis.strengths,
      icon: TrendingUp,
      bullet: Check,
      tone: "bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/40",
      accent: "text-emerald-700 dark:text-emerald-400",
      bulletTone: "text-emerald-500",
    },
    {
      key: "weaknesses",
      label: "Fraquezas",
      hint: "Onde ainda estamos vulneráveis",
      items: analysis.weaknesses,
      icon: ShieldAlert,
      bullet: AlertTriangle,
      tone: "bg-amber-50 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/40",
      accent: "text-amber-700 dark:text-amber-400",
      bulletTone: "text-amber-500",
    },
    {
      key: "opportunities",
      label: "Oportunidades",
      hint: "Movimentos possíveis no mercado",
      items: analysis.opportunities,
      icon: Zap,
      bullet: Lightbulb,
      tone: "bg-sky-50 border-sky-100 dark:bg-sky-950/20 dark:border-sky-900/40",
      accent: "text-sky-700 dark:text-sky-400",
      bulletTone: "text-sky-500",
    },
    {
      key: "threats",
      label: "Ameaças",
      hint: "Riscos externos a monitorar",
      items: analysis.threats,
      icon: Flame,
      bullet: Flame,
      tone: "bg-rose-50 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900/40",
      accent: "text-rose-700 dark:text-rose-400",
      bulletTone: "text-rose-500",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Matriz SWOT</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Diagnóstico estratégico dos quatro vetores competitivos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ContextSourceBadge source="competitors" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSwotOpen(true)}
            disabled={!swotId}
            className="h-8 gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" /> Editar SWOT
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {quadrants.map((q) => (
          <div key={q.key} className={`rounded-xl border p-5 ${q.tone}`}>
            <div className={`flex items-center gap-2 ${q.accent}`}>
              <q.icon className="h-4 w-4" />
              <h4 className="text-sm font-semibold">{q.label}</h4>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{q.hint}</p>
            <ul className="mt-4 space-y-2">
              {q.items.length ? (
                q.items.map((it, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs leading-relaxed text-foreground/90"
                  >
                    <q.bullet className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${q.bulletTone}`} />
                    <span>{it}</span>
                  </li>
                ))
              ) : (
                <li className="text-xs text-muted-foreground">—</li>
              )}
            </ul>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShieldAlert className="h-4 w-4 text-primary" /> Matriz competitiva
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Comparativo direto com concorrentes estruturados.
              </p>
            </div>
          </div>
          {matrix.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[28%]">Concorrente</TableHead>
                    <TableHead>Nossas vantagens</TableHead>
                    <TableHead>Vulnerabilidades deles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrix.map((c, i) => (
                    <TableRow key={i}>
                      <TableCell className="align-top font-medium text-foreground">
                        {c.competitor_name}
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap gap-1">
                          {splitBullets(c.our_advantages).map((v, j) => (
                            <Badge
                              key={j}
                              className="rounded-full border border-emerald-200 bg-emerald-50 font-normal text-emerald-800 hover:bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                            >
                              {v}
                            </Badge>
                          )) || <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap gap-1">
                          {splitBullets(c.vulnerabilities).map((v, j) => (
                            <Badge
                              key={j}
                              className="rounded-full border border-rose-200 bg-rose-50 font-normal text-rose-800 hover:bg-rose-50 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                            >
                              {v}
                            </Badge>
                          )) || <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyHint text="Nenhum concorrente estruturado ainda." />
          )}
        </CardContent>
      </Card>

      <SwotEditor
        open={swotOpen}
        onClose={() => setSwotOpen(false)}
        scope={{ brandId, clientId }}
        entityId={swotId}
        initial={swotInitial}
      />
    </div>
  );
}

function splitBullets(input: string): string[] {
  if (!input || !input.trim()) return [];
  // Split on common bullet separators, keeping items concise
  const parts = input
    .split(/[;•\n]|(?:\s-\s)|(?:\s\|\s)|(?:,\s(?=[A-ZÀ-Ú]))/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 5);
  return [input.trim()];
}

// ---------- TOPICS ----------

export function TopicsTab({ brandId, clientId }: { brandId: string; clientId: string }) {
  const send = useServerFn(sendPautaToContentFn);
  const qc = useQueryClient();

  const pautasQ = useSuspenseQuery(customerPautasQuery({ brandId, clientId }));

  const sendMut = useMutation({
    mutationFn: (pautaId: string) => send({ data: { brandId, clientId, pautaId } }),
    onSuccess: () => {
      toast.success("Enviado ao pipeline de conteúdo");
      qc.invalidateQueries({ queryKey: ["customer-pautas", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["posts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao enviar"),
  });

  const rows = pautasQ.data;

  if (!rows.length) {
    return <EmptyHint text="Nenhuma pauta gerada ainda. Rode o pipeline para popular o backlog." />;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 pb-1">
        <ContextSourceBadge source="full" />
        <ContextSourceBadge source="knowledge" />
      </div>
      {rows.map((p) => {
        const sent = p.status === "sent_to_content";
        return (
          <div
            key={p.id}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:flex-row md:items-center md:justify-between"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {p.pilar_type ? <Chip tone="info">{p.pilar_type}</Chip> : null}
                {p.plataforma ? <Chip>{p.plataforma}</Chip> : null}
                {p.formato ? <Chip>{p.formato}</Chip> : null}
                {p.cohort_alvo ? <Chip>{p.cohort_alvo}</Chip> : null}
                {sent ? <Chip tone="success">no pipeline</Chip> : null}
              </div>
              <div className="mt-1.5 truncate text-sm font-semibold text-foreground">
                {p.titulo}
              </div>
              {p.gancho ? (
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{p.gancho}</div>
              ) : null}
            </div>
            <Button
              size="sm"
              variant={sent ? "secondary" : "default"}
              disabled={sent || sendMut.isPending}
              onClick={() => sendMut.mutate(p.id)}
              className="shrink-0 gap-1.5"
            >
              {sent ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
              {sent ? "Enviado" : "Send to Content"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
