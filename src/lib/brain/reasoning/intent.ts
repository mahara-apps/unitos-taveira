// ⚠️ Brain Reasoning Engine — classificador de intenção determinístico.
// Sem LLM: regex + heurísticas. Retorna a intenção canônica + confiança.

export type ReasoningIntent =
  | "consulta_metrica"
  | "consulta_status"
  | "consulta_usuario"
  | "consulta_cliente"
  | "consulta_projeto"
  | "consulta_tarefa"
  | "consulta_financeiro"
  | "consulta_conteudo"
  | "consulta_midia_paga"
  | "consulta_calendario"
  | "recomendacao"
  | "resumo"
  | "comparacao"
  | "previsao"
  | "diagnostico"
  | "desconhecida";

interface Rule {
  intent: ReasoningIntent;
  rx: RegExp;
  weight: number;
}

const RULES: Rule[] = [
  {
    intent: "consulta_tarefa",
    rx: /\b(tarefa|tarefas|task|tasks|atrasad[ao]s?|pendente|kanban|entrega)\b/i,
    weight: 1,
  },
  { intent: "consulta_projeto", rx: /\b(projeto|projetos|campanha|campanhas)\b/i, weight: 1 },
  {
    intent: "consulta_conteudo",
    rx: /\b(post|posts|conte[uú]do|publica[cç][aã]o|feed|reels|story|stories|carrossel|pauta)\b/i,
    weight: 1,
  },
  {
    intent: "consulta_cliente",
    rx: /\b(cliente|clientes|customer|conta|marca|brand)\b/i,
    weight: 1,
  },
  {
    intent: "consulta_calendario",
    rx: /\b(calend[aá]rio|agenda|agendad[oa]s?|semana|mes|m[eê]s|hoje|amanh[aã])\b/i,
    weight: 0.7,
  },
  {
    intent: "consulta_midia_paga",
    rx: /\b(m[ií]dia\s*paga|ads?|an[uú]ncio|an[uú]ncios|meta\s*ads|google\s*ads|campanha\s*paga)\b/i,
    weight: 1,
  },
  {
    intent: "consulta_financeiro",
    rx: /\b(receita|faturamento|financeiro|mrr|arr|custo|invoice|cobran[çc]a)\b/i,
    weight: 1,
  },
  {
    intent: "consulta_usuario",
    rx: /\b(usu[aá]rio|usu[aá]rios|time|equipe|colaborador|respons[aá]vel)\b/i,
    weight: 0.9,
  },
  {
    intent: "recomendacao",
    rx: /\b(recomend|sugest|o que devo|o que fazer|pr[oó]xim[oa]s?\s+passo|melhor)\b/i,
    weight: 1,
  },
  {
    intent: "resumo",
    rx: /\b(resum|resumo|panorama|overview|vis[aã]o geral|status geral)\b/i,
    weight: 1,
  },
  {
    intent: "comparacao",
    rx: /\b(comparar?|compara[cç][aã]o|vs\.?|versus|melhor entre|diferen[çc]a entre)\b/i,
    weight: 1,
  },
  {
    intent: "previsao",
    rx: /\b(previs[aã]o|projeta|proje[cç][aã]o|forecast|estimativa|tend[eê]ncia)\b/i,
    weight: 1,
  },
  {
    intent: "diagnostico",
    rx: /\b(por que|porque|motivo|causa|diagn[oó]stico|problema|falha|erro)\b/i,
    weight: 1,
  },
  {
    intent: "consulta_status",
    rx: /\b(status|situa[cç][aã]o|como est[aá]|andamento)\b/i,
    weight: 0.6,
  },
  {
    intent: "consulta_metrica",
    rx: /\b(quantos?|quantas?|total|m[eé]dia|percentual|taxa|kpi|m[eé]trica|engajamento|alcance|cliques?)\b/i,
    weight: 0.7,
  },
];

export interface IntentDetection {
  intent: ReasoningIntent;
  confidence: number;
  matches: ReasoningIntent[];
}

export function classifyIntent(question: string): IntentDetection {
  const q = (question || "").trim();
  if (!q) return { intent: "desconhecida", confidence: 0, matches: [] };
  const hits = new Map<ReasoningIntent, number>();
  for (const r of RULES) {
    if (r.rx.test(q)) hits.set(r.intent, (hits.get(r.intent) ?? 0) + r.weight);
  }
  if (!hits.size) return { intent: "desconhecida", confidence: 0.2, matches: [] };
  const sorted = [...hits.entries()].sort((a, b) => b[1] - a[1]);
  const [top, score] = sorted[0];
  const total = sorted.reduce((a, [, s]) => a + s, 0);
  return {
    intent: top,
    confidence: Math.min(0.99, score / total),
    matches: sorted.map(([i]) => i),
  };
}
