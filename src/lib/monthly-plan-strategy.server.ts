import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Contexto de Estratégia IA (gerada no Briefing / módulo Cérebro) para a Pauta.
 *
 * Lê os blocos ATIVOS de voice / personas / cohorts / swot do cliente e
 * condensa em markdown enxuto para ser injetado no prompt de geração da pauta.
 * Nunca lança: sem estratégia ativa, devolve `markdown: ""`.
 */

const BLOCK_TABLES = {
  voice: "brand_voice_cards",
  personas: "brand_personas",
  cohorts: "brand_cohorts",
  swot: "brand_swot",
} as const;

export type StrategyBlockName = keyof typeof BLOCK_TABLES;

export type StrategyContext = {
  markdown: string;
  /** Blocos ativos encontrados. */
  blocks: StrategyBlockName[];
  /** Data do bloco ativo mais antigo do conjunto (início da geração). */
  generatedAt: string | null;
  /** Nomes das personas ativas (usado para validar o alvo de cada ideia). */
  personaNames: string[];
  /** Nomes dos cohorts ativos. */
  cohortNames: string[];
};

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown, max = 6): string =>
  asArray(v).map(asStr).filter(Boolean).slice(0, max).join(", ");

export async function loadStrategyContext(
  supabase: SupabaseClient,
  brandId: string,
  clientId: string,
  opts: { maxChars?: number } = {},
): Promise<StrategyContext> {
  const names = Object.keys(BLOCK_TABLES) as StrategyBlockName[];
  const results = await Promise.all(
    names.map(async (block) => {
      try {
        const { data } = await supabase
          .from(BLOCK_TABLES[block])
          .select("data, created_at")
          .eq("brand_id", brandId)
          .eq("client_id", clientId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data) return null;
        return {
          block,
          created_at: (data.created_at as string | null) ?? null,
          data: (data.data ?? null) as Record<string, unknown> | null,
        };
      } catch (err) {
        console.warn(`[monthly-plan strategy] failed to load ${block}`, err);
        return null;
      }
    }),
  );

  const found = results.filter(
    (
      r,
    ): r is {
      block: StrategyBlockName;
      created_at: string | null;
      data: Record<string, unknown> | null;
    } => !!r && !!r.data,
  );
  if (found.length === 0) {
    return { markdown: "", blocks: [], generatedAt: null, personaNames: [], cohortNames: [] };
  }

  const sections: string[] = [];
  const personaNames: string[] = [];
  const cohortNames: string[] = [];

  for (const entry of found) {
    const d = entry.data ?? {};
    if (entry.block === "voice") {
      const vc = (d.voice_card ?? d) as Record<string, unknown>;
      const vocab = (vc.vocabulary_rules ?? {}) as Record<string, unknown>;
      const lines = [
        asStr(vc.brand_personality) && `- Personalidade: ${asStr(vc.brand_personality)}`,
        list(vc.tone_characteristics) && `- Traços de tom: ${list(vc.tone_characteristics)}`,
        list(vocab.words_to_use, 10) && `- Usar: ${list(vocab.words_to_use, 10)}`,
        list(vocab.words_to_avoid, 10) && `- Evitar: ${list(vocab.words_to_avoid, 10)}`,
        list(vc.brand_phrases_examples, 5) &&
          `- Frases-modelo: ${list(vc.brand_phrases_examples, 5)}`,
      ].filter(Boolean);
      if (lines.length)
        sections.push(`### Voice card (obrigatório respeitar)\n${lines.join("\n")}`);
    }

    if (entry.block === "personas") {
      const rows = asArray(d.personas ?? d).slice(0, 4) as Array<Record<string, unknown>>;
      const lines = rows.map((p) => {
        const nome = asStr(p.nome) || asStr(p.name) || "Persona";
        personaNames.push(nome);
        const bits = [
          asStr(p.descricao) && asStr(p.descricao),
          list(p.dores, 3) && `dores: ${list(p.dores, 3)}`,
          list(p.desejos, 3) && `desejos: ${list(p.desejos, 3)}`,
          list(p.canais_preferidos, 4) && `canais: ${list(p.canais_preferidos, 4)}`,
          list(p.gatilhos_de_decisao, 3) && `gatilhos: ${list(p.gatilhos_de_decisao, 3)}`,
        ].filter(Boolean);
        return `- **${nome}** — ${bits.join(" · ")}`;
      });
      if (lines.length) sections.push(`### Personas ativas\n${lines.join("\n")}`);
    }

    if (entry.block === "cohorts") {
      const rows = asArray(d.cohorts ?? d).slice(0, 5) as Array<Record<string, unknown>>;
      const lines = rows.map((c) => {
        const nome = asStr(c.name) || asStr(c.nome) || "Cohort";
        cohortNames.push(nome);
        const bits = [
          list(c.target_personas, 3) && `personas: ${list(c.target_personas, 3)}`,
          asStr(c.behavioral_traits) && `comportamento: ${asStr(c.behavioral_traits)}`,
          asStr(c.content_strategy) && `estratégia editorial: ${asStr(c.content_strategy)}`,
          asStr(c.conversion_criteria) && `conversão: ${asStr(c.conversion_criteria)}`,
        ].filter(Boolean);
        return `- **${nome}** — ${bits.join(" · ")}`;
      });
      if (lines.length) sections.push(`### Cohorts e estratégia editorial\n${lines.join("\n")}`);
    }

    if (entry.block === "swot") {
      const sw = (d.swot_analysis ?? d) as Record<string, unknown>;
      const lines = [
        list(sw.strengths, 4) && `- Forças: ${list(sw.strengths, 4)}`,
        list(sw.opportunities, 4) && `- Oportunidades (priorizar): ${list(sw.opportunities, 4)}`,
        list(sw.weaknesses, 3) && `- Fraquezas: ${list(sw.weaknesses, 3)}`,
        list(sw.threats, 3) && `- Ameaças: ${list(sw.threats, 3)}`,
      ].filter(Boolean);
      const matrix = asArray(d.competitive_matrix).slice(0, 4) as Array<Record<string, unknown>>;
      const matrixLines = matrix
        .map((m) => {
          const n = asStr(m.competitor_name);
          if (!n) return "";
          return `- vs ${n}: vantagens — ${asStr(m.our_advantages) || "n/a"}`;
        })
        .filter(Boolean);
      if (lines.length || matrixLines.length) {
        sections.push(`### SWOT e diferenciação\n${[...lines, ...matrixLines].join("\n")}`);
      }
    }
  }

  const generatedAt =
    found
      .map((f) => f.created_at)
      .filter((v): v is string => !!v)
      .sort()[0] ?? null;

  const maxChars = opts.maxChars ?? 4000;
  const markdown = sections.length
    ? `## Estratégia IA ativa (fonte de verdade — gerada em ${
        generatedAt ? new Date(generatedAt).toLocaleDateString("pt-BR") : "data desconhecida"
      })\n${sections.join("\n\n")}`.slice(0, maxChars)
    : "";

  return {
    markdown,
    blocks: found.map((f) => f.block),
    generatedAt,
    personaNames,
    cohortNames,
  };
}
