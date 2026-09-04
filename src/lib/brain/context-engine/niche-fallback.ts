// ⚠️ Brain Context Engine — Cold Start Fallback.
// Quando o Brain ainda não tem histórico para uma marca (cliente novo, sem
// eventos/insights/memórias), o Context Engine injeta um bloco de boas
// práticas de mercado baseado no nicho do cliente. Isso garante que a Pauta
// Mensal (e outros consumidores) NUNCA saiam genéricas no primeiro mês.
//
// Catálogo estático — sem IA, sem tabelas. Curado manualmente pela agência.

type NichePractice = {
  keywords: string[]; // termos usados no `clients.niche` para casar (case-insensitive)
  label: string;
  practices: string[];
};

const CATALOG: NichePractice[] = [
  {
    keywords: ["cafeteria", "café", "coffee", "cafe"],
    label: "Cafeterias & Coffee Shops",
    practices: [
      "Reels curtos (<20s) de preparo (latte art, grãos) performam 2-3× melhor que fotos estáticas.",
      "Publique 3-5×/semana com pelo menos 40% de Reels e 20% de Stories interativos (enquetes/quizzes).",
      "Aposte em posts de rotina (abertura, novos grãos, especial do dia) — geram salvamentos e visitas.",
      "Use localização geo-tagueada em todo post — Instagram distribui organicamente na aba 'Perto de você'.",
      "Tom de voz: acolhedor, sensorial, próximo (você/nós). Evite corporativismo.",
    ],
  },
  {
    keywords: [
      "restaurante",
      "restaurant",
      "gastronomia",
      "bar",
      "bistrô",
      "hamburgueria",
      "pizzaria",
    ],
    label: "Restaurantes & F&B",
    practices: [
      "Vídeos de prato sendo montado (top-down, 15-25s) são o formato de maior engajamento em IG/TikTok.",
      "Carrosséis de cardápio com preço/descrição têm alta taxa de salvamento — ótimos para gatilho de conversão.",
      "Publique em horários pré-refeição: 10-11h e 17-18h. Reservas sobem quando o post cai antes da fome.",
      "Reviews de clientes reais (com foto do prato) convertem mais que fotos profissionais isoladas.",
      "Combine Reels + Story com sticker de reserva/WhatsApp — reduz atrito no funil.",
    ],
  },
  {
    keywords: ["moda", "fashion", "roupa", "vestuário", "boutique"],
    label: "Moda & Vestuário",
    practices: [
      "Reels de 'looks do dia' (POV) e transições outfit performam melhor que fotos de produto.",
      "Carrosséis de peça (5-7 slides) mostrando detalhes, caimento e combinações têm alto tempo de retenção.",
      "Colab com micro-influenciadores locais (5k-30k) tem melhor ROI que macro no primeiro ano.",
      "Publique lançamentos em blocos temáticos ('cápsula da semana') — cria expectativa e recorrência.",
    ],
  },
  {
    keywords: ["fitness", "academia", "personal", "crossfit", "yoga", "pilates"],
    label: "Fitness & Wellness",
    practices: [
      "Antes/depois (com autorização) e transformações em Reels são o topo de engajamento no nicho.",
      "Dicas técnicas curtas (execução correta de exercícios) geram compartilhamento e salvamento.",
      "Depoimentos em vídeo de alunos convertem mais que promoções de preço.",
      "Publique 4-5×/semana com mix Reels + carrossel educativo + story de bastidor.",
    ],
  },
  {
    keywords: ["saas", "software", "tech", "tecnologia", "startup", "b2b"],
    label: "SaaS & B2B Tech",
    practices: [
      "LinkedIn > Instagram para B2B. Priorize carrosséis de tese/case e posts longos com storytelling.",
      "Cases de cliente (com número real) convertem mais que features. Regra: problema → solução → resultado.",
      "Reels curtos de UI/produto em ação funcionam para topo de funil no IG/TikTok.",
      "Publique 3×/semana no LinkedIn com foco em CEO/decisor + 2-3×/semana no IG com bastidor humano.",
      "Tom de voz: consultivo, direto, com dados. Evite jargão de marketing.",
    ],
  },
  {
    keywords: ["imobiliária", "imóveis", "imovel", "corretor", "real estate"],
    label: "Imobiliário",
    practices: [
      "Tours em Reels (30-60s, vertical) do imóvel são o formato de maior salvamento e mensagem direta.",
      "Carrossel com planta baixa + fotos + preço + localização é o formato mais compartilhado.",
      "Publique novidades de bairro e mercado — posiciona a marca como autoridade, não só vendedor.",
      "Localização geo-tagueada em TODO post. Facebook Marketplace ainda é canal relevante.",
    ],
  },
  {
    keywords: [
      "clínica",
      "clinica",
      "estética",
      "estetica",
      "odontológica",
      "dermato",
      "saúde",
      "medicina",
    ],
    label: "Clínicas & Estética/Saúde",
    practices: [
      "Antes/depois exige autorização documentada — quando usado, é o post de maior conversão do nicho.",
      "Conteúdo educativo (esclarece dúvidas, mitos, procedimentos) constrói autoridade e reduz objeção.",
      "Depoimentos em vídeo (não texto) têm 4× mais engajamento e conversão em agenda.",
      "Respeite normas do CFM/CRO/ANVISA — evite promessas absolutas e sensacionalismo.",
    ],
  },
  {
    keywords: ["educação", "educacao", "curso", "escola", "ensino"],
    label: "Educação & Cursos",
    practices: [
      "Depoimentos de alunos com resultado concreto são o gatilho principal de conversão.",
      "Carrosséis 'aprenda X em 5 slides' têm alto salvamento — ótimos para topo de funil.",
      "Publique consistentemente 4-5×/semana. Frequência importa mais que produção alta.",
      "Lançamentos com evento (aula ao vivo/webinar) + Stories de contagem regressiva convertem melhor.",
    ],
  },
  {
    keywords: ["e-commerce", "ecommerce", "loja online", "varejo"],
    label: "E-commerce & Varejo",
    practices: [
      "Reels de 'unboxing' e uso real de produto convertem mais que fotos studio.",
      "Provas sociais (avaliações, reviews em vídeo) reduzem objeção de compra e aumentam CTR do link.",
      "Publique 4-6×/semana com carrossel de produto + Reels + Story com sticker de link direto.",
      "Datas comemorativas + urgência (contagem regressiva) são gatilhos previsíveis de pico de venda.",
    ],
  },
];

const GENERIC_FALLBACK: string[] = [
  "Publique 3-5×/semana com mistura de formatos (60% Reels/vídeos, 30% carrosséis, 10% Stories).",
  "Reels de 15-30s têm o maior alcance orgânico em Instagram e TikTok — priorize para tráfego frio.",
  "Carrosséis educativos (5-8 slides) têm a maior taxa de salvamento — ótimos para autoridade.",
  "Depoimentos reais (vídeo curto ou print) convertem mais que qualquer post produzido.",
  "Consistência de publicação supera qualidade individual — mantenha frequência semanal fixa.",
  "Use CTA claro em toda peça: 'salve', 'compartilhe', 'link na bio', 'chame no direct'.",
];

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Retorna markdown de boas práticas de mercado para o nicho informado.
 * Se o nicho não bater com nenhum item do catálogo, retorna fallback genérico.
 * Nunca retorna string vazia — sempre há algo relevante para injetar.
 */
export function getNicheFallbackMarkdown(niche: string | null | undefined): string {
  const n = normalize(niche);
  const match = n ? CATALOG.find((c) => c.keywords.some((k) => n.includes(normalize(k)))) : null;
  const label = match?.label ?? "Boas práticas gerais de social media";
  const practices = match?.practices ?? GENERIC_FALLBACK;
  const header = match
    ? `## Cold start — boas práticas de mercado (${label})`
    : `## Cold start — ${label}`;
  const body = practices.map((p) => `- ${p}`).join("\n");
  const note = `\n\n_Diretrizes baseadas em benchmarks de mercado — o Brain ainda não tem histórico específico desta marca. À medida que os posts forem publicados, aprovados e receberem métricas, estas diretrizes serão substituídas por aprendizados reais._`;
  return `${header}\n${body}${note}`;
}
