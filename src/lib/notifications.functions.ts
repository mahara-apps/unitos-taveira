import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { NotificationRow, NotificationsFeed } from "@/lib/notifications-feed";
import {
  NOTIFICATION_SELECT_COLUMNS as SELECT_COLUMNS,
  pendingNotificationsCount as pendingCount,
} from "@/lib/notifications.server";
import {
  NOTIFICATION_SCOPES,
  notificationWindow,
  type NotificationScope,
} from "@/lib/notifications-window";

export type { NotificationRow, NotificationsFeed } from "@/lib/notifications-feed";

const feedInput = z
  .object({
    scope: z.enum(NOTIFICATION_SCOPES).default("popup"),
    brandId: z.string().uuid().nullish(),
  })
  .default({ scope: "popup" });

export const listMyNotificationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => feedInput.parse(i ?? {}))
  .handler(async ({ data, context }): Promise<NotificationsFeed> => {
    const { sinceIso, limit } = notificationWindow(data.scope as NotificationScope);
    const brandId = data.brandId ?? null;

    let listQ = context.supabase
      .from("notifications")
      .select(SELECT_COLUMNS)
      .eq("user_id", context.userId)
      .gte("created_at", sinceIso);

    // Drawer do sino = caixa de entrada de PENDENTES (nunca histórico).
    if (data.scope === "popup") {
      listQ = listQ.is("read_at", null).is("archived_at", null);
    }
    if (brandId) listQ = listQ.eq("brand_id", brandId);

    let countQ = context.supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .is("read_at", null)
      .is("archived_at", null);
    if (brandId) countQ = countQ.eq("brand_id", brandId);

    const [list, unread] = await Promise.all([
      listQ.order("created_at", { ascending: false }).limit(limit),
      countQ,
    ]);

    if (list.error) throw list.error;
    if (unread.error) throw unread.error;

    return {
      items: (list.data ?? []) as NotificationRow[],
      unreadTotal: unread.count ?? 0,
    };
  });

export const markNotificationReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ id: z.string().uuid(), brandId: z.string().uuid().nullish() }).parse(i),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; unreadTotal: number }> => {
    const { error } = await context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .is("read_at", null);
    if (error) throw error;
    return { ok: true, unreadTotal: await pendingCount(context.supabase, context.userId, data.brandId ?? null) };
  });

export const markAllNotificationsReadFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ brandId: z.string().uuid().nullish() })
      .default({})
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; unreadTotal: number }> => {
    let q = context.supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .is("read_at", null);
    if (data.brandId) q = q.eq("brand_id", data.brandId);
    const { error } = await q;
    if (error) throw error;
    return { ok: true, unreadTotal: await pendingCount(context.supabase, context.userId, data.brandId ?? null) };
  });

/**
 * "Limpar": arquiva as notificações JÁ LIDAS — nada é apagado, o histórico
 * continua disponível na tela /notifications.
 */
export const archiveReadNotificationsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({ brandId: z.string().uuid().nullish() })
      .default({})
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; unreadTotal: number }> => {
    let q = context.supabase
      .from("notifications")
      .update({ archived_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .not("read_at", "is", null)
      .is("archived_at", null);
    if (data.brandId) q = q.eq("brand_id", data.brandId);
    const { error } = await q;
    if (error) throw error;
    return { ok: true, unreadTotal: await pendingCount(context.supabase, context.userId, data.brandId ?? null) };
  });
