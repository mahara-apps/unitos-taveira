/**
 * Canonical catalog of runtime variables that the AI pipelines can resolve
 * from the Supabase brand/client context. Every `{{VAR}}` referenced in an
 * `agent_prompts.system_prompt` should either match a key below (so the
 * Drawer can explain and hydrate it) or be flagged as unknown.
 *
 * Rules for adding a variable:
 *  1) Add it here first.
 *  2) Teach `resolveAgentVariablesFn` to hydrate it.
 *  3) Reference it in a seeded prompt via `{{KEY}}`.
 */

export type VariableCategory = "identidade" | "briefing" | "audiencia" | "concorrencia" | "runtime";

export const CATEGORY_LABEL: Record<VariableCategory, string> = {
  identidade: "Identidade visual",
  briefing: "Briefing & Estratégia",
  audiencia: "Audiência",
  concorrencia: "Concorrência",
  runtime: "Runtime (fornecido na execução)",
};

export type VariableSpec = {
  key: string;
  label: string;
  description: string;
  /** Which Supabase source the value derives from (docs for the user). */
  source: string;
  category: VariableCategory;
  /** True when the value is provided by the caller at execution time
   *  (form input, concept payload) instead of being read from the DB. */
  runtimeProvided?: boolean;
};

export const AGENT_VARIABLE_CATALOG: Record<string, VariableSpec> = {
  CONTEXT: {
    key: "CONTEXT",
    label: "Blueprint completo da marca",
    description:
      "Bloco em markdown consolidando identidade, tom, missão, dores, diferenciais, hashtags, concorrentes e documentos do cliente. Fonte primária de contexto de qualquer agente.",
    source: "clients.brand_hub + brand_competitors + client_documents",
    category: "briefing",
  },
  BRAND_CONTEXT: {
    key: "BRAND_CONTEXT",
    label: "Descrição institucional",
    description: "Texto curto de posicionamento declarado no briefing (missão + descrição).",
    source: "clients.brand_hub.description / mission",
    category: "briefing",
  },
  PERSONAS: {
    key: "PERSONAS",
    label: "Personas ativas",
    description:
      "Todas as personas ativas do cliente em JSON — usadas para orientar tom, dor e ganchos.",
    source: "brand_personas.data (is_active = true)",
    category: "audiencia",
  },
  PERSONA: {
    key: "PERSONA",
    label: "Persona primária",
    description: "Recorte da persona principal para prompts mais leves (copywriter, roteirista).",
    source: "brand_personas.data (primeira ativa)",
    category: "audiencia",
  },
  TONE: {
    key: "TONE",
    label: "Voice card",
    description:
      "Diretrizes de voz e estilo (do/dont, arquétipos, tom). Cai para clients.tone_of_voice se não existir voice card.",
    source: "brand_voice_cards.data / clients.tone_of_voice",
    category: "briefing",
  },
  TONE_OF_VOICE: {
    key: "TONE_OF_VOICE",
    label: "Tom de voz (curto)",
    description: "Tag curta de tom declarada em Dados Básicos do cliente.",
    source: "clients.tone_of_voice",
    category: "briefing",
  },
  HASHTAGS: {
    key: "HASHTAGS",
    label: "Hashtags oficiais",
    description: "Hashtags declaradas no Brand Hub, injetadas na base de qualquer legenda.",
    source: "clients.brand_hub.hashtags[]",
    category: "briefing",
  },
  COMPETITORS: {
    key: "COMPETITORS",
    label: "Concorrentes monitorados",
    description: "Lista de handles Instagram dos concorrentes cadastrados no Brand Hub.",
    source: "brand_competitors.handle",
    category: "concorrencia",
  },
  PRIMARY_COLORS: {
    key: "PRIMARY_COLORS",
    label: "Cores primárias",
    description:
      "Primeiras entradas da paleta do Brand Hub (label + hex). Usado por briefings de arte.",
    source: "clients.brand_hub.palette[0..3]",
    category: "identidade",
  },
  SECONDARY_COLORS: {
    key: "SECONDARY_COLORS",
    label: "Cores secundárias",
    description: "Segunda leva de cores da paleta.",
    source: "clients.brand_hub.palette[4..7]",
    category: "identidade",
  },
  TERTIARY_COLORS: {
    key: "TERTIARY_COLORS",
    label: "Cores terciárias",
    description: "Cores restantes da paleta (acentos).",
    source: "clients.brand_hub.palette[8..]",
    category: "identidade",
  },
  LOGO_URL: {
    key: "LOGO_URL",
    label: "URL do logotipo",
    description: "Link público do logo carregado no Brand Hub — referência visual apenas.",
    source: "clients.brand_hub.logo_url",
    category: "identidade",
  },
  QUANTIDADE: {
    key: "QUANTIDADE",
    label: "Quantidade de peças",
    description: "Número total de conteúdos que o Planejador deve gerar na execução atual.",
    source: "input do dialog Plano do Mês",
    category: "runtime",
    runtimeProvided: true,
  },
  PERIODO: {
    key: "PERIODO",
    label: "Período alvo",
    description: "Mês/janela que o plano cobre (ex: `2026-08`).",
    source: "input do dialog Plano do Mês",
    category: "runtime",
    runtimeProvided: true,
  },
  CHANNEL_MIX: {
    key: "CHANNEL_MIX",
    label: "Distribuição por canal",
    description: "Cota obrigatória por plataforma derivada da volumetria semanal do briefing.",
    source: "clients.brand_hub.volumetry * semanas do período",
    category: "runtime",
    runtimeProvided: true,
  },
  CONCEPT: {
    key: "CONCEPT",
    label: "Conceito da peça",
    description:
      "JSON do conceito individual gerado pelo Planejador, entregue ao Copywriter para redigir a peça.",
    source: "saída do agente Planejador Estratégico",
    category: "runtime",
    runtimeProvided: true,
  },
  USER_PROMPT: {
    key: "USER_PROMPT",
    label: "Briefing pontual",
    description: "Texto do usuário para a chamada específica (ex.: pedido para o Diretor de Arte).",
    source: "input do playground / chamada externa",
    category: "runtime",
    runtimeProvided: true,
  },
  VISUAL_ANALYSIS: {
    key: "VISUAL_ANALYSIS",
    label: "Análise visual da marca",
    description:
      "Resumo dos padrões visuais dominantes do histórico Instagram (quando disponível).",
    source: "brand_ai_content (tipo visual_analysis)",
    category: "identidade",
  },
  REF_HINTS: {
    key: "REF_HINTS",
    label: "Referências visuais",
    description:
      "Dicas de referência (moodboard, imagens de inspiração) fornecidas pelo usuário na execução.",
    source: "input do playground",
    category: "runtime",
    runtimeProvided: true,
  },
  N: {
    key: "N",
    label: "Quantidade requisitada",
    description: "Número inteiro fornecido na chamada (usado por agentes de análise).",
    source: "input da chamada",
    category: "runtime",
    runtimeProvided: true,
  },
};

/** Extract {{VAR}} tokens from a prompt. */
export function extractPromptVariables(prompt: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) set.add(m[1]);
  return [...set];
}

/** Render a prompt template by substituting every {{VAR}} using values. */
export function renderPrompt(
  template: string,
  values: Record<string, string | undefined>,
  fallback = "(não informado)",
): string {
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_m, key) => values[key] ?? fallback);
}

export type ResolvedVariable = {
  key: string;
  value: string;
  resolved: boolean;
  source: string;
};

export type ResolvedVariableMap = Record<string, ResolvedVariable>;
