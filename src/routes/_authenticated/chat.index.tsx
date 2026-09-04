import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageHeader } from "@/hooks/use-page-header";
import { createChatConversationFn } from "@/lib/chat.functions";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatEmpty,
});

function ChatEmpty() {
  usePageHeader({ title: "Chat", subtitle: "Converse com o Brain da Unitos" }, []);
  const navigate = useNavigate();
  const create = useServerFn(createChatConversationFn);
  const m = useMutation({
    mutationFn: () => create({ data: {} }),
    onSuccess: (row) =>
      navigate({ to: "/chat/$conversationId", params: { conversationId: row.id } }),
  });
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="rounded-full bg-primary/10 p-4">
        <MessageSquarePlus className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">Nenhuma conversa selecionada</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          Toda pergunta passa primeiro pelo Brain — memórias, insights e conhecimento consolidado. O
          modelo generativo só é usado quando necessário.
        </p>
      </div>
      <Button onClick={() => m.mutate()} disabled={m.isPending}>
        {m.isPending ? "Criando…" : "Iniciar nova conversa"}
      </Button>
    </div>
  );
}
