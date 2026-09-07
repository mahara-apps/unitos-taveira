import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, BellOff, CheckCheck, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { getCachedUser } from "@/lib/auth-cache";
import { useSessionUserId } from "@/hooks/use-session-user";
import { useActiveContextOptional } from "@/hooks/use-active-context";
import {
  archiveReadNotificationsFn,
  listMyNotificationsFn,
  markAllNotificationsReadFn,
  markNotificationReadFn,
} from "@/lib/notifications.functions";
import {
  applyArchiveRead,
  applyMarkAllRead,
  applyMarkRead,
  EMPTY_FEED,
  NOTIFICATIONS_QUERY_ROOT,
  notificationsQueryKey,
  type NotificationsFeed,
} from "@/lib/notifications-feed";
import type { NotificationScope } from "@/lib/notifications-window";
import { colorFor, iconFor, relativeTimePtBr } from "@/lib/notifications-format";
import { NotificationLink } from "@/components/notifications/notification-link";

export { NOTIFICATIONS_QUERY_ROOT, notificationsQueryKey } from "@/lib/notifications-feed";

/** Escopo canônico das queries: identidade + workspace atual. */
function useNotificationsScopeKey(scope: NotificationScope) {
  const userId = useSessionUserId();
  const { brandId } = useActiveContextOptional();
  return { userId, brandId, key: notificationsQueryKey(scope, userId, brandId) };
}

export function useNotifications(scope: NotificationScope = "popup") {
  const listFn = useServerFn(listMyNotificationsFn);
  const { userId, brandId, key } = useNotificationsScopeKey(scope);
  return useQuery<NotificationsFeed>({
    queryKey: key,
    queryFn: () => listFn({ data: { scope, brandId } }),
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/**
 * Leitura/arquivamento persistidos (servidor) + atualização otimista do cache.
 * `drop: true` (drawer) remove o item da lista na hora — o drawer é caixa de
 * entrada de pendentes, não histórico.
 */
export function useNotificationReads(scope: NotificationScope = "popup") {
  const qc = useQueryClient();
  const { brandId, key } = useNotificationsScopeKey(scope);
  const drop = scope === "popup";
  const markOneFn = useServerFn(markNotificationReadFn);
  const markAllFn = useServerFn(markAllNotificationsReadFn);
  const archiveFn = useServerFn(archiveReadNotificationsFn);

  const patch = (updater: (feed: NotificationsFeed) => NotificationsFeed) =>
    qc.setQueryData<NotificationsFeed>(key, (old) => updater(old ?? EMPTY_FEED));

  const invalidate = () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_ROOT });

  const markOne = useMutation({
    mutationFn: (id: string) => markOneFn({ data: { id, brandId } }),
    onMutate: (id) => {
      const prev = qc.getQueryData<NotificationsFeed>(key);
      patch((feed) => applyMarkRead(feed, id, { drop }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (res) => {
      if (res && typeof res.unreadTotal === "number") {
        patch((feed) => ({ ...feed, unreadTotal: res.unreadTotal }));
      }
    },
    onSettled: invalidate,
  });

  const markAll = useMutation({
    mutationFn: () => markAllFn({ data: { brandId } }),
    onMutate: () => {
      const prev = qc.getQueryData<NotificationsFeed>(key);
      patch((feed) => applyMarkAllRead(feed, { drop }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: invalidate,
  });

  const archiveRead = useMutation({
    mutationFn: () => archiveFn({ data: { brandId } }),
    onMutate: () => {
      const prev = qc.getQueryData<NotificationsFeed>(key);
      patch((feed) => applyArchiveRead(feed));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: invalidate,
  });

  return { markOne, markAll, archiveRead };
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const notifQ = useNotifications("popup");
  const feed = notifQ.data ?? EMPTY_FEED;
  const items = feed.items;
  const unread = feed.unreadTotal;
  const { markOne, markAll, archiveRead } = useNotificationReads("popup");

  // Realtime: invalidate on any insert/update to my notifications.
  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    getCachedUser().then((user) => {
      const userId = user?.id ?? null;
      if (!userId || cancelled) return;
      const topic = `notif:${userId}`;
      for (const existing of supabase.getChannels()) {
        if (existing.topic === `realtime:${topic}` || existing.topic === topic) {
          supabase.removeChannel(existing);
        }
      }
      const ch = supabase.channel(topic);
      ch.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_ROOT }),
      );
      ch.subscribe();
      channel = ch;
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [qc]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative h-8 w-8"
        aria-label={`Notificações${unread ? ` (${unread} não lida${unread === 1 ? "" : "s"})` : ""}`}
        onClick={() => setOpen(true)}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          data-testid="notifications-drawer"
          className="flex h-dvh w-full flex-col gap-0 border-l border-border/70 p-0 sm:max-w-[440px]"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2 text-sm font-semibold">
                Notificações
                {unread > 0 ? (
                  <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-500">
                    {unread}
                  </span>
                ) : null}
              </SheetTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {unread > 0 ? "Pendentes de leitura" : "Tudo em dia"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Marcar todas
            </Button>
            {/* O fechar (✕) já vem do SheetContent — não duplicar aqui. */}
            <span className="w-6 shrink-0" aria-hidden />

          </header>

          <ScrollArea className="min-h-0 flex-1">
            {notifQ.isLoading ? (
              <ListSkeleton />
            ) : items.length === 0 ? (
              <EmptyState />
            ) : (
              <ul className="divide-y divide-border/50">
                {items.map((n) => {
                  const Icon = iconFor(n.kind);
                  const content = (
                    <div className="flex items-start gap-3 px-4 py-3">
                      <div className={`mt-0.5 shrink-0 ${colorFor(n.kind)}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <span className="line-clamp-2 flex-1 text-[13px] font-medium leading-snug text-foreground">
                            {n.title}
                          </span>
                          <span
                            aria-label="Não lida"
                            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500"
                          />
                        </div>
                        {n.body ? (
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                            {n.body}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {relativeTimePtBr(n.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                  return (
                    <li key={n.id} className="transition-colors hover:bg-muted/40">
                      <NotificationLink
                        notification={n}
                        className="block"
                        onNavigate={() => {
                          markOne.mutate(n.id);
                          setOpen(false);
                        }}
                      >
                        {content}
                      </NotificationLink>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>

          <footer className="flex shrink-0 items-center gap-2 border-t border-border/60 px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              disabled={archiveRead.isPending}
              onClick={() => archiveRead.mutate()}
              title="Arquiva as notificações já lidas (o histórico continua disponível)"
            >
              <Eraser className="h-3.5 w-3.5" /> Limpar
            </Button>
            <Button asChild variant="outline" size="sm" className="flex-1">
              <Link to="/notifications" onClick={() => setOpen(false)}>
                Ver histórico completo
              </Link>
            </Button>
          </footer>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-border/50">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 h-4 w-4 rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-2 w-1/2 rounded bg-muted/70" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      <BellOff className="h-5 w-5 text-muted-foreground/60" />
      <p className="text-[13px] font-medium text-foreground">Tudo em dia</p>
      <p className="text-[11px] text-muted-foreground">Você não tem novas notificações.</p>
    </div>
  );
}

/** Ação "Limpar" (arquiva lidas) — exposta na tela de histórico. */
export function ClearReadNotificationsButton() {
  const { archiveRead } = useNotificationReads("inbox");
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      disabled={archiveRead.isPending}
      onClick={() => archiveRead.mutate()}
    >
      <Eraser className="h-3.5 w-3.5" /> Limpar lidas
    </Button>
  );
}
