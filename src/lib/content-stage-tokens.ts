/**
 * Ciclo ÚNICO de estágios do conteúdo usado na área Projetos
 * (funil do projeto, board de pautas, cards e legenda).
 * COR = ESTÁGIO — sempre com os mesmos rótulos e classes semânticas,
 * adaptadas automaticamente aos temas claro e escuro.
 */
export const CONTENT_STAGES = [
  "briefing",
  "production",
  "review",
  "approved",
  "scheduled",
  "published",
] as const;

export type ContentStage = (typeof CONTENT_STAGES)[number];

export type ContentStageToken = {
  label: string;
  /** chip/pill de estágio */
  chip: string;
  /** ponto colorido da legenda */
  dot: string;
  /** faixa lateral do card */
  accent: string;
  /** barra/preenchimento do funil */
  bar: string;
};

export const CONTENT_STAGE: Record<ContentStage, ContentStageToken> = {
  briefing: {
    label: "Briefing",
    chip: "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300",
    dot: "bg-content-briefing",
    accent: "border-l-content-briefing",
    bar: "bg-content-briefing",
  },
  production: {
    label: "Em produção",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    dot: "bg-content-production",
    accent: "border-l-content-production",
    bar: "bg-content-production",
  },
  review: {
    label: "Em revisão",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dot: "bg-content-review",
    accent: "border-l-content-review",
    bar: "bg-content-review",
  },
  approved: {
    label: "Aprovado",
    chip: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    dot: "bg-content-approved",
    accent: "border-l-content-approved",
    bar: "bg-content-approved",
  },
  scheduled: {
    label: "Agendado",
    chip: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    dot: "bg-content-scheduled",
    accent: "border-l-content-scheduled",
    bar: "bg-content-scheduled",
  },
  published: {
    label: "Publicado",
    chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dot: "bg-content-published",
    accent: "border-l-content-published",
    bar: "bg-content-published",
  },
};

/**
 * Agrupa os estados REAIS da peça (stage/review_status/published_at) nos seis
 * estágios do ciclo. Sem peça vinculada, o item ainda está em briefing.
 */
export function contentStageOf(
  post: {
    stage?: string | null;
    review_status?: string | null;
    published_at?: string | null;
  } | null,
): ContentStage {
  if (!post) return "briefing";
  if (post.published_at || post.stage === "published") return "published";
  if (post.stage === "scheduled") return "scheduled";
  const review = (post.review_status ?? "").toLowerCase();
  if (review === "approved" || post.stage === "approved") return "approved";
  if (post.stage === "review" || review === "pending") return "review";
  if (post.stage === "idea" || post.stage === "briefing") return "briefing";
  return "production";
}

/** Chips de unidade — cor estável por nome, sem depender de cadastro. */
const UNIT_CHIPS = [
  "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  "border-pink-500/30 bg-pink-500/10 text-pink-700 dark:text-pink-300",
  "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
];

export function unitChipClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  return UNIT_CHIPS[hash % UNIT_CHIPS.length]!;
}
