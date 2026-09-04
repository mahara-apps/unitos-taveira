import { useMemo, useState } from "react";
import {
  checkDestinationsReadinessFn,
  type DestinationReadiness,
} from "@/lib/publish-capability.functions";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Link2, Loader2, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAccessRole } from "@/hooks/use-access-role";
import { cn } from "@/lib/utils";
import {
  CHANNEL_ICON_SIZE,
  channelDef,
  normalizeStatus,
  type StatusKey,
} from "@/components/connections/channel-meta";
import { ClientWhatsappSection } from "@/components/customer/client-whatsapp-section";
import {
  ProfileEmpty,
  ProfilePageHeader,
  ProfileSection,
} from "@/components/customer/ui/profile-ui";
import {
  listClientLinkedChannelsFn,
  listWorkspaceChannelsFn,
  toggleClientChannelFn,
  type LinkedChannel,
  type WorkspaceChannel,
} from "@/lib/client-channels.functions";

/**
 * Perfil do cliente > Canais.
 *
 * Mostra EXCLUSIVAMENTE os canais vinculados a este cliente
 * (`client_social_accounts`). Nunca lista canais de outros clientes nem
 * inicia OAuth — a conexão de contas acontece em /connections (workspace).
 */

/* ------------------------------ status badge ------------------------------ */

const STATUS_META: Record<StatusKey, { label: string; dot: string; text: string; ring: string }> = {
  active: {
    label: "Conectado",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    ring: "border-emerald-500/30 bg-emerald-500/10",
  },
  attention: {
    label: "Atenção",
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    ring: "border-amber-500/30 bg-amber-500/10",
  },
  disconnected: {
    label: "Desconectado",
    dot: "bg-destructive",
    text: "text-destructive",
    ring: "border-destructive/30 bg-destructive/10",
  },
  soon: {
    label: "Em breve",
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    ring: "border-border/60 bg-muted/40",
  },
};

function ChannelStatusBadge({ status }: { status: StatusKey }) {
  const m = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide",
        m.ring,
        m.text,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

const PROVIDER_LABEL: Record<string, string> = { meta: "Meta" };


function accountType(row: LinkedChannel) {
  if (row.channel === "instagram") return "Instagram Business";
  if (row.channel === "facebook") return "Página do Facebook";
  return channelDef(row.channel).label;
}

/* --------------------------------- screen --------------------------------- */

export function ChannelsTab({ brandId, clientId }: { brandId: string; clientId: string }) {
  const qc = useQueryClient();
  // owner/manager/super_admin podem vincular e desvincular.
  const { role } = useAccessRole();
  const canManage = role === "admin";
  const listLinkedFn = useServerFn(listClientLinkedChannelsFn);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<LinkedChannel | null>(null);

  const linkedKey = ["client-linked-channels", brandId, clientId] as const;
  const linkedQ = useQuery({
    queryKey: linkedKey,
    queryFn: () => listLinkedFn({ data: { brandId, clientId } }),
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: linkedKey });
    qc.invalidateQueries({ queryKey: ["workspace-channels", brandId] });
    qc.invalidateQueries({ queryKey: ["client-channels", brandId, clientId] });
    qc.invalidateQueries({ queryKey: ["wizard-connections", brandId, clientId] });
    qc.invalidateQueries({ queryKey: ["social-analytics", brandId, clientId] });
  };

  const rows = useMemo(() => linkedQ.data ?? [], [linkedQ.data]);

  // Capacidade REAL de publicação (não apenas `status = active`): valida
  // vínculo, token e escopo granular da Meta para cada conta do cliente.
  const checkReadiness = useServerFn(checkDestinationsReadinessFn);
  const connIds = useMemo(() => rows.map((r) => r.connectionId).sort(), [rows]);
  const readinessQ = useQuery({
    enabled: connIds.length > 0,
    queryKey: ["client-channels-readiness", brandId, clientId, connIds],
    queryFn: () => checkReadiness({ data: { brandId, clientId, connectionIds: connIds } }),
    staleTime: 60_000,
  });
  const readinessByConn = useMemo(() => {
    const map = new Map<string, DestinationReadiness>();
    (readinessQ.data ?? []).forEach((r) => map.set(r.connectionId, r));
    return map;
  }, [readinessQ.data]);

  return (
    <div className="space-y-4">
      <ProfilePageHeader
        title="Canais"
        description="Contas sociais vinculadas a este cliente. As conexões são gerenciadas em Integrações."
        actions={
          canManage ? (
            <>
              <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                <Link to="/connections">
                  <Settings2 className="h-3.5 w-3.5" />
                  Gerenciar integrações
                </Link>
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setPickerOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Vincular canal
              </Button>
            </>
          ) : null
        }
      />

      <ProfileSection
        title="Canais conectados"
        subtitle="Contas vinculadas a este cliente"
        icon={<Link2 className="h-4 w-4" />}
        bodyClassName="px-0 py-0"
        action={
          rows.length ? (
            <span className="text-[11px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? "canal" : "canais"}
            </span>
          ) : null
        }
      >
        {linkedQ.isLoading ? (
          <div className="divide-y divide-border/40">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            ))}
          </div>
        ) : linkedQ.isError ? (
          <div className="px-5 py-4">
            <ProfileEmpty
              icon={<RefreshCw className="h-4 w-4" />}
              title="Não foi possível carregar os canais."
              hint="Verifique sua conexão e tente novamente."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => linkedQ.refetch()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Tentar novamente
                </Button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-4">
            <ProfileEmpty
              icon={<Link2 className="h-4 w-4" />}
              title="Nenhum canal conectado"
              hint={
                canManage
                  ? "Este cliente ainda não possui contas sociais vinculadas. Vincule uma conta já conectada ao workspace."
                  : "Este cliente ainda não possui contas sociais vinculadas. Um administrador ou gestor da conta pode realizar essa configuração."
              }
              action={
                canManage ? (
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                      <Link to="/connections">
                        <Settings2 className="h-3.5 w-3.5" />
                        Gerenciar integrações
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setPickerOpen(true)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Vincular canal
                    </Button>
                  </div>
                ) : null
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {rows.map((row) => (
              <ChannelRow
                key={row.connectionId}
                row={row}
                canManage={canManage}
                readiness={readinessByConn.get(row.connectionId) ?? null}
                checking={readinessQ.isLoading}
                onUnlink={() => setUnlinkTarget(row)}
              />
            ))}
          </ul>
        )}
      </ProfileSection>

      <ClientWhatsappSection brandId={brandId} clientId={clientId} canManage={canManage} />

      <LinkChannelDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        brandId={brandId}
        clientId={clientId}
        onChanged={invalidate}
      />

      <UnlinkDialog
        row={unlinkTarget}
        brandId={brandId}
        clientId={clientId}
        onOpenChange={(v) => !v && setUnlinkTarget(null)}
        onChanged={invalidate}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ChannelRow({
  row,
  canManage,
  readiness,
  checking,
  onUnlink,
}: {
  row: LinkedChannel;
  canManage: boolean;
  readiness?: DestinationReadiness | null;
  checking?: boolean;
  onUnlink: () => void;
}) {
  const def = channelDef(row.channel);
  const Icon = def.icon;
  const status = normalizeStatus(row.status);
  const handle = row.handle ? `@${row.handle.replace(/^@/, "")}` : row.accountLabel;
  // Publicação só é liberada com capacidade confirmada pela Meta.
  const capLabel = checking
    ? "Verificando…"
    : !readiness
      ? null
      : readiness.publishReady
        ? "Pronto para publicar"
        : readiness.action === "relink"
          ? "Desconectado"
          : "Autorização necessária";

  return (
    <li className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={row.avatarUrl ?? undefined} alt={row.accountLabel} />
          <AvatarFallback className="text-[10px] uppercase">
            {row.channel.slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
              <Icon className={cn(CHANNEL_ICON_SIZE, "shrink-0", def.tone)} />
              {/* Nome do canal = plataforma; o perfil vem como @complemento. */}
              <span className="truncate">{def.label}</span>
            </span>
            {handle ? (
              <span className="truncate text-sm text-muted-foreground">
                {handle.startsWith("@") ? handle : `@${handle}`}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {def.label} · {accountType(row)}
            {/* ID explícito do destino: elimina ambiguidade na escolha da conta. */}
            {row.instagramBusinessId
              ? ` · Instagram Business ID ${row.instagramBusinessId}`
              : row.pageId
                ? ` · Page ID ${row.pageId}`
                : ""}
          </p>
          {capLabel && !readiness?.publishReady && !checking ? (
            <p className="mt-0.5 text-[11px] text-destructive">{readiness?.message}</p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
        {capLabel ? (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
              checking
                ? "border-border/60 bg-muted/40 text-muted-foreground"
                : readiness?.publishReady
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
            title={readiness?.message ?? undefined}
          >
            {capLabel}
          </span>
        ) : null}
        <ChannelStatusBadge status={status} />

        {canManage ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={onUnlink}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Desvincular
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function UnlinkDialog({
  row,
  brandId,
  clientId,
  onOpenChange,
  onChanged,
}: {
  row: LinkedChannel | null;
  brandId: string;
  clientId: string;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const toggleFn = useServerFn(toggleClientChannelFn);

  const unlinkMut = useMutation({
    mutationFn: (connectionId: string) =>
      toggleFn({ data: { brandId, clientId, connectionId, assigned: false } }),
    onSuccess: () => {
      toast.success("Vínculo removido");
      onOpenChange(false);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao remover vínculo"),
  });

  return (
    <Dialog open={!!row} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Desvincular este canal?</DialogTitle>
          <DialogDescription className="text-xs">
            Este canal continuará conectado ao workspace, mas deixará de estar disponível para este
            cliente.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
            disabled={unlinkMut.isPending}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-8 gap-1.5 text-xs"
            disabled={unlinkMut.isPending || !row}
            onClick={() => row && unlinkMut.mutate(row.connectionId)}
          >
            {unlinkMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Desvincular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function LinkChannelDialog({
  open,
  onOpenChange,
  brandId,
  clientId,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brandId: string;
  clientId: string;
  onChanged: () => void;
}) {
  const listFn = useServerFn(listWorkspaceChannelsFn);
  const toggleFn = useServerFn(toggleClientChannelFn);

  const {
    data = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["workspace-channels", brandId],
    queryFn: () => listFn({ data: { brandId } }),
    enabled: open,
    staleTime: 30_000,
  });

  const linkMut = useMutation({
    mutationFn: (connectionId: string) =>
      toggleFn({ data: { brandId, clientId, connectionId, assigned: true } }),
    onSuccess: () => {
      toast.success("Canal vinculado");
      onOpenChange(false);
      onChanged();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Falha ao vincular canal"),
  });

  // Exclusividade: uma conta social pertence a no máximo um cliente.
  const connected = data.filter((c) => normalizeStatus(c.status) !== "disconnected");
  const candidates = connected.filter((c) => c.clients.length === 0);
  const takenByOthers = connected.filter(
    (c) => c.clients.length > 0 && !c.clients.some((cl) => cl.id === clientId),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Vincular canal</DialogTitle>
          <DialogDescription className="text-xs">
            Contas conectadas ao workspace e ainda sem cliente. Para conectar uma nova conta, use a
            tela de Integrações.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="space-y-2 rounded-lg border border-dashed p-4">
            <p className="text-sm font-medium">Não foi possível carregar os canais.</p>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={() => refetch()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Tentar novamente
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {candidates.length === 0 ? (
              <div className="space-y-2 rounded-lg border border-dashed p-4">
                <p className="text-sm font-medium">Nenhuma conta disponível</p>
                <p className="text-xs text-muted-foreground">
                  Todas as contas conectadas já estão atribuídas a algum cliente — ou ainda não há
                  contas conectadas ao workspace. Cada conta pode pertencer a apenas um cliente:
                  desvincule-a do cliente atual antes de atribuí-la aqui.
                </p>
                <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                  <Link to="/connections">Abrir Integrações</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.connectionId}
                    row={c}
                    pending={linkMut.isPending && linkMut.variables === c.connectionId}
                    onSelect={() => linkMut.mutate(c.connectionId)}
                  />
                ))}
              </div>
            )}

            {takenByOthers.length > 0 ? (
              <div className="space-y-1.5">
                <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Já vinculadas a outro cliente
                </p>
                {takenByOthers.map((c) => (
                  <CandidateRow key={c.connectionId} row={c} pending={false} />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CandidateRow({
  row,
  pending,
  onSelect,
}: {
  row: WorkspaceChannel;
  pending: boolean;
  onSelect?: () => void;
}) {
  const def = channelDef(row.channel);
  const Icon = def.icon;
  const taken = !onSelect;
  const ownerName = row.clients[0]?.name ?? null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border/50 p-3",
        taken && "opacity-60",
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={row.avatarUrl ?? undefined} alt={row.accountLabel} />
        <AvatarFallback className="text-[10px] uppercase">{row.channel.slice(0, 2)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Icon className={cn(CHANNEL_ICON_SIZE, "shrink-0", def.tone)} />
          <span className="truncate text-sm font-medium">{def.label}</span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {row.handle ? `@${row.handle.replace(/^@/, "")}` : row.accountLabel}
          {taken && ownerName ? ` · ${ownerName}` : ""}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 px-2.5 text-xs"
        disabled={pending || taken}
        onClick={onSelect}
      >
        {taken ? (
          "Indisponível"
        ) : pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          "Selecionar"
        )}
      </Button>
    </div>
  );
}
