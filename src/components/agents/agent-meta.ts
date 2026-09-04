import { BrainCircuit, Compass, PenTool, LineChart, type LucideIcon } from "lucide-react";

export type AgentCategory = "intelligence" | "planning" | "creation" | "analysis";

export type AgentMeta = {
  category: AgentCategory;
  categoryLabel: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon container (bg + text). */
  iconClass: string;
  /** Badge tint class. */
  badgeClass: string;
  /** Default model label shown in footer. */
  model: string;
};

export const CATEGORY_ORDER: AgentCategory[] = ["intelligence", "planning", "creation", "analysis"];

const CATEGORY_STYLE: Record<AgentCategory, Omit<AgentMeta, "category" | "model">> = {
  intelligence: {
    categoryLabel: "Inteligência & Setup",
    icon: BrainCircuit,
    iconClass: "bg-violet-500/10 text-violet-500",
    badgeClass: "border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  },
  planning: {
    categoryLabel: "Planejamento & Direção",
    icon: Compass,
    iconClass: "bg-blue-500/10 text-blue-500",
    badgeClass: "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
  creation: {
    categoryLabel: "Criação & Copywriting",
    icon: PenTool,
    iconClass: "bg-orange-500/10 text-orange-500",
    badgeClass: "border-orange-500/20 bg-orange-500/10 text-orange-600 dark:text-orange-300",
  },
  analysis: {
    categoryLabel: "Análise & Otimização",
    icon: LineChart,
    iconClass: "bg-emerald-500/10 text-emerald-500",
    badgeClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  },
};

/** Explicit agent → category map (matches seeded agent_id list). */
const ID_TO_CATEGORY: Record<string, AgentCategory> = {
  briefing_extractor: "intelligence",
  persona_generator: "intelligence",
  brand_brain: "intelligence",
  planner_strategic: "planning",
  visual_analyst: "planning",
  art_director_social: "planning",
  copywriter_senior: "creation",
  roteirista_social: "creation",
  instagram_analyst: "analysis",
};

const KEYWORD_TO_CATEGORY: Array<[RegExp, AgentCategory]> = [
  [/\b(analis|análise|analytics|instagram|benchmark|insight|otimiza)/i, "analysis"],
  [/\b(copy|caption|headline|roteir|script)/i, "creation"],
  [/\b(planejad|planner|diretor|art\s?director|visual)/i, "planning"],
  [/\b(briefing|persona|cérebro|cerebro|brand.?brain|setup)/i, "intelligence"],
];

export function inferAgentCategory(id: string, name: string): AgentCategory {
  if (ID_TO_CATEGORY[id]) return ID_TO_CATEGORY[id];
  const hay = `${id} ${name}`;
  for (const [re, cat] of KEYWORD_TO_CATEGORY) if (re.test(hay)) return cat;
  return "intelligence";
}

export function getAgentMeta(id: string, name: string): AgentMeta {
  const category = inferAgentCategory(id, name);
  const base = CATEGORY_STYLE[category];
  return {
    category,
    categoryLabel: base.categoryLabel,
    icon: base.icon,
    iconClass: base.iconClass,
    badgeClass: base.badgeClass,
    model: "gemini-2.5-flash",
  };
}

/** Descrição pública de cada agente para vitrine na tela `/agents`.
 *  NUNCA usar o system prompt original — ele é confidencial. */
const AGENT_DESCRIPTION: Record<string, string> = {
  briefing_extractor:
    "Lê briefings e documentos do cliente para extrair objetivos, público-alvo e diretrizes-chave.",
  persona_generator:
    "Sintetiza personas de compra a partir do briefing, entrevistas e sinais da marca.",
  brand_brain:
    "Consolida o cérebro estratégico da marca — posicionamento, promessa e territórios narrativos.",
  planner_strategic:
    "Planeja pautas mensais equilibrando pilares, formatos e canais com foco em resultado.",
  visual_analyst:
    "Interpreta referências visuais e traduz em diretrizes de arte para o time criativo.",
  art_director_social:
    "Define direção de arte de posts, priorizando consistência de identidade e legibilidade.",
  copywriter_senior:
    "Escreve legendas, ganchos e CTAs no tom de voz da marca prontos para publicação.",
  roteirista_social:
    "Estrutura roteiros de Reels/Shorts com abertura, desenvolvimento e chamada para ação.",
  instagram_analyst:
    "Analisa performance de Instagram e recomenda ajustes de conteúdo, horário e formato.",
};

export function getAgentDescription(id: string, name: string): string {
  if (AGENT_DESCRIPTION[id]) return AGENT_DESCRIPTION[id];
  const category = inferAgentCategory(id, name);
  return {
    intelligence: "Agente de inteligência que estrutura o conhecimento da marca.",
    planning: "Agente de planejamento estratégico e direção de conteúdo.",
    creation: "Agente de criação e copywriting para publicação social.",
    analysis: "Agente de análise de performance e otimização.",
  }[category];
}

export function getCategoryStyle(category: AgentCategory) {
  return CATEGORY_STYLE[category];
}

/** Clean an agent name by stripping "(Meta)"-style suffixes before Title Case. */
export function cleanAgentName(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clean AI-generated prompt names into Title Case, no ALL CAPS, no dashes. */
export function toTitleCase(raw: string): string {
  const cleaned = cleanAgentName(raw)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const small = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "para", "com", "em"]);
  return cleaned
    .split(" ")
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Strip markdown dividers, headings, bullets, ALL CAPS lines from a prompt to
 * turn it into a clean synopsis. */
export function cleanPromptSynopsis(prompt: string): string {
  const lines = prompt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^[-=_*#]{3,}$/.test(l))
    .filter((l) => !/^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^[*\-•]\s+/, ""))
    .map((l) => l.replace(/\*\*/g, ""))
    .map((l) =>
      l === l.toUpperCase() && l.length > 6 ? l.charAt(0) + l.slice(1).toLowerCase() : l,
    );
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/** Extract {{variables}} from a prompt. */
export function extractPromptVariables(prompt: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([A-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) set.add(m[1]);
  return [...set];
}
