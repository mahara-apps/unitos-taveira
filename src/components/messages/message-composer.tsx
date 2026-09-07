/**
 * Composer de mensagem: texto com menções + LINKS (sem anexos, por decisão de
 * produto — não sobrecarregar o banco).
 */
import { useState } from "react";
import { Link2, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MentionTextarea,
  resolveMentions,
  type MentionPerson,
} from "@/components/ui/mention-textarea";
import { LINK_SOURCE_LABEL, detectLinkSource, normalizeLinkUrl } from "@/lib/link-source";
import { MAX_MESSAGE_LINKS, type MessageLink } from "@/lib/messaging";
import { cn } from "@/lib/utils";

export type ComposerPayload = { body: string; links: MessageLink[]; mentions: string[] };

export function MessageComposer({
  people,
  sending,
  disabled,
  placeholder = "Escreva uma mensagem… use @ para mencionar",
  onSend,
  className,
}: {
  people: MentionPerson[];
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onSend: (payload: ComposerPayload) => void;
  className?: string;
}) {
  const [body, setBody] = useState("");
  const [links, setLinks] = useState<MessageLink[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const addLink = () => {
    const url = normalizeLinkUrl(linkDraft);
    if (!url) {
      setLinkError("Informe um endereço válido (ex.: https://drive.google.com/…)");
      return;
    }
    if (links.some((l) => l.url === url)) {
      setLinkError("Esse link já está na mensagem.");
      return;
    }
    if (links.length >= MAX_MESSAGE_LINKS) {
      setLinkError(`Máximo de ${MAX_MESSAGE_LINKS} links por mensagem.`);
      return;
    }
    setLinks((prev) => [...prev, { url, title: null, source: detectLinkSource(url) }]);
    setLinkDraft("");
    setLinkError(null);
  };

  const canSend = !!body.trim() && !sending && !disabled;
  const submit = () => {
    if (!canSend) return;
    onSend({ body: body.trim(), links, mentions: resolveMentions(body, people) });
    setBody("");
    setLinks([]);
    setLinkDraft("");
    setLinkOpen(false);
  };

  return (
    <div className={cn("space-y-2 border-t border-border/60 bg-background/60 p-3", className)}>
      {links.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {links.map((l) => (
            <span
              key={l.url}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs"
            >
              <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate">
                {LINK_SOURCE_LABEL[l.source as keyof typeof LINK_SOURCE_LABEL] ?? "Link"} ·{" "}
                {l.url}
              </span>
              <button
                type="button"
                aria-label="Remover link"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setLinks((prev) => prev.filter((x) => x.url !== l.url))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {linkOpen ? (
        <div className="space-y-1">
          <div className="flex gap-2">
            <Input
              autoFocus
              value={linkDraft}
              placeholder="https://drive.google.com/…"
              onChange={(e) => {
                setLinkDraft(e.target.value);
                setLinkError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={addLink}>
              Adicionar
            </Button>
          </div>
          {linkError ? <p className="text-xs text-destructive">{linkError}</p> : null}
        </div>
      ) : null}

      <MentionTextarea
        value={body}
        onChange={setBody}
        people={people}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-[76px]"
      />

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setLinkOpen((v) => !v)}
        >
          <Link2 className="mr-1.5 h-3.5 w-3.5" />
          {linkOpen ? "Fechar links" : "Inserir link"}
        </Button>
        <Button type="button" size="sm" disabled={!canSend} onClick={submit}>
          {sending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="mr-1.5 h-3.5 w-3.5" />
          )}
          Enviar
        </Button>
      </div>
    </div>
  );
}
