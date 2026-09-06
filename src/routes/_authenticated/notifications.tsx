import { createFileRoute, Link } from "@tanstack/react-router";
import { ensureFeatureEnabled } from "@/lib/feature-flags.gate";
import { useMemo, useState } from "react";
import { Inbox, Search, Settings2, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsStatCard } from "@/components/settings/settings-stat-card";
import { usePageHeader } from "@/hooks/use-page-header";
import { type NotificationRow } from "@/lib/notifications.functions";
import {
  ClearReadNotificationsButton,
  useNotificationReads,
  useNotifications,
} from "@/components/notifications/notifications-drawer";
import {
  BUCKET_LABEL,
  bucketFor,
  colorFor,
  iconFor,
  labelFor,
  relativeTimePtBr,
  type NotificationBucket,
} from "@/lib/notifications-format";
import { NotificationLink } from "@/components/notifications/notification-link";

export const Route = createFileRoute("/_authenticated/notifications")({
  beforeLoad: () => ensureFeatureEnabled("notifications"),
  component: NotificationsPage,
});

type FilterTab = "all" | "unread" | "mention" | "approvals" | "system";

const BUCKET_ORDER: NotificationBucket[] = ["today", "yesterday", "week", "older"];

function NotificationsPage() {
  const notifQ = useNotifications("inbox");
  const items: NotificationRow[] = useMemo(() => notifQ.data?.items ?? [], [notifQ.data]);
  const unreadTotal = notifQ.data?.unreadTotal ?? 0;
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");

  const { markOne, markAll } = useNotificationReads("inbox");

  const counts = useMemo(() => {
    const startToday = (() => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    })();
    let mentions = 0;
    let approvals = 0;
    let deadlines = 0;
    let today = 0;
    for (const n of items) {
      if (n.kind === "mention") mentions++;
      if (n.kind === "approval_requested" && !n.read_at) approvals++;
      if (n.kind === "deadline") deadlines++;
      if (new Date(n.created_at).getTime() >= startToday) today++;
    }
    return { unread: unreadTotal, mentions, approvals, deadlines, today };
  }, [items, unreadTotal]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((n) => {
      if (tab === "unread" && n.read_at) return false;
      if (tab === "mention" && n.kind !== "mention") return false;
      if (tab === "approvals" && n.kind !== "approval_requested" && n.kind !== "approval_decision")
        return false;
      if (tab === "system" && n.kind !== "system" && n.kind !== "deadline") return false;
      if (!term) return true;
      return n.title.toLowerCase().includes(term) || (n.body ?? "").toLowerCase().includes(term);
    });
  }, [items, tab, search]);

  const grouped = useMemo(() => {
    const map: Record<NotificationBucket, NotificationRow[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };
    for (const n of filtered) map[bucketFor(n.created_at)].push(n);
    return map;
  }, [filtered]);

  usePageHeader(
    {
      title: "Notificações",
      subtitle:
        counts.unread > 0
          ? `${counts.unread} não lida${counts.unread === 1 ? "" : "s"} · ${counts.today} hoje`
          : "Tudo em dia",
      actions: (
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
            <Link to="/settings/notifications">
              <Settings2 className="h-3.5 w-3.5" /> Preferências
            </Link>
          </Button>
          <ClearReadNotificationsButton />
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            disabled={counts.unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            <CheckCheck className="h-3.5 w-3.5" /> Marcar todas como lidas
          </Button>
        </div>
      ),
    },
    [counts.unread, counts.today, markAll.isPending],
  );

  return (
    <div className="w-full space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SettingsStatCard label="Não lidas" value={counts.unread} tone="violet" />
        <SettingsStatCard label="Menções" value={counts.mentions} tone="sky" />
        <SettingsStatCard label="Aprovações pendentes" value={counts.approvals} tone="amber" />
        <SettingsStatCard label="Prazos próximos" value={counts.deadlines} tone="rose" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <CardTitle className="text-base">Caixa de entrada</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Menções, atribuições, aprovações, prazos e eventos do sistema — tudo em um só lugar.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
            <TabsList>
              <TabsTrigger value="all">Todas</TabsTrigger>
              <TabsTrigger value="unread">
                Não lidas
                {counts.unread > 0 ? (
                  <span className="ml-1.5 rounded-full bg-rose-500/15 px-1.5 text-[10px] font-medium text-rose-500">
                    {counts.unread}
                  </span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="mention">Menções</TabsTrigger>
              <TabsTrigger value="approvals">Aprovações</TabsTrigger>
              <TabsTrigger value="system">Sistema</TabsTrigger>
            </TabsList>
          </Tabs>

          {notifQ.isLoading ? (
            <SkeletonList />
          ) : filtered.length === 0 ? (
            <EmptyState hasAny={items.length > 0} />
          ) : (
            <div className="space-y-6">
              {BUCKET_ORDER.map((bucket) => {
                const rows = grouped[bucket];
                if (rows.length === 0) return null;
                return (
                  <section key={bucket} className="space-y-2">
                    <h3 className="px-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      {BUCKET_LABEL[bucket]} · {rows.length}
                    </h3>
                    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
                      {rows.map((n) => (
                        <NotificationRow key={n.id} n={n} onMarkRead={(id) => markOne.mutate(id)} />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationRow({
  n,
  onMarkRead,
}: {
  n: NotificationRow;
  onMarkRead: (id: string) => void;
}) {
  const Icon = iconFor(n.kind);
  const isUnread = !n.read_at;
  const handleClick = () => {
    if (isUnread) onMarkRead(n.id);
  };
  const content = (
    <div
      className={`group flex items-start gap-3 px-4 py-3 transition-colors ${isUnread ? "bg-muted/20" : ""}`}
    >
      <div className={`mt-0.5 shrink-0 ${colorFor(n.kind)}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="flex-1 text-[13px] font-medium leading-snug text-foreground">
            {n.title}
          </span>
          <span className="mt-0.5 shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {labelFor(n.kind)}
          </span>
          {isUnread ? (
            <span
              aria-label="Não lida"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500"
            />
          ) : null}
        </div>
        {n.body ? (
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
            {n.body}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground/80">
          <span>{relativeTimePtBr(n.created_at)}</span>
          {isUnread ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onMarkRead(n.id);
              }}
              className="opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
            >
              Marcar como lida
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
  return (
    <li className="hover:bg-muted/40">
      <NotificationLink notification={n} onNavigate={handleClick} className="block">
        {content}
      </NotificationLink>
    </li>
  );
}

function SkeletonList() {
  return (
    <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60 bg-card">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3">
          <div className="mt-0.5 h-4 w-4 rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-2 w-1/3 rounded bg-muted/70" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-16 text-center">
      <div className="rounded-full border border-border/60 bg-muted/40 p-3">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">
        {hasAny ? "Nenhuma notificação neste filtro" : "Tudo em dia!"}
      </p>
      <p className="text-xs text-muted-foreground">
        {hasAny
          ? "Ajuste os filtros ou volte para 'Todas'."
          : "Menções, atribuições, aprovações e prazos aparecem aqui em tempo real."}
      </p>
    </div>
  );
}
