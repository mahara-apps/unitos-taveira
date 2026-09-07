import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { z } from "zod";

import { ScrollArea } from "@/components/ui/scroll-area";
import { ClientInbox } from "@/components/client-inbox/client-inbox";
import { useActiveContext } from "@/hooks/use-active-context";
import { usePageHeader } from "@/hooks/use-page-header";

export const Route = createFileRoute("/_authenticated/inbox")({
  validateSearch: (s) =>
    z
      .object({
        cliente: z.string().uuid().optional(),
        tipo: z.enum(["request", "comment", "decision", "briefing"]).optional(),
      })
      .parse(s),
  component: ClientInboxPage,
});

function ClientInboxPage() {
  const { cliente } = Route.useSearch();
  const { brandId } = useActiveContext();

  usePageHeader(
    {
      title: "Área do cliente",
      subtitle: "Pedidos, comentários, aprovações e briefings que chegaram do cliente",
    },
    [],
  );

  if (!brandId) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
          Selecione um workspace no menu lateral.
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100dvh-3.5rem)] bg-background">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <ClientInbox brandId={brandId} clientId={cliente} />
      </div>
    </ScrollArea>
  );
}
