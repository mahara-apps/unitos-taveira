// Perfil do cliente > Comunicação (WhatsApp).
// Destinatários deste cliente + histórico de envios (somente leitura).
// Sem inbox, conversa ou atendimento.
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { History, MessageCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ProfileSection } from "@/components/customer/ui/profile-ui";
import { WhatsappRecipientsPanel } from "@/components/connections/whatsapp-recipients-panel";
import { listWhatsappSendLogs } from "@/lib/whatsapp-recipients.functions";

const STATUS_LABEL: Record<string, string> = {
  sent: "Enviado",
  delivered: "Entregue",
  failed: "Falhou",
  skipped: "Ignorado",
};

function statusTone(status: string) {
  if (status === "failed") return "red" as const;
  if (status === "skipped") return "amber" as const;
  return "emerald" as const;
}

export function ClientWhatsappSection({
  brandId,
  clientId,
  canManage,
}: {
  brandId: string;
  clientId: string;
  canManage: boolean;
}) {
  const logsFn = useServerFn(listWhatsappSendLogs);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["whatsapp-send-logs", brandId, clientId],
    queryFn: () => logsFn({ data: { brandId, clientId } }),
    enabled: !!brandId && !!clientId,
    staleTime: 30_000,
  });

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ProfileSection
        title="Destinatários de WhatsApp"
        subtitle="Para quem as automações e notificações deste cliente serão enviadas"
        icon={<MessageCircle className="h-4 w-4" />}
      >
        <WhatsappRecipientsPanel
          brandId={brandId}
          clientId={clientId}
          canManage={canManage}
          title="Destinatários deste cliente"
          hint="Contatos, grupos, gestor da conta, admin da agência e usuários internos."
        />
      </ProfileSection>

      <ProfileSection
        title="Histórico de envios"
        subtitle="Mensagens enviadas por este cliente, do mais recente ao mais antigo"
        icon={<History className="h-4 w-4" />}
      >
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Carregando histórico…</p>
        ) : logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum envio registrado ainda.</p>
        ) : (
          <ul className="space-y-2">
            {logs.map((log) => (
              <li
                key={log.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-lg border border-border/60 bg-muted/20 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-xs font-medium">{log.recipient ?? "—"}</p>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">
                    {log.message ?? log.errorMessage ?? "Mensagem enviada pelo sistema."}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(log.sentAt).toLocaleString("pt-BR")}
                  </p>
                </div>
                <Badge tone={statusTone(log.status)} className="shrink-0 text-[10px]">
                  {STATUS_LABEL[log.status] ?? log.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </ProfileSection>
    </div>
  );
}
