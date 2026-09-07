import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, Link2, Paperclip, Plus, Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  cancelPortalRequestFn,
  commentPortalRequestFn,
  createPortalRequestFn,
  getPortalRequestFn,
  listPortalRequestsFn,
  MAX_REQUEST_LINKS,
  PORTAL_REQUEST_STATUS_LABEL,
  type PortalRequest,
  type PortalRequestLink,
  type PortalRequestStatus,
} from "@/lib/portal-requests.functions";
import {
  LINK_SOURCE_LABEL,
  detectLinkSource,
  linkFallbackLabel,
  normalizeLinkUrl,
  type LinkSource,
} from "@/lib/link-source";
import { usePortalCanInteract, usePortalMode } from "./portal-context";
import { EmptyState, ErrorState, ListSkeleton, formatDate, portalErrorMessage } from "./portal-shared";

/**
 * Pedidos do cliente — o cliente abre uma solicitação, acompanha a situação e
 * conversa com a equipe. Só existe no acesso com login: no link sem senha o
 * botão de novo pedido não aparece e o servidor recusa qualquer escrita.
 */

const STATUS_TONE: Record<PortalRequestStatus, string> = {
  submitted: "border-border/60 bg-muted/50 text-foreground",
  info_needed: "border-severity-warning/40 bg-severity-warning/10 text-severity-warning",
  accepted: "border-primary/30 bg-primary/10 text-primary",
  in_production: "border-primary/30 bg-primary/10 text-primary",
  done: "border-severity-success/40 bg-severity-success/10 text-severity-success",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
  cancelled: "border-border/60 bg-muted/40 text-muted-foreground",
};

const OPEN_STATUS: PortalRequestStatus[] = ["submitted", "info_needed", "accepted", "in_production"];

function StatusChip({ status }: { status: PortalRequestStatus }) {
  return (
    <span
      className={`w-fit rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[status]}`}
    >
      {PORTAL_REQUEST_STATUS_LABEL[status]}
    </span>
  );
}

function sourceLabel(source: string): string {
  return LINK_SOURCE_LABEL[source as LinkSource] ?? LINK_SOURCE_LABEL.link;
}

/** Lista de links de um pedido, clicáveis e com o serviço reconhecido. */
function RequestLinkList({ links }: { links: PortalRequestLink[] }) {
  if (!links.length) return null;
  return (
    <ul className="space-y-1.5">
      {links.map((l) => (
        <li key={l.url}>
          <a
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2 transition-colors hover:bg-muted/50"
          >
            <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {l.title ?? linkFallbackLabel(l.url)}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {sourceLabel(l.source)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function PortalRequests() {
  const mode = usePortalMode();
  const clientId = mode.kind === "session" ? mode.clientId : "";
  const canInteract = usePortalCanInteract("requests");
  const queryClient = useQueryClient();

  const list = useServerFn(listPortalRequestsFn);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["portal", "requests", clientId],
    queryFn: () => list({ data: { clientId } }),
    enabled: mode.kind === "session",
  });

  const rows = useMemo(() => {
    const all = q.data ?? [];
    return filter === "open" ? all.filter((r) => OPEN_STATUS.includes(r.status)) : all;
  }, [q.data, filter]);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["portal", "requests", clientId] });

  if (mode.kind !== "session") {
    return (
      <EmptyState
        icon={Inbox}
        title="Pedidos exigem login"
        description="Entre com seu e-mail e senha para abrir e acompanhar solicitações."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {(["open", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === f
                  ? "border-foreground/20 bg-foreground text-background"
                  : "border-border/60 bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "open" ? "Em andamento" : "Todos"}
            </button>
          ))}
        </div>
        {canInteract ? (
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Novo pedido
          </Button>
        ) : null}
      </div>

      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState
          description="Não conseguimos carregar seus pedidos agora."
          message={(q.error as Error)?.message}
          onRetry={() => void q.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={filter === "open" ? "Nenhum pedido em andamento" : "Nenhum pedido ainda"}
          description={
            canInteract
              ? "Abra um pedido para solicitar um material, ajuste ou campanha à equipe."
              : "Quando a equipe registrar solicitações, elas aparecem aqui."
          }
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpenId(r.id)}
                className="flex w-full flex-col gap-2 px-4 py-4 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="truncate text-sm font-medium">{r.title}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>Aberto em {formatDate(r.createdAt)}</span>
                    {r.desiredDueAt ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>Prazo desejado {formatDate(r.desiredDueAt)}</span>
                      </>
                    ) : null}
                    {r.links.length ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Link2 className="h-3 w-3" /> {r.links.length}
                        </span>
                      </>
                    ) : null}
                    {r.attachments.length ? (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="h-3 w-3" /> {r.attachments.length}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <StatusChip status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <NewRequestDialog
          clientId={clientId}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      ) : null}

      {openId ? (
        <RequestDetailDialog
          clientId={clientId}
          requestId={openId}
          canInteract={canInteract}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      ) : null}
    </div>
  );
}

function NewRequestDialog({
  clientId,
  onClose,
  onDone,
}: {
  clientId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const create = useServerFn(createPortalRequestFn);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [links, setLinks] = useState<PortalRequestLink[]>([]);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");

  const addLink = () => {
    if (links.length >= MAX_REQUEST_LINKS) {
      toast.error(`Você pode enviar até ${MAX_REQUEST_LINKS} links.`);
      return;
    }
    const url = normalizeLinkUrl(linkUrl);
    if (!url) {
      toast.error("Cole um endereço completo, como https://drive.google.com/...");
      return;
    }
    if (links.some((l) => l.url === url)) {
      toast.info("Esse link já está na lista.");
      setLinkUrl("");
      setLinkTitle("");
      return;
    }
    setLinks((prev) => [
      ...prev,
      { url, title: linkTitle.trim() || null, source: detectLinkSource(url) },
    ]);
    setLinkUrl("");
    setLinkTitle("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      return create({
        data: {
          clientId,
          title: title.trim(),
          description: description.trim() || undefined,
          desiredDueAt: due ? new Date(`${due}T12:00:00`).toISOString() : null,
          links: links.map((l) => ({ url: l.url, title: l.title ?? undefined })),
        },
      });
    },
    onSuccess: () => {
      toast.success("Pedido enviado para a equipe");
      onDone();
    },
    onError: (e: Error) => toast.error(portalErrorMessage(e.message)),
  });

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo pedido</DialogTitle>
          <DialogDescription>
            Conte o que você precisa. A equipe recebe o aviso na hora e responde por aqui.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="req-title">O que você precisa?</Label>
            <Input
              id="req-title"
              value={title}
              maxLength={160}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: post de lançamento da coleção nova"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-desc">Detalhes</Label>
            <Textarea
              id="req-desc"
              value={description}
              maxLength={4000}
              rows={5}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Referências, tom, informações obrigatórias, links…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="req-due">Prazo desejado (opcional)</Label>
            <Input
              id="req-due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="req-link">Links de referência (até {MAX_REQUEST_LINKS})</Label>
            <p className="text-xs text-muted-foreground">
              Compartilhe pastas ou arquivos por link (Google Drive, Docs, Figma, Dropbox,
              WeTransfer…). Confira se o link está liberado para a equipe abrir.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="req-link"
                value={linkUrl}
                inputMode="url"
                maxLength={2000}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                  }
                }}
                placeholder="https://drive.google.com/..."
                className="sm:flex-[3]"
              />
              <Input
                value={linkTitle}
                maxLength={160}
                onChange={(e) => setLinkTitle(e.target.value)}
                placeholder="Nome (opcional)"
                className="sm:flex-[2]"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={addLink}
              >
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </div>
            {links.length ? (
              <ul className="space-y-1.5">
                {links.map((l) => (
                  <li
                    key={l.url}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {l.title ?? linkFallbackLabel(l.url)}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {sourceLabel(l.source)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remover ${l.title ?? l.url}`}
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                      onClick={() => setLinks((prev) => prev.filter((x) => x.url !== l.url))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="gap-1.5"
            disabled={title.trim().length < 3 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Send className="h-4 w-4" /> Enviar pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequestDetailDialog({
  clientId,
  requestId,
  canInteract,
  onClose,
  onChanged,
}: {
  clientId: string;
  requestId: string;
  canInteract: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const load = useServerFn(getPortalRequestFn);
  const comment = useServerFn(commentPortalRequestFn);
  const cancelReq = useServerFn(cancelPortalRequestFn);
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const q = useQuery({
    queryKey: ["portal", "request", clientId, requestId],
    queryFn: () => load({ data: { clientId, requestId } }),
  });

  const refetchDetail = () =>
    void queryClient.invalidateQueries({ queryKey: ["portal", "request", clientId, requestId] });

  const send = useMutation({
    mutationFn: () => comment({ data: { clientId, requestId, note: note.trim() } }),
    onSuccess: () => {
      setNote("");
      toast.success("Comentário enviado");
      refetchDetail();
      onChanged();
    },
    onError: (e: Error) => toast.error(portalErrorMessage(e.message)),
  });

  const cancel = useMutation({
    mutationFn: () => cancelReq({ data: { clientId, requestId } }),
    onSuccess: () => {
      toast.success("Pedido cancelado");
      refetchDetail();
      onChanged();
    },
    onError: (e: Error) => toast.error(portalErrorMessage(e.message)),
  });

  const request: PortalRequest | undefined = q.data?.request;

  return (
    <Dialog open onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{request?.title ?? "Pedido"}</DialogTitle>
          <DialogDescription>
            {request ? `Aberto em ${formatDate(request.createdAt)}` : "Carregando…"}
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <ListSkeleton />
        ) : q.isError || !request ? (
          <ErrorState
            description="Não conseguimos abrir este pedido."
            message={(q.error as Error)?.message}
            onRetry={() => void q.refetch()}
          />
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={request.status} />
              {request.desiredDueAt ? (
                <span className="text-xs text-muted-foreground">
                  Prazo desejado: {formatDate(request.desiredDueAt)}
                </span>
              ) : null}
            </div>

            {request.description ? (
              <p className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
                {request.description}
              </p>
            ) : null}

            {request.links.length ? (
              <div className="space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Links
                </div>
                <RequestLinkList links={request.links} />
              </div>
            ) : null}

            {request.attachments.length ? (
              <div className="flex flex-wrap gap-2">
                {request.attachments.map((a) => (
                  <a
                    key={a.path}
                    href={a.url ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-xs hover:bg-muted/50"
                  >
                    <Paperclip className="h-3 w-3" /> {a.name}
                  </a>
                ))}
              </div>
            ) : null}

            <div className="space-y-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Histórico
              </div>
              <ol className="space-y-3 border-l border-border/60 pl-4">
                {(q.data?.events ?? []).map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <div className="text-xs text-muted-foreground">
                      {e.actorName ?? (e.actorSide === "client" ? "Você" : "Equipe")} ·{" "}
                      {formatDate(e.createdAt)}
                    </div>
                    {e.note ? <div className="mt-0.5 whitespace-pre-wrap text-sm">{e.note}</div> : null}
                  </li>
                ))}
              </ol>
            </div>

            {canInteract ? (
              <div className="space-y-2">
                <Label htmlFor="req-note">Adicionar comentário</Label>
                <Textarea
                  id="req-note"
                  rows={3}
                  value={note}
                  maxLength={4000}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Escreva uma atualização para a equipe"
                />
                <div className="flex flex-wrap justify-between gap-2">
                  {["submitted", "info_needed"].includes(request.status) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-muted-foreground"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate()}
                    >
                      <X className="h-4 w-4" /> Cancelar pedido
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!note.trim() || send.isPending}
                    onClick={() => send.mutate()}
                  >
                    <Send className="h-4 w-4" /> Enviar
                  </Button>
                </div>
              </div>
            ) : (
              <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                Este acesso é somente de acompanhamento.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
