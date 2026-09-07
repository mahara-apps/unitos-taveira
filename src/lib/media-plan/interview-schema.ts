/**
 * Entrevista guiada do plano de mídia paga.
 *
 * Fonte ÚNICA das perguntas: a UI (wizard) e o prompt do agente leem daqui,
 * para que o texto enviado ao modelo seja exatamente o que o usuário viu.
 *
 * Regras de design:
 *  - Linguagem de dia a dia. Zero jargão de mídia (nada de topo/meio/fundo,
 *    CPA, ROAS, lookalike). O agente é quem traduz para termos de plataforma.
 *  - Fluxo adaptativo: `showIf` abre perguntas extras apenas quando a resposta
 *    anterior torna a pergunta relevante.
 */

export type QuestionKind = "single" | "multi" | "text" | "money";

export type InterviewOption = {
  value: string;
  label: string;
  /** Emoji do cartão — leitura rápida para quem não é da área. */
  icon: string;
  /** Exemplo concreto, some a dúvida de "isso é o meu caso?". */
  hint?: string;
};

export type InterviewQuestion = {
  id: string;
  kind: QuestionKind;
  /** Pergunta como o usuário lê na tela. */
  question: string;
  /** Uma linha de apoio, opcional. */
  help?: string;
  placeholder?: string;
  options?: InterviewOption[];
  /** Multi: mínimo/máximo de seleções. */
  min?: number;
  max?: number;
  optional?: boolean;
  /** Fluxo adaptativo — a pergunta só aparece quando isto retorna true. */
  showIf?: (answers: InterviewAnswers) => boolean;
};

export type InterviewAnswers = Record<string, string | string[] | undefined>;

const has = (answers: InterviewAnswers, id: string, value: string) => {
  const v = answers[id];
  return Array.isArray(v) ? v.includes(value) : v === value;
};

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: "business_model",
    kind: "single",
    question: "Como esse cliente ganha dinheiro hoje?",
    help: "Isso define onde a venda acontece e o que vamos medir.",
    options: [
      {
        value: "ecommerce",
        label: "Vende produtos pelo site",
        icon: "🛒",
        hint: "Loja online com carrinho e pagamento",
      },
      {
        value: "local_store",
        label: "Vende na loja física",
        icon: "🏬",
        hint: "O cliente precisa ir até o local",
      },
      {
        value: "services",
        label: "Presta serviço com orçamento",
        icon: "🧾",
        hint: "Conversa antes de fechar (WhatsApp, visita, proposta)",
      },
      {
        value: "appointments",
        label: "Trabalha com agendamento",
        icon: "📅",
        hint: "Consultas, sessões, horários marcados",
      },
      {
        value: "subscription",
        label: "Assinatura ou mensalidade",
        icon: "🔄",
        hint: "Cobrança recorrente, software, clube",
      },
      {
        value: "b2b",
        label: "Vende para outras empresas",
        icon: "🏢",
        hint: "Ciclo mais longo, decisão de várias pessoas",
      },
    ],
  },
  {
    id: "goal_30d",
    kind: "single",
    question: "O que você mais precisa nos próximos 30 dias?",
    help: "Escolha só o principal. O resto entra como apoio.",
    options: [
      { value: "sales_online", label: "Vender pelo site", icon: "💳", hint: "Pedidos fechados online" },
      {
        value: "leads",
        label: "Receber contatos",
        icon: "📞",
        hint: "WhatsApp, formulário, ligações",
      },
      { value: "store_visits", label: "Levar gente até a loja", icon: "🚶", hint: "Movimento no ponto físico" },
      { value: "bookings", label: "Encher a agenda", icon: "🗓️", hint: "Horários marcados" },
      { value: "awareness", label: "Ser mais conhecido", icon: "👀", hint: "Mais gente sabendo que existe" },
      {
        value: "retention",
        label: "Trazer de volta quem já viu",
        icon: "🔁",
        hint: "Quem visitou e não comprou",
      },
    ],
  },
  {
    id: "offer",
    kind: "text",
    question: "O que exatamente vamos anunciar?",
    help: "Produto, serviço, promoção ou lançamento — do jeito que você explicaria para um amigo.",
    placeholder: "Ex.: coleção de inverno com 20% off no primeiro pedido",
  },
  {
    id: "ticket",
    kind: "single",
    question: "Quanto custa, em média, o que o cliente compra?",
    help: "Ajuda a saber quanto podemos pagar por cada venda ou contato.",
    options: [
      { value: "under_100", label: "Até R$ 100", icon: "🪙" },
      { value: "100_500", label: "R$ 100 a R$ 500", icon: "💵" },
      { value: "500_2000", label: "R$ 500 a R$ 2 mil", icon: "💰" },
      { value: "2000_10000", label: "R$ 2 mil a R$ 10 mil", icon: "🏦" },
      { value: "over_10000", label: "Mais de R$ 10 mil", icon: "💎" },
    ],
  },
  {
    id: "audience",
    kind: "text",
    question: "Quem precisa ver esse anúncio?",
    help: "Descreva a pessoa: idade aproximada, o que ela busca, qual problema ela tem.",
    placeholder: "Ex.: mulheres de 25 a 45 anos que compram roupa online e valoram peças exclusivas",
  },
  {
    id: "coverage",
    kind: "single",
    question: "Onde o cliente atende?",
    options: [
      { value: "nationwide", label: "Todo o Brasil", icon: "🇧🇷" },
      { value: "state", label: "Um estado ou região", icon: "🗺️" },
      { value: "city", label: "Uma cidade", icon: "📍" },
      { value: "radius", label: "Só perto do endereço", icon: "🧭", hint: "Bairro, raio de alguns km" },
    ],
  },
  {
    id: "coverage_detail",
    kind: "text",
    question: "Quais lugares, exatamente?",
    help: "Cidades, estados ou o endereço de referência com o raio que faz sentido.",
    placeholder: "Ex.: São Paulo capital + ABC, raio de 15 km da loja da Vila Mariana",
    showIf: (a) => typeof a["coverage"] === "string" && !has(a, "coverage", "nationwide"),
  },
  {
    id: "monthly_budget",
    kind: "money",
    question: "Quanto o cliente pode investir por mês em anúncios?",
    help: "Valor apenas de mídia, sem contar honorários.",
    placeholder: "Ex.: 3000",
  },
  {
    id: "differentiator",
    kind: "text",
    question: "Por que alguém escolhe esse negócio e não o concorrente?",
    help: "Vale preço, prazo, garantia, atendimento, especialidade — o que for verdade.",
    placeholder: "Ex.: entrega em 24h na cidade e troca gratuita em 30 dias",
  },
  {
    id: "assets",
    kind: "multi",
    question: "O que já existe pronto para usar?",
    help: "Selecione tudo que se aplica. O que faltar vira aviso no plano.",
    min: 0,
    options: [
      { value: "website", label: "Site que vende", icon: "🌐" },
      { value: "landing", label: "Página de campanha", icon: "📄" },
      { value: "whatsapp", label: "WhatsApp de atendimento", icon: "💬" },
      { value: "catalog", label: "Catálogo de produtos", icon: "📦", hint: "Feed com preço e estoque" },
      { value: "photos", label: "Fotos boas do produto", icon: "📷" },
      { value: "videos", label: "Vídeos curtos", icon: "🎬" },
      { value: "reviews", label: "Avaliações de clientes", icon: "⭐" },
      { value: "tracking", label: "Medição já instalada", icon: "📊", hint: "Pixel/tag de conversão" },
      { value: "none", label: "Quase nada ainda", icon: "🚧" },
    ],
  },
  {
    id: "history",
    kind: "single",
    question: "Esse cliente já anunciou antes?",
    options: [
      { value: "never", label: "Nunca anunciou", icon: "🆕" },
      { value: "tried_failed", label: "Tentou e não deu certo", icon: "😕" },
      { value: "working", label: "Anuncia e funciona", icon: "📈" },
      { value: "unknown", label: "Não sei dizer", icon: "🤷" },
    ],
  },
  {
    id: "history_detail",
    kind: "text",
    question: "O que já foi testado e como foi?",
    help: "Onde anunciou, quanto gastou e o que aconteceu — mesmo que seja pouca informação.",
    placeholder: "Ex.: impulsionou posts no Instagram por 3 meses, teve muitos cliques e nenhuma venda",
    optional: true,
    showIf: (a) => has(a, "history", "tried_failed") || has(a, "history", "working"),
  },
  {
    id: "catalog_size",
    kind: "single",
    question: "Quantos produtos entram na campanha?",
    showIf: (a) => has(a, "business_model", "ecommerce") || has(a, "assets", "catalog"),
    options: [
      { value: "few", label: "Até 10 produtos", icon: "🔢" },
      { value: "medium", label: "De 10 a 100", icon: "📚" },
      { value: "many", label: "Mais de 100", icon: "🏗️" },
    ],
  },
  {
    id: "store_context",
    kind: "single",
    question: "O que faz alguém sair de casa para ir até a loja?",
    showIf: (a) =>
      has(a, "business_model", "local_store") ||
      has(a, "goal_30d", "store_visits") ||
      has(a, "coverage", "radius"),
    options: [
      { value: "promo", label: "Promoção do dia", icon: "🏷️" },
      { value: "experience", label: "Experimentar/ver de perto", icon: "🤲" },
      { value: "service", label: "Atendimento presencial", icon: "🧑‍🔧" },
      { value: "urgency", label: "Precisa na hora", icon: "⚡" },
    ],
  },
  {
    id: "response_time",
    kind: "single",
    question: "Quem responde os contatos e em quanto tempo?",
    help: "Contato que demora a ser respondido esfria — isso muda o tipo de campanha.",
    showIf: (a) =>
      has(a, "goal_30d", "leads") ||
      has(a, "goal_30d", "bookings") ||
      has(a, "business_model", "services") ||
      has(a, "business_model", "appointments") ||
      has(a, "business_model", "b2b"),
    options: [
      { value: "minutes", label: "Em minutos", icon: "⚡" },
      { value: "same_day", label: "No mesmo dia", icon: "🕐" },
      { value: "next_day", label: "No dia seguinte", icon: "📮" },
      { value: "nobody", label: "Ninguém dedicado ainda", icon: "🚨" },
    ],
  },
  {
    id: "sales_cycle",
    kind: "single",
    question: "Quanto tempo leva entre o primeiro contato e a venda?",
    showIf: (a) => has(a, "business_model", "b2b") || has(a, "business_model", "services"),
    options: [
      { value: "same_day", label: "Fecha no mesmo dia", icon: "⚡" },
      { value: "week", label: "Alguns dias", icon: "📆" },
      { value: "month", label: "Cerca de um mês", icon: "🗓️" },
      { value: "quarter", label: "Vários meses", icon: "⏳" },
    ],
  },
  {
    id: "constraints",
    kind: "text",
    question: "Existe algo que NÃO podemos fazer?",
    help: "Restrições de marca, temas proibidos, regiões que não atende, concorrente que não pode ser citado.",
    placeholder: "Ex.: não usar preço nos anúncios e não anunciar para menores de 18",
    optional: true,
  },
];

/** Perguntas visíveis para as respostas atuais (fluxo adaptativo). */
export function visibleQuestions(answers: InterviewAnswers): InterviewQuestion[] {
  return INTERVIEW_QUESTIONS.filter((q) => (q.showIf ? q.showIf(answers) : true));
}

function isFilled(q: InterviewQuestion, answers: InterviewAnswers): boolean {
  const v = answers[q.id];
  if (q.optional) return true;
  if (q.kind === "multi") return Array.isArray(v) && v.length >= (q.min ?? 1);
  return typeof v === "string" && v.trim().length > 0;
}

export function isQuestionAnswered(q: InterviewQuestion, answers: InterviewAnswers): boolean {
  return isFilled(q, answers);
}

export function isInterviewComplete(answers: InterviewAnswers): boolean {
  return visibleQuestions(answers).every((q) => isFilled(q, answers));
}

/** Valor do orçamento mensal em número, tolerando "3.000", "R$ 3000" e "3,5". */
export function parseMoney(raw: string | string[] | undefined): number {
  if (typeof raw !== "string") return 0;
  const cleaned = raw.replace(/[^\d.,-]/g, "");
  const hasComma = cleaned.includes(",");
  const normalized = hasComma
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : /\.\d{3}(\D|$)/.test(cleaned)
      ? cleaned.replace(/\./g, "")
      : cleaned;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function interviewBudget(answers: InterviewAnswers): number {
  return parseMoney(answers["monthly_budget"]);
}

function labelFor(q: InterviewQuestion, value: string): string {
  const opt = q.options?.find((o) => o.value === value);
  return opt ? opt.label : value;
}

/**
 * Serializa a entrevista para o prompt exatamente como o usuário respondeu —
 * pergunta em linguagem simples + resposta escolhida.
 */
export function interviewToPromptText(answers: InterviewAnswers): string {
  const lines: string[] = [];
  for (const q of visibleQuestions(answers)) {
    const v = answers[q.id];
    if (v == null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim())) {
      continue;
    }
    const answer = Array.isArray(v)
      ? v.map((x) => labelFor(q, x)).join(", ")
      : q.kind === "single"
        ? labelFor(q, v)
        : v.trim();
    lines.push(`- ${q.question} → ${answer}`);
  }
  return lines.join("\n");
}
