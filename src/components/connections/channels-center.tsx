import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronDown,
  Copy,
  Facebook,
  History,
  Instagram,
  Link2,
  Loader2,
  MoreHorizontal,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  Unlink,
  Unplug,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MetaPortfolioDialog } from "@/components/connections/meta-portfolio-dialog";
import { ConnectChannelsDialog } from "@/components/connections/connect-channels-dialog";
import { MetaPortfoliosPanel } from "@/components/connections/meta-portfolios-panel";

import {
  CHANNEL_ICON_SIZE,
  CONNECTABLE_CHANNELS,
  UPCOMING_CHANNELS,
  channelDef,
  formatRelative,
} from "@/components/connections/channel-meta";
import {
  listWorkspaceChannelsFn,
  toggleClientChannelFn,
  type WorkspaceChannel,
} from "@/lib/client-channels.functions";
import { listClients } from "@/lib/workspace.functions";
import { WhatsappCenter } from "./whatsapp-center";
import { disconnectMeta, getActiveMetaSession, startMetaOAuth } from "@/lib/meta/meta.functions";
import {
  applyMetaReconnectFn,
  inspectMetaConnectionFn,
  type InspectResult,
} from "@/lib/meta/reconnect.functions";
import {
  listDiscoveredMetaAccountsFn,
  reconcileMetaConnectionFn,
  type DiscoveredAccountsResult,
} from "@/lib/meta/discovery.functions";
import { metaIssueToast } from "@/lib/meta/issue-messages";
import {
  busyChannel,
  classifyConnectFailure,
  readAuthorizeUrl,
  type MetaConnectState,
} from "@/lib/meta/connect-flow";

/** Limite duro de espera pelo consentimento antes de virar estado de timeout. */
const OAUTH_TIMEOUT_MS = 4 * 60_000;
import { maskId } from "@/lib/meta/reconnect-diagnosis";
import { linkMetaAccount } from "@/lib/meta/portfolio.functions";
import {
  disconnectMetaPortfolioFn,
  getMetaPortfolioStatusFn,
  type MetaPortfolioSummary,
} from "@/lib/meta/portfolio-admin.functions";
import { listChannelHistoryFn, recordChannelEventFn } from "@/lib/channels-center.functions";
import { listEvolutionInstances } from "@/lib/evolution-instances.functions";
import {
  ChannelStatusLegend,
  ClientsChannelsTable,
} from "@/components/connections/clients-channels-table";
import { cn } from "@/lib/utils";

/**
 * Central de Canais (Integrações → Canais).
 *
 * Apresentação e orquestração de UI apenas: banco, RLS, OAuth, criptografia e
 * workers permanecem intocados. As regras de negócio continuam nos server
 * functions existentes (`toggleClientChannelFn` para vínculo exclusivo,
 * `disconnectMeta` para remoção, `applyMetaReconnectFn` para reconexão
 * explícita — que nunca troca a conta sem confirmação do usuário).
 */

/* --------------------------------- status -------------------------------- */

type ChannelState = "ready" | "auth" | "unavailable" | "disconnected";

const STATE_META: Record<ChannelState, { label: string; hint: string; className: string }> = {
  ready: {
    label: "Pronto",
    hint: "Autorizado para publicar",
    className: "border-health-good/30 bg-health-good/10 text-health-good",
  },
  auth: {
    label: "Atenção",
    hint: "Autorização precisa ser renovada",
    className: "border-severity-warning/30 bg-severity-warning/10 text-severity-warning",
  },
  unavailable: {
    label: "Não disponível",
    hint: "A Meta não está aceitando esta conta agora",
    className: "border-severity-critical/30 bg-severity-critical/10 text-severity-critical",
  },
  disconnected: {
    label: "Desconectado",
    hint: "Sem conexão ativa",
    className: "border-border bg-muted/40 text-muted-foreground",
  },
};

function channelState(row: WorkspaceChannel): ChannelState {
  if (row.status === "active") return row.lastError ? "auth" : "ready";
  if (row.status === "attention" || row.status === "expired") return "auth";
  if (row.status === "revoked" || row.status === "error") return "unavailable";
  return "disconnected";
}

function StatusBadge({ state }: { state: ChannelState }) {
  const m = STATE_META[state];
  return (
    <Badge
      variant="outline"
      title={m.hint}
      className={cn("h-5 gap-1 px-1.5 text-[11px] font-medium", m.className)}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
    </Badge>
  );
}

function CopyableId({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      className="group flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      title={`${label}: ${value}`}
    >
      <span className="shrink-0 uppercase tracking-wide">{label}</span>
      <span className="truncate font-mono">{value}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-health-good" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  );
}

/* --------------------------------- center -------------------------------- */

/** Tipo da conta (complemento discreto, nunca o nome do canal). */
function accountTypeLabel(channel: string): string {
  if (channel === "instagram") return "Instagram Business";
  if (channel === "facebook") return "Página do Facebook";
  return channelDef(channel).label;
}

export function ChannelsCenter({
  brandId,
  canManage,
}: {
  brandId: string | null;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listWorkspaceChannelsFn);
  const historyFn = useServerFn(listChannelHistoryFn);
  const clientsFn = useServerFn(listClients);
  const startMetaFn = useServerFn(startMetaOAuth);
  const activeSessionFn = useServerFn(getActiveMetaSession);

  const [tab, setTab] = useState<"meta" | "whatsapp">("meta");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [portfolioDetailsOpen, setPortfolioDetailsOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [flow, setFlow] = useState<MetaConnectState>({ kind: "idle" });
  /** Compat: controles que só precisam saber "há autorização em andamento". */
  const connecting = busyChannel(flow);
  const pollRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const flowRef = useRef<"facebook" | "instagram" | null>(null);
  const [portfolioSessionId, setPortfolioSessionId] = useState<string | null>(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  /** Etapa 02 ("Ativos") renderizada dentro do modal "Conectar canais". */
  const [assetsStep, setAssetsStep] = useState(false);
  const [portfolioChannel, setPortfolioChannel] = useState<"facebook" | "instagram" | null>(null);
  const [manage, setManage] = useState<WorkspaceChannel | null>(null);
  const [linkTarget, setLinkTarget] = useState<WorkspaceChannel | null>(null);
  const [reconnectTarget, setReconnectTarget] = useState<WorkspaceChannel | null>(null);
  const [linkDiscovered, setLinkDiscovered] = useState<
    DiscoveredAccountsResult["accounts"][number] | null
  >(null);
  const reauthRef = useRef(false);
  const discoverFn = useServerFn(listDiscoveredMetaAccountsFn);

  const { data: channels = [], isLoading } = useQuery({
    queryKey: ["workspace-channels", brandId],
    queryFn: () => listFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 30_000,
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ["channel-history", brandId],
    queryFn: () => historyFn({ data: { brandId: brandId! } }),
    enabled: !!brandId && historyOpen,
    staleTime: 60_000,
  });

  const {
    data: discovery,
    isLoading: loadingDiscovery,
    isFetching: fetchingDiscovery,
  } = useQuery({
    queryKey: ["meta-discovered-accounts", brandId],
    queryFn: () => discoverFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 120_000,
    // Requisição da Meta NUNCA é repetida automaticamente: um retry silencioso
    // dobrava o custo de uma descoberta inteira ao primeiro erro.
    retry: false,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["clients", brandId],
    queryFn: () => clientsFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  const instancesFn = useServerFn(listEvolutionInstances);
  const { data: whatsappInstances = [] } = useQuery({
    queryKey: ["evolution-instances", brandId],
    queryFn: () => instancesFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  const portfolioStatusFn = useServerFn(getMetaPortfolioStatusFn);
  const { data: portfolioStatus, isLoading: loadingPortfolio } = useQuery({
    queryKey: ["meta-portfolio-status", brandId],
    queryFn: () => portfolioStatusFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 30_000,
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["workspace-channels", brandId] });
    qc.invalidateQueries({ queryKey: ["channel-history", brandId] });
    qc.invalidateQueries({ queryKey: ["meta-connections", brandId] });
    qc.invalidateQueries({ queryKey: ["connections", brandId] });
    qc.invalidateQueries({ queryKey: ["meta-discovered-accounts", brandId] });
    qc.invalidateQueries({ queryKey: ["meta-portfolio-status", brandId] });
  };

  /**
   * Revoga a autorização Meta do workspace mesmo quando nenhum canal foi
   * vinculado. Sem isso, as contas descobertas pela autorização anterior
   * continuariam listadas como "disponíveis".
   */
  const revokeAuthFn = useServerFn(disconnectMetaPortfolioFn);
  const revokeAuthMut = useMutation({
    mutationFn: () => revokeAuthFn({ data: { brandId: brandId!, ownerExternalId: null } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Autorização Meta revogada.", { description: res.message });
      invalidate();
    },
    onError: () => toast.error("Não foi possível revogar a autorização Meta."),
  });

  /**
   * Nova varredura na Meta.
   *
   * O botão "Sincronizar" observava a query key BASE, mas a varredura rodava em
   * `[..., "refresh"]`: o botão nunca desabilitava e cada clique disparava uma
   * descoberta completa. Agora há um guard explícito de reentrada e o estado
   * de "sincronizando" é o real.
   */
  const refreshingRef = useRef(false);
  const [manualSyncing, setManualSyncing] = useState(false);
  function refreshDiscovery(fullDiscovery = false) {
    if (refreshingRef.current || !brandId) return;
    refreshingRef.current = true;
    setManualSyncing(true);
    void qc
      .fetchQuery({
        queryKey: ["meta-discovered-accounts", brandId, "refresh", fullDiscovery],
        queryFn: () =>
          discoverFn({ data: { brandId: brandId!, refresh: true, fullDiscovery } }),
        retry: false,
      })
      .then((r) => {
        qc.setQueryData(["meta-discovered-accounts", brandId], r);
        // Erro técnico da Meta NÃO vai para toast: o detalhe fica no alerta da seção.
        if (r.error) {
          const m = metaIssueToast(r.error);
          toast.warning(m.title, { description: m.description, duration: 8000 });
        } else toast.success(`${r.accounts.length} conta(s) disponível(is).`);
      })
      .catch((e) => {
        const m = metaIssueToast(e);
        toast.error(m.title, { description: m.description, duration: 8000 });
      })
      .finally(() => {
        refreshingRef.current = false;
        setManualSyncing(false);
      });
  }

  /**
   * Limpa popup + watchdogs. Toda saída do estado "em andamento" passa por aqui,
   * garantindo que o modal nunca permaneça indefinidamente em loading.
   */
  const clearWatchdogs = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    pollRef.current = null;
    timeoutRef.current = null;
  }, []);

  /** Conclui a autorização (terminal) a partir de uma sessão Meta válida. */
  const finishAuthorized = useCallback(
    (channel: "facebook" | "instagram", sessionId: string) => {
      if (reauthRef.current) {
        setFlow({ kind: "idle" });
        return;
      }
      setFlow({ kind: "authorized", channel, sessionId });
      setPortfolioSessionId(sessionId);
      setPortfolioChannel(channel);
      qc.invalidateQueries({ queryKey: ["meta-discovered-accounts", brandId] });
      qc.invalidateQueries({ queryKey: ["meta-portfolio-status", brandId] });
      // Caminho ÚNICO: a seleção de contas acontece sempre dentro de
      // "Conectar canais" (etapa Ativos) — nunca em um segundo modal paralelo.
      setPortfolioOpen(false);
      setConnectOpen(true);
      setAssetsStep(true);
    },
    [brandId, connectOpen, qc],
  );

  /**
   * A janela fechou sem `postMessage` recebido. Isso NÃO significa cancelamento:
   * COOP/bloqueadores podem cortar o `window.opener`, ou a origem do
   * META_REDIRECT_URI pode divergir da origem atual. Antes de marcar como
   * cancelado, confirmamos no servidor se existe sessão Meta ativa.
   */
  const resolveClosedPopup = useCallback(
    async (channel: "facebook" | "instagram") => {
      if (!brandId) return;
      let sessionId: string | null = null;
      try {
        const res = await activeSessionFn({ data: { brandId } });
        sessionId = res?.sessionId ?? null;
      } catch {
        sessionId = null;
      }
      setFlow((prev) => {
        if (prev.kind !== "awaiting" && prev.kind !== "returning") return prev;
        if (sessionId) return prev; // resolvido abaixo por finishAuthorized
        return { kind: "error", channel, reason: "cancelled", detail: null };
      });
      if (sessionId) finishAuthorized(channel, sessionId);
    },
    [activeSessionFn, brandId, finishAuthorized],
  );

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const d = ev.data as {
        source?: string;
        type?: string;
        ok?: boolean;
        error?: string;
        message?: string;
        sessionId?: string | null;
        channel?: "facebook" | "instagram" | null;
        scopes?: string[];
      };
      if (!d || d.source !== "meta-oauth") return;
      if (d.type === "missing-scopes" && d.scopes?.length) {
        toast.warning(
          "Algumas permissões não foram concedidas. Refaça a autorização marcando todas as páginas e contas desejadas.",
          { duration: 8000 },
        );
        return;
      }
      clearWatchdogs();
      const channel = d.channel ?? flowRef.current;
      if (d.ok && d.sessionId && reauthRef.current) {
        setFlow({ kind: "idle" });
        return;
      }
      if (d.ok && d.sessionId) {
        // Autorização é terminal aqui: a SINCRONIZAÇÃO dos ativos é etapa
        // separada e não pode bloquear a confirmação para o usuário.
        finishAuthorized(channel ?? "facebook", d.sessionId);
      } else {
        const detail = d.error ?? d.message ?? null;
        console.warn("[meta-oauth] falha na autorização:", detail);
        setFlow({
          kind: "error",
          channel: channel ?? null,
          reason: classifyConnectFailure(detail),
          detail,
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [brandId, clearWatchdogs, connectOpen, qc]);

  // Nunca deixa watchdogs pendurados quando o componente sai de cena.
  useEffect(() => clearWatchdogs, [clearWatchdogs]);

  async function connectMeta(channel: "facebook" | "instagram", forceReauth = false) {
    if (!brandId) return;
    clearWatchdogs();
    flowRef.current = channel;
    setFlow({ kind: "starting", channel });
    // O popup precisa abrir de forma síncrona no clique.
    const popup = window.open(
      "",
      "meta-oauth",
      "width=760,height=820,resizable=yes,scrollbars=yes",
    );
    try {
      // O retorno NUNCA é desestruturado às cegas: `authorizeUrl` é validado
      // antes de qualquer navegação (era a origem do "Cannot destructure
      // property 'authorizeUrl' of undefined").
      const res: unknown = await startMetaFn({
        // Fluxo normal: reutiliza a sessão Meta e solicita novamente apenas
        // permissões recusadas. Reautenticação forçada fica restrita às ações
        // explícitas de trocar portfólio / reconectar uma conta.
        data: { brandId, channel, ...(forceReauth ? { forceReauth: true } : {}) },
      });

      if (!res || typeof res !== "object") {
        popup?.close();
        setFlow({ kind: "error", channel, reason: "invalid_response", detail: String(res) });
        return;
      }
      const payload = res as { authorizeUrl?: unknown; redirectUri?: unknown };
      const authorizeUrl =
        typeof payload.authorizeUrl === "string" ? payload.authorizeUrl.trim() : "";
      if (!authorizeUrl) {
        popup?.close();
        setFlow({
          kind: "error",
          channel,
          reason: "missing_url",
          detail: "A resposta de startMetaOAuth não trouxe authorizeUrl.",
        });
        return;
      }

      if (typeof payload.redirectUri === "string") {
        console.info("[meta-oauth] redirect_uri em uso:", payload.redirectUri);
      }

      if (popup) {
        popup.location.href = authorizeUrl;
        setFlow({ kind: "awaiting", channel });
        // Janela fechada sem retorno do callback: pode ser cancelamento OU
        // `postMessage` perdido (COOP / divergência de origem). Damos uma
        // janela de graça e confirmamos no servidor antes de acusar cancelamento.
        pollRef.current = window.setInterval(() => {
          if (!popup.closed) return;
          clearWatchdogs();
          setFlow((prev) => (prev.kind === "awaiting" ? { kind: "returning", channel } : prev));
          window.setTimeout(() => void resolveClosedPopup(channel), 1200);
        }, 800);
        // Timeout duro: o modal jamais fica preso em "Aguardando autorização".
        timeoutRef.current = window.setTimeout(() => {
          clearWatchdogs();
          try {
            popup.close();
          } catch {
            /* janela já fechada */
          }
          setFlow((prev) =>
            prev.kind === "awaiting" || prev.kind === "returning"
              ? { kind: "error", channel, reason: "timeout", detail: null }
              : prev,
          );
        }, OAUTH_TIMEOUT_MS);
      } else {
        // Sem popup disponível: usa o redirecionamento da própria aba (fluxo
        // OAuth existente, sem segunda implementação).
        setFlow({ kind: "awaiting", channel });
        window.location.href = authorizeUrl;
      }
    } catch (err) {
      popup?.close();
      clearWatchdogs();
      console.warn("[meta-oauth] falha ao iniciar autorização:", err);
      setFlow({
        kind: "error",
        channel,
        reason: /permiss|owner|admin/i.test(err instanceof Error ? err.message : "")
          ? "permission"
          : "start_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /* ---------------------------------- dados --------------------------------- */

  /**
   * "Contas disponíveis" = contas realmente devolvidas pela Meta na autorização
   * atual e ainda não salvas neste workspace. Nunca derivado do histórico.
   */
  const available = useMemo(() => discovery?.accounts ?? [], [discovery]);

  /* ----------------------------------- ui ----------------------------------- */

  /* ------------------------------- portfólios ------------------------------- */

  const portfolios = portfolioStatus?.portfolios ?? [];

  const linkedByExternalId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of channels) {
      const name = c.clients[0]?.name;
      if (name) m.set(c.externalId, name);
    }
    return m;
  }, [channels]);

  return (
    <div className="space-y-4">
      {/* ---------------------------------- header --------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Conexões</h2>
          <p className="text-xs text-muted-foreground">
            Uma linha por cliente: veja em segundos quais canais estão ativos, quais precisam de
            ação e onde falta vínculo.
          </p>
          <div className="pt-1.5">
            <ChannelStatusLegend />
          </div>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-9 gap-2 px-3.5 text-sm font-medium">
                  <Plus className="h-4 w-4" />
                  Conectar canais
                  <ChevronDown className="h-4 w-4 opacity-80" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-1.5">
                <div className="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Disponíveis
                </div>
                <DropdownMenuItem
                  className="gap-2.5 rounded-md px-2 py-2 text-sm"
                  onClick={() => setConnectOpen(true)}
                  disabled={connecting !== null}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br from-sky-500/15 to-pink-500/15">
                    <Facebook className="h-3.5 w-3.5 text-sky-600" />
                    <Instagram className="-ml-1.5 h-3.5 w-3.5 text-pink-500" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">Conectar canais Meta</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      Instagram e Facebook via autorização oficial
                    </span>
                  </span>
                </DropdownMenuItem>
                {portfolios.length ? (
                  <DropdownMenuItem
                    className="gap-2.5 rounded-md px-2 py-2 text-sm"
                    onClick={() => void connectMeta("facebook", true)}
                    disabled={connecting !== null}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">Adicionar portfólio Meta</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        Autorizar um novo Business Portfolio
                      </span>
                    </span>
                  </DropdownMenuItem>
                ) : null}

                <DropdownMenuSeparator className="my-1.5" />
                <div className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Em breve
                </div>
                {UPCOMING_CHANNELS.map((def) => {
                  const Icon = def.icon;
                  return (
                    <div
                      key={def.key}
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2 py-1.5 text-sm opacity-60"
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{def.label}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          Em breve
                        </span>
                      </span>
                    </div>
                  );
                })}

                {(portfolioStatus?.authorizations?.length ?? 0) > 0 ? (
                  <>
                    <DropdownMenuSeparator className="my-1.5" />
                    <DropdownMenuItem
                      className="gap-2.5 rounded-md px-2 py-2 text-sm"
                      onClick={() => refreshDiscovery(true)}
                      disabled={manualSyncing}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted">
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">Descoberta completa</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          Varre todos os portfólios (consome mais cota da Meta)
                        </span>
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 rounded-md px-2 py-2 text-sm text-destructive focus:text-destructive"
                      onClick={() => setRevokeAllOpen(true)}
                      disabled={revokeAuthMut.isPending}
                    >
                      <Unplug className="h-4 w-4" />
                      Revogar acesso à Meta
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      <AlertDialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar acesso à Meta?</AlertDialogTitle>
            <AlertDialogDescription>
              A autorização atual será revogada para este workspace. Os canais já conectados
              permanecem funcionando, mas novas descobertas de contas exigirão uma nova autorização.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setRevokeAllOpen(false);
                revokeAuthMut.mutate();
              }}
            >
              Revogar acesso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="space-y-4">
        <TabsList className="h-8">
          <TabsTrigger value="meta" className="h-6 text-xs">
            Clientes e canais
          </TabsTrigger>
          <TabsTrigger value="whatsapp" className="h-6 text-xs">
            WhatsApp
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whatsapp" className="space-y-3">
          <WhatsappCenter brandId={brandId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="meta" className="space-y-4">
          {/* --------------------- 1. clientes × canais (elemento principal) --------------------- */}
          <ClientsChannelsTable
            clients={clients.map((c) => ({
              id: c.id as string,
              name: c.name as string,
              logoUrl: (c.logo_url as string | null) ?? null,
              color: (c.color as string | null) ?? null,
            }))}
            channels={channels}
            whatsapp={whatsappInstances}
            canManage={canManage}
            loading={isLoading}
            reconnectingIds={reconnectTarget ? [reconnectTarget.connectionId] : []}
            actions={{
              onConnect: () => setConnectOpen(true),
              onReconnect: setReconnectTarget,
              onManage: setManage,
              onLink: setLinkTarget,
              onManageWhatsapp: () => setTab("whatsapp"),
            }}
          />

          {/* ------------- 2. portfólios Meta e ativos (detalhe secundário) ------------- */}
          <Collapsible open={portfolioDetailsOpen} onOpenChange={setPortfolioDetailsOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-between px-2 text-xs text-muted-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Portfólios Meta e ativos disponíveis
                  {portfolios.length ? (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      {portfolios.length}
                    </Badge>
                  ) : null}
                </span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    portfolioDetailsOpen && "rotate-180",
                  )}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2.5">
              <MetaPortfoliosPanel
                brandId={brandId}
                canManage={canManage}
                loading={loadingPortfolio}
                loadingDiscovery={loadingDiscovery}
                fetchingDiscovery={fetchingDiscovery || manualSyncing}
                portfolios={portfolios}
                accounts={available}
                discovery={discovery}
                clientByExternalId={linkedByExternalId}
                busy={connecting !== null}
                revoking={revokeAuthMut.isPending}
                onConnect={() => setConnectOpen(true)}
                onSwitch={() => void connectMeta("facebook", true)}
                onRefresh={() => refreshDiscovery()}
                onRevokeAll={() => revokeAuthMut.mutate()}
                onLinkAccount={(a) => setLinkDiscovered(a)}
                onChanged={invalidate}
              />
            </CollapsibleContent>
          </Collapsible>

          {/* ------------------------------ 4. histórico ------------------------------ */}
          <Collapsible
            open={historyOpen}
            onOpenChange={(v) => {
              setHistoryOpen(v);
              if (v) qc.invalidateQueries({ queryKey: ["channel-history", brandId] });
            }}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-between px-2 text-xs text-muted-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Histórico de conexões
                </span>
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", historyOpen && "rotate-180")}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              {loadingHistory ? (
                <Skeleton className="h-32 w-full rounded-xl" />
              ) : history.length === 0 ? (
                <Card className="border-dashed p-4 text-xs text-muted-foreground">
                  Ainda não há eventos registrados. Vínculos, reconexões e remoções feitos a partir
                  de agora aparecem aqui.
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Quando</TableHead>
                          <TableHead className="text-xs">Evento</TableHead>
                          <TableHead className="text-xs">Ativo</TableHead>
                          <TableHead className="text-xs">Cliente</TableHead>
                          <TableHead className="text-xs">Resultado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.map((h) => (
                          <TableRow key={h.id}>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                              {new Date(h.at).toLocaleString("pt-BR")}
                            </TableCell>
                            <TableCell className="text-xs font-medium">{h.actionLabel}</TableCell>
                            <TableCell className="text-xs">
                              {h.accountLabel}
                              {h.externalId ? (
                                <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                                  {h.externalId}
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {h.clientName ?? "—"}
                            </TableCell>
                            <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                              {h.detail ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              )}
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>
      </Tabs>

      {/* Sessão Meta autorizada e wizard fechado: retomada clara e explícita. */}
      {portfolioSessionId && !connectOpen && !portfolioOpen ? (
        <Card className="flex flex-col gap-3 border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Autorização da Meta concluída</p>
            <p className="text-xs text-muted-foreground">
              Continue de onde parou para ativar as contas e vinculá-las a um cliente.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs"
              onClick={() => setPortfolioSessionId(null)}
            >
              Descartar
            </Button>
            <Button size="sm" className="text-xs" onClick={() => setPortfolioOpen(true)}>
              Retomar seleção de contas
            </Button>
          </div>
        </Card>
      ) : null}

      {/* -------------------------------- diálogos -------------------------------- */}

      <ConnectChannelsDialog
        open={connectOpen}
        onOpenChange={(v) => {
          setConnectOpen(v);
          if (!v) {
            clearWatchdogs();
            setFlow({ kind: "idle" });
            setAssetsStep(false);
            // A sessão é preservada para permitir "Retomar seleção de contas".
            invalidate();
          }
        }}
        state={flow}
        onConnect={(channel) => void connectMeta(channel)}
        onCancel={() => {
          clearWatchdogs();
          setFlow({ kind: "idle" });
        }}
        onContinue={() => {
          // Etapa 02 acontece NO MESMO popup — nunca um segundo modal.
          if (portfolioSessionId) setAssetsStep(true);
          else setConnectOpen(false);
        }}
        onRefreshDiscovery={() => refreshDiscovery()}
        discovery={discovery}
        syncing={loadingDiscovery || fetchingDiscovery || manualSyncing}
        assetsStep={assetsStep}
        brandId={brandId ?? undefined}
        assetsSessionId={portfolioSessionId}
        assetsChannel={portfolioChannel}
        onBackFromAssets={() => setAssetsStep(false)}
        onFinishAssets={() => {
          setAssetsStep(false);
          setConnectOpen(false);
          setFlow({ kind: "idle" });
          setPortfolioSessionId(null);
          invalidate();
        }}
      />

      {/* Retomada EXPLÍCITA: nunca abre sozinho depois de fechar o wizard. */}
      {portfolioSessionId && !connectOpen && portfolioOpen ? (
        <MetaPortfolioDialog
          open={portfolioOpen}
          onOpenChange={(v) => {
            setPortfolioOpen(v);
            if (!v) {
              setPortfolioSessionId(null);
              invalidate();
            }
          }}
          sessionId={portfolioSessionId}
          brandId={brandId ?? ""}
          channel={portfolioChannel}
        />
      ) : null}

      <LinkClientDialog
        row={linkTarget}
        brandId={brandId}
        clients={clients.map((c) => ({ id: c.id as string, name: c.name as string }))}
        onOpenChange={(v) => !v && setLinkTarget(null)}
        onChanged={invalidate}
      />

      <LinkDiscoveredDialog
        account={linkDiscovered}
        brandId={brandId}
        sessionId={discovery?.sessionId ?? null}
        clients={clients.map((c) => ({ id: c.id as string, name: c.name as string }))}
        onOpenChange={(v) => !v && setLinkDiscovered(null)}
        onChanged={invalidate}
      />

      <ReconnectDialog
        row={reconnectTarget}
        brandId={brandId}
        reauthRef={reauthRef}
        onOpenChange={(v) => !v && setReconnectTarget(null)}
        onChanged={invalidate}
      />

      <ManageChannelDialog
        row={manage}
        brandId={brandId}
        canManage={canManage}
        onOpenChange={(v) => !v && setManage(null)}
        onChanged={invalidate}
        onReconnect={(row) => {
          setManage(null);
          setReconnectTarget(row);
        }}
        onLink={(row) => {
          setManage(null);
          setLinkTarget(row);
        }}
      />
    </div>
  );
}

/* --------------------------------- pedaços -------------------------------- */

/** Passos do fluxo de conexão — indicador compacto, sem estado próprio. */
function ConnectSteps({ active }: { active: number }) {
  const steps = ["Autorização", "Seleção de ativos", "Validação", "Confirmação"];
  return (
    <ol className="flex items-center gap-1.5 text-[11px]">
      {steps.map((label, i) => (
        <li key={label} className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-medium",
              i <= active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <span
            className={cn("truncate", i <= active ? "text-foreground" : "text-muted-foreground")}
          >
            {label}
          </span>
          {i < steps.length - 1 ? <span className="h-px w-3 bg-border" /> : null}
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------ vincular cliente --------------------------- */

function LinkClientDialog({
  row,
  brandId,
  clients,
  onOpenChange,
  onChanged,
}: {
  row: WorkspaceChannel | null;
  brandId: string | null;
  clients: Array<{ id: string; name: string }>;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const toggleFn = useServerFn(toggleClientChannelFn);
  const recordFn = useServerFn(recordChannelEventFn);
  const [clientId, setClientId] = useState<string>("");

  useEffect(() => {
    setClientId(row?.clients[0]?.id ?? "");
  }, [row?.connectionId, row?.clients]);

  const linkMut = useMutation({
    mutationFn: async () => {
      if (!row || !brandId || !clientId) return;
      await toggleFn({
        data: { brandId, clientId, connectionId: row.connectionId, assigned: true },
      });
      await recordFn({
        data: {
          brandId,
          connectionId: row.connectionId,
          clientId,
          verb: "channel_linked" as const,
          channel: row.channel,
          accountLabel: row.accountLabel,
          externalId: row.externalId,
          clientName: clients.find((c) => c.id === clientId)?.name ?? null,
          detail: null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Canal vinculado ao cliente.");
      onOpenChange(false);
      onChanged();
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : "Não foi possível vincular esta conta ao cliente.",
      ),
  });

  if (!row) return null;
  const def = channelDef(row.channel);

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Vincular a um cliente</DialogTitle>
          <DialogDescription className="text-xs">
            {def.label}
            {row.handle ? ` · @${row.handle.replace(/^@/, "")}` : ""}. Uma conta atende apenas um
            cliente por vez — isso garante o isolamento de dados e de publicações.
          </DialogDescription>
        </DialogHeader>

        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Selecione o cliente" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={!clientId || linkMut.isPending}
            onClick={() => linkMut.mutate()}
          >
            {linkMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            Vincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- reconectar ------------------------------ */

function ReconnectDialog({
  row,
  brandId,
  reauthRef,
  onOpenChange,
  onChanged,
}: {
  row: WorkspaceChannel | null;
  brandId: string | null;
  reauthRef: React.MutableRefObject<boolean>;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const inspectFn = useServerFn(inspectMetaConnectionFn);
  const startMetaFn = useServerFn(startMetaOAuth);
  const reconcileFn = useServerFn(reconcileMetaConnectionFn);
  const [reauthorizing, setReauthorizing] = useState(false);
  const applyFn = useServerFn(applyMetaReconnectFn);
  const recordFn = useServerFn(recordChannelEventFn);
  const [result, setResult] = useState<InspectResult | null>(null);

  useEffect(() => {
    setResult(null);
  }, [row?.connectionId]);

  const inspectMut = useMutation({
    mutationFn: () => inspectFn({ data: { brandId: brandId!, connectionId: row!.connectionId } }),
    onSuccess: (r) => setResult(r),
    onError: () => toast.error("Não foi possível verificar esta conexão agora. Tente novamente."),
  });

  useEffect(() => {
    if (row && brandId && !result && !inspectMut.isPending) inspectMut.mutate();

    // Handler do popup OAuth: religado apenas quando a conexão/marca muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.connectionId, brandId]);

  const applyMut = useMutation({
    mutationFn: async (acceptNewAccount: boolean) => {
      const res = await applyFn({
        data: {
          brandId: brandId!,
          connectionId: row!.connectionId,
          acceptNewAccount,
        },
      });
      if (res.ok && row && brandId) {
        await recordFn({
          data: {
            brandId,
            connectionId: row.connectionId,
            clientId: row.clients[0]?.id ?? null,
            verb: acceptNewAccount
              ? ("channel_account_changed" as const)
              : ("channel_reconnected" as const),
            channel: row.channel,
            accountLabel: row.accountLabel,
            externalId: row.externalId,
            clientName: row.clients[0]?.name ?? null,
            detail: acceptNewAccount ? "Conta substituída com confirmação" : null,
          },
        });
      }
      return res;
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message?.description ?? "Não foi possível atualizar a conexão.");
        return;
      }
      toast.success("Conexão atualizada.");
      onOpenChange(false);
      onChanged();
    },
    onError: () => toast.error("Não foi possível atualizar a conexão."),
  });

  /**
   * Reconexão real: nova autorização na Meta + nova descoberta. A conta só volta
   * a ficar ativa se a Meta continuar devolvendo o mesmo ID externo.
   */
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const d = ev.data as {
        source?: string;
        type?: string;
        ok?: boolean;
        error?: string;
        sessionId?: string | null;
      };
      if (!d || d.source !== "meta-oauth" || d.type === "missing-scopes") return;
      if (!reauthRef.current) return;
      if (!d.ok || !d.sessionId) {
        reauthRef.current = false;
        setReauthorizing(false);
        if (d.error)
          toast.error("A Meta não concluiu a autorização.", {
            description: d.error,
            duration: 12000,
          });
        return;
      }
      const sessionId = d.sessionId;
      void (async () => {
        try {
          const res = await reconcileFn({
            data: { brandId: brandId!, connectionId: row!.connectionId, sessionId },
          });
          if (res.ok) {
            toast.success(res.message.title, { description: res.message.description });
            onOpenChange(false);
            onChanged();
          } else {
            toast.error(res.message.title, {
              description: res.message.description,
              duration: 12000,
            });
            onChanged();
          }
        } catch (e) {
          toast.error("Não foi possível concluir a reconexão.", {
            description: e instanceof Error ? e.message : undefined,
            duration: 12000,
          });
        } finally {
          reauthRef.current = false;
          setReauthorizing(false);
        }
      })();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [row?.connectionId, brandId]);

  async function startReauth() {
    if (!row || !brandId) return;
    reauthRef.current = true;
    setReauthorizing(true);
    const popup = window.open(
      "",
      "meta-oauth",
      "width=760,height=820,resizable=yes,scrollbars=yes",
    );
    try {
      const authorizeUrl = readAuthorizeUrl(
        await startMetaFn({
          data: {
            brandId,
            channel: row.channel as "facebook" | "instagram",
            forceReauth: true,
          },
        }),
      );
      if (popup) popup.location.href = authorizeUrl;
      else window.location.href = authorizeUrl;
    } catch (err) {
      reauthRef.current = false;
      setReauthorizing(false);
      popup?.close();
      toast.error("Não foi possível abrir a autorização da Meta.", {
        description: err instanceof Error ? err.message : undefined,
        duration: 10000,
      });
    }
  }

  if (!row) return null;
  const def = channelDef(row.channel);
  const diag = result?.diagnosis ?? null;
  const mismatch = !!result?.ok && !!result.changed;
  const loading = inspectMut.isPending || !result;

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="space-y-1.5">
          <div className="flex items-center gap-2">
            <def.icon className={cn(CHANNEL_ICON_SIZE, def.tone)} />
            <span className="text-xs text-muted-foreground">
              {def.label}
              {row.handle ? ` · @${row.handle.replace(/^@/, "")}` : ""}
            </span>
            {diag ? (
              <Badge
                variant="outline"
                className={cn(
                  "ml-auto h-5 border-none px-2 text-[11px] font-medium",
                  diag.severity === "critical"
                    ? "bg-destructive/10 text-destructive"
                    : diag.severity === "warning"
                      ? "bg-severity-warning/10 text-severity-warning"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {diag.badge}
              </Badge>
            ) : null}
          </div>
          <DialogTitle className="text-base leading-snug">
            {loading ? "Verificando a conta na Meta…" : (diag?.title ?? "Reconectar canal")}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            {loading ? "Nenhuma alteração é gravada durante a verificação." : (diag?.cause ?? "")}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Consultando a Meta…
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Ação recomendada
              </p>
              <p className="mt-1 text-xs leading-relaxed">{diag?.action}</p>
            </div>

            {mismatch ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <AccountBox title="Conta atual" snap={result.current} channel={row.channel} />
                <AccountBox
                  title="Conta encontrada agora"
                  snap={result.found}
                  channel={row.channel}
                  highlight
                />
              </div>
            ) : null}

            {result?.technical ? (
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <ChevronDown className="h-3 w-3" />
                  Detalhes técnicos
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="mt-2 break-words rounded-md bg-muted p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {result.technical}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>

          {mismatch ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={applyMut.isPending}
                onClick={() => applyMut.mutate(false)}
              >
                Manter conta atual
              </Button>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={applyMut.isPending}
                onClick={() => applyMut.mutate(true)}
              >
                {applyMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Usar a nova conta
              </Button>
            </>
          ) : diag?.allowReauthorize ? (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={reauthorizing}
              onClick={() => void startReauth()}
            >
              {reauthorizing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Nova autorização na Meta
            </Button>
          ) : diag?.kind === "ok" ? (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={applyMut.isPending}
              onClick={() => applyMut.mutate(false)}
            >
              {applyMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Reconectar
            </Button>
          ) : diag?.allowRetry ? (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={inspectMut.isPending}
              onClick={() => inspectMut.mutate()}
            >
              {inspectMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Verificar novamente
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountBox({
  title,
  snap,
  channel,
  highlight,
}: {
  title: string;
  snap: InspectResult["current"] | null;
  channel: string;
  highlight?: boolean;
}) {
  const isIg = channel === "instagram";
  return (
    <div
      className={cn(
        "space-y-1 rounded-lg border p-3",
        highlight && "border-severity-warning/40 bg-severity-warning/5",
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{title}</p>
      <p className="truncate text-sm font-medium">
        {snap?.pageName ?? (snap?.instagramUsername ? `@${snap.instagramUsername}` : "—")}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {isIg ? "Instagram profissional" : "Página do Facebook"}
      </p>
      <p className="truncate font-mono text-[11px] text-muted-foreground">
        Página {maskId(snap?.pageId)}
      </p>
      <p className="truncate font-mono text-[11px] text-muted-foreground">
        Instagram {snap?.instagramUsername ? `@${snap.instagramUsername} · ` : ""}
        {maskId(snap?.instagramBusinessId)}
      </p>
    </div>
  );
}

/* --------------------------------- gerenciar ------------------------------- */

function ManageChannelDialog({
  row,
  brandId,
  canManage,
  onOpenChange,
  onChanged,
  onReconnect,
  onLink,
}: {
  row: WorkspaceChannel | null;
  brandId: string | null;
  canManage: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
  onReconnect: (row: WorkspaceChannel) => void;
  onLink: (row: WorkspaceChannel) => void;
}) {
  const disconnectFn = useServerFn(disconnectMeta);
  const toggleFn = useServerFn(toggleClientChannelFn);
  const recordFn = useServerFn(recordChannelEventFn);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    setConfirmDisconnect(false);
  }, [row?.connectionId]);

  const unlinkMut = useMutation({
    mutationFn: async (client: { id: string; name: string }) => {
      await toggleFn({
        data: {
          brandId: brandId!,
          clientId: client.id,
          connectionId: row!.connectionId,
          assigned: false,
        },
      });
      await recordFn({
        data: {
          brandId: brandId!,
          connectionId: row!.connectionId,
          clientId: client.id,
          verb: "channel_unlinked" as const,
          channel: row!.channel,
          accountLabel: row!.accountLabel,
          externalId: row!.externalId,
          clientName: client.name,
          detail: null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Canal desvinculado do cliente.");
      onChanged();
      onOpenChange(false);
    },
    onError: () => toast.error("Não foi possível desvincular este canal."),
  });

  const disconnectMut = useMutation({
    mutationFn: async () => {
      await recordFn({
        data: {
          brandId: brandId!,
          connectionId: row!.connectionId,
          clientId: row!.clients[0]?.id ?? null,
          verb: "channel_disconnected" as const,
          channel: row!.channel,
          accountLabel: row!.accountLabel,
          externalId: row!.externalId,
          clientName: row!.clients[0]?.name ?? null,
          detail: null,
        },
      });
      await disconnectFn({
        data: { brandId: brandId!, connectionId: row!.connectionId },
      });
    },
    onSuccess: () => {
      toast.success("Canal removido do workspace.");
      onOpenChange(false);
      onChanged();
    },
    onError: () => toast.error("Não foi possível remover este canal."),
  });

  if (!row) return null;
  const def = channelDef(row.channel);
  const Icon = def.icon;
  const state = channelState(row);

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Icon className={cn(CHANNEL_ICON_SIZE, def.tone)} />
            {def.label}
            {row.handle ? (
              <span className="text-xs font-normal text-muted-foreground">
                @{row.handle.replace(/^@/, "")}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-xs">{accountTypeLabel(row.channel)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11">
              <AvatarImage src={row.avatarUrl ?? undefined} alt={row.accountLabel} />
              <AvatarFallback className="text-xs uppercase">
                {row.channel.slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-1">
              <StatusBadge state={state} />
              <p className="text-[11px] text-muted-foreground">
                {STATE_META[state].hint} · sincronizado {formatRelative(row.lastSyncedAt)}
              </p>
            </div>
          </div>

          <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Identificadores oficiais
            </p>
            <CopyableId label="Page ID" value={row.pageId ?? row.externalId} />
            <CopyableId label="Instagram ID" value={row.instagramBusinessId} />
            <CopyableId label="Conexão" value={row.connectionId} />
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Cliente atendido
            </p>
            {row.clients.length ? (
              <div className="space-y-1.5">
                {row.clients.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                  >
                    <span className="truncate text-xs">{c.name}</span>
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
                        disabled={unlinkMut.isPending}
                        onClick={() => unlinkMut.mutate(c)}
                      >
                        <Unlink className="h-3.5 w-3.5" />
                        Desvincular
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-2.5 py-2">
                <span className="text-xs text-muted-foreground">
                  Sem cliente vinculado — este canal não publica.
                </span>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => onLink(row)}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Vincular
                  </Button>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Permissões concedidas
            </p>
            {row.scopes.length ? (
              <div className="flex flex-wrap gap-1">
                {row.scopes.map((s) => (
                  <span
                    key={s}
                    className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma permissão registrada nesta conexão.
              </p>
            )}
          </div>

          {row.lastError ? (
            <div className="rounded-lg border border-severity-warning/30 bg-severity-warning/10 p-3 text-xs text-severity-warning">
              A Meta recusou a última operação desta conta. Reconecte para renovar a autorização.
            </div>
          ) : null}
        </div>

        {canManage ? (
          <DialogFooter className="flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => onReconnect(row)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reconectar
            </Button>
            {confirmDisconnect ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-1.5 text-xs"
                disabled={disconnectMut.isPending}
                onClick={() => disconnectMut.mutate()}
              >
                {disconnectMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                Confirmar remoção
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                onClick={() => setConfirmDisconnect(true)}
              >
                <History className="h-3.5 w-3.5" />
                Remover canal
              </Button>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------- vincular conta descoberta na Meta -------------------- */

function LinkDiscoveredDialog({
  account,
  brandId,
  sessionId,
  clients,
  onOpenChange,
  onChanged,
}: {
  account: DiscoveredAccountsResult["accounts"][number] | null;
  brandId: string | null;
  sessionId: string | null;
  clients: Array<{ id: string; name: string }>;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const linkFn = useServerFn(linkMetaAccount);
  const [clientId, setClientId] = useState("");
  const [linkPair, setLinkPair] = useState(true);

  useEffect(() => {
    setClientId("");
    setLinkPair(true);
  }, [account?.externalId]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!account || !brandId || !sessionId || !clientId) return;
      await linkFn({
        data: {
          brandId,
          sessionId,
          channel: account.channel,
          targetId: account.externalId,
          clientId,
          linkPair:
            account.channel === "facebook" && !!account.instagramBusinessId ? linkPair : false,
        },
      });
    },
    onSuccess: () => {
      toast.success("Conta conectada e vinculada ao cliente.");
      onOpenChange(false);
      onChanged();
    },
    onError: (e) =>
      toast.error("Não foi possível conectar esta conta.", {
        description: e instanceof Error ? e.message : undefined,
        duration: 12000,
      }),
  });

  if (!account) return null;
  const def = channelDef(account.channel);
  const canPair = account.channel === "facebook" && !!account.instagramBusinessId;

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Conectar e vincular</DialogTitle>
          <DialogDescription className="text-xs">
            {def.label} · {account.label} · ID {account.externalId}. A conta é salva no workspace e
            passa a atender apenas o cliente escolhido.
          </DialogDescription>
        </DialogHeader>

        {!sessionId ? (
          <div className="rounded-lg border border-severity-warning/30 bg-severity-warning/10 p-3 text-xs text-severity-warning">
            A autorização da Meta expirou. Autorize novamente para conectar esta conta.
          </div>
        ) : null}

        {account.status !== "ready" ? (
          <div className="rounded-lg border border-severity-warning/30 bg-severity-warning/10 p-3 text-[11px] text-severity-warning">
            A Meta ainda não liberou publicação para esta conta. Você pode vinculá-la agora, mas
            será necessário refazer a autorização marcando esta conta.
          </div>
        ) : null}

        <Select value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="h-9 text-sm">
            <SelectValue placeholder="Selecione o cliente" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canPair ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={linkPair}
              onChange={(e) => setLinkPair(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Conectar também o Instagram vinculado a esta Página
          </label>
        ) : null}

        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={!clientId || !sessionId || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Link2 className="h-3.5 w-3.5" />
            )}
            Conectar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------- portfólio Meta ----------------------------- */

/**
 * Painel de PORTFÓLIOS Meta conectados ao workspace.
 *
 * O portfólio (Business da Meta) é a identidade que autoriza a instalação; os
 * canais abaixo dele atendem clientes específicos. Trocar o portfólio inicia uma
 * nova autorização e o seletor de contas — nada é gravado até a seleção, então a
 * conexão atual continua íntegra se a nova autorização falhar.
 */
/* Painel legado de portfólios removido — ver `PortfolioSection`. */
