/**
 * Comunicador interno — layout: lista de conversas + painel da conversa ativa.
 * O escopo já vem autorizado pelo banco (RLS + can_access_message_thread).
 */
import { useMemo, useState } from "react";
import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle } from "lucide-react";
import { MessageThreadList, type ThreadListTab } from "@/components/messages/message-thread-list";
import { NewThreadDialog } from "@/components/messages/new-thread-dialog";
import { useActiveContext } from "@/hooks/use-active-context";
import { usePageHeader } from "@/hooks/use-page-header";
import { useSessionUser } from "@/hooks/use-session-user";
import { listThreads } from "@/lib/messaging.functions";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [
      { title: "Mensagens — Unitos" },
      {
        name: "description",
        content: "Comunicador interno da equipe e conversas com clientes, com histórico completo.",
      },
      { property: "og:title", content: "Mensagens — Unitos" },
      {
        property: "og:description",
        content: "Conversas da equipe e dos clientes em um só lugar, sem cruzamento de dados.",
      },
    ],
  }),
  component: MessagesLayout,
});

function MessagesLayout() {
  const { brandId } = useActiveContext();
  const { userId } = useSessionUser();
  const qc = useQueryClient();
  const params = useParams({ strict: false }) as { threadId?: string };
  const [tab, setTab] = useState<ThreadListTab>("clients");

  usePageHeader({ title: "Mensagens", subtitle: "Equipe e clientes, com histórico completo" }, []);

  const fetchThreads = useServerFn(listThreads);
  const threadsQ = useQuery({
    queryKey: ["message-threads", brandId],
    queryFn: () => fetchThreads({ data: { brandId: brandId!, scope: "all" } }),
    enabled: !!brandId && !!userId,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const refresh = useMemo(
    () => () => {
      qc.invalidateQueries({ queryKey: ["message-threads", brandId] });
      qc.invalidateQueries({ queryKey: ["messages-unread", brandId] });
    },
    [qc, brandId],
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
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col bg-background lg:flex-row">
      <aside className="flex min-h-0 flex-col border-b border-border/60 lg:w-[340px] lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-2 px-3 pt-3">
          <h2 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Conversas
          </h2>
          <NewThreadDialog
            brandId={brandId}
            defaultKind={tab === "team" ? "team_dm" : "client"}
            onCreated={refresh}
          />
        </div>
        <div className="min-h-0 flex-1">
          <MessageThreadList
            threads={threadsQ.data ?? []}
            loading={threadsQ.isPending}
            activeThreadId={params.threadId ?? null}
            currentUserId={userId ?? ""}
            tab={tab}
            onTabChange={setTab}
          />
        </div>
      </aside>
      <section className="min-h-0 flex-1">
        <Outlet />
      </section>
    </div>
  );
}
