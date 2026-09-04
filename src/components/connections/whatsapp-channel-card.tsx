// Card de canal "WhatsApp Evolution" no mesmo padrão visual do Resend.
// Estado compacto no card; configuração da Evolution, status da conexão e
// QR/ações continuam nos componentes já existentes, dentro de um modal.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getEvolutionStatus } from "@/lib/evolution.functions";
import { listEvolutionInstances } from "@/lib/evolution-instances.functions";
import { EvolutionConfigCard } from "./evolution-config-card";
import { EvolutionConnectionCard } from "./evolution-connection-card";
import {
  deriveStage,
  formatPhone,
  WHATSAPP_STAGE_LABELS,
  stageDot,
} from "./whatsapp/status";

export function WhatsappChannelCard({
  brandId,
  canManage,
}: {
  brandId: string;
  canManage: boolean;
}) {
  const statusFn = useServerFn(getEvolutionStatus);
  const instancesFn = useServerFn(listEvolutionInstances);
  const [open, setOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["evolution-status", brandId],
    queryFn: () => statusFn({ data: { brandId } }),
    enabled: !!brandId,
  });

  const { data: instances = [], isLoading } = useQuery({
    queryKey: ["evolution-instances", brandId],
    queryFn: () => instancesFn({ data: { brandId } }),
    enabled: !!brandId,
  });

  const instance = instances.find((i) => i.status === "connected") ?? instances[0] ?? null;
  const configured = !!status?.configured;
  const stage = deriveStage({ configured, instanceStatus: instance?.status ?? null });
  const connected = stage === "connected";

  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-border/60 bg-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/60 text-muted-foreground">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">WhatsApp Evolution</div>
            <div className="truncate text-xs text-muted-foreground">
              Disparos, notificações e templates
            </div>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 gap-1.5 text-[10px]">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${stageDot(stage)}`} />
          {WHATSAPP_STAGE_LABELS[stage]}
        </Badge>
      </div>

      <dl className="space-y-1 text-xs">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
          <dt className="text-muted-foreground">Conexão</dt>
          <dd className="truncate text-right font-medium">
            {connected
              ? "Ativa"
              : configured
                ? "Pendente"
                : "Nenhuma credencial configurada"}
          </dd>
        </div>
        {instance?.phoneNumber ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
            <dt className="text-muted-foreground">Número</dt>
            <dd className="truncate text-right font-medium">
              {formatPhone(instance.phoneNumber)}
            </dd>
          </div>
        ) : null}
        {instance?.instanceName ? (
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
            <dt className="text-muted-foreground">Instância</dt>
            <dd className="truncate text-right font-mono text-[11px]">{instance.instanceName}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={configured ? "outline" : "default"}
          className="flex-1"
          onClick={() => setOpen(true)}
        >
          {configured ? "Gerenciar" : "Configurar"}
        </Button>
      </div>


      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>WhatsApp Evolution</DialogTitle>
            <DialogDescription>
              Configure o servidor, conecte via QR Code e acompanhe o estado da conexão.
            </DialogDescription>
          </DialogHeader>

          <div className="grid items-stretch gap-3 lg:grid-cols-2">
            <EvolutionConfigCard brandId={brandId} status={status} canManage={canManage} />
            <EvolutionConnectionCard
              brandId={brandId}
              configured={configured}
              instance={instance}
              isLoading={isLoading}
              canManage={canManage}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
