// Cards de canal WhatsApp reutilizados pela tela de Mensageria.
// Apenas apresentação: a configuração/conexão da Evolution vive em
// <WhatsappChannelCard /> e o teste avulso em <WhatsappManualTestCard />.
// Destinatários ficam no perfil de cada cliente.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { WhatsappChannelCard } from "./whatsapp-channel-card";
import { WhatsappManualTestCard } from "./whatsapp-manual-test-card";

export function WhatsappCenter({
  brandId,
  canManage,
}: {
  brandId: string | null;
  canManage: boolean;
}) {
  if (!brandId) {
    return <p className="text-xs text-muted-foreground">Selecione um workspace.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <WhatsappChannelCard brandId={brandId} canManage={canManage} />
        <WhatsappComingSoonCard />
      </div>
      <WhatsappManualTestCard brandId={brandId} canManage={canManage} />
    </div>
  );
}


/** Canal previsto na arquitetura, ainda sem fluxo funcional. */
export function WhatsappComingSoonCard() {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-xl border border-dashed border-border/60 bg-muted/20 p-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-dashed border-border/60 bg-background/40 text-muted-foreground/70">
            <MessageSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-muted-foreground">
              WhatsApp Cloud API
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Integração oficial da Meta para WhatsApp
            </div>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
          Em breve
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Este canal ainda não está disponível para configuração.
      </p>
      <Button size="sm" variant="outline" className="w-full" disabled>
        Em breve
      </Button>
    </div>
  );
}
