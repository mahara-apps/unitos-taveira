import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Link2, MessagesSquare, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { LINK_SOURCE_LABEL, normalizeLinkUrl, type LinkSource } from "@/lib/link-source";
import { MAX_MESSAGE_LINKS } from "@/lib/messaging";
import {
  listPortalMessages,
  listPortalThreads,
  markPortalThreadRead,
  sendPortalMessage,
} from "@/lib/portal-messages.functions";
import { formatDateTimeBr } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { usePortalCanInteract, usePortalMode, portalScopeKey } from "./portal-context";
import { EmptyState, ErrorState, ListSkeleton, portalErrorMessage } from "./portal-shared";

/**
 * Mensagens do Portal — só conversas compartilhadas do próprio cliente.
 * Mobile-first: lista e conversa alternam na mesma tela em telas pequenas.
 */
export function PortalMessages() {
  const mode = usePortalMode();
  const canInteract = usePortalCanInteract("messages");
  const clientId = mode.kind === "session" ? mode.clientId : null;
  const scopeKey = portalScopeKey(mode);
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);

  const fetchThreads = useServerFn(listPortalThreads);
  const threadsQ = useQuery({
    queryKey: ["portal", "message-threads", scopeKey],
    queryFn: () => fetchThreads({ data: { clientId: clientId! } }),
    enabled: !!clientId,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  if (!clientId) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="Disponível no acesso com login"
        description="Entre com seu e-mail e senha para conversar com a equipe."
      />
    );
  }

  if (threadsQ.isPending) return <ListSkeleton />;
  if (threadsQ.isError) return <ErrorState message={portalErrorMessage((threadsQ.error as Error).message)} />;

  const threads = threadsQ.data ?? [];
  const active = threads.find((t) => t.id === activeId) ?? null;

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="Nenhuma conversa por aqui"
        description="Quando a equipe abrir uma conversa com você, ela aparece nesta aba."
      />
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div className={cn("space-y-2", active && "hidden lg:block")}>
        {threads.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveId(t.id)}
            className={cn(
              "w-full rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
              t.id === activeId && "border-primary/40 bg-primary/5",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.subject}</span>
              {t.unread > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                  {t.unread > 99 ? "99+" : t.unread}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {t.lastMessagePreview ?? "Sem mensagens ainda"}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {formatDateTimeBr(t.lastMessageAt)}
            </p>
          </button>
        ))}
      </div>

      <div className={cn(!active && "hidden lg:block")}>
        {active ? (
          <PortalThread
            clientId={clientId}
            threadId={active.id}
            subject={active.subject}
            canInteract={canInteract}
            onBack={() => setActiveId(null)}
            onChanged={() =>
              qc.invalidateQueries({ queryKey: ["portal", "message-threads", scopeKey] })
            }
          />
        ) : (
          <EmptyState
            icon={MessagesSquare}
            title="Escolha uma conversa"
            description="Selecione uma conversa ao lado para ver o histórico completo."
          />
        )}
      </div>
    </div>
  );
}

function PortalThread({
  clientId,
  threadId,
  subject,
  canInteract,
  onBack,
  onChanged,
}: {
  clientId: string;
  threadId: string;
  subject: string;
  canInteract: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const fetchMessages = useServerFn(listPortalMessages);
  const send = useServerFn(sendPortalMessage);
  const markRead = useServerFn(markPortalThreadRead);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [body, setBody] = useState("");
  const [links, setLinks] = useState<Array<{ url: string }>>([]);
  const [linkDraft, setLinkDraft] = useState("");

  const queryKey = useMemo(() => ["portal", "messages", threadId], [threadId]);
  const listQ = useQuery({
    queryKey,
    queryFn: () => fetchMessages({ data: { clientId, threadId } }),
    staleTime: 5_000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`portal-messages:${threadId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `thread_id=eq.${threadId}` },
        () => {
          qc.invalidateQueries({ queryKey });
          onChanged();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [threadId, qc, queryKey, onChanged]);

  useEffect(() => {
    markRead({ data: { clientId, threadId } })
      .then(() => onChanged())
      .catch(() => undefined);
  }, [threadId, clientId, markRead, onChanged]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [listQ.data]);

  const mut = useMutation({
    mutationFn: () => send({ data: { clientId, threadId, body: body.trim(), links } }),
    onSuccess: () => {
      setBody("");
      setLinks([]);
      setLinkDraft("");
      qc.invalidateQueries({ queryKey });
      onChanged();
    },
    onError: (e: Error) => toast.error(portalErrorMessage(e.message) ?? "Não conseguimos enviar sua mensagem agora."),
  });

  const addLink = () => {
    const url = normalizeLinkUrl(linkDraft);
    if (!url) {
      toast.error("Informe um endereço válido (ex.: https://drive.google.com/…)");
      return;
    }
    if (links.length >= MAX_MESSAGE_LINKS || links.some((l) => l.url === url)) return;
    setLinks((prev) => [...prev, { url }]);
    setLinkDraft("");
  };

  return (
    <div className="flex min-h-[60dvh] flex-col rounded-xl border border-border/60 bg-card">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{subject}</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {listQ.isPending ? (
          <ListSkeleton />
        ) : listQ.isError ? (
          <ErrorState message={portalErrorMessage((listQ.error as Error).message)} />
        ) : (
          (listQ.data ?? []).map((m) => (
            <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                  m.mine
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/60 bg-muted/40",
                )}
              >
                {!m.mine ? (
                  <p className="mb-0.5 text-[11px] font-medium opacity-80">{m.authorName}</p>
                ) : null}
                {m.removed ? (
                  <p className="italic opacity-70">Mensagem removida</p>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                )}
                {m.links.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {m.links.map((l) => (
                      <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs underline underline-offset-2"
                      >
                        <Link2 className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {l.title ??
                            (LINK_SOURCE_LABEL[l.source as LinkSource] ?? LINK_SOURCE_LABEL.link)}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : null}
                <p className="mt-1 text-[10px] opacity-70">{formatDateTimeBr(m.createdAt)}</p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {canInteract ? (
        <div className="space-y-2 border-t border-border/60 p-3">
          {links.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {links.map((l) => (
                <span
                  key={l.url}
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]"
                >
                  <Link2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{l.url}</span>
                  <button
                    type="button"
                    aria-label="Remover link"
                    onClick={() => setLinks((prev) => prev.filter((x) => x.url !== l.url))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Escreva sua mensagem para a equipe…"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 gap-2">
              <Input
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                placeholder="Colar link (Google Drive, WeTransfer…)"
              />
              <Button type="button" variant="outline" onClick={addLink}>
                <Link2 className="h-4 w-4" />
              </Button>
            </div>
            <Button
              onClick={() => mut.mutate()}
              disabled={!body.trim() || mut.isPending}
              className="sm:w-auto"
            >
              <Send className="mr-1.5 h-4 w-4" />
              Enviar
            </Button>
          </div>
        </div>
      ) : (
        <p className="border-t border-border/60 p-3 text-xs text-muted-foreground">
          Você pode acompanhar esta conversa, mas o envio de mensagens está desativado.
        </p>
      )}
    </div>
  );
}
