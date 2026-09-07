import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/messages/")({
  component: MessagesEmpty,
});

function MessagesEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
        <MessagesSquare className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-medium">Escolha uma conversa</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Conversas de cliente ficam agrupadas por cliente. Conversas de equipe são internas e
          nunca aparecem para o cliente.
        </p>
      </div>
    </div>
  );
}
