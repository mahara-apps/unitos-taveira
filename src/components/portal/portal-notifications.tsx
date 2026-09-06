import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { resolvePortalNotificationTarget } from "@/lib/notification-target";
import { Button } from "@/components/ui/button";
import {
  listMyNotificationsFn,
  markAllNotificationsReadFn,
  markNotificationReadFn,
} from "@/lib/notifications.functions";
import { usePortalMode } from "./portal-context";
import { EmptyState, ErrorState, ListSkeleton, formatDate } from "./portal-shared";

/**
 * Avisos do cliente — mesma tabela `notifications` do sistema, filtrada pelo
 * próprio usuário no servidor. Existe apenas no acesso com login.
 */
export function PortalNotifications() {
  const mode = usePortalMode();
  const list = useServerFn(listMyNotificationsFn);
  const markRead = useServerFn(markNotificationReadFn);
  const markAll = useServerFn(markAllNotificationsReadFn);
  const queryClient = useQueryClient();

  const q = useQuery({
    queryKey: ["portal", "notifications", mode.kind === "session" ? mode.clientId : "token"],
    queryFn: () => list({ data: { scope: "inbox" } }),
    enabled: mode.kind === "session",
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["portal", "notifications"] });

  const read = useMutation({
    mutationFn: (id: string) => markRead({ data: { id } }),
    onSuccess: invalidate,
  });
  const readAll = useMutation({
    mutationFn: () => markAll({ data: {} }),
    onSuccess: invalidate,
  });

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const unread = q.data?.unreadTotal ?? 0;

  if (mode.kind !== "session") {
    return (
      <EmptyState
        icon={BellOff}
        title="Avisos exigem login"
        description="Entre com seu e-mail e senha para receber e acompanhar avisos."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {unread > 0 ? `${unread} sem ler` : "Tudo em dia"}
        </div>
        {unread > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={readAll.isPending}
            onClick={() => readAll.mutate()}
          >
            <CheckCheck className="h-3.5 w-3.5" /> Marcar tudo como lido
          </Button>
        ) : null}
      </div>

      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState
          description="Não conseguimos carregar seus avisos agora."
          message={(q.error as Error)?.message}
          onRetry={() => void q.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nenhum aviso ainda"
          description="Aprovações pendentes, prazos e respostas da equipe aparecem aqui."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
          {items.map((n) => {
            const pending = !n.read_at;
            const target = resolvePortalNotificationTarget(
              n,
              mode.kind === "session" ? mode.clientId : null,
            );
            const body = (
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  {pending ? (
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  ) : null}
                  <span className="truncate text-sm font-medium">{n.title}</span>
                </div>
                {n.body ? <p className="text-sm text-muted-foreground">{n.body}</p> : null}
                <div className="text-xs text-muted-foreground">{formatDate(n.created_at)}</div>
              </div>
            );
            return (
              <li
                key={n.id}
                className={`flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-start sm:justify-between ${
                  pending ? "bg-primary/[0.04]" : ""
                }`}
              >
                {target ? (
                  <Link
                    to={target.to as never}
                    search={(target.search ?? {}) as never}
                    className="min-w-0 flex-1"
                    onClick={() => {
                      if (pending) read.mutate(n.id);
                    }}
                  >
                    {body}
                  </Link>
                ) : (
                  body
                )}
                {pending ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    disabled={read.isPending}
                    onClick={() => read.mutate(n.id)}
                  >
                    Marcar como lido
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
