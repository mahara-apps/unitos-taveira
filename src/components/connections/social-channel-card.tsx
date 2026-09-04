import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AlertTriangle, Plus, RefreshCw, Search, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { readAuthorizeUrl } from "@/lib/meta/connect-flow";
import { ExpandedModal } from "@/components/ui/expanded-modal";

import { DashboardPanelSurface } from "@/components/ui/dashboard-primitives";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

import { disconnectMeta, refreshMetaConnection, startMetaOAuth } from "@/lib/meta/meta.functions";
import { upsertChannel } from "@/lib/connections.functions";

export type SocialAccount = {
  id: string;
  name: string;
  handle?: string | null;
  avatarUrl?: string | null;
  updatedAt?: string | null;
  status?: "active" | "attention" | "disconnected" | string;
  lastError?: string | null;
  tokenExpiresAt?: string | null;
};

export type SocialChannelDef = {
  id: "instagram" | "facebook" | "tiktok" | "youtube" | "linkedin" | "twitter" | "threads";
  name: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
  handleLabel: string;
  handlePlaceholder: string;
};

type Kind = "meta" | "manual";
type MetaConnectChannel = "facebook" | "instagram" | "threads";

function metaChannelFromId(id: SocialChannelDef["id"]): MetaConnectChannel | undefined {
  return id === "instagram" || id === "facebook" || id === "threads" ? id : undefined;
}

function metaPopupFeatures(): string {
  const width = 760;
  const height = 820;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  return `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`;
}

function metaStuckMessage(): string {
  return "A conexão da Meta não foi concluída. Se a janela ficou em branco ou em /business/cancel, tente novamente mantendo as permissões do canal selecionadas.";
}

function fmtSync(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "—";
  }
}

type Health = "active" | "expired" | "attention";

function accountHealth(acc: SocialAccount): Health {
  const expired = acc.tokenExpiresAt && new Date(acc.tokenExpiresAt).getTime() < Date.now();
  const errText = (acc.lastError ?? "").toLowerCase();
  const looksExpired = expired || /expired|invalid|revok|oauth/.test(errText);
  if (acc.status && acc.status !== "active") {
    return looksExpired ? "expired" : "attention";
  }
  if (looksExpired) return "expired";
  return "active";
}

function HealthBadge({ health }: { health: Health }) {
  if (health === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Conectado
      </span>
    );
  }
  if (health === "expired") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-red-700 dark:text-red-300">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Expirado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-wider text-amber-700 dark:text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
      Requer atenção
    </span>
  );
}

function overallStatus(accounts: SocialAccount[]): "connected" | "attention" | "disconnected" {
  if (accounts.length === 0) return "disconnected";
  const anyErr = accounts.some((a) => a.status && a.status !== "active");
  return anyErr ? "attention" : "connected";
}

function StatusPill({
  status,
  count,
}: {
  status: "connected" | "attention" | "disconnected";
  count: number;
}) {
  if (status === "connected") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[10px] text-emerald-700 dark:text-emerald-300"
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
        {count} {count === 1 ? "conta" : "contas"}
      </Badge>
    );
  }
  if (status === "attention") {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/40 bg-amber-500/10 font-mono text-[10px] text-amber-700 dark:text-amber-300"
      >
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
        Atenção · {count}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
      Desconectado
    </Badge>
  );
}

export function SocialChannelCard({
  channel,
  accounts,
  brandId,
  brandLabel,
  onChanged,
}: {
  channel: SocialChannelDef;
  accounts: SocialAccount[];
  brandId: string;
  brandLabel: string;
  onChanged: () => void;
}) {
  const kind: Kind =
    channel.id === "instagram" || channel.id === "facebook" || channel.id === "threads"
      ? "meta"
      : "manual";
  const Icon = channel.icon;
  const status = overallStatus(accounts);
  const primary = accounts[0];
  const [sheetOpen, setSheetOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

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
        <StatusPill status={status} count={accounts.length} />
      </div>

      <AccountsSummary accounts={accounts} channel={channel} brandLabel={brandLabel} />

      <Separator className="my-4" />

      <div className="flex gap-2">
        {accounts.length === 0 ? (
          kind === "manual" ? (
            <Button size="sm" variant="outline" className="flex-1" disabled>
              Integração em breve
            </Button>
          ) : (
            <ConnectButton
              kind={kind}
              channel={channel}
              brandId={brandId}
              hasExisting={false}
              existingLabel={null}
              manualOpen={manualOpen}
              setManualOpen={setManualOpen}
              onChanged={onChanged}
            />
          )
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => setSheetOpen(true)}
            >
              Gerenciar
            </Button>
            <ConnectButton
              kind={kind}
              channel={channel}
              brandId={brandId}
              hasExisting={true}
              existingLabel={primary?.handle ?? primary?.name ?? null}
              manualOpen={manualOpen}
              setManualOpen={setManualOpen}
              onChanged={onChanged}
              iconOnly
            />
          </>
        )}
      </div>

      <ManageSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        channel={channel}
        kind={kind}
        accounts={accounts}
        brandId={brandId}
        brandLabel={brandLabel}
        onChanged={onChanged}
        onAddNew={() => {
          setSheetOpen(false);
          setManualOpen(true);
        }}
      />
    </DashboardPanelSurface>
  );
}

function AccountsSummary({
  accounts,
  channel,
  brandLabel,
}: {
  accounts: SocialAccount[];
  channel: SocialChannelDef;
  brandLabel: string;
}) {
  const Icon = channel.icon;
  if (accounts.length === 0) {
    return (
      <div className="mt-4 flex min-h-[54px] items-center justify-center rounded-lg border border-dashed border-border/60 bg-background/40 p-3 text-center font-mono text-[10px] text-muted-foreground">
        Nenhuma conta conectada
      </div>
    );
  }

  if (accounts.length <= 2) {
    return (
      <div className="mt-4 space-y-1.5">
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 p-2.5"
          >
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={acc.avatarUrl ?? undefined} alt={acc.name} />
              <AvatarFallback className={cn("text-[10px]", channel.tone)}>
                <Icon className="h-3 w-3" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{acc.name}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                sync {fmtSync(acc.updatedAt)}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const preview = accounts.slice(0, 3);
  const extra = accounts.length - preview.length;
  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
      <div className="flex -space-x-2">
        {preview.map((acc) => (
          <Avatar key={acc.id} className="h-8 w-8 border-2 border-background ring-0">
            <AvatarImage src={acc.avatarUrl ?? undefined} alt={acc.name} />
            <AvatarFallback className={cn("text-[10px]", channel.tone)}>
              <Icon className="h-3.5 w-3.5" />
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">
          {accounts.length} contas conectadas
          {extra > 0 && <span className="ml-1 text-muted-foreground">· +{extra} além destas</span>}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          {brandLabel} · sync {fmtSync(accounts[0]?.updatedAt)}
        </div>
      </div>
    </div>
  );
}

function ConnectButton({
  kind,
  channel,
  brandId,
  hasExisting,
  existingLabel,
  manualOpen,
  setManualOpen,
  onChanged,
  iconOnly,
}: {
  kind: Kind;
  channel: SocialChannelDef;
  brandId: string;
  hasExisting: boolean;
  existingLabel?: string | null;
  manualOpen: boolean;
  setManualOpen: (v: boolean) => void;
  onChanged: () => void;
  iconOnly?: boolean;
}) {
  const qc = useQueryClient();
  const startFn = useServerFn(startMetaOAuth);
  const [connecting, setConnecting] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const oauthCompletedRef = useRef(false);

  // Listen for Meta OAuth popup postMessage.
  useEffect(() => {
    if (kind !== "meta") return;
    function onMsg(ev: MessageEvent) {
      const d = ev.data as { source?: string; ok?: boolean; error?: string; message?: string };
      if (!d || d.source !== "meta-oauth") return;
      oauthCompletedRef.current = true;
      setConnecting(false);
      if (d.ok) {
        toast.success(d.message ?? "Meta conectada");
        qc.invalidateQueries({ queryKey: ["meta-connections", brandId] });
        onChanged();
      } else if (d.error) {
        toast.error(d.error);
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [kind, brandId, qc, onChanged]);

  async function handleMetaConnect() {
    oauthCompletedRef.current = false;
    const popup = window.open("", "meta-oauth", metaPopupFeatures());
    setConnecting(true);
    try {
      const metaChannel = metaChannelFromId(channel.id);
      const authorizeUrl = readAuthorizeUrl(
        await startFn({
          data: { brandId, ...(metaChannel ? { channel: metaChannel } : {}), forceReauth: true },
        }),
      );
      if (popup) popup.location.href = authorizeUrl;
      else window.location.href = authorizeUrl;
      // Detect popup closed without completing OAuth so the button doesn't
      // stay stuck on "Conectando…" forever.
      if (popup) {
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
          if (oauthCompletedRef.current) {
            window.clearInterval(timer);
            return;
          }
          if (popup.closed) {
            window.clearInterval(timer);
            setConnecting((prev) => {
              if (prev && !oauthCompletedRef.current) {
                toast.error(metaStuckMessage(), { duration: 9000 });
              }
              return false;
            });
            return;
          }
          if (Date.now() - startedAt > 120_000) {
            window.clearInterval(timer);
            try {
              popup.close();
            } catch {
              /* noop */
            }
            setConnecting((prev) => {
              if (prev && !oauthCompletedRef.current) {
                toast.error(metaStuckMessage(), { duration: 9000 });
              }
              return false;
            });
          }
        }, 600);
      }
    } catch (e) {
      setConnecting(false);
      popup?.close();
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar OAuth");
    }
  }

  const label = connecting ? "Conectando…" : iconOnly ? "" : "Conectar";

  return (
    <>
      <Button
        size="sm"
        variant={iconOnly ? "ghost" : "default"}
        className={iconOnly ? "" : "flex-1"}
        disabled={connecting}
        onClick={() => {
          if (kind === "meta") {
            if (hasExisting) setReplaceOpen(true);
            else handleMetaConnect();
          } else setManualOpen(true);
        }}
        title={iconOnly ? "Adicionar conta" : undefined}
      >
        {iconOnly ? <Plus className="h-4 w-4" /> : label}
        {!iconOnly && !connecting ? null : null}
      </Button>

      {kind === "manual" && (
        <ManualConnectDialog
          open={manualOpen}
          onOpenChange={setManualOpen}
          channel={channel}
          brandId={brandId}
          onChanged={onChanged}
        />
      )}

      <Dialog open={replaceOpen} onOpenChange={setReplaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Substituir conexão de {channel.name}?</DialogTitle>
            <DialogDescription>
              Já existe uma conta ativa deste canal para esta marca
              {existingLabel ? ` (${existingLabel})` : ""}. Continuar irá substituir a conexão
              existente pela nova conta autorizada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReplaceOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setReplaceOpen(false);
                handleMetaConnect();
              }}
            >
              Substituir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ManualConnectDialog({
  open,
  onOpenChange,
  channel,
  brandId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: SocialChannelDef;
  brandId: string;
  onChanged: () => void;
}) {
  const [handle, setHandle] = useState("");
  const fn = useServerFn(upsertChannel);
  const saveMut = useMutation({
    mutationFn: () =>
      fn({ data: { brandId, channel: channel.id, handle: handle.trim(), connected: true } }),
    onSuccess: () => {
      toast.success(`${channel.name} conectado`);
      onOpenChange(false);
      setHandle("");
      onChanged();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Falha ao salvar"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
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
  );
}

function ManageSheet({
  open,
  onOpenChange,
  channel,
  kind,
  accounts,
  brandId,
  brandLabel,
  onChanged,
  onAddNew,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: SocialChannelDef;
  kind: Kind;
  accounts: SocialAccount[];
  brandId: string;
  brandLabel: string;
  onChanged: () => void;
  onAddNew: () => void;
}) {
  const qc = useQueryClient();
  const Icon = channel.icon;
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      [a.name, a.handle ?? "", a.id].some((v) => v.toLowerCase().includes(q)),
    );
  }, [accounts, query]);

  const refreshFn = useServerFn(refreshMetaConnection);
  const disconnectMetaFn = useServerFn(disconnectMeta);
  const upsertFn = useServerFn(upsertChannel);

  const invalidateMeta = () => qc.invalidateQueries({ queryKey: ["meta-connections", brandId] });

  const refreshMut = useMutation({
    mutationFn: (id: string) => refreshFn({ data: { connectionId: id, brandId } }),
    onSuccess: () => {
      toast.success("Conexão atualizada");
      invalidateMeta();
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao atualizar"),
  });

  const disconnectMut = useMutation({
    mutationFn: async (acc: SocialAccount) => {
      if (kind === "meta") {
        await disconnectMetaFn({ data: { connectionId: acc.id, brandId } });
      } else {
        await upsertFn({ data: { brandId, channel: channel.id, connected: false } });
      }
    },
    onSuccess: () => {
      toast.success("Conta desconectada");
      invalidateMeta();
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao desconectar"),
  });

  const startOAuthFn = useServerFn(startMetaOAuth);

  /**
   * Adds a Meta account. Every path goes through Meta's official dialog with
   * `auth_type=reauthenticate`, so login + Page/Instagram asset selection are
   * always shown. Existing sessions are never reused here — reusing them made
   * the in-app account selector replace Meta's own consent screen.
   */
  async function handleAddMeta(_opts?: { forceReauth?: boolean }) {
    const metaChannel = metaChannelFromId(channel.id);

    // O popup precisa ser criado sincronamente no clique, senão o navegador
    // bloqueia a janela depois de qualquer `await`.
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
      const authorizeUrl = readAuthorizeUrl(
        await startOAuthFn({
          data: {
            brandId,
            ...(metaChannel ? { channel: metaChannel } : {}),
            forceReauth: true,
          },
        }),
      );
      if (popup) popup.location.href = authorizeUrl;
      else window.location.href = authorizeUrl;
    } catch (e) {
      if (timeoutId) window.clearTimeout(timeoutId);
      window.removeEventListener("message", onOAuthMessage);
      popup?.close();
      toast.error(e instanceof Error ? e.message : "Falha ao iniciar OAuth");
    }
  }

  return (
    <ExpandedModal
      open={open}
      onOpenChange={onOpenChange}
      size="xs"
      title={
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "grid h-8 w-8 place-items-center rounded-md border border-border/60 bg-background/60",
              channel.tone,
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
          Gerenciar {channel.name}
        </span>
      }
      description={
        <>
          {accounts.length} {accounts.length === 1 ? "conta vinculada" : "contas vinculadas"} ao
          workspace <b>{brandLabel}</b>.
        </>
      }
      footer={
        <div className="w-full space-y-2">
          <Button
            className="w-full"
            variant="outline"
            onClick={() => {
              if (kind === "meta") handleAddMeta();
              else onAddNew();
            }}
          >
            <Plus className="mr-2 h-4 w-4" /> Adicionar conta
          </Button>
          {kind === "meta" && (
            <Button
              className="w-full text-xs text-muted-foreground"
              variant="ghost"
              size="sm"
              onClick={() => handleAddMeta({ forceReauth: true })}
              title="Faz logout na Meta e permite entrar com outro usuário"
            >
              Conectar outro perfil Meta
            </Button>
          )}
        </div>
      }
    >
      <>
        {accounts.length > 0 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, handle ou ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pl-9 text-xs"
            />
          </div>
        )}

        <div className="mt-3 space-y-1">
          {accounts.length === 0 ? (
            <p className="rounded-md border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
              Nenhuma conta conectada.
            </p>
          ) : filtered.length === 0 ? (
            <p className="rounded-md border border-dashed border-border/60 p-6 text-center text-xs text-muted-foreground">
              Nenhuma conta corresponde a “{query}”.
            </p>
          ) : (
            filtered.map((acc) => {
              const isRefreshing = refreshMut.isPending && refreshMut.variables === acc.id;
              const isDisconnecting =
                disconnectMut.isPending &&
                (disconnectMut.variables as SocialAccount)?.id === acc.id;
              const health = accountHealth(acc);
              const needsReconnect = health !== "active" && kind === "meta";
              return (
                <div
                  key={acc.id}
                  className="group flex items-center gap-3 rounded-md border border-transparent px-2 py-2 transition-colors hover:border-border/60 hover:bg-muted/40"
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={acc.avatarUrl ?? undefined} alt={acc.name} />
                    <AvatarFallback className={cn(channel.tone)}>
                      <Icon className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{acc.name}</span>
                      <HealthBadge health={health} />
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {acc.handle ?? acc.id} · sync {fmtSync(acc.updatedAt)}
                    </div>
                    {acc.lastError && (
                      <p className="truncate text-[10px] text-destructive" title={acc.lastError}>
                        {acc.lastError}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                    {needsReconnect ? (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8 gap-1.5 px-2.5 text-[11px]"
                        onClick={() => handleAddMeta({ forceReauth: true })}
                        title="Reautenticar esta conta na Meta"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Reconectar
                      </Button>
                    ) : kind === "meta" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={isRefreshing}
                        onClick={() => refreshMut.mutate(acc.id)}
                        title="Revalidar token"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
                      </Button>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      disabled={isDisconnecting}
                      onClick={() => disconnectMut.mutate(acc)}
                      title="Desconectar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </>
    </ExpandedModal>
  );
}
