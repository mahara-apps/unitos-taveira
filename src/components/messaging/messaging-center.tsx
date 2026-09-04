import { useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Briefcase, CheckCircle2, Loader2, Mail, Send, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageKpi, PageKpiGrid, type KpiStatus } from "@/components/ui/page-kpi";
import { TemplatesWorkspace } from "@/components/messaging/template-editor";
import { WhatsappComingSoonCard } from "@/components/connections/whatsapp-center";
import { WhatsappChannelCard } from "@/components/connections/whatsapp-channel-card";
import { WhatsappManualTestCard } from "@/components/connections/whatsapp-manual-test-card";
import { getMessagingKpis } from "@/lib/messaging-kpis.functions";
import {
  saveToolCredential,
  removeToolCredential,
  type ChannelConfig,
} from "@/lib/connections.functions";
import { sendTestMessage } from "@/lib/message-templates.functions";
import { getEmailChannelStatus } from "@/lib/email.functions";
import { EVENTS, getDefault, type Channel } from "@/lib/message-templates.catalog";
import { cn } from "@/lib/utils";

// WhatsApp (Evolution) tem fluxo próprio em <WhatsappCenter />.
// WhatsApp Cloud API fica fora da UI nesta versão (feature futura).
type ProviderId = "resend";

type ProviderDef = {
  id: ProviderId;
  name: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  /** Canal usado no envio de teste. */
  channel: Channel;
  handleLabel: string;
  handlePlaceholder: string;
  testLabel: string;
  testPlaceholder: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: "resend",
    name: "E-mail — Resend",
    hint: "Notificações, convites e templates transacionais",

    icon: Mail,
    channel: "email",
    handleLabel: "From address",
    handlePlaceholder: "hello@dominio.com",
    testLabel: "E-mail de destino",
    testPlaceholder: "voce@dominio.com",
  },
];

export function MessagingCenter({
  brandId,
  channels,
  isLoading,
  onChanged,
  canManage = false,
}: {
  brandId: string;
  channels: Record<string, ChannelConfig | undefined>;
  isLoading?: boolean;
  onChanged: () => void;
  canManage?: boolean;
}) {
  return (
    <div className="space-y-6">
      <MessagingKpis brandId={brandId} />

      <section className="space-y-3">
        <SectionTitle
          title="Canais de comunicação"
          hint="Provedores de mensageria configurados neste workspace."
        />
        <div className="grid gap-3 md:grid-cols-2">
          <WhatsappChannelCard brandId={brandId} canManage={canManage} />
          {isLoading ? (
            <Skeleton className="h-[196px] rounded-xl" />
          ) : (
            PROVIDERS.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                config={channels[p.id]}
                brandId={brandId}
                onChanged={onChanged}
              />
            ))
          )}
          <WhatsappComingSoonCard />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle
          title="Teste de envio"
          hint="Valide a conexão ativa do WhatsApp com um envio pontual."
        />
        <WhatsappManualTestCard brandId={brandId} canManage={canManage} />
      </section>

      <section className="space-y-3">
        <SectionTitle
          title="Templates de comunicação"
          hint="Gerencie as mensagens automáticas utilizadas pelo Unitos."
        />
        <TemplatesWorkspace brandId={brandId} />
      </section>
    </div>
  );
}


function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="space-y-0.5">
      <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* KPIs                                                                       */
/* -------------------------------------------------------------------------- */

function MessagingKpis({ brandId }: { brandId: string }) {
  const getKpis = useServerFn(getMessagingKpis);
  const { data, isLoading } = useQuery({
    queryKey: ["messaging-kpis", brandId],
    queryFn: () => getKpis({ data: { brandId } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <PageKpiGrid columns={4}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </PageKpiGrid>
    );
  }

  const sent = data?.sent30d ?? 0;
  const trend = data?.trendPct ?? null;
  const ratePct = data?.deliveryRate == null ? null : Math.round(data.deliveryRate * 100);
  const rateStatus: KpiStatus =
    ratePct == null ? "neutral" : ratePct > 95 ? "success" : ratePct >= 80 ? "warning" : "danger";
  const failed = data?.failed7d ?? 0;
  const covered = data?.brandsCovered ?? 0;
  const total = data?.brandsTotal ?? 0;
  const missing = Math.max(0, total - covered);

  return (
    <PageKpiGrid columns={4}>
      <PageKpi
        icon={<Send />}
        label="Enviadas"
        trailing="30d"
        status={sent > 0 ? "info" : "neutral"}
        value={sent.toLocaleString("pt-BR")}
        trend={trend == null ? undefined : { value: trend, label: "vs anterior" }}
        description={sent === 0 ? "Nenhum envio registrado" : undefined}
      />
      <PageKpi
        icon={<CheckCircle2 />}
        label="Taxa de entrega"
        trailing="30d"
        status={rateStatus}
        value={ratePct == null ? "—" : `${ratePct}%`}
        description={
          sent === 0
            ? "Sem dados no período"
            : `${(data?.delivered30d ?? 0).toLocaleString("pt-BR")} de ${sent.toLocaleString("pt-BR")}`
        }
      />
      <PageKpi
        icon={<AlertTriangle />}
        label="Falhas"
        trailing="7d"
        status={failed === 0 ? "success" : "warning"}
        value={failed.toLocaleString("pt-BR")}
        description={
          failed === 0 ? "Nenhuma falha registrada" : (data?.topFailedChannel ?? undefined)
        }
      />
      <PageKpi
        icon={<Briefcase />}
        label="Cobertura por marca"
        status={total > 0 && missing === 0 ? "success" : total === 0 ? "neutral" : "warning"}
        value={`${covered}/${total}`}
        description={
          total === 0
            ? "Nenhuma marca no workspace"
            : missing === 0
              ? "Cobertura completa"
              : `${missing} sem canal ativo`
        }
      />
    </PageKpiGrid>
  );
}

/* -------------------------------------------------------------------------- */
/* Provider card                                                              */
/* -------------------------------------------------------------------------- */

function ProviderCard({
  provider,
  config,
  brandId,
  onChanged,
}: {
  provider: ProviderDef;
  config?: ChannelConfig;
  brandId: string;
  onChanged: () => void;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const Icon = provider.icon;
  const queryClient = useQueryClient();

  // Estado exibido = estado usado pelo envio (mesmo resolvedor no servidor).
  const statusFn = useServerFn(getEmailChannelStatus);
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["email-channel-status", brandId],
    queryFn: () => statusFn({ data: { brandId } }),
    enabled: !!brandId && provider.channel === "email",
    staleTime: 30_000,
  });
  const connected = !!status?.configured;
  const sender = status?.from ?? config?.handle ?? null;

  // Qualquer mudança de credencial revalida o status compartilhado com o envio.
  const handleChanged = () => {
    void queryClient.invalidateQueries({ queryKey: ["email-channel-status", brandId] });
    onChanged();
  };

  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{provider.name}</div>
            <div className="truncate text-xs text-muted-foreground">{provider.hint}</div>
          </div>
        </div>
        {statusLoading ? (
          <Skeleton className="h-5 w-24 rounded-full" />
        ) : (
          <StatusPill connected={connected} />
        )}
      </div>

      <dl className="space-y-1 text-xs">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
          <dt className="text-muted-foreground">Credencial</dt>
          <dd className="truncate text-right font-medium">
            {connected ? "Configurada" : "Nenhuma credencial configurada"}
          </dd>
        </div>
        {connected && sender ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
            <dt className="text-muted-foreground">Remetente</dt>
            <dd className="truncate text-right font-medium">{sender}</dd>
          </div>
        ) : null}
      </dl>


      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={connected ? "outline" : "default"}
          className="flex-1"
          onClick={() => setManageOpen(true)}
        >
          {connected ? "Gerenciar" : "Configurar"}
        </Button>
        {connected && (
          <Button size="sm" variant="ghost" onClick={() => setTestOpen(true)}>
            Testar
          </Button>
        )}
      </div>

      <ManageProviderDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        provider={provider}
        config={config}
        brandId={brandId}
        onChanged={handleChanged}
      />
      <TestProviderDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        provider={provider}
        brandId={brandId}
      />
    </div>
  );
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 gap-1.5 text-[10px]",
        connected
          ? "border-health-good/40 bg-health-good/10 text-health-good"
          : "text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          connected ? "bg-health-good" : "bg-muted-foreground/60",
        )}
      />
      {connected ? "Conectado" : "Não configurado"}
    </Badge>
  );
}

function ManageProviderDialog({
  open,
  onOpenChange,
  provider,
  config,
  brandId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider: ProviderDef;
  config?: ChannelConfig;
  brandId: string;
  onChanged: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [handle, setHandle] = useState(config?.handle ?? "");
  const connected = !!config?.connected;

  const saveFn = useServerFn(saveToolCredential);
  const removeFn = useServerFn(removeToolCredential);

  const saveMut = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          brandId,
          provider: provider.id,
          apiKey: apiKey.trim(),
          metadata: handle.trim() ? { handle: handle.trim() } : undefined,
        },
      }),
    onSuccess: () => {
      toast.success(`${provider.name} conectado`);
      setApiKey("");
      onOpenChange(false);
      onChanged();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao conectar"),
  });

  const removeMut = useMutation({
    mutationFn: () => removeFn({ data: { brandId, provider: provider.id } }),
    onSuccess: () => {
      toast.success(`${provider.name} removido`);
      onOpenChange(false);
      onChanged();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao remover"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{provider.name}</DialogTitle>
          <DialogDescription>
            A credencial é armazenada de forma cifrada. Apenas uma identificação mascarada fica
            visível.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {connected && (
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">Credencial atual</span>
              <span className="font-mono">{config?.handle || "••••••••"}</span>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`key-${provider.id}`}>
              {connected ? "Nova credencial" : "API Key / Token"}
            </Label>
            <Input
              id={`key-${provider.id}`}
              type="password"
              autoComplete="off"
              placeholder="••••••••"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`handle-${provider.id}`}>{provider.handleLabel}</Label>
            <Input
              id={`handle-${provider.id}`}
              placeholder={provider.handlePlaceholder}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => removeMut.mutate()}
              disabled={removeMut.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remover
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || apiKey.trim().length < 4}
            >
              {saveMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestProviderDialog({
  open,
  onOpenChange,
  provider,
  brandId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider: ProviderDef;
  brandId: string;
}) {
  const [to, setTo] = useState("");
  const sendFn = useServerFn(sendTestMessage);

  const event = EVENTS.find((e) => e.channels.includes(provider.channel));
  const defaults = event ? getDefault(event.key, provider.channel) : undefined;

  const testMut = useMutation({
    mutationFn: async () => {
      if (!event || !defaults) throw new Error("Nenhum template disponível para este canal.");
      if (!to.trim()) throw new Error("Informe um destinatário.");
      return sendFn({
        data: {
          brandId,
          eventKey: event.key,
          channel: provider.channel,
          subject: provider.channel === "email" ? (defaults.subject ?? null) : null,
          body: defaults.body,
          to: to.trim(),
        },
      });
    },
    onSuccess: (r) => {
      if (r.sent) {
        toast.success("Mensagem de teste enviada");
        onOpenChange(false);
      } else {
        toast.error(r.error ? `Não enviado: ${r.error}` : "Não enviado");
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha no envio"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Testar {provider.name}</DialogTitle>
          <DialogDescription>
            Envio real usando o template padrão de{" "}
            {provider.channel === "email" ? "e-mail" : "WhatsApp"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`test-${provider.id}`}>{provider.testLabel}</Label>
          <Input
            id={`test-${provider.id}`}
            placeholder={provider.testPlaceholder}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => testMut.mutate()} disabled={testMut.isPending}>
            {testMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Enviar teste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
