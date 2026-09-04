import { createFileRoute } from "@tanstack/react-router";
import { ChatConversation } from "@/components/chat/chat-conversation";
import { usePageHeader } from "@/hooks/use-page-header";

export const Route = createFileRoute("/_authenticated/chat/$conversationId")({
  component: ChatConversationRoute,
});

function ChatConversationRoute() {
  const { conversationId } = Route.useParams();
  usePageHeader({ title: "Chat", subtitle: "Brain-first — o Brain responde primeiro" }, []);
  return <ChatConversation conversationId={conversationId} />;
}
