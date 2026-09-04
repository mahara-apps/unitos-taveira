/**
 * Regras puras do feed de notificações — fonte única de verdade compartilhada
 * entre o drawer do sino (caixa de entrada de PENDENTES) e a tela /notifications
 * (histórico completo).
 *
 * Conceitos:
 * - pendente  = não lida E não arquivada  → aparece no drawer e conta no sino
 * - lida      = permanece no histórico, NUNCA no drawer
 * - arquivada = "limpa" do drawer, permanece no histórico
 */
import type { QueryKey } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";
import type { NotificationScope } from "@/lib/notifications-window";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export type NotificationsFeed = {
  items: NotificationRow[];
  /** Contagem real de pendentes (não lidas + não arquivadas) do escopo atual. */
  unreadTotal: number;
};

export const EMPTY_FEED: NotificationsFeed = { items: [], unreadTotal: 0 };

/** Prefixo usado para invalidar todos os escopos (drawer + histórico) de uma vez. */
export const NOTIFICATIONS_QUERY_ROOT = ["notifications", "me"] as const;

/**
 * Isolamento absoluto por identidade + workspace: nenhuma notificação de outro
 * usuário/brand pode ser reaproveitada do cache.
 */
export function notificationsQueryKey(
  scope: NotificationScope,
  userId: string | null,
  brandId: string | null,
): QueryKey {
  return [...NOTIFICATIONS_QUERY_ROOT, scope, userId ?? "anon", brandId ?? "no-brand"];
}

export function isPending(n: Pick<NotificationRow, "read_at" | "archived_at">): boolean {
  return !n.read_at && !n.archived_at;
}

/** O drawer só mostra pendentes — nunca filtra "apenas visualmente". */
export function pendingOnly(items: NotificationRow[]): NotificationRow[] {
  return items.filter(isPending);
}

/** Marca uma como lida removendo-a do feed pendente (drawer) ou apenas marcando (histórico). */
export function applyMarkRead(
  feed: NotificationsFeed,
  id: string,
  opts: { drop: boolean; now?: string },
): NotificationsFeed {
  const now = opts.now ?? new Date().toISOString();
  const wasPending = feed.items.some((n) => n.id === id && isPending(n));
  const items = opts.drop
    ? feed.items.filter((n) => n.id !== id)
    : feed.items.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? now } : n));
  return { items, unreadTotal: Math.max(0, feed.unreadTotal - (wasPending ? 1 : 0)) };
}

export function applyMarkAllRead(
  feed: NotificationsFeed,
  opts: { drop: boolean; now?: string },
): NotificationsFeed {
  const now = opts.now ?? new Date().toISOString();
  const items = opts.drop
    ? feed.items.filter((n) => !isPending(n))
    : feed.items.map((n) => (n.read_at ? n : { ...n, read_at: now }));
  return { items, unreadTotal: 0 };
}

/** "Limpar": arquiva as já lidas — nada é apagado, o histórico permanece. */
export function applyArchiveRead(
  feed: NotificationsFeed,
  opts: { now?: string } = {},
): NotificationsFeed {
  const now = opts.now ?? new Date().toISOString();
  return {
    items: feed.items.map((n) =>
      n.read_at && !n.archived_at ? { ...n, archived_at: now } : n,
    ),
    unreadTotal: feed.unreadTotal,
  };
}
