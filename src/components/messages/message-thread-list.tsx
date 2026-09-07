/**
 * Lista de conversas: abas Clientes / Equipe, busca e contagem de não lidas.
 * Sem cruzamento de dados: cada aba filtra o escopo já autorizado pelo banco.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { MessagesSquare, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  dmTitle,
  filterThreads,
  groupThreadsByClient,
  sortThreads,
  threadContextLabel,
  totalUnread,
  type ThreadSummary,
} from "@/lib/messaging";
import { formatDateTimeBr } from "@/lib/timezone";
import { cn } from "@/lib/utils";

export type ThreadListTab = "clients" | "team";

export function MessageThreadList({
  threads,
  loading,
  activeThreadId,
  currentUserId,
  tab,
  onTabChange,
}: {
  threads: ThreadSummary[];
  loading?: boolean;
  activeThreadId?: string | null;
  currentUserId: string;
  tab: ThreadListTab;
  onTabChange: (tab: ThreadListTab) => void;
}) {
  const [term, setTerm] = useState("");

  const clientThreads = useMemo(
    () => threads.filter((t) => t.scope === "client" || t.scope === "project"),
    [threads],
  );
  const teamThreads = useMemo(() => threads.filter((t) => t.scope === "team_dm"), [threads]);

  const visible = filterThreads(tab === "clients" ? clientThreads : teamThreads, term);
  const groups = tab === "clients" ? groupThreadsByClient(visible) : [];
  const loose = tab === "clients" ? visible.filter((t) => !t.clientId) : sortThreads(visible);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-border/60 p-3">
        <Tabs value={tab} onValueChange={(v) => onTabChange(v as ThreadListTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="clients" className="flex-1 gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Clientes
              {totalUnread(clientThreads) > 0 ? (
                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                  {totalUnread(clientThreads)}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="team" className="flex-1 gap-1.5">
              <MessagesSquare className="h-3.5 w-3.5" />
              Equipe
              {totalUnread(teamThreads) > 0 ? (
                <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                  {totalUnread(teamThreads)}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Buscar conversa, cliente ou pessoa"
            className="pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2 p-1">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-muted-foreground">
            Nenhuma conversa aqui ainda.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.clientId} className="space-y-1">
                <div className="flex items-center gap-2 px-2 pb-1">
                  <span className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {g.clientName}
                  </span>
                  {g.unread > 0 ? (
                    <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                      {g.unread}
                    </Badge>
                  ) : null}
                </div>
                {g.threads.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    active={t.id === activeThreadId}
                    currentUserId={currentUserId}
                  />
                ))}
              </div>
            ))}
            {loose.length > 0 ? (
              <div className="space-y-1">
                {loose.map((t) => (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    active={t.id === activeThreadId}
                    currentUserId={currentUserId}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  thread,
  active,
  currentUserId,
}: {
  thread: ThreadSummary;
  active?: boolean;
  currentUserId: string;
}) {
  const title = thread.scope === "team_dm" ? dmTitle(thread, currentUserId) : thread.subject;
  return (
    <Link
      to="/messages/$threadId"
      params={{ threadId: thread.id }}
      preload="intent"
      className={cn(
        "block rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:bg-muted/50",
        active && "border-border/60 bg-muted/70",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn("min-w-0 flex-1 truncate text-sm", thread.unread > 0 && "font-semibold")}
        >
          {title}
        </span>
        {thread.unread > 0 ? (
          <Badge variant="destructive" className="h-4 px-1 text-[10px]">
            {thread.unread > 99 ? "99+" : thread.unread}
          </Badge>
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {thread.lastMessagePreview ?? threadContextLabel(thread)}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatDateTimeBr(thread.lastMessageAt)}
        </span>
      </div>
    </Link>
  );
}
