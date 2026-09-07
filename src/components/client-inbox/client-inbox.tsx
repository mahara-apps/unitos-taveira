import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ExternalLink,
  Inbox,
  MessageSquare,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageKpi, PageKpiGrid } from "@/components/ui/page-kpi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTimeBr } from "@/lib/timezone";
import {
  listClientInboxFn,
  replyClientInboxFn,
  type ClientInboxItem,
  type ClientInboxType,
} from "@/lib/client-inbox.functions";
import {
  PORTAL_REQUEST_STATUS_LABEL,
  type PortalRequestStatus,
} from "@/lib/portal-requests.functions";

/**
 * Caixa de entrada da Área do Cliente (lado da equipe).
 *
 * A MESMA lista serve a tela geral (`/inbox`) e a aba "Área do cliente" na
 * ficha do cliente — quando `clientId` vem preenchido, o filtro de cliente
 * desaparece e a conversa fica restrita a ele.
 */

const TYPE_TABS: Array<{ value: "all" | ClientInboxType; label: string }> = [
  { value: "all", label: "Tudo" },
  { value: "request", label: "Pedidos" },
  { value: "comment", label: "Comentários" },
  { value: "decision", label: "Aprovações" },
  { value: "briefing", label: "Briefings" },
];

const TYPE_LABEL: Record<ClientInboxType, string> = {
  request: "Pedido",
  comment: "Comentário",
  decision: "Aprovação",
  briefing: "Briefing",
};

const REPLY_STATUS: PortalRequestStatus[] = [
  "accepted",
  "in_production",
  "info_needed",
  "done",
  "rejected",
];

export function ClientInbox({
  brandId,
  clientId,
  embedded,
}: {
  brandId: string;
  clientId?: string;
  embedded?: boolean;
}) {
  const [type, setType] = useState<"all" | ClientInboxType>("all");
  const [awaitingOnly, setAwaitingOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useServerFn(listClientInboxFn);
  const qc = useQueryClient();
  const queryKey = ["client-inbox", brandId, clientId ?? null, type, awaitingOnly] as const;
  const itemsQ = useQuery({
    queryKey,
    queryFn: () =>
      list({
        data: {
          brandId,
          clientId: clientId ?? null,
          type: type === "all" ? null : type,
          awaitingOnly,
        },
      }),
    staleTime: 20_000,
  });

  const items = itemsQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      [i.title, i.body, i.clientName, i.authorName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [items, search]);

  const awaiting = items.filter((i) => i.awaiting).length;
  const requests = items.filter((i) => i.type === "request").length;
  const conversations = items.filter((i) => i.type === "comment" || i.type === "decision").length;

  const refresh = () => qc.invalidateQueries({ queryKey: ["client-inbox"] });

  return (
    <div className={embedded ? "space-y-5" : "space-y-6"}>
      <PageKpiGrid>
        <PageKpi
          label="Itens recebidos"
          value={items.length}
          icon={<Inbox className="h-4 w-4" />}
          description="Últimos movimentos da área do cliente"
        />
        <PageKpi
          label="Sem resposta"
          value={awaiting}
          status={awaiting > 0 ? "warning" : "success"}
          icon={<MessageSquare className="h-4 w-4" />}
          description="Esperando alguém da equipe"
          onClick={() => setAwaitingOnly((v) => !v)}
          active={awaitingOnly}
        />
        <PageKpi
          label="Pedidos"
          value={requests}
          icon={<Sparkles className="h-4 w-4" />}
          status="info"
        />
        <PageKpi
          label="Conversas e aprovações"
          value={conversations}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </PageKpiGrid>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={type} onValueChange={(v) => setType(v as typeof type)}>
          <TabsList className="flex-wrap">
            {TYPE_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs sm:text-sm">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por cliente ou texto"
            className="h-9 w-full sm:w-64"
          />
          <Button
            variant={awaitingOnly ? "default" : "outline"}
            size="sm"
            className="h-9 shrink-0"
            onClick={() => setAwaitingOnly((v) => !v)}
          >
            Sem resposta
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={refresh}
            aria-label="Atualizar"
          >
            <RefreshCw className={itemsQ.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      {itemsQ.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : itemsQ.isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Não foi possível carregar a caixa de entrada. Tente atualizar.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nada por aqui. Quando o cliente comentar, aprovar, pedir ajuste ou abrir um pedido, aparece
          nesta lista.
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              brandId={brandId}
              showClient={!clientId}
              open={openId === item.id}
              onToggle={() => setOpenId(openId === item.id ? null : item.id)}
              onReplied={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function InboxRow({
  item,
  brandId,
  showClient,
  open,
  onToggle,
  onReplied,
}: {
  item: ClientInboxItem;
  brandId: string;
  showClient: boolean;
  open: boolean;
  onToggle: () => void;
  onReplied: () => void;
}) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<PortalRequestStatus | "keep">("keep");
  const reply = useServerFn(replyClientInboxFn);
  const canReply = item.type === "request" || !!item.postId;

  const replyM = useMutation({
    mutationFn: () =>
      reply({
        data: {
          brandId,
          clientId: item.clientId,
          requestId: item.type === "request" ? item.requestId : null,
          postId: item.type === "request" ? null : item.postId,
          note,
          status: item.type === "request" && status !== "keep" ? status : null,
        },
      }),
    onSuccess: () => {
      setNote("");
      setStatus("keep");
      toast.success("Resposta enviada ao cliente");
      onReplied();
    },
    onError: (e) => toast.error("Não foi possível responder", { description: String(e) }),
  });

  return (
    <li className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-[11px]">
              {TYPE_LABEL[item.type]}
            </Badge>
            {showClient && item.clientName ? (
              <span className="text-xs font-medium text-muted-foreground">{item.clientName}</span>
            ) : null}
            {item.type === "request" && item.status ? (
              <Badge variant="outline" className="text-[11px]">
                {PORTAL_REQUEST_STATUS_LABEL[item.status as PortalRequestStatus] ?? item.status}
              </Badge>
            ) : null}
            {item.awaiting ? (
              <Badge className="bg-severity-warning/15 text-[11px] text-severity-warning hover:bg-severity-warning/15">
                Sem resposta
              </Badge>
            ) : null}
          </div>
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          {item.body ? (
            <p className="line-clamp-3 text-sm text-muted-foreground">{item.body}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {item.authorName ? `${item.authorName} · ` : ""}
            {formatDateTimeBr(item.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5">
            <Link to={item.href as never}>
              Abrir
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
          {canReply ? (
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onToggle}>
              <MessageSquare className="h-3.5 w-3.5" />
              Responder
            </Button>
          ) : null}
        </div>
      </div>

      {open && canReply ? (
        <div className="mt-4 space-y-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Escreva a resposta que o cliente vai ver na área dele…"
            rows={3}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {item.type === "request" ? (
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger className="h-9 w-full sm:w-56">
                  <SelectValue placeholder="Manter situação" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Manter situação</SelectItem>
                  {REPLY_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {PORTAL_REQUEST_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground">
                A resposta aparece na conversa do conteúdo, na área do cliente.
              </span>
            )}
            <Button
              size="sm"
              className="h-9 gap-1.5"
              disabled={!note.trim() || replyM.isPending}
              onClick={() => replyM.mutate()}
            >
              <Send className="h-3.5 w-3.5" />
              {replyM.isPending ? "Enviando…" : "Enviar resposta"}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
