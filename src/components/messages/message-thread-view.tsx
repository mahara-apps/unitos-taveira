/**
 * Painel de uma conversa: cabeçalho com contexto/visibilidade, histórico
 * completo (nada é apagado — mensagem removida vira placeholder) e composer.
 */
import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Lock, MessagesSquare, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MentionText } from "@/components/ui/mention-text";
import type { MentionPerson } from "@/components/ui/mention-textarea";
import { MessageComposer } from "@/components/messages/message-composer";
import { supabase } from "@/integrations/supabase/client";
import { listMessages, markThreadRead, removeMessage, sendMessage } from "@/lib/messaging.functions";
import {
  VISIBILITY_LABEL,
  dmTitle,
  threadContextLabel,
  type MessageItem,
  type ThreadSummary,
} from "@/lib/messaging";
import { LINK_SOURCE_LABEL } from "@/lib/link-source";
import { displayName, initialsOf } from "@/lib/identity";
import { formatDateTimeBr } from "@/lib/timezone";

export function MessageThreadView({
  thread,
  currentUserId,
  people,
  onChanged,
}: {
  thread: ThreadSummary;
  currentUserId: string;
  people: MentionPerson[];
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const fetchMessages = useServerFn(listMessages);
  const send = useServerFn(sendMessage);
  const markRead = useServerFn(markThreadRead);
  const remove = useServerFn(removeMessage);
  const bottomRef = useRef<HTMLDivElement>(null);
  const queryKey = useMemo(() => ["messages", thread.id], [thread.id]);

  const listQ = useQuery({
    queryKey,
    queryFn: () => fetchMessages({ data: { threadId: thread.id, limit: 200 } }),
    staleTime: 5_000,
  });
  const messages = listQ.data ?? [];

  // Realtime: novas mensagens da conversa aberta chegam sem recarregar.
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${thread.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `thread_id=eq.${thread.id}` },
        () => {
          qc.invalidateQueries({ queryKey });
          onChanged?.();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [thread.id, qc, queryKey, onChanged]);

  // Abrir a conversa zera as não lidas dela.
  useEffect(() => {
    markRead({ data: { threadId: thread.id } })
      .then(() => onChanged?.())
      .catch(() => undefined);
  }, [thread.id, markRead, onChanged]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const sendMut = useMutation({
    mutationFn: (payload: { body: string; links: MessageItem["links"]; mentions: string[] }) =>
      send({
        data: {
          threadId: thread.id,
          body: payload.body,
          links: payload.links.map((l) => ({ url: l.url, title: l.title })),
          mentions: payload.mentions,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      onChanged?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: (messageId: string) => remove({ data: { messageId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const title = thread.scope === "team_dm" ? dmTitle(thread, currentUserId) : thread.subject;
  const shared = thread.visibility === "shared_with_client";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-background/60 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{threadContextLabel(thread)}</p>
        </div>
        <Badge variant={shared ? "default" : "secondary"} className="gap-1">
          {shared ? <Users className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {VISIBILITY_LABEL[thread.visibility]}
        </Badge>
        <Badge variant="outline" className="gap-1">
          <MessagesSquare className="h-3 w-3" />
          {thread.participants.length} participante{thread.participants.length === 1 ? "" : "s"}
        </Badge>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {listQ.isPending ? (
          <>
            <Skeleton className="h-16 w-2/3 rounded-lg" />
            <Skeleton className="ml-auto h-16 w-1/2 rounded-lg" />
          </>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma mensagem ainda. Comece a conversa abaixo.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.authorId === currentUserId;
            return (
              <div key={m.id} className="flex gap-2.5">
                <Avatar className="h-8 w-8 shrink-0">
                  {m.authorAvatarUrl ? <AvatarImage src={m.authorAvatarUrl} alt="" /> : null}
                  <AvatarFallback className="text-[10px]">
                    {initialsOf({ full_name: m.authorName, email: m.authorEmail })}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium">
                      {displayName({ full_name: m.authorName, email: m.authorEmail }, "Usuário")}
                    </span>
                    {m.authorKind === "portal_client" ? (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        Cliente
                      </Badge>
                    ) : null}
                    <span className="text-[10px] text-muted-foreground">
                      {formatDateTimeBr(m.createdAt)}
                    </span>
                    {mine && !m.removedAt ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-6 w-6 text-muted-foreground"
                        aria-label="Remover mensagem"
                        onClick={() => removeMut.mutate(m.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                  {m.removedAt ? (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      Mensagem removida pelo autor.
                    </p>
                  ) : (
                    <div className="mt-1 whitespace-pre-wrap break-words text-sm">
                      <MentionText text={m.body} people={people} />
                    </div>
                  )}
                  {m.links.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {m.links.map((l) => (
                        <li key={l.url}>
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-xs hover:bg-muted/60"
                          >
                            <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">
                              {l.title ??
                                LINK_SOURCE_LABEL[l.source as keyof typeof LINK_SOURCE_LABEL] ??
                                l.url}
                            </span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <MessageComposer
        people={people}
        sending={sendMut.isPending}
        onSend={(payload) => sendMut.mutate(payload)}
      />
    </div>
  );
}
