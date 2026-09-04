/**
 * Bloco "Links e referências" reutilizado em projeto, job, tarefa, peça e
 * pauta. Somente links (URL) — upload de arquivo não faz parte deste recurso.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addWorkLinkFn,
  deleteWorkLinkFn,
  listWorkLinksFn,
  type WorkLink,
  type WorkLinkTarget,
} from "@/lib/work-links.functions";
import { LINK_SOURCE_LABEL, linkFallbackLabel, normalizeLinkUrl } from "@/lib/link-source";
import { APP_TIMEZONE } from "@/lib/timezone";

function sourceLabel(source: string) {
  return LINK_SOURCE_LABEL[source as keyof typeof LINK_SOURCE_LABEL] ?? "Link";
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  });
}

export function WorkLinkList({
  links,
  onRemove,
  removingId,
  emptyLabel = "Nenhum link ainda.",
}: {
  links: WorkLink[];
  onRemove?: (link: WorkLink) => void;
  removingId?: string | null;
  emptyLabel?: string;
}) {
  if (links.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {links.map((l) => (
        <li
          key={l.id}
          className="group flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5"
        >
          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-xs font-medium hover:underline"
            title={l.url}
          >
            {l.title?.trim() || linkFallbackLabel(l.url)}
          </a>
          <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
            {sourceLabel(l.source)}
          </Badge>
          {l.created_by_client ? (
            <Badge variant="secondary" className="h-5 shrink-0 text-[10px]">
              cliente
            </Badge>
          ) : null}
          <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
            {l.author_name ? `${l.author_name} · ` : ""}
            {formatWhen(l.created_at)}
          </span>
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Abrir link"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {onRemove ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0 opacity-0 transition group-hover:opacity-100"
              aria-label="Remover link"
              disabled={removingId === l.id}
              onClick={() => onRemove(l)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function WorkLinkForm({
  onSubmit,
  pending,
  compact,
}: {
  onSubmit: (url: string, title: string) => void;
  pending?: boolean;
  compact?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const submit = () => {
    const normalized = normalizeLinkUrl(url);
    if (!normalized) {
      toast.error("Informe uma URL válida (https://…)");
      return;
    }
    onSubmit(normalized, title.trim());
    setUrl("");
    setTitle("");
  };

  return (
    <div className={compact ? "flex flex-col gap-1.5" : "flex flex-col gap-1.5 sm:flex-row"}>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Cole o link (Google Drive, Figma…)"
        className="h-8 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Rótulo (opcional)"
        className="h-8 text-xs sm:max-w-[180px]"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button size="sm" className="h-8 shrink-0 text-xs" onClick={submit} disabled={pending}>
        {pending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Plus className="mr-1 h-3.5 w-3.5" />
        )}
        Adicionar
      </Button>
    </div>
  );
}

/** Versão conectada às server functions (uso interno, autenticado). */
export function WorkLinks({
  target,
  targetId,
  title = "Links e referências",
  readOnly,
  className,
}: {
  target: WorkLinkTarget;
  targetId: string;
  title?: string;
  readOnly?: boolean;
  className?: string;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listWorkLinksFn);
  const add = useServerFn(addWorkLinkFn);
  const del = useServerFn(deleteWorkLinkFn);
  const key = ["work-links", target, targetId];

  const q = useQuery({
    queryKey: key,
    queryFn: () => list({ data: { target, targetId } }),
    enabled: !!targetId,
  });

  const addMut = useMutation({
    mutationFn: (v: { url: string; title: string }) =>
      add({ data: { target, targetId, url: v.url, title: v.title || undefined } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
      toast.success("Link adicionado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (linkId: string) => del({ data: { linkId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {q.data && q.data.length > 0 ? (
          <span className="text-[10px] text-muted-foreground">{q.data.length}</span>
        ) : null}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : (
        <WorkLinkList
          links={q.data ?? []}
          removingId={delMut.isPending ? delMut.variables : null}
          onRemove={readOnly ? undefined : (l) => delMut.mutate(l.id)}
        />
      )}
      {readOnly ? null : (
        <div className="mt-2">
          <WorkLinkForm
            pending={addMut.isPending}
            onSubmit={(url, t) => addMut.mutate({ url, title: t })}
          />
        </div>
      )}
    </div>
  );
}
