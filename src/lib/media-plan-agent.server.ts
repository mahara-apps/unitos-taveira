import type { SupabaseClient } from "@supabase/supabase-js";
import { runPlanAgent } from "./monthly-plan-agent.server";
import { loadAgentPrompts } from "./agent-prompts.server";
import { briefingToPromptText, loadCanonicalBriefing } from "./briefing-source.server";
import { GeneratedPlanSchema, type GeneratedPlan } from "./media-plan/plan-schema";
import { maxCampaignsForBudget, normalizeGeneratedPlan } from "./media-plan/normalize";
import { interviewToPromptText, type InterviewAnswers } from "./media-plan/interview-schema";

export const MEDIA_PLAN_AGENT_ID = "media_planner_paid";

const FALLBACK_SYSTEM = [
  "Você é um especialista sênior em mídia paga com domínio profundo de Meta Ads e Google Ads.",
  "Responda SEMPRE em português do Brasil, em linguagem clara para quem não é da área.",
  "Monte planos prontos para execução a partir de uma entrevista respondida por pessoas sem conhecimento técnico.",
].join(" ");

/**
 * Conhecimento de plataforma injetado a cada execução. Fica no código (e não
 * só no prompt do banco) para que instalações sem seed do agente ainda gerem
 * planos com os tipos, eventos e limites corretos.
 */
const PLATFORM_KNOWLEDGE = `
CATÁLOGO META ADS (use os nomes reais)
- Objetivos: Vendas, Cadastros, Tráfego, Engajamento, Reconhecimento, Promoção de app.
- Tipos/subtipos úteis: Vendas > conversões no site; Vendas > catálogo (Advantage+ Shopping, exige feed);
  Cadastros > formulário instantâneo; Cadastros > mensagens (WhatsApp/Direct); Cadastros > chamadas;
  Tráfego > cliques no link; Reconhecimento > alcance/vídeo.
- Públicos: amplo com Advantage+, interesses/comportamentos, personalizados (pixel, listas, engajamento,
  visualização de vídeo), semelhantes (1% a 10%), retargeting por evento.
- Posicionamentos: Feed, Stories, Reels, Explorar, Marketplace, Audience Network, ou Advantage+ placements.
- Eventos padrão: Purchase, Lead, AddToCart, InitiateCheckout, Contact, Schedule, CompleteRegistration.
- Requisitos: pixel + Conversions API, verificação de domínio, catálogo para vendas de e-commerce.
- Limites de texto: título até 40, texto principal até 125 recomendado, descrição até 30.

CATÁLOGO GOOGLE ADS (use os nomes reais)
- Tipos: Search, Performance Max, Demand Gen, Display, Vídeo/YouTube (in-stream, in-feed, Shorts),
  Shopping (exige Merchant Center), campanhas com meta de visitas à loja/Local.
- Lances: Maximizar conversões, tCPA, tROAS, Maximizar cliques, Maximizar valor de conversão.
- Search: grupos por tema, correspondência ampla/frase/exata, lista de negativas obrigatória,
  RSA com até 15 títulos de 30 caracteres e 4 descrições de 90.
- Performance Max: grupos de ativos, sinais de público, feed opcional (obrigatório para varejo).
- Requisitos: conversões importadas/tag do Google, Merchant Center para Shopping/PMax com feed,
  extensões (sitelinks, frases de destaque, snippets estruturados).

REGRAS DE PLANEJAMENTO
- Nunca pulverize verba. Cada campanha precisa de verba diária suficiente para sair do aprendizado.
- Escolha o tipo de campanha pela intenção revelada na entrevista, não por moda.
- Você define a divisão por etapa do funil e explica o motivo sem jargão.
- Palavras-chave e negativas apenas em campanhas de Search do Google; deixe as listas vazias nas outras.
- Pré-requisitos que faltam (pixel, conversões, catálogo, página, atendimento) entram em prerequisites e warnings.
- Números futuros são faixas estimadas, nunca promessas.
- Respeite os limites de caracteres reais da plataforma de cada campanha.
`.trim();

export type MediaPlanGenerationInput = {
  supabase: SupabaseClient;
  brandId: string;
  clientId: string;
  userId: string;
  monthlyBudget: number;
  interview: InterviewAnswers;
  /** Ajuste avançado opcional: quando ausente, a IA decide a divisão. */
  funnelSplit?: { topo: number; meio: number; fundo: number } | null;
  /** Regeração focada: instrução livre do usuário sobre o que mudar. */
  refinement?: string | null;
};

export async function generateMediaPlanStrategy(input: MediaPlanGenerationInput): Promise<{
  plan: GeneratedPlan;
  modelId: string;
}> {
  const [prompts, canonical] = await Promise.all([
    loadAgentPrompts(input.brandId, [MEDIA_PLAN_AGENT_ID], input.supabase).catch(() => null),
    loadCanonicalBriefing(input.supabase, {
      clientId: input.clientId,
      brandId: input.brandId,
    }).catch(() => null),
  ]);

  const system = prompts?.get(MEDIA_PLAN_AGENT_ID)?.trim() || FALLBACK_SYSTEM;

  const brief = canonical ? briefingToPromptText(canonical) : "";
  const budgetBRL = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(input.monthlyBudget);
  const dailyBRL = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(input.monthlyBudget / 30);
  const maxCampaigns = maxCampaignsForBudget(input.monthlyBudget);

  const prompt = [
    "Monte o plano de mídia paga mensal para o cliente abaixo.",
    "",
    canonical?.clientName ? `Cliente: ${canonical.clientName}` : "",
    brief ? `Briefing consolidado:\n${brief.slice(0, 4000)}` : "",
    "",
    "RESPOSTAS DA ENTREVISTA (linguagem do próprio usuário):",
    interviewToPromptText(input.interview) || "(entrevista sem respostas)",
    "",
    `Verba mensal de mídia: ${budgetBRL} (aproximadamente ${dailyBRL} por dia).`,
    `Use no máximo ${maxCampaigns} campanha(s) para esta verba.`,
    input.funnelSplit
      ? `O usuário fixou a divisão por etapa do funil: topo=${input.funnelSplit.topo}%, meio=${input.funnelSplit.meio}%, fundo=${input.funnelSplit.fundo}%. Respeite exatamente esses números em funnel_split e distribua as campanhas de acordo.`
      : "Você decide a divisão por etapa do funil e explica o motivo em funnel_rationale, sem jargão.",
    input.refinement ? `AJUSTE PEDIDO PELO USUÁRIO: ${input.refinement}` : "",
    "",
    PLATFORM_KNOWLEDGE,
    "",
    "Formato: budget_pct das campanhas deve somar exatamente 100. Escreva tudo em português do Brasil,",
    "sem markdown e sem numeração nos textos. Explique termos técnicos na primeira menção.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await runPlanAgent({
    agent: "media.plan",
    supabase: input.supabase,
    brandId: input.brandId,
    clientId: input.clientId,
    userId: input.userId,
    system,
    prompt,
    schema: GeneratedPlanSchema,
  });

  const plan = normalizeGeneratedPlan(result.output as GeneratedPlan);
  if (input.funnelSplit) plan.funnel_split = input.funnelSplit;
  return { plan, modelId: result.modelId };
}
