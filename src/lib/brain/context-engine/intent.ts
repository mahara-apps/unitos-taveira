// ⚠️ Brain Context Engine — detecção determinística de intenção.
// Sem LLM: usa keywords + heurísticas para decidir QUAIS partes do Brain
// precisam ser carregadas. Objetivo: nunca varrer todo o banco.

export type IntentTopic =
  | "posts"
  | "tasks"
  | "projects"
  | "insights"
  | "recommendations"
  | "customers"
  | "general";

export interface DetectedIntent {
  /** Tópicos que devem ser buscados. Sempre inclui "general" como fallback. */
  topics: IntentTopic[];
  /** Termos-chave normalizados usados para scoring de relevância. */
  keywords: string[];
  /** Janela temporal implícita, se detectada na pergunta. */
  period?: { from: string; to: string } | null;
}

const TOPIC_KEYWORDS: Record<IntentTopic, RegExp> = {
  posts: /\b(post|posts|conte[uú]do|publica[cç][aã]o|feed|reels|story|stories|carrossel)\b/i,
  tasks: /\b(tarefa|tarefas|task|kanban|entrega|sla|prazo)\b/i,
  projects: /\b(projeto|projetos|campanha|campanhas|briefing)\b/i,
  insights: /\b(insight|insights|padr[aã]o|padr[oõ]es|tend[eê]ncia|descoberta)\b/i,
  recommendations: /\b(recomend|sugest|pr[oó]xim[oa]s?\s+passo)\b/i,
  customers: /\b(cliente|clientes|customer|conta|contas|marca|brand)\b/i,
  general: /.*/,
};

const STOPWORDS = new Set([
  "a",
  "o",
  "os",
  "as",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "que",
  "qual",
  "quais",
  "quanto",
  "quantos",
  "quantas",
  "para",
  "por",
  "com",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "e",
  "é",
  "são",
  "foi",
  "foram",
  "um",
  "uma",
  "uns",
  "umas",
  "meu",
  "minha",
  "nosso",
  "nossa",
  "hoje",
  "ontem",
  "este",
  "esta",
  "isso",
  "isto",
  "the",
  "of",
  "and",
  "for",
  "to",
]);

export function detectIntent(question: string): DetectedIntent {
  const q = (question || "").trim();
  const topics: IntentTopic[] = [];
  for (const [topic, rx] of Object.entries(TOPIC_KEYWORDS) as Array<[IntentTopic, RegExp]>) {
    if (topic === "general") continue;
    if (rx.test(q)) topics.push(topic);
  }
  topics.push("general");

  const keywords = q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  return { topics, keywords, period: detectPeriod(q) };
}

function detectPeriod(q: string): { from: string; to: string } | null {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const start = new Date(now);
  if (/\bhoje\b/i.test(q)) {
    start.setHours(0, 0, 0, 0);
    return { from: iso(start), to: iso(now) };
  }
  if (/\b(essa|esta)\s+semana\b/i.test(q) || /\b7\s*dias\b/i.test(q)) {
    start.setDate(start.getDate() - 7);
    return { from: iso(start), to: iso(now) };
  }
  if (/\b(esse|este)\s+m[eê]s\b/i.test(q) || /\b30\s*dias\b/i.test(q)) {
    start.setDate(start.getDate() - 30);
    return { from: iso(start), to: iso(now) };
  }
  const m = q.match(/\b(\d{1,3})\s*dias\b/i);
  if (m) {
    const n = Math.min(365, parseInt(m[1], 10));
    start.setDate(start.getDate() - n);
    return { from: iso(start), to: iso(now) };
  }
  return null;
}
