import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ChatShell } from "@/components/chat/chat-shell";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";

export const Route = createFileRoute("/_authenticated/chat")({
  beforeLoad: () => ensureFeatureEnabled("chat"),
  component: ChatLayout,
});

function ChatLayout() {
  return (
    <ChatShell>
      <Outlet />
    </ChatShell>
  );
}
