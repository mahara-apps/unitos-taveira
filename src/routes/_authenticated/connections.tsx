import { createFileRoute, Navigate } from "@tanstack/react-router";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import { useEffect, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sparkles,
  KeyRound,
  Radio,
  CheckCircle2,
  Mail,
  Instagram,
  Facebook,
  Youtube,
  Music2,
  MessageCircle,
  Send,
  Linkedin,
  Twitter,
  AtSign,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { AlertTriangle, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessagingCenter } from "@/components/messaging/messaging-center";
import {
  SocialChannelCard,
  type SocialAccount,
  type SocialChannelDef,
} from "@/components/connections/social-channel-card";
import { MetaPortfolioDialog } from "@/components/connections/meta-portfolio-dialog";
import { listMetaConnections } from "@/lib/meta/meta.functions";
import { supabase } from "@/integrations/supabase/client";
import { useActiveContext } from "@/hooks/use-active-context";
import { ChannelsCenter } from "@/components/connections/channels-center";
import { useAccessRole } from "@/hooks/use-access-role";
import {
  getConnections,
  updateConnectionsSettings,
  upsertChannel,
  saveToolCredential,
  removeToolCredential,
} from "@/lib/connections.functions";
import { getMessagingKpis } from "@/lib/messaging-kpis.functions";
import { usePageHeader } from "@/hooks/use-page-header";
import { DashboardPageShell, DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { KpiCard } from "@/components/ui/kpi-card";
import { AiCenter, type AiSettingsUpdate } from "@/components/connections/ai-center";
import { AiUsagePanel } from "@/components/connections/ai-usage-panel";
import { AiPromptsPanel } from "@/components/connections/ai-prompts-panel";
import { LogViewer } from "@/components/system-logs/log-viewer";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type ConnectionsSearch = { tab?: "channels" | "ai" | "messaging"; section?: string };

export const Route = createFileRoute("/_authenticated/connections")({
  beforeLoad: () => ensureFeatureEnabled("connections"),
  validateSearch: (search: Record<string, unknown>): ConnectionsSearch => ({
    tab:
      search.tab === "ai" || search.tab === "messaging" || search.tab === "channels"
        ? search.tab
        : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
  }),
  component: ConnectionsPage,
});

function ConnectionsHeaderRegister() {
  usePageHeader({
    title: "Conexões",
    subtitle: "Chaves de IA, canais sociais e comunicações do workspace · cifradas com AES-256-GCM",
  });
  return null;
}

type ProviderId = "openai" | "anthropic" | "gemini" | "groq";
type ChannelId =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "twitter"
  | "threads"
  | "whatsapp_evolution"
  | "whatsapp_cloud"
  | "resend";

type ChannelDef = {
  id: ChannelId;
  name: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  handleLabel: string;
  handlePlaceholder: string;
};

const SOCIAL_CHANNELS: ChannelDef[] = [
  {
    id: "instagram",
    name: "Instagram",
    hint: "Feed, Reels & Stories",
    icon: Instagram,
    tone: "text-pink-500",
    handleLabel: "Handle",
    handlePlaceholder: "@marca",
  },
  {
    id: "tiktok",
    name: "TikTok",
    hint: "Business API",
    icon: Music2,
    tone: "text-foreground",
    handleLabel: "Handle",
    handlePlaceholder: "@marca",
  },
  {
    id: "facebook",
    name: "Facebook",
    hint: "Páginas & Ads",
    icon: Facebook,
    tone: "text-sky-600",
    handleLabel: "Página",
    handlePlaceholder: "facebook.com/marca",
  },
  {
    id: "youtube",
    name: "YouTube",
    hint: "Shorts & vídeos longos",
    icon: Youtube,
    tone: "text-red-500",
    handleLabel: "Canal",
    handlePlaceholder: "@marca",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    hint: "Company Pages & posts",
    icon: Linkedin,
    tone: "text-sky-700",
    handleLabel: "Página",
    handlePlaceholder: "linkedin.com/company/marca",
  },
  {
    id: "twitter",
    name: "Twitter / X",
    hint: "Posts & threads",
    icon: Twitter,
    tone: "text-foreground",
    handleLabel: "Handle",
    handlePlaceholder: "@marca",
  },
  {
    id: "threads",
    name: "Threads",
    hint: "Meta Threads",
    icon: AtSign,
    tone: "text-foreground",
    handleLabel: "Handle",
    handlePlaceholder: "@marca",
  },
];

const MESSAGING_CHANNELS: ChannelDef[] = [
  {
    id: "whatsapp_evolution",
    name: "WhatsApp Evolution",
    hint: "Instância self-hosted",
    icon: MessageCircle,
    tone: "text-emerald-500",
    handleLabel: "Base URL da instância",
    handlePlaceholder: "https://evo.dominio.com",
  },
  {
    id: "whatsapp_cloud",
    name: "WhatsApp Cloud API",
    hint: "Meta Business Cloud",
    icon: Send,
    tone: "text-emerald-600",
    handleLabel: "Phone Number ID",
    handlePlaceholder: "123456789012345",
  },
  {
    id: "resend",
    name: "Resend",
    hint: "E-mails transacionais",
    icon: Mail,
    tone: "text-violet-500",
    handleLabel: "From address",
    handlePlaceholder: "hello@dominio.com",
  },
];

function ConnectionsPage() {
  const { brandId } = useActiveContext();
  const qc = useQueryClient();
  // Autoridade de integração = super_admin | admin (owner normaliza para admin).
  // NÃO usar o `role` legado: ele funde MANAGER em "admin".
  const { canManageIntegrations, isReady } = useAccessRole();
  const search = Route.useSearch();
  const aiSection = ["providers", "usage", "logs", "prompts"].includes(search.section ?? "")
    ? search.section!
    : "providers";

  // Portfolio selector state (Meta OAuth post-callback).
  const [portfolioSessionId, setPortfolioSessionId] = useState<string | null>(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [portfolioChannel, setPortfolioChannel] = useState<
    "facebook" | "instagram" | "threads" | "ads" | null
  >(null);

  // Global listener for postMessage from the OAuth popup.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const d = ev.data as {
        source?: string;
        type?: string;
        ok?: boolean;
        sessionId?: string | null;
        channel?: "facebook" | "instagram" | "threads" | "ads" | null;
        scopes?: string[];
      };
      if (!d || d.source !== "meta-oauth") return;
      if (d.type === "missing-scopes" && d.scopes?.length) {
        toast.warning(
          `Permissões negadas: ${d.scopes.join(", ")}. Funcionalidades ligadas ficarão limitadas.`,
          { duration: 8000 },
        );
        return;
      }
      if (d.ok && d.sessionId) {
        setPortfolioSessionId(d.sessionId);
        setPortfolioChannel(d.channel ?? null);
        setPortfolioOpen(true);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // URL fallback: if the popup couldn't post to opener (COOP / manual close),
  // the callback appends ?meta_session=<id> so a reload still opens the dialog.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("meta_session");
    const ch = params.get("meta_channel") as "facebook" | "instagram" | "threads" | "ads" | null;
    if (sid) {
      setPortfolioSessionId(sid);
      setPortfolioChannel(ch);
      setPortfolioOpen(true);
      params.delete("meta_session");
      params.delete("meta_channel");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  const getFn = useServerFn(getConnections);
  const { data, isLoading } = useQuery({
    queryKey: ["connections", brandId],
    queryFn: () => getFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const getMsgKpisFn = useServerFn(getMessagingKpis);
  const { data: msgKpis } = useQuery({
    queryKey: ["messaging-kpis", brandId],
    queryFn: () => getMsgKpisFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  const listMetaFn = useServerFn(listMetaConnections);
  const { data: metaConnections = [] } = useQuery({
    queryKey: ["meta-connections", brandId],
    queryFn: () => listMetaFn({ data: { brandId: brandId! } }),
    enabled: !!brandId,
  });

  const { data: brandRow } = useQuery({
    queryKey: ["brand-name", brandId],
    queryFn: async () => {
      const { data } = await supabase
        .from("brands")
        .select("name")
        .eq("id", brandId!)
        .maybeSingle();
      return data;
    },
    enabled: !!brandId,
    staleTime: 5 * 60_000,
  });
  const brandLabel = brandRow?.name ?? "Workspace";

  const invalidate = () => qc.invalidateQueries({ queryKey: ["connections", brandId] });

  type UpdateInput = {
    brandId: string;
    monthlyBudgetUsd?: number;
    textProvider?: ProviderId;
    imageProvider?: ProviderId;
    textFallbackProvider?: ProviderId | "none";
  };
  const updateFn = useServerFn(updateConnectionsSettings);
  const updateMut = useMutation({
    mutationFn: (input: UpdateInput) => updateFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Configurações atualizadas");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  // Gate: /connections é área admin (BM, credenciais globais, mapa de conexões).
  // Contas operacionais por cliente vivem em /customers/:id → aba Canais.
  // IMPORTANTE: este early-return fica DEPOIS de todos os hooks — colocá-lo
  // antes fazia a segunda renderização (isReady: false → true) executar menos
  // hooks e derrubar a tela com "Rendered fewer hooks than expected".
  if (isReady && !canManageIntegrations) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!brandId) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
        Selecione um workspace para ver as conexões.
      </div>
    );
  }

  const active = data?.monthlyBudgetUsd ?? 500;
  const used = data?.usage.monthUsd ?? 0;
  const pct = Math.min(100, Math.round((used / (active || 1)) * 100));
  const totalCalls = data?.usage.totalCalls ?? 0;
  const successCalls = data?.usage.successCalls ?? 0;
  const successRate = totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0;
  const noUsage = !isLoading && totalCalls === 0;
  const byProvider = data?.usage.byProvider ?? {};

  const channelsMap = (data?.channels ?? {}) as Record<
    string,
    { connected?: boolean; handle?: string; updatedAt?: string } | undefined
  >;

  const summarize = (defs: ChannelDef[]) => {
    const total = defs.length;
    const connectedDefs = defs.filter((d) => channelsMap[d.id]?.connected);
    const connected = connectedDefs.length;
    const pending = defs.filter((d) => !channelsMap[d.id]?.connected);
    const latest = connectedDefs
      .map((d) => ({ def: d, at: channelsMap[d.id]?.updatedAt }))
      .filter((x) => !!x.at)
      .sort((a, b) => (a.at! < b.at! ? 1 : -1))[0];
    const latestRel = latest?.at
      ? formatDistanceToNow(new Date(latest.at), { addSuffix: true, locale: ptBR })
      : "—";
    return { total, connected, pending, latest, latestRel };
  };

  const ch = summarize(SOCIAL_CHANNELS);
  const ms = summarize(MESSAGING_CHANNELS);
  const chTone: "emerald" | "amber" | "rose" =
    ch.connected >= 4 ? "emerald" : ch.connected >= 1 ? "amber" : "rose";
  const msTone: "emerald" | "amber" | "rose" =
    ms.connected === ms.total ? "emerald" : ms.connected >= 1 ? "amber" : "rose";
  const chCoverage = Math.round((ch.connected / ch.total) * 100);
  const pendingNames = (list: ChannelDef[]) =>
    list
      .map((d) => d.name)
      .slice(0, 3)
      .join(", ") || "Nenhum";

  return (
    <DashboardPageShell>
      <ConnectionsHeaderRegister />

      <MetaPortfolioDialog
        brandId={brandId}
        sessionId={portfolioSessionId}
        open={portfolioOpen}
        channel={portfolioChannel}
        onOpenChange={(v) => {
          setPortfolioOpen(v);
          if (!v) qc.invalidateQueries({ queryKey: ["meta-connections", brandId] });
        }}
      />

      <Tabs defaultValue={search.tab ?? "channels"} className="space-y-4">
        <TabsList variant="bordered">
          <TabsTrigger value="channels">
            <Radio className="h-3.5 w-3.5" />
            Canais
          </TabsTrigger>
          <TabsTrigger value="ai">
            <Sparkles className="h-3.5 w-3.5" />
            IA
          </TabsTrigger>
          <TabsTrigger value="messaging">
            <Send className="h-3.5 w-3.5" />
            Mensageria
          </TabsTrigger>
        </TabsList>

        {/* Tab: IA — Centro de IA (provedores, governança, execuções, prompts) */}
        <TabsContent value="ai" className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Inteligência Artificial</h2>
            <p className="text-xs text-muted-foreground">
              Provedores e modelos, limites e consumo, execuções e prompts dos agentes.
            </p>
          </div>
          <Tabs defaultValue={aiSection} className="space-y-4">
            <TabsList>
              <TabsTrigger value="providers">Provedores & Modelos</TabsTrigger>
              {canManageIntegrations ? (
                <>
                  <TabsTrigger value="usage">Limites & Consumo</TabsTrigger>
                  <TabsTrigger value="logs">Execuções</TabsTrigger>
                  <TabsTrigger value="prompts">Prompts</TabsTrigger>
                </>
              ) : null}
            </TabsList>

            <TabsContent value="providers" className="space-y-4">
              <AiCenter
                brandId={brandId}
                data={data as unknown as never}
                isLoading={isLoading}
                onChanged={invalidate}
                isSaving={updateMut.isPending}
                onUpdateSettings={(input: AiSettingsUpdate) =>
                  updateMut.mutate({ brandId, ...input })
                }
              />
            </TabsContent>

            {canManageIntegrations ? (
              <>
                <TabsContent value="usage" className="space-y-4">
                  <AiUsagePanel brandId={brandId} />
                </TabsContent>

                <TabsContent value="logs" className="space-y-4">
                  <LogViewer
                    queryKey="ai-center-logs"
                    sources={["ai_job"]}
                    title="Execuções de IA"
                    description="Jobs de IA executados no workspace. Últimas 300 entradas por consulta."
                  />
                </TabsContent>

                <TabsContent value="prompts" className="space-y-4">
                  <AiPromptsPanel brandId={brandId} />
                </TabsContent>
              </>
            ) : null}
          </Tabs>
        </TabsContent>

        {/* Tab: Canais */}
        <TabsContent value="channels" className="space-y-3">
          <ChannelsCenter brandId={brandId} canManage={canManageIntegrations} />
        </TabsContent>

        {/* Tab: Mensageria */}
        <TabsContent value="messaging" className="space-y-4">
          <div>
            <h2 className="text-base font-semibold">Mensageria</h2>
            <p className="text-xs text-muted-foreground">
              Configure os canais de comunicação e gerencie os templates usados pelo sistema.
            </p>
          </div>
          <MessagingCenter
            brandId={brandId}
            channels={data?.channels ?? {}}
            isLoading={isLoading}
            onChanged={invalidate}
            canManage={canManageIntegrations}
          />
        </TabsContent>
      </Tabs>
    </DashboardPageShell>
  );
}

/* -------------------------------------------------------------------------- */

function SectionHeader({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex items-end justify-between border-b border-border/60 pb-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="font-mono text-[11px] uppercase tracking-widest">{title}</span>
      </div>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}

type MetaConnRow = Awaited<ReturnType<typeof listMetaConnections>>[number];

function accountsForChannel(
  channel: ChannelDef,
  legacy: { connected?: boolean; handle?: string; updatedAt?: string } | undefined,
  meta: MetaConnRow[],
): SocialAccount[] {
  if (channel.id === "facebook") {
    return meta
      .filter((c) => c.channel === "facebook")
      .map((c) => {
        const md = (c.metadata ?? {}) as { page_picture_url?: string | null };
        return {
          id: c.id,
          name: c.externalName ?? c.externalId,
          handle: c.externalName ?? undefined,
          avatarUrl: md.page_picture_url ?? undefined,
          updatedAt: c.updatedAt,
          status: c.status === "active" ? "active" : "attention",
          lastError: c.lastError,
          tokenExpiresAt: c.tokenExpiresAt,
        };
      });
  }
  if (channel.id === "instagram") {
    return meta
      .filter((c) => c.channel === "instagram")
      .filter((c) => {
        const md = (c.metadata ?? {}) as { instagram_username?: string | null };
        return c.accountUsername || md.instagram_username;
      })
      .map((c) => {
        const md = (c.metadata ?? {}) as {
          instagram_picture_url?: string | null;
          instagram_username?: string | null;
        };
        const uname = c.accountUsername ?? md.instagram_username ?? "";
        return {
          id: c.id,
          name: uname ? `@${uname}` : (c.externalName ?? c.externalId),
          handle: uname ? `@${uname}` : undefined,
          avatarUrl: md.instagram_picture_url ?? undefined,
          updatedAt: c.updatedAt,
          status: c.status === "active" ? "active" : "attention",
          lastError: c.lastError,
          tokenExpiresAt: c.tokenExpiresAt,
        };
      });
  }
  // Channels without a real OAuth pipeline (TikTok, YouTube, LinkedIn, X)
  // stay empty until we ship provider integration. Legacy manual toggles
  // stored in brand_connections.channels are ignored so the UI never shows
  // an "account" that has never been authorized.
  void legacy;
  return [];
}

function MessagingKpiCards({
  data,
}: {
  data:
    | {
        sent30d: number;
        sentPrev30d: number;
        trendPct: number | null;
        delivered30d: number;
        deliveryRate: number | null;
        failed7d: number;
        topFailedChannel: string | null;
        brandsTotal: number;
        brandsCovered: number;
      }
    | undefined;
}) {
  const sent = data?.sent30d ?? 0;
  const trend = data?.trendPct ?? null;
  const rate = data?.deliveryRate;
  const ratePct = rate == null ? null : Math.round(rate * 100);
  const rateTone: "emerald" | "amber" | "rose" | "neutral" =
    ratePct == null ? "neutral" : ratePct > 95 ? "emerald" : ratePct >= 80 ? "amber" : "rose";
  const failed = data?.failed7d ?? 0;
  const covered = data?.brandsCovered ?? 0;
  const total = data?.brandsTotal ?? 0;
  const missing = Math.max(0, total - covered);

  return (
    <>
      <KpiCard
        icon={<Send className="h-4 w-4" />}
        label="Enviadas (30d)"
        value={sent.toLocaleString("pt-BR")}
        sub={
          sent === 0
            ? "Nenhum envio registrado"
            : trend == null
              ? "Sem comparação anterior"
              : `${trend >= 0 ? "+" : ""}${trend}% vs período anterior`
        }
        tone="rose"
      />
      <KpiCard
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="Taxa de entrega"
        value={ratePct == null ? "—" : `${ratePct}%`}
        sub={
          sent === 0
            ? "Sem dados no período"
            : `${(data?.delivered30d ?? 0).toLocaleString("pt-BR")} entregues de ${sent.toLocaleString("pt-BR")} enviadas`
        }
        tone={rateTone}
      />
      <KpiCard
        icon={<AlertTriangle className="h-4 w-4" />}
        label="Falhas (7d)"
        value={failed.toLocaleString("pt-BR")}
        sub={failed === 0 ? "Nenhuma falha registrada" : (data?.topFailedChannel ?? "—")}
        tone={failed === 0 ? "emerald" : "amber"}
      />
      <KpiCard
        icon={<Briefcase className="h-4 w-4" />}
        label="Cobertura por marca"
        value={`${covered}/${total}`}
        sub={
          total === 0
            ? "Nenhuma marca no workspace"
            : missing === 0
              ? "Cobertura completa"
              : `${missing} marca${missing > 1 ? "s" : ""} sem canal ativo`
        }
        tone={total > 0 && missing === 0 ? "emerald" : "violet"}
      />
    </>
  );
}

function ChannelCard({
  channel,
  config,
  brandId,
  onChanged,
}: {
  channel: ChannelDef;
  config?: { connected: boolean; handle?: string; updatedAt?: string };
  brandId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState(config?.handle ?? "");
  const Icon = channel.icon;

  const fn = useServerFn(upsertChannel);
  const saveMut = useMutation({
    mutationFn: () =>
      fn({ data: { brandId, channel: channel.id, handle: handle.trim(), connected: true } }),
    onSuccess: () => {
      toast.success(`${channel.name} conectado`);
      setOpen(false);
      onChanged();
    },
  });
  const removeMut = useMutation({
    mutationFn: () => fn({ data: { brandId, channel: channel.id, connected: false } }),
    onSuccess: () => {
      toast.success(`${channel.name} desconectado`);
      onChanged();
    },
  });

  const connected = !!config?.connected;

  return (
    <DashboardPanelSurface className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid h-10 w-10 place-items-center rounded-lg border border-border/60 bg-background/60",
              channel.tone,
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-semibold">{channel.name}</div>
            <div className="font-mono text-[10px] text-muted-foreground">{channel.hint}</div>
          </div>
        </div>
        <StatusBadge connected={connected} label={connected ? config?.handle : undefined} />
      </div>

      <Separator className="my-4" />

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={connected ? "outline" : "default"}
          className="flex-1"
          onClick={() => setOpen(true)}
        >
          {connected ? "Editar" : "Conectar"}
        </Button>
        {connected && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => removeMut.mutate()}
            disabled={removeMut.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar {channel.name}</DialogTitle>
            <DialogDescription>
              Informe o identificador da conta para exibir na página de conexões.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`handle-${channel.id}`}>{channel.handleLabel}</Label>
            <Input
              id={`handle-${channel.id}`}
              placeholder={channel.handlePlaceholder}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || handle.trim().length === 0}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardPanelSurface>
  );
}

function StatusBadge({ connected, label }: { connected: boolean; label?: string }) {
  if (connected) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-300"
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        {label ?? "Conectado"}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
      Não configurado
    </Badge>
  );
}

function ToolCredentialCard({
  tool,
  config,
  brandId,
  onChanged,
}: {
  tool: ChannelDef;
  config?: { connected: boolean; handle?: string; updatedAt?: string };
  brandId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [handle, setHandle] = useState(config?.handle ?? "");
  const Icon = tool.icon;

  const saveFn = useServerFn(saveToolCredential);
  const removeFn = useServerFn(removeToolCredential);

  const provider = tool.id as "resend" | "whatsapp_evolution" | "whatsapp_cloud";

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          brandId,
          provider,
          apiKey: apiKey.trim(),
          metadata: handle.trim() ? { handle: handle.trim() } : undefined,
        },
      }),
    onSuccess: () => {
      toast.success(`${tool.name} conectado`);
      setApiKey("");
      setOpen(false);
      onChanged();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao conectar"),
  });

  const removeMut = useMutation({
    mutationFn: () => removeFn({ data: { brandId, provider } }),
    onSuccess: () => {
      toast.success(`${tool.name} desconectado`);
      onChanged();
    },
  });

  const connected = !!config?.connected;

  return (
    <DashboardPanelSurface className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "grid h-10 w-10 place-items-center rounded-lg border border-border/60 bg-background/60",
              tool.tone,
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-semibold">{tool.name}</div>
            <div className="font-mono text-[10px] text-muted-foreground">{tool.hint}</div>
          </div>
        </div>
        <StatusBadge connected={connected} label={connected ? config?.handle : undefined} />
      </div>

      <div className="mt-4 rounded-lg border border-border/60 bg-background/60 p-3">
        <div className="flex items-center justify-between font-mono text-[11px]">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <KeyRound className="h-3 w-3" />
            API Key
          </span>
          <span className="tabular-nums text-foreground/80">{connected ? "•••• segura" : "—"}</span>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Cifrada com AES-256-GCM (BRAND_CREDENTIALS_SECRET)
        </div>
      </div>

      <Separator className="my-4" />

      <div className="flex gap-2">
        <Button
          size="sm"
          variant={connected ? "outline" : "default"}
          className="flex-1"
          onClick={() => setOpen(true)}
        >
          {connected ? "Rotacionar chave" : "Conectar"}
        </Button>
        {connected && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => removeMut.mutate()}
            disabled={removeMut.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar {tool.name}</DialogTitle>
            <DialogDescription>
              A chave é cifrada com AES-256-GCM antes de ser salva. Apenas os últimos 4 caracteres
              ficam visíveis.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`tool-key-${tool.id}`}>API Key / Token</Label>
              <PasswordInput
                id={`tool-key-${tool.id}`}
                autoComplete="off"
                placeholder="••••"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`tool-handle-${tool.id}`}>{tool.handleLabel}</Label>
              <Input
                id={`tool-handle-${tool.id}`}
                placeholder={tool.handlePlaceholder}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
              <p className="font-mono text-[10px] text-muted-foreground">
                Este campo é armazenado em claro (não é secreto).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || apiKey.trim().length < 4}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardPanelSurface>
  );
}
