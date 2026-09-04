// Card "Teste de envio": telefone manual (formato internacional) + mensagem.
// Não depende de destinatário cadastrado; a validação/normalização do número e
// o envio continuam server-side, no serviço Evolution existente.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Send, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listEvolutionInstances } from "@/lib/evolution-instances.functions";
import { sendWhatsappTestMessage } from "@/lib/whatsapp-recipients.functions";

export function WhatsappManualTestCard({
  brandId,
  canManage,
}: {
  brandId: string;
  canManage: boolean;
}) {
  const instancesFn = useServerFn(listEvolutionInstances);
  const sendFn = useServerFn(sendWhatsappTestMessage);
  const [phone, setPhone] = useState("+55 ");
  const [message, setMessage] = useState("Mensagem de teste enviada pelo Unitos.");

  const { data: instances = [] } = useQuery({
    queryKey: ["evolution-instances", brandId],
    queryFn: () => instancesFn({ data: { brandId } }),
    enabled: !!brandId,
  });

  const instance = instances.find((i) => i.status === "connected") ?? null;

  const send = useMutation({
    mutationFn: () =>
      sendFn({
        data: {
          brandId,
          instanceId: instance!.id,
          phone: phone.trim(),
          message: message.trim(),
        },
      }),
  });

  const disabled =
    !canManage || !instance || phone.replace(/\D/g, "").length < 10 || !message.trim();

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <Send className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">Teste de envio</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Envie uma mensagem para um número de teste sem cadastrar um destinatário.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {instance ? "Conexão ativa" : "Sem conexão"}
        </Badge>
      </div>

      {!instance ? (
        <p className="text-xs text-muted-foreground">
          Conecte o WhatsApp para habilitar o teste.
        </p>
      ) : (
        <div className="grid items-end gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="wa-test-phone" className="text-xs">
              Telefone
            </Label>
            <Input
              id="wa-test-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+55 31 99999-9999"
              inputMode="tel"
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-test-message" className="text-xs">
              Mensagem
            </Label>
            <Input
              id="wa-test-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="h-9 text-xs"
            />
          </div>
          <Button
            size="sm"
            className="h-9 md:w-auto"
            disabled={disabled || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3 w-3" />
            )}
            {send.isPending ? "Enviando…" : "Enviar teste"}
          </Button>
        </div>
      )}

      {send.isError ? (
        <p className="flex items-center gap-1.5 text-[11px] text-destructive">
          <TriangleAlert className="h-3 w-3 shrink-0" />
          {send.error instanceof Error ? send.error.message : "Falha ao enviar a mensagem."}
        </p>
      ) : send.isSuccess ? (
        send.data.status === "sent" ? (
          <p className="flex items-center gap-1.5 text-[11px] text-health-good">
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            Mensagem enviada.
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-destructive">
            <TriangleAlert className="h-3 w-3 shrink-0" />
            {send.data.error ?? "A Evolution recusou o envio."}
          </p>
        )
      ) : null}
    </div>
  );
}

