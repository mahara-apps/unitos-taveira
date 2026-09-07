// Endpoint HTTP para o chat com streaming + tools + multimodal.
// Não é um createServerFn porque precisamos retornar Response streaming.
// Auth: Bearer token no header Authorization (mesma sessão do client).
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { BrainContext } from "@/lib/brain/core";
import { brain } from "@/lib/brain/api";
import type { ChatAttachmentInput } from "@/lib/brain/chat-gateway/multimodal.server";
import type { ToolCallLog } from "@/lib/brain/chat-gateway/tools.server";
import { streamAnswer } from "@/lib/brain/chat-gateway/llm.server";
import { reason } from "@/lib/brain/reasoning/orchestrator.server";
import { waitUntil } from "@/lib/wait-until.server";

const BodySchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().max(8000).default(""),
  attachments: z
    .array(
      z.object({
        path: z.string(),
        name: z.string(),
        mime: z.string(),
        size: z.number(),
        kind: z.enum(["image", "audio", "pdf", "file"]),
      }),
    )
    .max(10)
    .default([]),
});

function isNewKey(k: string) {
  return k.startsWith("sb_publishable_") || k.startsWith("sb_secret_");
}
function makeFetch(key: string, token: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (isNewKey(key) && headers.get("Authorization") === `Bearer ${key}`)
      headers.delete("Authorization");
    headers.set("apikey", key);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };
}

export const Route = createFileRoute("/api/chat/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
        const token = auth.slice(7);
        if (token.split(".").length !== 3) return new Response("Invalid token", { status: 401 });

        const url = process.env.SUPABASE_URL;
        const pubKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!url || !pubKey) return new Response("Missing Supabase env", { status: 500 });

        const supabase = createClient<Database>(url, pubKey, {
          global: {
            fetch: makeFetch(pubKey, token),
            headers: { Authorization: `Bearer ${token}` },
          },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });

        const claimsRes = await supabase.auth.getClaims(token);
        const userId = claimsRes.data?.claims?.sub;
        if (!userId) return new Response("Invalid token", { status: 401 });
        const userEmail = (claimsRes.data?.claims?.email as string | undefined) ?? null;

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "Invalid body", { status: 400 });
        }

        const question = body.content.trim();
        const attachments = body.attachments as ChatAttachmentInput[];
        if (!question && attachments.length === 0) {
          return new Response("Mensagem vazia", { status: 400 });
        }

        // 1) Carregar conversa
        const { data: convo, error: convoErr } = await supabase
          .from("chat_conversations")
          .select("id, brand_id, client_id, title")
          .eq("id", body.conversationId)
          .maybeSingle();
        if (convoErr || !convo) return new Response("Conversa não encontrada", { status: 404 });

        // 2) Persistir mensagem do usuário
        const { data: userRow, error: userErr } = await supabase
          .from("chat_messages")
          .insert({
            conversation_id: body.conversationId,
            user_id: userId,
            role: "user",
            content: question,
            attachments:
              attachments as unknown as Database["public"]["Tables"]["chat_messages"]["Insert"]["attachments"],
          })
          .select("id")
          .single();
        if (userErr || !userRow)
          return new Response(userErr?.message ?? "insert failed", { status: 500 });

        // Auto-title
        if (convo.title === "Nova conversa" && question) {
          await supabase
            .from("chat_conversations")
            .update({ title: question.slice(0, 60) })
            .eq("id", convo.id);
        }

        // 3) Brain context
        const brainCtx: BrainContext = {
          supabase,
          userId,
          brandId: convo.brand_id,
          clientId: convo.client_id,
          module: "chat",
        };

        // 3.1) Identidade do usuário para personalizar o tom
        const { data: profileRow } = await supabase
          .from("user_profiles")
          .select("full_name")
          .eq("id", userId)
          .maybeSingle();
        const chatUser = {
          id: userId,
          name: profileRow?.full_name ?? null,
          email: userEmail,
        };

        const contextPack = await brain.buildContext(brainCtx, {
          question: question || attachments.map((a) => a.name).join(", "),
          module: "chat",
        });

        // 3.5) Brain Reasoning Engine v1 — planeja antes de responder.
        const reasoning = question
          ? await reason(brainCtx, supabase, { question, conversationId: convo.id })
          : null;

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
          markdown: reasoning?.llmContextMarkdown
            ? `${contextPack.markdown}\n\n${reasoning.llmContextMarkdown}`
            : contextPack.markdown,
        };

        // 3.6) Se o Reasoning já resolveu de forma determinística, respondemos
        // sem chamar o LLM — economiza tokens e mantém precisão factual.
        if (reasoning && !reasoning.shouldCallLlm && reasoning.deterministicAnswer) {
          const answer = reasoning.deterministicAnswer;
          const brainSummary = {
            memories: brainKnowledge.memories.slice(0, 5),
            insights: brainKnowledge.insights.slice(0, 5),
            stats: brainKnowledge.stats as Record<string, number>,
            used_llm: false,
            model: "brain.reasoning.v1",
            reasoning: {
              intent: reasoning.intent.intent,
              decision: reasoning.decision.decision,
              tools: reasoning.toolResults.map((r) => r.tool),
              latency_ms: reasoning.latencyMs,
            },
          };
          const { data: asstRow } = await supabase
            .from("chat_messages")
            .insert({
              conversation_id: body.conversationId,
              user_id: userId,
              role: "assistant",
              content: answer,
              attachments: [],
              brain_context:
                brainSummary as unknown as Database["public"]["Tables"]["chat_messages"]["Insert"]["brain_context"],
              used_llm: false,
              model: "brain.reasoning.v1",
              tool_calls:
                [] as unknown as Database["public"]["Tables"]["chat_messages"]["Insert"]["tool_calls"],
            })
            .select("id")
            .single();
          await Promise.all([
            brain.events.publish(brainCtx, {
              brand_id: convo.brand_id,
              client_id: convo.client_id,
              source_module: "chat",
              event_type: "chat.turn",
              payload: {
                conversation_id: convo.id,
                question: question.slice(0, 400),
                used_llm: false,
                reasoning_intent: reasoning.intent.intent,
                reasoning_decision: reasoning.decision.decision,
              },
            }),
            asstRow
              ? brain.recordContextUsage(brainCtx, {
                  pack: contextPack,
                  responseId: asstRow.id,
                  consumer: "chat",
                  usedLlm: false,
                })
              : Promise.resolve(),
          ]);
          const encoder = new TextEncoder();
          const rs = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(answer));
              controller.close();
            },
          });
          return new Response(rs, {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
              "Cache-Control": "no-cache",
              "X-Brain-Reasoning": "deterministic",
              "X-Brain-Intent": reasoning.intent.intent,
            },
          });
        }

        // 4) Histórico
        const { data: history } = await supabase
          .from("chat_messages")
          .select("role, content")
          .eq("conversation_id", body.conversationId)
          .order("created_at", { ascending: true })
          .limit(20);

        const toolCallLog: ToolCallLog[] = [];

        // 5) Streaming
        let stream: ReturnType<typeof streamAnswer> extends Promise<infer R> ? R : never;
        try {
          stream = await streamAnswer({
            supabase,
            brainCtx,
            question,
            attachments,
            history: (history ?? []) as Array<{ role: string; content: string }>,
            brain: brainKnowledge,
            toolCallLog,
            user: chatUser,
          });
        } catch (err) {
          // Falha ANTES de qualquer token: nada é persistido como resposta do
          // assistente e o erro técnico do provider não vaza para o usuário.
          console.error("[chat.stream] falha ao iniciar stream", err);
          const { classifyAiError, FAILURE_MESSAGE_PT } = await import("@/lib/ai-failures.server");
          const { kind } = classifyAiError(err);
          return new Response(FAILURE_MESSAGE_PT[kind].body, {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8", "X-Ai-Error": kind },
          });
        }

        // 6) Persistência da resposta (parcial ou completa) + eventos Brain
        const persist = async (answer: string, failure: { kind: string } | null) => {
          const brainSummary = {
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
            used_llm: true,
            model: stream.model,
            tool_calls_count: toolCallLog.length,
            ...(failure ? { error_kind: failure.kind, incomplete: true } : {}),
          };

          const { data: asstRow } = await supabase
            .from("chat_messages")
            .insert({
              conversation_id: body.conversationId,
              user_id: userId,
              role: "assistant",
              content: answer,
              attachments: [],
              brain_context:
                brainSummary as unknown as Database["public"]["Tables"]["chat_messages"]["Insert"]["brain_context"],
              used_llm: true,
              model: stream.model,
              tool_calls:
                toolCallLog as unknown as Database["public"]["Tables"]["chat_messages"]["Insert"]["tool_calls"],
            })
            .select("id")
            .single();

          await Promise.all([
            brain.events.publish(brainCtx, {
              brand_id: convo.brand_id,
              client_id: convo.client_id,
              source_module: "chat",
              event_type: "chat.turn",
              payload: {
                conversation_id: convo.id,
                question: question.slice(0, 400),
                used_llm: true,
                tool_calls: toolCallLog.length,
                memories_used: brainSummary.memories.length,
                ...(failure ? { error_kind: failure.kind } : {}),
              },
            }),
            asstRow
              ? brain.recordContextUsage(brainCtx, {
                  pack: contextPack,
                  responseId: asstRow.id,
                  consumer: "chat",
                  usedLlm: true,
                })
              : Promise.resolve(),
          ]);
        };

        // 7) Stream próprio: erro no MEIO do stream é tratado (aviso em pt-BR,
        // nunca o texto bruto do provider) e a persistência fica consistente
        // com o que o usuário viu.
        const encoder = new TextEncoder();
        let persisted: Promise<void> = Promise.resolve();
        const rs = new ReadableStream<Uint8Array>({
          async start(controller) {
            let acc = "";
            let failure: { kind: string } | null = null;
            try {
              for await (const chunk of stream.result.textStream) {
                acc += chunk;
                controller.enqueue(encoder.encode(chunk));
              }
            } catch (err) {
              console.error("[chat.stream] falha durante o streaming", err);
              const { classifyAiError, FAILURE_MESSAGE_PT } = await import(
                "@/lib/ai-failures.server"
              );
              const { kind } = classifyAiError(err);
              failure = { kind };
              const notice = `\n\n_${FAILURE_MESSAGE_PT[kind].body}_`;
              acc += notice;
              controller.enqueue(encoder.encode(notice));
            }
            const answer = acc.trim() || "_(sem resposta)_";
            persisted = persist(answer, failure).catch((err) => {
              console.error("[chat.stream] falha ao persistir resposta", err);
            });
            // Mantém o isolate vivo até a linha do assistente existir no banco.
            waitUntil(persisted);
            controller.close();
          },
        });

        return new Response(rs, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });

      },
    },
  },
});
