import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { brain, type BrainContext } from "./brain/api";

// ============ types ============
export type ChatAttachment = {
  path: string; // storage path inside chat-attachments bucket
  name: string;
  mime: string;
  size: number;
  kind: "image" | "audio" | "pdf" | "file";
};

export type ChatMessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments: ChatAttachment[];
  brain_context: BrainContextSummary | null;
  used_llm: boolean;
  model: string | null;
  tool_calls: ChatToolCall[];
  created_at: string;
};

export type ChatToolCall = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: Record<string, any>;
  ok: boolean;
  ts: string;
};

export type ChatConversationRow = {
  id: string;
  user_id: string;
  brand_id: string | null;
  client_id: string | null;
  title: string;
  last_message_at: string;
  created_at: string;
};

type BrainContextSummary = {
  memories: Array<{ summary: string; similarity: number; event_type: string }>;
  insights: Array<{ description: string; type: string; confidence: number | null }>;
  stats: Record<string, number>;
  used_llm: boolean;
  model?: string;
};

const HISTORY_LIMIT = 12;

// ============ list conversations ============
export const listChatConversationsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChatConversationRow[]> => {
    const { data, error } = await context.supabase
      .from("chat_conversations")
      .select("id, user_id, brand_id, client_id, title, last_message_at, created_at")
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as ChatConversationRow[];
  });

// ============ create conversation ============
const CreateInput = z.object({
  title: z.string().max(200).optional(),
  brandId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
});
export const createChatConversationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateInput.parse(i))
  .handler(async ({ data, context }): Promise<ChatConversationRow> => {
    const { data: row, error } = await context.supabase
      .from("chat_conversations")
      .insert({
        user_id: context.userId,
        title: data.title?.trim() || "Nova conversa",
        brand_id: data.brandId ?? null,
        client_id: data.clientId ?? null,
      })
      .select("id, user_id, brand_id, client_id, title, last_message_at, created_at")
      .single();
    if (error || !row) throw new Error(error?.message ?? "insert failed");
    return row as ChatConversationRow;
  });

// ============ rename / delete ============
export const renameChatConversationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), title: z.string().min(1).max(200) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_conversations")
      .update({ title: data.title })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChatConversationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("chat_conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ list messages ============
export const listChatMessagesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ conversationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<ChatMessageRow[]> => {
    const { data: rows, error } = await context.supabase
      .from("chat_messages")
      .select(
        "id, conversation_id, role, content, attachments, brain_context, used_llm, model, tool_calls, created_at",
      )
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (rows ?? []) as ChatMessageRow[];
  });

// ============ send message (Brain-first orchestrator) ============
// Toda a lógica de consolidação + LLM + evento de feedback é feita através da
// Brain API (`src/lib/brain/api.ts`). Este arquivo NÃO acessa tabelas brain_*
// diretamente — persiste apenas em chat_conversations / chat_messages.
const AttachmentSchema = z.object({
  path: z.string(),
  name: z.string(),
  mime: z.string(),
  size: z.number(),
  kind: z.enum(["image", "audio", "pdf", "file"]),
});
const SendInput = z.object({
  conversationId: z.string().uuid(),
  content: z.string().max(8000),
  attachments: z.array(AttachmentSchema).max(10).default([]),
});

export const sendChatMessageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SendInput.parse(i))
  .handler(
    async ({ data, context }): Promise<{ user: ChatMessageRow; assistant: ChatMessageRow }> => {
      const question = data.content.trim();
      const hasAttachments = data.attachments.length > 0;
      if (!question && !hasAttachments) throw new Error("Mensagem vazia");

      // 1) Load conversation (scope + auto-title)
      const { data: convo, error: convoErr } = await context.supabase
        .from("chat_conversations")
        .select("id, brand_id, client_id, title")
        .eq("id", data.conversationId)
        .maybeSingle();
      if (convoErr || !convo) throw new Error("Conversa não encontrada");

      // 2) Persist user message immediately
      const { data: userRow, error: userErr } = await context.supabase
        .from("chat_messages")
        .insert({
          conversation_id: data.conversationId,
          user_id: context.userId,
          role: "user",
          content: question,
          attachments: data.attachments,
        })
        .select(
          "id, conversation_id, role, content, attachments, brain_context, used_llm, model, created_at",
        )
        .single();
      if (userErr || !userRow) throw new Error(userErr?.message ?? "insert user msg failed");

      // Auto-title on first message
      if (convo.title === "Nova conversa" && question) {
        const short = question.slice(0, 60);
        await context.supabase
          .from("chat_conversations")
          .update({ title: short })
          .eq("id", convo.id);
      }

      // 3) BRAIN FIRST — via Brain API (consolida memory + insights + query.stats)
      const brainCtx: BrainContext = {
        supabase: context.supabase,
        userId: context.userId,
        brandId: convo.brand_id,
        clientId: convo.client_id,
        module: "chat",
      };
      // Context Engine: pacote reduzido e scored (apenas o relevante).
      const contextPack = await brain.buildContext(brainCtx, {
        question: question || data.attachments.map((a) => a.name).join(", "),
        module: "chat",
      });
      // Compat: mantém a shape que o LLM já espera.
      const brainKnowledge = {
        memories: contextPack.items
          .filter((i) => i.kind === "semantic")
          .map((i) => ({
            content_summary: i.detail,
            similarity: i.confidence ?? i.score,
            event_type: i.label,
          })),
        insights: contextPack.items
          .filter((i) => i.kind === "insight")
          .map((i) => ({
            insight_type: i.label,
            description: i.detail,
            confidence: i.confidence ?? null,
          })),
        memoryRows: contextPack.items
          .filter((i) => i.kind === "memory")
          .map((i) => ({
            title: i.label,
            description: i.detail,
            confidence: i.confidence ?? null,
          })),
        stats: contextPack.stats,
        markdown: contextPack.markdown,
      };

      // 4) Recent history (last N messages)
      const { data: history } = await context.supabase
        .from("chat_messages")
        .select("role, content")
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT);
      const orderedHistory = (history ?? []).reverse();

      // 5) Try to answer WITHOUT LLM when there is a strong direct hit
      const directAnswer = brain.chat.tryDirectAnswer(question, brainKnowledge);

      let answer: string;
      let usedLlm = false;
      let model: string | null = null;

      if (directAnswer && !hasAttachments) {
        answer = directAnswer;
      } else {
        const llm = await brain.chat.callLlm({
          question,
          history: orderedHistory as Array<{ role: string; content: string }>,
          brain: brainKnowledge,
          attachments: data.attachments.map((a) => ({ name: a.name, kind: a.kind, mime: a.mime })),
          supabase: context.supabase,
          brandId: convo.brand_id as string,
        });
        answer = llm.text;
        usedLlm = true;
        model = llm.model;
      }

      // 6) Persist assistant message with brain context summary
      const brainSummary: BrainContextSummary = {
        memories: brainKnowledge.memories.slice(0, 5).map((m) => ({
          summary: m.content_summary,
          similarity: m.similarity,
          event_type: m.event_type,
        })),
        insights: brainKnowledge.insights.slice(0, 5).map((i) => ({
          description: i.description,
          type: i.insight_type,
          confidence: i.confidence,
        })),
        stats: brainKnowledge.stats as Record<string, number>,
        used_llm: usedLlm,
        model: model ?? undefined,
      };

      const { data: asstRow, error: asstErr } = await context.supabase
        .from("chat_messages")
        .insert({
          conversation_id: data.conversationId,
          user_id: context.userId,
          role: "assistant",
          content: answer,
          attachments: [],
          brain_context: brainSummary,
          used_llm: usedLlm,
          model,
        })
        .select(
          "id, conversation_id, role, content, attachments, brain_context, used_llm, model, created_at",
        )
        .single();
      if (asstErr || !asstRow) throw new Error(asstErr?.message ?? "insert assistant failed");

      // 7) Feedback loop → Brain Event Bus (best-effort)
      await Promise.all([
        brain.events.publish(brainCtx, {
          brand_id: convo.brand_id,
          client_id: convo.client_id,
          source_module: "chat",
          event_type: "chat.turn",
          payload: {
            conversation_id: convo.id,
            question: question.slice(0, 400),
            used_llm: usedLlm,
            memories_used: brainSummary.memories.length,
            insights_used: brainSummary.insights.length,
          },
        }),
        // Provenance: registra quais memórias/insights (com score) alimentaram a resposta.
        brain.recordContextUsage(brainCtx, {
          pack: contextPack,
          responseId: (asstRow as { id: string }).id,
          consumer: "chat",
          usedLlm,
        }),
      ]);

      return { user: userRow as ChatMessageRow, assistant: asstRow as ChatMessageRow };
    },
  );
