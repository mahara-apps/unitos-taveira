import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import {
  Paperclip,
  Send,
  X,
  FileText,
  Image as ImageIcon,
  Mic,
  Loader2,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listChatMessagesFn,
  type ChatAttachment,
  type ChatMessageRow,
  type ChatToolCall,
} from "@/lib/chat.functions";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const BUCKET = "chat-attachments";
const MAX_FILE_MB = 20;

type SendPayload = {
  content: string;
  attachments: ChatAttachment[];
};

function kindFromMime(mime: string): ChatAttachment["kind"] {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

export function ChatConversation({ conversationId }: { conversationId: string }) {
  const listMsgs = useServerFn(listChatMessagesFn);
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<
    Array<{ file: File; progress: number; uploaded?: ChatAttachment }>
  >([]);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const [streamingText, setStreamingText] = useState<string>("");

  const messages = useQuery({
    queryKey: ["chat", "messages", conversationId],
    queryFn: () => listMsgs({ data: { conversationId } }),
    staleTime: 0,
  });

  // realtime updates
  useEffect(() => {
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, qc]);

  // autoscroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.data?.length]);

  // focus composer
  useEffect(() => {
    textareaRef.current?.focus();
  }, [conversationId]);

  const sendM = useMutation({
    mutationFn: async (payload: SendPayload) => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada");
      setStreamingText("");
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId,
          content: payload.content,
          attachments: payload.attachments,
        }),
      });
      if (!res.ok || !res.body) {
        const msg = await res.text().catch(() => "Falha no stream");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      // Realtime já vai inserir a linha do usuário; leia o stream para o placeholder.
      qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setStreamingText(acc);
      }
      return acc;
    },
    onMutate: () => {
      setDraft("");
      setPendingFiles([]);
    },
    onSuccess: () => {
      setStreamingText("");
      qc.invalidateQueries({ queryKey: ["chat", "messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["chat", "conversations"] });
      textareaRef.current?.focus();
    },
    onError: (e) => {
      setStreamingText("");
      toast.error(e instanceof Error ? e.message : "Falha ao enviar");
    },
  });

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      toast.error("Sessão expirada");
      return;
    }
    for (const file of list) {
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        toast.error(`${file.name} excede ${MAX_FILE_MB}MB`);
        continue;
      }
      const key = `${uid}/${conversationId}/${crypto.randomUUID()}-${file.name}`;
      setPendingFiles((prev) => [...prev, { file, progress: 10 }]);
      const { error } = await supabase.storage.from(BUCKET).upload(key, file, { upsert: false });
      if (error) {
        toast.error(`Falha ao enviar ${file.name}: ${error.message}`);
        setPendingFiles((prev) => prev.filter((p) => p.file !== file));
        continue;
      }
      const uploaded: ChatAttachment = {
        path: key,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        kind: kindFromMime(file.type || ""),
      };
      setPendingFiles((prev) =>
        prev.map((p) => (p.file === file ? { ...p, progress: 100, uploaded } : p)),
      );
    }
  }

  function removePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recordChunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && recordChunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordChunksRef.current, { type: rec.mimeType || "audio/webm" });
        const file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type });
        await uploadFiles([file]);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      toast.error("Sem permissão de microfone");
      console.error(err);
    }
  }

  const canSend =
    !sendM.isPending && (draft.trim().length > 0 || pendingFiles.some((p) => p.uploaded));
  const isThinking = sendM.isPending;

  function submitMessage() {
    const content = draft.trim();
    const attachments = pendingFiles.map((p) => p.uploaded).filter(Boolean) as ChatAttachment[];
    if (!content && attachments.length === 0) return;
    sendM.mutate({ content, attachments });
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="mx-auto max-w-3xl px-4 py-6 space-y-6">
          {messages.isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}
          {messages.data?.length === 0 && <EmptyConversation onSuggest={(s) => setDraft(s)} />}
          {messages.data?.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {isThinking && streamingText && <StreamingBubble text={streamingText} />}
          {isThinking && !streamingText && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Brain className="h-4 w-4 animate-pulse" />
              Consultando o Brain…
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 space-y-2">
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingFiles.map((p, i) => (
                <AttachmentChip
                  key={i}
                  name={p.file.name}
                  mime={p.file.type}
                  uploading={!p.uploaded}
                  onRemove={() => removePending(i)}
                />
              ))}
            </div>
          )}
          <div className="relative rounded-2xl border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) submitMessage();
                }
              }}
              placeholder="Pergunte ao Brain…"
              rows={1}
              className="min-h-[52px] max-h-48 resize-none border-0 bg-transparent pr-24 focus-visible:ring-0 shadow-none"
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,audio/*,.pdf,.txt,.md,.csv,.json"
                onChange={(e) => {
                  if (e.target.files) void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Anexar"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant={recording ? "destructive" : "ghost"}
                className="h-8 w-8"
                onClick={toggleRecording}
                aria-label={recording ? "Parar gravação" : "Gravar áudio"}
              >
                <Mic className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                className="h-8 w-8"
                disabled={!canSend}
                onClick={submitMessage}
                aria-label="Enviar"
              >
                {isThinking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Toda pergunta passa primeiro pelo Brain • Enter envia, Shift+Enter quebra linha
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyConversation({ onSuggest }: { onSuggest: (s: string) => void }) {
  const suggestions = [
    "Quais clientes tiveram mais atividade essa semana?",
    "Resuma os principais insights do Brain",
    "Quais projetos estão em risco?",
    "O que aprendemos sobre briefings recentes?",
  ];
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 text-center">
      <div className="rounded-full bg-primary/10 p-4">
        <Brain className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h2 className="text-2xl font-semibold">Como posso ajudar?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Pergunte sobre clientes, projetos, conteúdo, ou qualquer conhecimento acumulado.
        </p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onSuggest(s)}
            className="rounded-lg border bg-card p-3 text-left text-sm hover:border-primary/40 hover:bg-accent/50 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessageRow }) {
  const isUser = message.role === "user";
  const brain = message.brain_context;
  const tools = message.tool_calls ?? [];
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {isUser ? "Você" : <Brain className="h-4 w-4" />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-2", isUser && "items-end")}>
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.attachments.map((a, i) => (
              <AttachmentPreview key={i} attachment={a} />
            ))}
          </div>
        )}
        {message.content && (
          <div
            className={cn(
              "max-w-full rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
              isUser ? "bg-primary text-primary-foreground" : "bg-muted/60 text-foreground",
            )}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-headings:my-2">
              <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
          </div>
        )}
        {!isUser && brain && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
                <Brain className="h-3 w-3" />
                {brain.used_llm
                  ? `Brain + LLM (${brain.model ?? "modelo"})`
                  : "Resposta direta do Brain"}
                {" · "}
                {brain.memories.length} memórias · {brain.insights.length} insights
                {tools.length > 0 && <> · {tools.length} ações</>}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1">
              <div className="rounded-md border bg-card/50 p-2 text-[11px] space-y-1.5">
                {tools.length > 0 && <ToolCallList tools={tools} />}
                {brain.memories.length > 0 && (
                  <div>
                    <div className="font-medium text-muted-foreground">Memórias usadas</div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {brain.memories.map((m, i) => (
                        <li key={i}>
                          <span className="text-muted-foreground">
                            ({m.event_type} · {(m.similarity * 100).toFixed(0)}%)
                          </span>{" "}
                          {m.summary}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {brain.insights.length > 0 && (
                  <div>
                    <div className="font-medium text-muted-foreground">Insights ativos</div>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {brain.insights.map((m, i) => (
                        <li key={i}>
                          <Badge variant="outline" className="mr-1 text-[9px] px-1 py-0">
                            {m.type}
                          </Badge>
                          {m.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {Object.keys(brain.stats).length > 0 && (
                  <div>
                    <div className="font-medium text-muted-foreground">Contadores</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(brain.stats).map(([k, v]) => (
                        <Badge key={k} variant="secondary" className="text-[9px]">
                          {k}: {v}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

function AttachmentChip({
  name,
  mime,
  uploading,
  onRemove,
}: {
  name: string;
  mime: string;
  uploading: boolean;
  onRemove: () => void;
}) {
  const Icon = mime.startsWith("image/") ? ImageIcon : mime.startsWith("audio/") ? Mic : FileText;
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-2 py-1 text-xs">
      {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      <span className="max-w-[180px] truncate">{name}</span>
      <button
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
        aria-label="Remover"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(attachment.path, 3600)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      alive = false;
    };
  }, [attachment.path]);

  if (attachment.kind === "image" && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={attachment.name}
          className="max-h-64 max-w-xs rounded-lg border object-cover"
        />
      </a>
    );
  }
  if (attachment.kind === "audio" && url) {
    return <audio controls src={url} className="max-w-xs" />;
  }
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs hover:bg-accent"
    >
      <FileText className="h-4 w-4" />
      <span className="max-w-[220px] truncate">{attachment.name}</span>
    </a>
  );
}

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
        <Brain className="h-4 w-4 animate-pulse" />
      </div>
      <div className="max-w-full rounded-2xl bg-muted/60 px-4 py-2.5 text-sm leading-relaxed">
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1">
          <ReactMarkdown>{text}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

function ToolCallList({ tools }: { tools: ChatToolCall[] }) {
  return (
    <div>
      <div className="font-medium text-muted-foreground">Ações executadas</div>
      <ul className="list-disc pl-4 space-y-0.5">
        {tools.map((t, i) => (
          <li key={i}>
            <Badge
              variant={t.ok ? "secondary" : "destructive"}
              className="mr-1 text-[9px] px-1 py-0"
            >
              {t.name}
            </Badge>
            <span className="text-muted-foreground">{t.ok ? "sucesso" : "falha"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
