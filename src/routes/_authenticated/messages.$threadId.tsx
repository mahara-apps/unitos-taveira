import { createFileRoute, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageThreadView } from "@/components/messages/message-thread-view";
import { useActiveContext } from "@/hooks/use-active-context";
import { useSessionUser } from "@/hooks/use-session-user";
import { listBrandAssigneesFn } from "@/lib/content.functions";
import { listThreads } from "@/lib/messaging.functions";

export const Route = createFileRoute("/_authenticated/messages/$threadId")({
  component: MessageThreadPage,
});

function MessageThreadPage() {
  const { threadId } = useParams({ from: "/_authenticated/messages/$threadId" });
  const { brandId } = useActiveContext();
  const { userId } = useSessionUser();
  const qc = useQueryClient();

  const fetchThreads = useServerFn(listThreads);
  const fetchPeople = useServerFn(listBrandAssigneesFn);

  const threadsQ = useQuery({
    queryKey: ["message-threads", brandId],
    queryFn: () => fetchThreads({ data: { brandId: brandId!, scope: "all" } }),
    enabled: !!brandId && !!userId,
    staleTime: 15_000,
  });

  const peopleQ = useQuery({
    queryKey: ["brand-assignees", brandId],
    queryFn: () => fetchPeople({ data: { brandId: brandId! } }),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  const thread = (threadsQ.data ?? []).find((t) => t.id === threadId) ?? null;

  if (threadsQ.isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-1/3 rounded-lg" />
        <Skeleton className="h-24 w-2/3 rounded-lg" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Conversa não encontrada ou fora do seu acesso.
      </div>
    );
  }

  return (
    <MessageThreadView
      key={thread.id}
      thread={thread}
      currentUserId={userId ?? ""}
      people={peopleQ.data ?? []}
      onChanged={() => {
        qc.invalidateQueries({ queryKey: ["message-threads", brandId] });
        qc.invalidateQueries({ queryKey: ["messages-unread", brandId] });
      }}
    />
  );
}
