// ⚠️ Brain Chat Gateway — chamada ao LLM com a chave de API da própria marca.
// Server-only: resolve provider/modelo via getBrandAiModel.
import { generateText, streamText, stepCountIs, type ModelMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrandAiModel } from "../../ai-provider.server";
import type { BrainConsolidated } from "./consolidate";
import { buildMultimodalContent, type ChatAttachmentInput } from "./multimodal.server";
import { buildChatTools, type ToolCallLog } from "./tools.server";
import type { BrainContext } from "../core";

export interface ChatAttachmentMeta {
  name: string;
  kind: string;
  mime: string;
}

export interface ChatUserContext {
  id?: string;
  name?: string | null;
  email?: string | null;
}

function firstName(name?: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0];
}

function buildInstructions(brain: BrainConsolidated, user?: ChatUserContext): string {
  const displayName = firstName(user?.name) ?? (user?.email ? user.email.split("@")[0] : null);

  const identity = displayName
    ? `Usuário atual: ${displayName}${user?.email ? ` (${user.email})` : ""}. Você já sabe quem é — chame pelo primeiro nome quando fizer sentido, sem forçar em toda mensagem.`
    : "Usuário atual: identidade não disponível — não peça o nome, apenas siga em frente.";

  return [
    "Você é o copiloto da Unitos, um SaaS para agências. Fale como uma pessoa próxima do time, não como um FAQ corporativo.",
    identity,
    "",
    "Estilo de resposta:",
    "- Curto por padrão: 1 a 3 frases. Só expanda quando a pergunta pedir detalhe real.",
    '- Conversacional e cadenciado, em português do Brasil. Sem jargão, sem preâmbulo ("claro!", "com certeza!").',
    "- Evite markdown pesado: nada de negrito em cada linha, nada de listas com 1–2 itens. Bullets só quando houver 3+ itens realmente paralelos.",
    "- Nunca liste todas as suas capacidades de forma proativa. Só cite uma ação quando ela responde a pergunta atual.",
    '- Para saudações ("oi", "tudo bem?"): responda curto e devolva a bola. Ex.: "Oi' +
      (displayName ? ", " + displayName : "") +
      '. No que te ajudo?". Nada de menu.',
    '- Perguntas sobre o próprio usuário ("qual meu nome?", "quem sou eu?"): responda direto com o que você já sabe acima.',
    "",
    "Uso de dados e ferramentas:",
    "- Nunca invente números, prazos ou nomes. Se não souber, use uma ferramenta ou diga que não tem o dado.",
    "- Só chame ferramentas quando a pergunta pedir dado real (clientes, tarefas, posts, memória do Brain). Não use ferramenta para bater papo.",
    "- Ao criar uma tarefa, confirme em uma frase o que foi criado.",
    "",
    "Conhecimento do Brain para esta pergunta (pode estar vazio):",
    brain.markdown ||
      "_(sem conhecimento relevante — responda com o que sabe ou use ferramentas.)_",
  ].join("\n");
}

async function buildMessages(
  supabase: SupabaseClient,
  history: Array<{ role: string; content: string }>,
  question: string,
  attachments: ChatAttachmentInput[],
): Promise<ModelMessage[]> {
  const past: ModelMessage[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content.trim().length > 0)
    .slice(0, -1) // remove a última user msg — vamos reconstruí-la multimodal
    .map((m) => ({ role: m.role as "assistant" | "user", content: m.content }));

  if (attachments.length > 0) {
    const content = await buildMultimodalContent(supabase, question, attachments);
    past.push({ role: "user", content });
  } else {
    past.push({ role: "user", content: question || "(sem texto)" });
  }

  return past;
}

// ---------- Modo síncrono (fallback / diagnóstico) ----------
export async function callLlm(args: {
  question: string;
  history: Array<{ role: string; content: string }>;
  brain: BrainConsolidated;
  attachments: ChatAttachmentMeta[];
  user?: ChatUserContext;
  supabase: SupabaseClient;
  brandId: string;
}): Promise<{ text: string; model: string }> {
  const { model, modelId } = await getBrandAiModel(
    args.supabase,
    args.brandId,
    "text",
    "operational",
    { agent: "brain.chat.simple", userId: args.user?.id ?? null },
  );

  const instructions = buildInstructions(args.brain, args.user);
  const messages: ModelMessage[] = args.history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: m.role as "assistant" | "user",
      content: m.content,
    }));

  if (args.attachments.length) {
    const list = args.attachments.map((a) => `- ${a.name} (${a.kind}, ${a.mime})`).join("\n");
    messages.push({
      role: "user",
      content: `Anexos enviados pelo usuário:\n${list}\n\nPergunta: ${args.question || "(sem texto)"}`,
    });
  }

  try {
    const result = await generateText({ model, instructions, messages, temperature: 0.4 });
    return { text: result.text.trim() || "_(sem resposta)_", model: modelId };
  } catch (err) {
    // Erro de provider NUNCA vira resposta do assistente: sobe classificado
    // para o chamador decidir o estado da conversa.
    console.error("[brain.chat.callLlm] LLM error", err);
    const { classifyAiError, FAILURE_MESSAGE_PT } = await import("@/lib/ai-failures.server");
    const { kind } = classifyAiError(err);
    throw new Error(`ai_chat_failed:${kind}: ${FAILURE_MESSAGE_PT[kind].body}`, { cause: err });
  }
}


// ---------- Modo streaming com tools + multimodal (caminho principal) ----------
export interface StreamAnswerArgs {
  supabase: SupabaseClient;
  brainCtx: BrainContext;
  question: string;
  attachments: ChatAttachmentInput[];
  history: Array<{ role: string; content: string }>;
  brain: BrainConsolidated;
  toolCallLog: ToolCallLog[];
  user?: ChatUserContext;
}

export async function streamAnswer(args: StreamAnswerArgs): Promise<{
  result: ReturnType<typeof streamText>;
  model: string;
}> {
  if (!args.brainCtx.brandId) throw new Error("brand_id ausente no contexto do chat");
  const { model, modelId } = await getBrandAiModel(
    args.supabase,
    args.brainCtx.brandId,
    "text",
    "operational",
    {
      agent: "brain.chat",
      clientId: args.brainCtx.clientId ?? null,
      userId: args.brainCtx.userId ?? args.user?.id ?? null,
    },
  );

  const messages = await buildMessages(
    args.supabase,
    args.history,
    args.question,
    args.attachments,
  );
  const tools = buildChatTools(args.supabase, args.brainCtx, args.toolCallLog);

  const result = streamText({
    model,
    instructions: buildInstructions(args.brain, args.user),
    messages,
    tools,
    stopWhen: stepCountIs(50),
    temperature: 0.4,
  });

  return { result, model: modelId };
}
