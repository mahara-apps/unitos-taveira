import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  AtSign,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Facebook,
  Instagram,
  Loader2,
  RefreshCw,
  Search,
  X,

} from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listClients } from "@/lib/workspace.functions";
import { toggleClientChannelFn } from "@/lib/client-channels.functions";
import {
  getMetaPortfolio,
  SESSION_INVALID_PREFIX,
  linkMetaAccount,
  unlinkMetaAccount,
  type PortfolioPage,
  type PortfolioResponse,
  type PortfolioThreadsAccount,
  type PortfolioAdAccount,
} from "@/lib/meta/portfolio.functions";
import { startMetaOAuth } from "@/lib/meta/meta.functions";
import {
  accountDiscoveryStatus,
  type DiscoveredAccountStatus,
  type PublishAuthorizationInfo,
} from "@/lib/meta/portfolio-shared";
import { humanizeMetaError } from "@/lib/meta/error-messages";
import { DiscoveryProgress } from "./discovery-progress";
import { readAuthorizeUrl } from "@/lib/meta/connect-flow";
import { assignFinishState } from "@/lib/meta/assign-completion";

/**
 * Status canônico por conta descoberta: 🟢 Pronto · 🟠 Autorização necessária
 * · 🔴 Não disponível. Derivado do target_id real (granular scopes da Meta).
 */
function AccountStatusBadge({ status }: { status: DiscoveredAccountStatus }) {
  if (status === "ready") {
    return (
      <Badge
        variant="outline"
        className="h-5 gap-1 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-3 w-3" />
        Pronto para publicar
      </Badge>
    );
  }
  if (status === "authorization_required") {
    return (
      <Badge
        variant="outline"
        className="h-5 gap-1 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-400"
        title="A Meta não autorizou esta conta específica para publicação. Reconecte e selecione esta conta na tela da Meta."
      >
        <AlertTriangle className="h-3 w-3" />
        Autorização necessária
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="h-5 gap-1 border-destructive/40 bg-destructive/10 px-1.5 text-[10px] text-destructive"
    >
      <AlertTriangle className="h-3 w-3" />
      Não disponível
    </Badge>
  );
}

function metaPopupFeatures(): string {
  const width = 760;
  const height = 820;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  return `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
}

/** Conta ativada nesta passagem pelo painel (o que será vinculado ao cliente). */
export type SelectedAccount = {
  connectionId: string;
  label: string;
  channel: "facebook" | "instagram" | "threads" | "ads";
  targetId: string;
  lookupId: string | null;
};

const CHANNEL_LABEL: Record<SelectedAccount["channel"], string> = {
  facebook: "Página",
  instagram: "Instagram",
  threads: "Threads",
  ads: "Ads",
};

function ChannelGlyph({ channel }: { channel: SelectedAccount["channel"] }) {
  if (channel === "facebook") return <Facebook className="h-3 w-3 text-[#1877F2]" />;
  if (channel === "instagram") return <Instagram className="h-3 w-3 text-[#DD2A7B]" />;
  if (channel === "threads") return <AtSign className="h-3 w-3" />;
  return <BarChart3 className="h-3 w-3 text-blue-500" />;
}

/**
 * Bandeja "Selecionadas": responde à pergunta "qual conta vai ser conectada?".
 * Lista exatamente as contas ativadas agora, com remoção direta por etiqueta.
 */
function MetaSelectionTray({
  selected,
  onRemove,
}: {
  selected: SelectedAccount[];
  onRemove: (item: SelectedAccount) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (selected.length === 0) return null;
  const counts = selected.reduce<Record<string, number>>((acc, item) => {
    acc[item.channel] = (acc[item.channel] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = (Object.keys(CHANNEL_LABEL) as Array<SelectedAccount["channel"]>)
    .filter((c) => counts[c])
    .map((c) => `${counts[c]} ${CHANNEL_LABEL[c]}`)
    .join(" · ");
  const collapsed = selected.length > 6 && !expanded;
  const shown = collapsed ? selected.slice(0, 6) : selected;

  return (
    <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          Vão ser conectadas ({selected.length}){breakdown ? ` · ${breakdown}` : ""}
        </p>
        {selected.length > 6 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => setExpanded((v) => !v)}
          >
            {collapsed ? `Ver todas (${selected.length})` : "Recolher"}
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((item) => (
          <li key={item.connectionId}>
            <span className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-border/60 bg-background px-2 py-1 text-[11px]">
              <ChannelGlyph channel={item.channel} />
              <span className="truncate">{item.label}</span>
              <button
                type="button"
                aria-label={`Remover ${item.label}`}
                title={`Remover ${item.label}`}
                className="shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onRemove(item)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Sessões Meta já varridas nesta aba do navegador. */
const scannedSessions = new Set<string>();

function metaStuckMessage(): string {
  return "A conexão da Meta não foi concluída. Se a janela ficou em branco ou em /business/cancel, tente novamente mantendo as permissões do canal selecionadas.";
}

/**
 * Post-OAuth account selector — PAINEL (sem modal próprio).
 *
 * Reads the captured portfolio for a `meta_oauth_sessions` id and lets the user
 * toggle which Facebook Pages / Instagram Business accounts are bound to the
 * brand. Vive como painel para poder ser embutido na etapa "Ativos" do modal
 * único "Conectar canais" — evitando modais empilhados.
 */
export function MetaAssetsPanel({
  brandId,
  clientId,
  sessionId,
  active,
  channel,
  assign,
  onClose,
  onPendingChange,
}: {
  brandId: string;
  clientId?: string;
  sessionId: string | null;
  /** true enquanto o painel está visível (controla a query). */
  active: boolean;
  channel?: "facebook" | "instagram" | "threads" | "ads" | null;
  /**
   * Mostra o rodapé de conclusão (resumo + escolha do cliente + "Concluir").
   * Sem ele o usuário não tem um destino claro depois de ativar as contas.
   */
  assign?: boolean;
  onClose: () => void;
  /** Nº de contas ativadas e ainda sem cliente — usado para confirmar o fechamento. */
  onPendingChange?: (count: number) => void;
}) {
  const open = active;
  const onOpenChange = (v: boolean) => {
    if (!v) onClose();
  };
  const qc = useQueryClient();
  const getFn = useServerFn(getMetaPortfolio);
  const linkFn = useServerFn(linkMetaAccount);
  const unlinkFn = useServerFn(unlinkMetaAccount);
  const startFn = useServerFn(startMetaOAuth);

  /** Conexões ativadas nesta passagem pelo painel (para vincular ao cliente). */
  const [linkedNow, setLinkedNow] = useState<SelectedAccount[]>([]);
  useEffect(() => {
    onPendingChange?.(linkedNow.length);
  }, [linkedNow.length, onPendingChange]);

  // A primeira abertura de uma sessão recém-autorizada faz varredura nova na
  // Graph API, para que TODAS as contas aprovadas no consentimento apareçam.
  // Depois disso a lista é cache-first e só o botão "Sincronizar" re-varre.
  const refreshNextRef = useRef(false);
  if (sessionId && !scannedSessions.has(sessionId)) {
    scannedSessions.add(sessionId);
    refreshNextRef.current = true;
  }

  const queryKey = [
    "meta-portfolio",
    brandId,
    sessionId,
    channel ?? "all",
    clientId ?? "workspace",
  ] as const;


  async function reauthorize(channel: "instagram" | "facebook" | "threads") {
    const popup = window.open("", "meta-oauth", metaPopupFeatures());
    let completed = false;
    let timeoutId: number | undefined;
    function onOAuthMessage(ev: MessageEvent) {
      const d = ev.data as { source?: string };
      if (d?.source !== "meta-oauth") return;
      completed = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener("message", onOAuthMessage);
    }
    window.addEventListener("message", onOAuthMessage);
    if (popup) {
      timeoutId = window.setTimeout(() => {
        window.removeEventListener("message", onOAuthMessage);
        if (completed || popup.closed) return;
        try {
          popup.close();
        } catch {
          /* noop */
        }
        toast.error(metaStuckMessage(), { duration: 9000 });
      }, 120_000);
    }
    try {
      const startRes = await startFn({ data: { brandId, channel, forceReauth: true } });
      const authorizeUrl = readAuthorizeUrl(startRes);
      console.log("[MetaPortfolio] oauth redirect_uri", startRes?.redirectUri);
      if (popup) popup.location.href = authorizeUrl;
      else window.location.href = authorizeUrl;
    } catch (err) {
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener("message", onOAuthMessage);
      popup?.close();
      toast.error(err instanceof Error ? err.message : "Falha ao iniciar OAuth");
    }
  }

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const refresh = refreshNextRef.current;
      try {
        const res = await getFn({
          data: {
            brandId,
            sessionId: sessionId!,
            channel: channel ?? undefined,
            refresh: refresh || undefined,
          },
        });
        console.log("[MetaPortfolio] portfolio response", {
          sessionId: res.sessionId,
          status: res.portfolioStatus,
          pages: res.pagesCount,
          pagesWithIg: res.pagesWithIgCount,
          channel,
          refresh,
        });
        refreshNextRef.current = false;
        return res;
      } catch (err) {
        console.error("[MetaPortfolio] portfolio error", { err, channel, refresh });
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Falha ao carregar contas da Meta";
        const isRateLimit = msg.startsWith("RATE_LIMIT:");
        const isSessionDead = msg.startsWith(SESSION_INVALID_PREFIX);
        if (isSessionDead) {
          toast.info("Sua sessão da Meta expirou. Abrindo login novamente…", {
            duration: 6000,
          });
          void reauthorize(channel === "ads" || !channel ? "facebook" : channel);
        } else {
          const friendly = humanizeMetaError(msg);
          toast.error(
            isRateLimit
              ? "Limite de requisições da Meta atingido. Por favor, aguarde alguns minutos antes de tentar novamente."
              : `${friendly.title} ${friendly.description}`,
            { duration: 9000 },
          );
        }
        refreshNextRef.current = false;
        throw err instanceof Error ? err : new Error(msg);
      }
    },
    enabled: !!sessionId && open,
    // Cache-first: never auto-refetch. Only the explicit "Sincronizar
    // novamente" button re-hits Meta.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  const isRateLimited = !!error && (error as Error).message.startsWith("RATE_LIMIT:");
  const isSessionInvalid = !!error && (error as Error).message.startsWith(SESSION_INVALID_PREFIX);

  const handleResync = () => {
    refreshNextRef.current = true;
    void refetch();
  };

  const [pending, setPending] = useState<Set<string>>(new Set());

  const invalidate = () => {
    // Only refresh the "connected" map — do NOT invalidate the portfolio
    // list, otherwise every toggle re-hits Meta's Graph API.
    qc.invalidateQueries({ queryKey: ["meta-connections", brandId] });
    qc.invalidateQueries({ queryKey: ["channels-kpis", brandId] });
    qc.invalidateQueries({
      queryKey: clientId ? ["client-channels", brandId, clientId] : ["client-channels", brandId],
    });
    if (clientId) {
      qc.invalidateQueries({ queryKey: ["wizard-connections", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["social-analytics", brandId, clientId] });
      qc.invalidateQueries({ queryKey: ["social-analytics-top", brandId, clientId] });
    }
    qc.invalidateQueries({ queryKey: ["social-analytics", brandId] });
    qc.invalidateQueries({ queryKey: ["social-analytics-top", brandId] });
  };

  const mut = useMutation({
    mutationFn: async (input: {
      channel: "facebook" | "instagram" | "threads" | "ads";
      targetId: string;
      connect: boolean;
      existingConnectionId: string | null;
    }) => {
      if (input.connect) {
        return linkFn({
          data: {
            brandId,
            ...(clientId ? { clientId } : {}),
            sessionId: sessionId!,
            targetId: input.targetId,
            channel: input.channel,
            // Página e Instagram vinculado vêm juntos em uma única ação.
            ...(input.channel === "facebook" || input.channel === "instagram"
              ? { linkPair: true }
              : {}),
          },
        });
      }
      if (!input.existingConnectionId) return { ok: true };
      return unlinkFn({ data: { brandId, connectionId: input.existingConnectionId } });
    },
    onSuccess: (_r, vars) => {
      qc.setQueryData<PortfolioResponse>(queryKey, (old) => {
        if (!old) return old;
        const connected = {
          facebook: { ...old.connected.facebook },
          instagram: { ...old.connected.instagram },
          threads: { ...old.connected.threads },
          ads: { ...old.connected.ads },
        };
        const lookupId =
          vars.channel === "instagram"
            ? (old.pages.find((p) => p.pageId === vars.targetId)?.instagramBusinessId ??
              vars.targetId)
            : vars.targetId;
        if (vars.connect) {
          const result = _r as Record<string, unknown>;
          if (typeof result.connectionId === "string") {
            connected[vars.channel][lookupId] = result.connectionId;
            const label =
              old.pages.find((p) => p.pageId === vars.targetId)?.pageName ??
              old.threadsAccounts?.find((t) => t.threadsUserId === vars.targetId)?.username ??
              old.adAccounts?.find((a) => a.adAccountId === vars.targetId)?.name ??
              vars.targetId;
            const connectionId = result.connectionId;
            const entry: SelectedAccount = {
              connectionId,
              label,
              channel: vars.channel,
              targetId: vars.targetId,
              lookupId,
            };
            setLinkedNow((prev) =>
              prev.some((x) => x.connectionId === connectionId) ? prev : [...prev, entry],
            );
          }
        } else {
          const removed = connected[vars.channel][lookupId];
          delete connected[vars.channel][lookupId];
          if (removed) setLinkedNow((prev) => prev.filter((x) => x.connectionId !== removed));
        }
        return { ...old, connected };
      });
      toast.success(
        vars.connect
          ? "Conta ativada — escolha o cliente no rodapé para concluir"
          : "Conta desativada",
      );
      invalidate();
    },

    onError: (e: Error) => {
      const friendly = humanizeMetaError(e);
      toast.error(`${friendly.title} ${friendly.description}`, { duration: 9000 });
    },
  });

  async function handleToggle(
    channel: "facebook" | "instagram" | "threads" | "ads",
    targetId: string,
    lookupId: string | null,
    connect: boolean,
  ) {
    const key = `${channel}:${targetId}`;
    setPending((s) => new Set(s).add(key));
    try {
      const map =
        channel === "facebook"
          ? data?.connected.facebook
          : channel === "instagram"
            ? data?.connected.instagram
            : channel === "threads"
              ? data?.connected.threads
              : data?.connected.ads;
      const existing = lookupId ? (map?.[lookupId] ?? null) : null;
      await mut.mutateAsync({ channel, targetId, connect, existingConnectionId: existing });
    } finally {
      setPending((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }

  const fbPages = data?.pages ?? [];
  // Instagram list = contas vindas de Páginas + contas atribuídas direto a um
  // portfólio empresarial (sem Página administrável), normalizadas na mesma forma.
  const igPages = useMemo(() => {
    const fromPages = (data?.pages ?? []).filter((p) => p.instagramBusinessId);
    const standalone = (data?.standaloneInstagram ?? []).map((i) => ({
      pageId: i.instagramId,
      pageName: i.name ?? i.username ?? i.instagramId,
      category: i.businessName,
      pagePictureUrl: null,
      instagramBusinessId: i.instagramId,
      instagramUsername: i.username,
      instagramPictureUrl: i.pictureUrl,
      standalone: true as const,
    }));
    return [...fromPages, ...standalone];
  }, [data]);
  const publishAuth: PublishAuthorizationInfo | null = data?.publishAuthorization ?? null;
  const threadsAccounts: PortfolioThreadsAccount[] = data?.threadsAccounts ?? [];
  const adAccounts: PortfolioAdAccount[] = data?.adAccounts ?? [];
  const missingScopes = data?.missingScopes ?? [];

  // Emit a targeted toast when the user opened a channel-specific flow and
  // the corresponding list came back empty.
  const emptyToastFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !channel || !data) return;
    if (data.portfolioStatus === "not_loaded" || data.portfolioStatus === "rate_limited") return;
    const key = `${sessionId}:${channel}`;
    if (emptyToastFiredRef.current === key) return;
    const counts: Record<string, number> = {
      facebook: fbPages.length,
      instagram: igPages.length,
      threads: threadsAccounts.length,
      ads: adAccounts.length,
    };
    if (counts[channel] === 0) {
      emptyToastFiredRef.current = key;
      if (channel === "instagram") {
        toast.error(
          "Nenhuma conta do Instagram Business encontrada. Verifique se o seu Instagram está corretamente vinculado a uma Página do Facebook.",
          { duration: 9000 },
        );
      } else if (channel === "facebook") {
        toast.error("Nenhuma Página do Facebook encontrada nesta conta Meta.");
      } else if (channel === "threads") {
        toast.error("Nenhum perfil do Threads encontrado nas suas Páginas.");
      } else if (channel === "ads") {
        toast.error("Nenhuma Conta de Anúncios encontrada (requer permissão ads_read).");
      }
    }
  }, [
    open,
    channel,
    data,
    sessionId,
    fbPages.length,
    igPages.length,
    threadsAccounts.length,
    adAccounts.length,
  ]);

  /**
   * Busca APENAS de apresentação sobre as listas já carregadas — nenhuma
   * consulta extra à Meta e nenhuma alteração no fluxo de seleção.
   */
  const [assetQuery, setAssetQuery] = useState("");
  /** Mostra apenas as contas ativadas nesta passagem (revisão final). */
  const [onlySelected, setOnlySelected] = useState(false);
  const selectedKeys = useMemo(
    () => new Set(linkedNow.map((item) => `${item.channel}:${item.targetId}`)),
    [linkedNow],
  );
  const keep = (channel: SelectedAccount["channel"], targetId: string) =>
    !onlySelected || selectedKeys.has(`${channel}:${targetId}`);
  const q = assetQuery.trim().toLowerCase();
  const match = (...parts: Array<string | null | undefined>) =>
    !q || parts.filter(Boolean).join(" ").toLowerCase().includes(q);
  const visibleFb = fbPages.filter(
    (p) => keep("facebook", p.pageId) && match(p.pageName, p.category, p.pageId),
  );
  const visibleIg = igPages.filter(
    (p) =>
      keep("instagram", p.pageId) &&
      match(p.pageName, p.instagramUsername, p.instagramBusinessId, p.pageId),
  );
  const visibleThreads = threadsAccounts.filter(
    (t) => keep("threads", t.threadsUserId) && match(t.username, t.name, t.threadsUserId),
  );
  const visibleAds = adAccounts.filter(
    (a) => keep("ads", a.adAccountId) && match(a.name, a.adAccountId, a.businessName),
  );

  const showNotLoadedState = data?.portfolioStatus === "not_loaded";
  const showStoredRateLimitState = data?.portfolioStatus === "rate_limited";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold">Selecione as contas da Meta</h3>
            {data && !isRateLimited && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-[11px]"
                onClick={handleResync}
                disabled={isFetching}
                title="Buscar novamente as contas na Meta"
              >
                {isFetching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Sincronizar
              </Button>
            )}
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {data?.metaUser.name ? `Logado como ${data.metaUser.name}. ` : ""}
            {channel === "instagram"
              ? "Escolha quais contas do Instagram Business você deseja vincular a este projeto."
              : channel === "facebook"
                ? "Escolha quais Páginas do Facebook você deseja vincular a este projeto."
                : channel === "threads"
                  ? "Escolha quais perfis do Threads você deseja vincular a este projeto."
                  : channel === "ads"
                    ? "Escolha quais Contas de Anúncio você deseja vincular a este projeto."
                    : "Escolha quais Páginas, Contas do Instagram, perfis do Threads e Contas de Anúncio você deseja vincular a este projeto."}
          </p>
        </div>

        {data && !isLoading ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Facebook className="h-3 w-3" /> {fbPages.length} Páginas
              </Badge>
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Instagram className="h-3 w-3" /> {igPages.length} Instagram
              </Badge>
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <AtSign className="h-3 w-3" /> {threadsAccounts.length} Threads
              </Badge>
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <BarChart3 className="h-3 w-3" /> {adAccounts.length} Ads
              </Badge>
              {data.businessCount ? (
                <span>
                  em {data.businessCount} {data.businessCount === 1 ? "portfólio" : "portfólios"}
                </span>
              ) : null}
            </div>
            {data.scanWarnings?.length ? (
              <Collapsible className="rounded-md border border-amber-500/40 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
                <div className="flex items-center gap-2 p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <p className="min-w-0 flex-1 font-medium">
                    {fbPages.length + igPages.length} contas carregadas; algumas leituras foram
                    restringidas pela Meta.
                  </p>
                  <CollapsibleTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      title="Ver detalhes técnicos"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="border-t border-amber-500/30 px-3 pb-3 pt-2">
                  <ul className="max-h-32 list-disc space-y-1 overflow-y-auto pl-4 text-amber-700/80 dark:text-amber-300/80">
                    {data.scanWarnings.slice(0, 8).map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                  {data.scanWarnings.length > 8 ? (
                    <p className="mt-2 text-[11px]">
                      Mais {data.scanWarnings.length - 8} diagnósticos semelhantes foram ocultados.
                    </p>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        ) : null}

        {missingScopes.length > 0 && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Algumas permissões não foram concedidas.</p>
              <p className="text-amber-700/80 dark:text-amber-300/80">
                As funcionalidades ligadas a estas permissões ficarão limitadas:{" "}
                <code className="text-[10px]">{missingScopes.join(", ")}</code>. Refaça o login e
                mantenha todas as permissões marcadas para liberar publicação, insights e Ads.
              </p>
            </div>
          </div>
        )}

        {isLoading ? (
          <DiscoveryProgress active={isLoading} />
        ) : showNotLoadedState ? (
          <PortfolioActionState
            title="Portfólio ainda não carregado"
            description="Para proteger o limite da Graph API, o Unitos não busca contas automaticamente. Clique em Sincronizar uma única vez para carregar o portfólio salvo nesta sessão."
            actionLabel="Sincronizar agora"
            loading={isFetching}
            onAction={handleResync}
            onClose={() => onOpenChange(false)}
          />
        ) : showStoredRateLimitState ? (
          <PortfolioActionState
            title="Limite da Meta em resfriamento"
            description={
              data?.portfolioRateLimitedUntil
                ? `A Meta bloqueou novas leituras temporariamente. Tente novamente após ${new Date(data.portfolioRateLimitedUntil).toLocaleString("pt-BR")}.`
                : "A Meta bloqueou novas leituras temporariamente. Aguarde alguns minutos antes de tentar novamente."
            }
            actionLabel="Tentar novamente"
            loading={isFetching}
            onAction={handleResync}
            onClose={() => onOpenChange(false)}
            disabled={isFetching}
          />
        ) : error ? (
          <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-xs">
            <div className="flex items-start gap-2 text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="space-y-1">
                <p className="font-medium">
                  {isRateLimited
                    ? "Limite de requisições da Meta atingido."
                    : isSessionInvalid
                      ? "Sessão da Meta expirada."
                      : humanizeMetaError(error).title}
                </p>
                <p className="text-destructive/80">
                  {isRateLimited
                    ? "Por favor, aguarde alguns minutos antes de tentar novamente. O portfólio salvo será mantido."
                    : isSessionInvalid
                      ? "Faça login na Meta novamente para recarregar suas contas."
                      : humanizeMetaError(error).description}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {isSessionInvalid ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void reauthorize(channel === "ads" || !channel ? "facebook" : channel)
                  }
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Entrar novamente na Meta
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleResync}
                  disabled={isFetching || isRateLimited}
                >
                  {isFetching ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Tentar novamente
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </div>
        ) : (
          <Tabs defaultValue={channel ?? "facebook"} className="w-full">
            {(data?.businessCount ?? 0) > 0 && (
              <p className="mb-2 text-[11px] text-muted-foreground">
                {data?.businessCount} portfólio(s) empresarial(is) verificado(s) ·{" "}
                {data?.pagesCount ?? 0} Páginas · {igPages.length} contas do Instagram
              </p>
            )}
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={assetQuery}
                onChange={(e) => setAssetQuery(e.target.value)}
                placeholder="Buscar ativo por nome, @username ou ID"
                className="h-9 pl-8 text-xs"
              />
            </div>
            {linkedNow.length > 0 ? (
              <div className="mb-2 flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant={onlySelected ? "secondary" : "ghost"}
                  className="h-7 gap-1.5 text-[11px]"
                  onClick={() => setOnlySelected((v) => !v)}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {onlySelected ? "Mostrar todas" : "Só as selecionadas"}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {linkedNow.length} selecionada{linkedNow.length === 1 ? "" : "s"}
                </span>
              </div>
            ) : null}
            {!channel && (
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="facebook" className="gap-2 text-xs">
                  <Facebook className="h-3.5 w-3.5" />
                  Facebook
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {fbPages.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="instagram" className="gap-2 text-xs">
                  <Instagram className="h-3.5 w-3.5" />
                  Instagram
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {igPages.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="threads" className="gap-2 text-xs">
                  <AtSign className="h-3.5 w-3.5" />
                  Threads
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {threadsAccounts.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="ads" className="gap-2 text-xs">
                  <BarChart3 className="h-3.5 w-3.5" />
                  Ads
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {adAccounts.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            )}

            <TabsContent value="facebook" className="mt-3">
              <ScrollArea className="h-[min(420px,42vh)] rounded-lg border border-border/60">
                <ul className="divide-y divide-border/60">
                  {visibleFb.length === 0 ? (
                    <li className="p-6 text-center text-xs text-muted-foreground">
                      Nenhuma Página encontrada.
                    </li>
                  ) : (
                    visibleFb.map((p) => {
                      const key = `facebook:${p.pageId}`;
                      const connectionId = data?.connected.facebook[p.pageId] ?? null;
                      const isConnected = !!connectionId;
                      const isPending = pending.has(key);
                      return (
                        <li key={p.pageId} className="flex items-center gap-3 p-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={p.pagePictureUrl ?? undefined} alt={p.pageName} />
                            <AvatarFallback className="bg-[#1877F2]/10 text-[#1877F2]">
                              <Facebook className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{p.pageName}</span>
                              {isConnected && (
                                <Badge
                                  variant="outline"
                                  className="h-5 gap-1 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Vinculada
                                </Badge>
                              )}
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {p.category ?? "Página"} · Page ID {p.pageId}
                            </p>
                            <div className="mt-1">
                              <AccountStatusBadge
                                status={accountDiscoveryStatus(publishAuth, "facebook", p.pageId)}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isPending && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            )}
                            <Switch
                              checked={isConnected}
                              disabled={isPending}
                              onCheckedChange={(v) =>
                                handleToggle("facebook", p.pageId, p.pageId, v)
                              }
                            />
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="instagram" className="mt-3">
              {visibleIg.length === 0 ? (
                <InstagramEmptyDiagnostic
                  pagesCount={data?.pagesCount ?? fbPages.length}
                  pages={fbPages}
                  missingInstagramScope={(data?.missingScopes ?? []).includes("instagram_basic")}
                  missingPagesScope={(data?.missingScopes ?? []).includes("pages_show_list")}
                  onReauthorize={() => reauthorize("instagram")}
                />
              ) : (
                <ScrollArea className="h-[min(420px,42vh)] rounded-lg border border-border/60">
                  <ul className="divide-y divide-border/60">
                    {visibleIg.map((p) => {
                      const key = `instagram:${p.pageId}`;
                      const connectionId = p.instagramBusinessId
                        ? (data?.connected.instagram[p.instagramBusinessId] ?? null)
                        : null;
                      const isConnected = !!connectionId;
                      const isPending = pending.has(key);
                      return (
                        <li key={p.pageId} className="flex items-center gap-3 p-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              src={p.instagramPictureUrl ?? undefined}
                              alt={p.instagramUsername ?? p.pageName}
                            />
                            <AvatarFallback className="bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] text-white">
                              <Instagram className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                @{p.instagramUsername ?? p.pageName}
                              </span>
                              {isConnected && (
                                <Badge
                                  variant="outline"
                                  className="h-5 gap-1 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Vinculada
                                </Badge>
                              )}
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {"standalone" in p && p.standalone
                                ? `Portfólio${p.category ? ` ${p.category}` : ""} · sem Página vinculada`
                                : `Página: ${p.pageName}`}
                              {p.instagramBusinessId
                                ? ` · Instagram Business ID ${p.instagramBusinessId}`
                                : ""}
                            </p>
                            <div className="mt-1">
                              <AccountStatusBadge
                                status={accountDiscoveryStatus(
                                  publishAuth,
                                  "instagram",
                                  p.instagramBusinessId,
                                )}
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {isPending && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            )}
                            <Switch
                              checked={isConnected}
                              disabled={isPending}
                              onCheckedChange={(v) =>
                                handleToggle("instagram", p.pageId, p.instagramBusinessId, v)
                              }
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </ScrollArea>
              )}
            </TabsContent>

            <TabsContent value="threads" className="mt-3">
              <ScrollArea className="h-[min(420px,42vh)] rounded-lg border border-border/60">
                <ul className="divide-y divide-border/60">
                  {visibleThreads.length === 0 ? (
                    <li className="p-6 text-center text-xs text-muted-foreground">
                      Nenhum perfil do Threads encontrado nas suas Páginas.
                    </li>
                  ) : (
                    visibleThreads.map((t) => {
                      const key = `threads:${t.threadsUserId}`;
                      const connectionId = data?.connected.threads[t.threadsUserId] ?? null;
                      const isConnected = !!connectionId;
                      const isPending = pending.has(key);
                      return (
                        <li key={t.threadsUserId} className="flex items-center gap-3 p-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage
                              src={t.pictureUrl ?? undefined}
                              alt={t.username ?? t.threadsUserId}
                            />
                            <AvatarFallback className="bg-foreground/10">
                              <AtSign className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                @{t.username ?? t.name ?? t.threadsUserId}
                              </span>
                              {isConnected && (
                                <Badge
                                  variant="outline"
                                  className="h-5 gap-1 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Vinculada
                                </Badge>
                              )}
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">
                              Threads · ID {t.threadsUserId}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isPending && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            )}
                            <Switch
                              checked={isConnected}
                              disabled={isPending}
                              onCheckedChange={(v) =>
                                handleToggle("threads", t.threadsUserId, t.threadsUserId, v)
                              }
                            />
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="ads" className="mt-3">
              <ScrollArea className="h-[min(420px,42vh)] rounded-lg border border-border/60">
                <ul className="divide-y divide-border/60">
                  {visibleAds.length === 0 ? (
                    <li className="p-6 text-center text-xs text-muted-foreground">
                      Nenhuma Conta de Anúncios encontrada (requer permissão
                      <code className="mx-1 rounded bg-muted px-1">ads_read</code>).
                    </li>
                  ) : (
                    visibleAds.map((a) => {
                      const key = `ads:${a.adAccountId}`;
                      const connectionId = data?.connected.ads[a.adAccountId] ?? null;
                      const isConnected = !!connectionId;
                      const isPending = pending.has(key);
                      return (
                        <li key={a.adAccountId} className="flex items-center gap-3 p-3">
                          <Avatar className="h-10 w-10">
                            <AvatarFallback className="bg-blue-500/10 text-blue-500">
                              <BarChart3 className="h-4 w-4" />
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {a.name ?? a.adAccountId}
                              </span>
                              {isConnected && (
                                <Badge
                                  variant="outline"
                                  className="h-5 gap-1 border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[10px] text-emerald-600 dark:text-emerald-400"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Vinculada
                                </Badge>
                              )}
                            </div>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {a.businessName ? `${a.businessName} · ` : ""}
                              {a.currency ?? "—"} · {a.adAccountId}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {isPending && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            )}
                            <Switch
                              checked={isConnected}
                              disabled={isPending}
                              onCheckedChange={(v) =>
                                handleToggle("ads", a.adAccountId, a.adAccountId, v)
                              }
                            />
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {assign ? (
        <div className="-mx-1 mt-3 border-t border-border/60 bg-background px-1 pt-3">
          <MetaSelectionTray
            selected={linkedNow}
            onRemove={(item) =>
              void handleToggle(item.channel, item.targetId, item.lookupId, false)
            }
          />
          <MetaAssignFooter
            brandId={brandId}
            clientId={clientId}
            linked={linkedNow}
            onDone={() => {
              setLinkedNow([]);
              onOpenChange(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Rodapé de conclusão: mostra o que foi ativado, permite escolher o cliente e
 * encerra o fluxo. Sem ele o usuário ficava sem destino após ativar as contas.
 */
function MetaAssignFooter({
  brandId,
  clientId,
  linked,
  onDone,
}: {
  brandId: string;
  clientId?: string;
  linked: SelectedAccount[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const clientsFn = useServerFn(listClients);
  const toggleFn = useServerFn(toggleClientChannelFn);
  const [target, setTarget] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const clientsQ = useQuery({
    queryKey: ["meta-assign-clients", brandId],
    queryFn: () => clientsFn({ data: { brandId } }),
    enabled: !clientId && !!brandId,
    staleTime: 60_000,
  });
  const clients = (clientsQ.data ?? []) as Array<{ id: string; name: string }>;

  async function finish(withClient: boolean) {
    if (withClient && !target) {
      toast.error("Escolha o cliente que vai receber estas contas.");
      return;
    }
    setSaving(true);
    try {
      if (withClient) {
        for (const item of linked) {
          await toggleFn({
            data: { brandId, clientId: target, connectionId: item.connectionId, assigned: true },
          });
        }
        toast.success(
          linked.length === 1
            ? "Conta vinculada ao cliente."
            : `${linked.length} contas vinculadas ao cliente.`,
        );
        qc.invalidateQueries({ queryKey: ["client-channels", brandId] });
        qc.invalidateQueries({ queryKey: ["meta-connections", brandId] });
        qc.invalidateQueries({ queryKey: ["channels-kpis", brandId] });
      }
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível vincular ao cliente.");
    } finally {
      setSaving(false);
    }
  }

  const channels = linked.reduce<Record<string, number>>((acc, item) => {
    acc[item.channel] = (acc[item.channel] ?? 0) + 1;
    return acc;
  }, {});
  const state = assignFinishState({
    activated: linked.map((l) => l.label),
    clientId,
    target: target || undefined,
    clientName: clients.find((c) => c.id === target)?.name,
    channels,
  });
  const count = state.count;

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-muted-foreground">{state.destination}</p>
      {clientId ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void finish(false)} disabled={saving}>
            Concluir
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 sm:w-72">
            <Select value={target} onValueChange={setTarget} disabled={saving || count === 0}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Vincular ao cliente" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void finish(false)}
              disabled={saving || !state.canFinishWithoutClient}
            >
              Concluir sem cliente
            </Button>
            <Button
              size="sm"
              onClick={() => void finish(true)}
              disabled={saving || !state.canLink}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Vincular e concluir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Wrapper legado — mantém o modal autônomo para as telas que ainda abrem a
 * seleção de contas fora do fluxo "Conectar canais".
 */
export function MetaPortfolioDialog({
  brandId,
  clientId,
  sessionId,
  open,
  channel,
  onOpenChange,
}: {
  brandId: string;
  clientId?: string;
  sessionId: string | null;
  open: boolean;
  channel?: "facebook" | "instagram" | "threads" | "ads" | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const onPendingChange = useCallback((n: number) => setPending(n), []);

  function requestClose() {
    if (pending > 0 && !clientId) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : requestClose())}>
        <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col overflow-hidden border-border/60 bg-background/95 backdrop-blur">
          <DialogHeader>
            <DialogTitle className="text-base">Selecione as contas da Meta</DialogTitle>
            <DialogDescription className="text-xs">
              Ative as contas que você vai usar e, no final, escolha o cliente que vai recebê-las.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pr-1">
            <MetaAssetsPanel
              brandId={brandId}
              clientId={clientId}
              sessionId={sessionId}
              active={open}
              channel={channel}
              assign
              onPendingChange={onPendingChange}
              onClose={() => onOpenChange(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vincular a um cliente agora?</AlertDialogTitle>
            <AlertDialogDescription>
              As contas ativadas ficaram salvas no workspace, mas ainda não pertencem a nenhum
              cliente. Você pode escolher o cliente agora no rodapé da tela.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vincular</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                onOpenChange(false);
              }}
            >
              Sair
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}


function PortfolioActionState({
  title,
  description,
  actionLabel,
  loading,
  disabled,
  onAction,
  onClose,
}: {
  title: string;
  description: string;
  actionLabel: string;
  loading: boolean;
  disabled?: boolean;
  onAction: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/30 p-4 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onAction} disabled={disabled || loading} className="gap-2">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {actionLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </div>
  );
}

function InstagramEmptyDiagnostic({
  pagesCount,
  pages,
  missingInstagramScope,
  missingPagesScope,
  onReauthorize,
}: {
  pagesCount: number;
  pages: PortfolioPage[];
  missingInstagramScope: boolean;
  missingPagesScope: boolean;
  onReauthorize: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Nenhuma conta do Instagram Business foi encontrada.</p>
          <p className="text-xs text-muted-foreground">
            O Graph API só devolve IGs que estejam <b>vinculados a uma Página do Facebook</b> e que
            você tenha <b>marcado</b> na tela de permissões da Meta.
          </p>
        </div>
      </div>

      {missingPagesScope || missingInstagramScope ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-2.5 text-[11px] text-red-700 dark:text-red-300">
          Permissão negada:{" "}
          <code className="font-mono">
            {[missingPagesScope && "pages_show_list", missingInstagramScope && "instagram_basic"]
              .filter(Boolean)
              .join(", ")}
          </code>
          . Sem essas permissões o Instagram nunca aparece — refaça o login e mantenha-as marcadas.
        </div>
      ) : null}

      <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
        <p className="mb-2 font-medium">
          A Meta devolveu <span className="font-mono">{pagesCount}</span>{" "}
          {pagesCount === 1 ? "Página" : "Páginas"} nesta autorização
          {pagesCount > 0 ? " — nenhuma com Instagram Business vinculado:" : "."}
        </p>
        {pagesCount === 0 ? (
          <p className="text-muted-foreground">
            Você provavelmente não marcou nenhuma Página na tela &ldquo;Choose what you
            allow&rdquo;. Refaça o login e escolha <b>Opt in to all current and future Pages</b> (ou
            selecione manualmente todas as Páginas que administram seus IGs).
          </p>
        ) : (
          <ScrollArea className="max-h-32">
            <ul className="space-y-1 pr-2 font-mono text-[10px] text-muted-foreground">
              {pages.map((p) => (
                <li key={p.pageId} className="truncate">
                  · {p.pageName}{" "}
                  <span className="opacity-60">
                    (ID {p.pageId}
                    {p.instagramBusinessId ? "" : ", sem IG"})
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>

      <div className="flex flex-col gap-2 pt-1 sm:flex-row">
        <Button onClick={onReauthorize} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Autorizar novamente e liberar todas as Páginas
        </Button>
        <a
          href="https://www.facebook.com/business/help/898752960195806"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
        >
          Como vincular Instagram a uma Página →
        </a>
      </div>
    </div>
  );
}
