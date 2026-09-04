// Conexão WhatsApp (Evolution) exibida diretamente na tela: criação da
// instância, QR Code inline, detecção de conexão e gestão do vínculo.
// Sem inbox, atendimento ou conversas.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Loader2,
  Plus,
  PowerOff,
  QrCode,
  RefreshCw,
  RotateCcw,
  Smartphone,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  configureEvolutionWebhook,
  createEvolutionInstance,
  deleteEvolutionInstance,
  disconnectEvolutionInstance,
  refreshEvolutionInstanceState,
  requestEvolutionInstanceQr,
  restartEvolutionInstance,
  type EvolutionInstanceRow,
  type EvolutionQrResult,
} from "@/lib/evolution-instances.functions";
import {
  deriveStage,
  formatPhone,
  stageBadgeVariant,
  stageDot,
  WHATSAPP_STAGE_LABELS,
} from "./whatsapp/status";

const POLL_MS = 4_000;
/** O QR da Evolution expira rápido; renovamos automaticamente. */
const QR_TTL_MS = 45_000;

export function EvolutionConnectionCard({
  brandId,
  configured,
  instance,
  isLoading,
  canManage,
}: {
  brandId: string;
  configured: boolean;
  instance: EvolutionInstanceRow | null;
  isLoading: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createEvolutionInstance);
  const requestQr = useServerFn(requestEvolutionInstanceQr);
  const refreshState = useServerFn(refreshEvolutionInstanceState);
  const configureWebhook = useServerFn(configureEvolutionWebhook);
  const restartFn = useServerFn(restartEvolutionInstance);
  const disconnectFn = useServerFn(disconnectEvolutionInstance);
  const deleteFn = useServerFn(deleteEvolutionInstance);

  const [label, setLabel] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [qr, setQr] = useState<EvolutionQrResult | null>(null);
  const [expired, setExpired] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const issuedAtRef = useRef(0);
  const webhookRef = useRef<string | null>(null);

  const stage = deriveStage({ configured, instanceStatus: instance?.status ?? null });
  const connected = instance?.status === "connected";
  const phone = formatPhone(instance?.phoneNumber ?? null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["evolution-instances", brandId] });

  const create = useMutation({
    mutationFn: () => createFn({ data: { brandId, label: label.trim() || "WhatsApp" } }),
    onSuccess: () => {
      setLabel("");
      toast.success("Conexão criada. Gere o QR Code para pareamento.");
      setShowQr(true);
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao criar a conexão."),
  });

  const qrMutation = useMutation({
    mutationFn: async () => {
      if (webhookRef.current !== instance!.id) {
        try {
          await configureWebhook({ data: { brandId, instanceId: instance!.id } });
          webhookRef.current = instance!.id;
        } catch (err) {
          console.warn("[Evolution] webhook não registrado", err);
        }
      }
      return requestQr({ data: { brandId, instanceId: instance!.id } });
    },
    onSuccess: (result) => {
      setQrError(null);
      setExpired(false);
      setQr(result);
      issuedAtRef.current = Date.now();
      if (result.connected) invalidate();
    },
    onError: (err: unknown) => {
      setQr(null);
      setQrError(err instanceof Error ? err.message : "Falha ao gerar o QR Code.");
    },
  });

  const instanceAction = (success: string) => ({
    onSuccess: () => {
      toast.success(success);
      invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Não foi possível concluir a ação."),
  });

  const restart = useMutation({
    mutationFn: (instanceId: string) => restartFn({ data: { brandId, instanceId } }),
    ...instanceAction("Conexão reiniciada."),
  });
  const disconnect = useMutation({
    mutationFn: (instanceId: string) => disconnectFn({ data: { brandId, instanceId } }),
    ...instanceAction("WhatsApp desconectado."),
  });
  const removeInstance = useMutation({
    mutationFn: (instanceId: string) => deleteFn({ data: { brandId, instanceId } }),
    ...instanceAction("Conexão removida."),
  });
  const refresh = useMutation({
    mutationFn: (instanceId: string) => refreshState({ data: { brandId, instanceId } }),
    onSuccess: () => invalidate(),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Falha ao consultar o estado."),
  });


  // Solicita o primeiro QR quando o usuário abre o pareamento.
  useEffect(() => {
    if (!showQr || !instance || connected) return;
    setQr(null);
    setQrError(null);
    setExpired(false);
    qrMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQr, instance?.id]);

  // Polling do estado enquanto aguarda o pareamento + marcação de QR expirado.
  useEffect(() => {
    if (!showQr || !instance || connected) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const state = await refreshState({ data: { brandId, instanceId: instance.id } });
        if (cancelled) return;
        if (state.state === "open") {
          setShowQr(false);
          setQr(null);
          toast.success("WhatsApp conectado com sucesso.");
          invalidate();
          return;
        }
        if (state.state === "not_found") {
          setQrError("Instância inexistente no servidor Evolution.");
          return;
        }
        if (Date.now() - issuedAtRef.current > QR_TTL_MS && !qrMutation.isPending) {
          setExpired(true);
        }
      } catch {
        // Falha transitória de rede: mantém o acompanhamento.
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showQr, instance?.id, connected, qrMutation.isPending]);

  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Smartphone className="h-4 w-4 text-muted-foreground" />
            Conexão WhatsApp
          </p>
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${stageDot(stage)}`} aria-hidden />
            <Badge variant={stageBadgeVariant(stage)} className="text-[10px]">
              {WHATSAPP_STAGE_LABELS[stage]}
            </Badge>
            {phone ? <span className="font-mono text-xs">{phone}</span> : null}
          </div>
        </div>

        {instance ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              title="Atualizar estado"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate(instance.id)}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
            {canManage ? (
              <>
                {!connected ? (
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setShowQr(true)}
                    disabled={showQr}
                  >
                    <QrCode className="mr-1.5 h-3 w-3" />
                    Gerar QR Code
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={restart.isPending}
                  onClick={() => restart.mutate(instance.id)}
                >
                  <RotateCcw className="mr-1.5 h-3 w-3" />
                  Reiniciar
                </Button>
                {connected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={disconnect.isPending}
                    onClick={() => disconnect.mutate(instance.id)}
                  >
                    <PowerOff className="mr-1.5 h-3 w-3" />
                    Desconectar
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-destructive"
                  disabled={removeInstance.isPending}
                  onClick={() => removeInstance.mutate(instance.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {instance?.lastError ? (
        <p className="flex items-center gap-1.5 text-[11px] text-destructive">
          <TriangleAlert className="h-3 w-3" />
          {instance.lastError}
        </p>
      ) : null}

      {/* ---------------------------- estados vazios --------------------------- */}
      {!configured ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Nenhuma conexão WhatsApp foi criada para este workspace.
          </p>
          <Button size="sm" className="h-8 text-xs" disabled>
            <Plus className="mr-1.5 h-3 w-3" />
            Criar conexão
          </Button>
          <p className="text-[11px] text-muted-foreground">Configure a Evolution API primeiro.</p>
        </div>
      ) : isLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Carregando conexão…
        </p>
      ) : !instance ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Crie uma conexão para começar o pareamento do WhatsApp.
          </p>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Nome da conexão (ex.: Atendimento)"
                className="h-8 max-w-xs text-xs"
              />
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-3 w-3" />
                )}
                Criar conexão
              </Button>
            </div>
          ) : null}
        </div>
      ) : connected ? (

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 text-health-good" />
          WhatsApp conectado{phone ? ` em ${phone}` : ""} — pronto para automações,
          notificações e templates.
        </p>
      ) : !showQr ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Conecte seu WhatsApp para começar a enviar mensagens pelo Unitos.
          </p>
          {canManage ? (
            <Button size="sm" className="h-8 text-xs" onClick={() => setShowQr(true)}>
              <QrCode className="mr-1.5 h-3 w-3" />
              Gerar QR Code
            </Button>
          ) : null}
        </div>
      ) : (
        /* -------------------------------- QR inline ------------------------------- */
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-4 text-center">
          <p className="text-sm font-medium">Conecte seu WhatsApp</p>
          {qrError ? (
            <p className="max-w-sm text-xs text-destructive">{qrError}</p>
          ) : qrMutation.isPending || !qr?.qrBase64 ? (
            <div className="flex h-56 w-56 items-center justify-center rounded-md bg-muted">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="relative">
              <img
                src={qr.qrBase64}
                alt="QR Code para conectar o WhatsApp"
                className={`h-56 w-56 rounded-md bg-background ${expired ? "opacity-30" : ""}`}
              />
              {expired ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="rounded bg-background/90 px-2 py-1 text-xs font-medium">
                    QR expirado
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {qr?.pairingCode ? (
            <Badge variant="secondary" className="font-mono text-xs">
              Código: {qr.pairingCode}
            </Badge>
          ) : null}

          <p className="max-w-xs text-[11px] text-muted-foreground">
            Abra o WhatsApp → Aparelhos conectados → Conectar aparelho e aponte a câmera
            para o código.
          </p>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={qrMutation.isPending}
              onClick={() => qrMutation.mutate()}
            >
              {qrMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3 w-3" />
              )}
              {expired ? "Gerar novo QR" : "Atualizar QR Code"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setShowQr(false)}
            >
              Fechar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
