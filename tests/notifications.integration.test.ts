/**
 * Central de Notificações — contador real, leitura persistida, janela do popup,
 * idempotência (sem duplicatas) e isolamento por usuário (RLS).
 *
 * Usa as MESMAS queries das server functions (src/lib/notifications.functions.ts)
 * executadas com o client autenticado do usuário, então RLS é exercida de verdade.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, cleanup, seed, type Fixture } from "./helpers/fixtures";
import { notificationWindow } from "@/lib/notifications-window";
import { insertNotificationsDeduped, notificationDedupeKey } from "@/lib/notifications-dedupe";

let fx: Fixture | null = null;

/** Espelha listMyNotificationsFn. */
async function feed(c: SupabaseClient, userId: string, scope: "popup" | "inbox" = "popup") {
  const { sinceIso, limit } = notificationWindow(scope);
  const [list, unread] = await Promise.all([
    c
      .from("notifications")
      .select("id,kind,title,read_at,created_at,dedupe_key")
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit),
    c
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ]);
  if (list.error) throw list.error;
  if (unread.error) throw unread.error;
  return { items: list.data ?? [], unreadTotal: unread.count ?? 0 };
}

/** Espelha markNotificationReadFn. */
async function markRead(c: SupabaseClient, userId: string, id: string) {
  const { error } = await c
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
}

/** Espelha markAllNotificationsReadFn. */
async function markAllRead(c: SupabaseClient, userId: string) {
  const { error } = await c
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
}

async function insert(row: Record<string, unknown>) {
  const { data, error } = await admin
    .from("notifications")
    .insert(row as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

beforeAll(async () => {
  fx = await seed();
  // Zera qualquer resíduo dos usuários de teste.
  await admin.from("notifications").delete().in("user_id", [fx.userA.id, fx.userB.id]);
}, 120_000);

afterAll(async () => {
  if (fx) await admin.from("notifications").delete().in("user_id", [fx.userA.id, fx.userB.id]);
  await cleanup(fx);
});

describe("notificações", () => {
  it("nova notificação aparece como não lida e o contador sobe", async () => {
    const f = fx!;
    const before = await feed(f.userA.client, f.userA.id);
    const id = await insert({
      user_id: f.userA.id,
      brand_id: f.brandId,
      kind: "system",
      title: "Nova notificação QA",
      dedupe_key: notificationDedupeKey("system", "qa-1"),
    });
    const after = await feed(f.userA.client, f.userA.id);
    expect(after.unreadTotal).toBe(before.unreadTotal + 1);
    const row = after.items.find((n) => n.id === id);
    expect(row?.read_at).toBeNull();
  });

  it("abrir/clicar marca como lida no servidor e o contador desce", async () => {
    const f = fx!;
    const id = await insert({
      user_id: f.userA.id,
      brand_id: f.brandId,
      kind: "system",
      title: "Para ler QA",
      dedupe_key: notificationDedupeKey("system", "qa-2"),
    });
    const before = await feed(f.userA.client, f.userA.id);
    await markRead(f.userA.client, f.userA.id, id);
    const after = await feed(f.userA.client, f.userA.id);
    expect(after.unreadTotal).toBe(before.unreadTotal - 1);
    expect(after.items.find((n) => n.id === id)?.read_at).not.toBeNull();
    // Reload (nova consulta) mantém o estado persistido.
    const reload = await feed(f.userA.client, f.userA.id);
    expect(reload.items.find((n) => n.id === id)?.read_at).not.toBeNull();
  });

  it("'Marcar todas como lidas' zera o contador e persiste após reload", async () => {
    const f = fx!;
    await insert({
      user_id: f.userA.id,
      brand_id: f.brandId,
      kind: "mention",
      title: "Pendente 1 QA",
      dedupe_key: notificationDedupeKey("mention", "qa-3"),
    });
    await insert({
      user_id: f.userA.id,
      brand_id: f.brandId,
      kind: "approval_decision",
      title: "Pendente 2 QA",
      dedupe_key: notificationDedupeKey("approval_decision", "qa-4"),
    });
    expect((await feed(f.userA.client, f.userA.id)).unreadTotal).toBeGreaterThan(0);
    await markAllRead(f.userA.client, f.userA.id);
    expect((await feed(f.userA.client, f.userA.id)).unreadTotal).toBe(0);
    expect((await feed(f.userA.client, f.userA.id, "inbox")).unreadTotal).toBe(0);
  });

  it("notificações antigas ficam fora da janela do popup e não contam como pendentes", async () => {
    const f = fx!;
    await admin.from("notifications").insert({
      user_id: f.userA.id,
      brand_id: f.brandId,
      kind: "system",
      title: "Antiga QA",
      read_at: new Date().toISOString(),
      created_at: new Date(Date.now() - 120 * 86_400_000).toISOString(),
      dedupe_key: notificationDedupeKey("system", "qa-old"),
    } as never);
    const popup = await feed(f.userA.client, f.userA.id);
    expect(popup.items.some((n) => n.title === "Antiga QA")).toBe(false);
    expect(popup.unreadTotal).toBe(0);
    // Continua no banco (histórico).
    const hist = await admin
      .from("notifications")
      .select("id")
      .eq("user_id", f.userA.id)
      .eq("title", "Antiga QA");
    expect((hist.data ?? []).length).toBe(1);
  });

  it("o mesmo evento pendente não gera duplicatas (idempotência)", async () => {
    const f = fx!;
    const row = {
      user_id: f.userA.id,
      brand_id: f.brandId,
      kind: "sla_overdue",
      title: 'SLA vencido em "Ideia"',
      dedupe_key: notificationDedupeKey("sla_overdue", "post-qa-1"),
    };
    // Simula reload / reprocessamento do worker várias vezes.
    const first = await insertNotificationsDeduped(admin as never, [row] as never);
    const second = await insertNotificationsDeduped(admin as never, [row] as never);
    const third = await insertNotificationsDeduped(admin as never, [row, row] as never);
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(third).toBe(0);

    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", f.userA.id)
      .eq("dedupe_key", row.dedupe_key)
      .is("read_at", null);
    expect(count).toBe(1);
    expect((await feed(f.userA.client, f.userA.id)).unreadTotal).toBe(1);

    // Depois de lida, um novo evento do mesmo tipo pode voltar a notificar.
    await markAllRead(f.userA.client, f.userA.id);
    const again = await insertNotificationsDeduped(admin as never, [row] as never);
    expect(again).toBe(1);
    expect((await feed(f.userA.client, f.userA.id)).unreadTotal).toBe(1);
  });

  it("usuário A não vê nem marca notificações do usuário B (RLS)", async () => {
    const f = fx!;
    const idB = await insert({
      user_id: f.userB.id,
      brand_id: f.brandId,
      kind: "system",
      title: "Só do B QA",
      dedupe_key: notificationDedupeKey("system", "qa-b"),
    });

    // A não lê a notificação de B.
    const asA = await f.userA.client.from("notifications").select("id").eq("id", idB);
    expect((asA.data ?? []).length).toBe(0);

    // A não consegue marcar como lida a de B.
    await f.userA.client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", idB);
    const check = await admin.from("notifications").select("read_at").eq("id", idB).single();
    expect((check.data as { read_at: string | null }).read_at).toBeNull();

    // B enxerga a sua.
    const asB = await feed(f.userB.client, f.userB.id);
    expect(asB.items.some((n) => n.id === idB)).toBe(true);
    expect(asB.unreadTotal).toBe(1);
  });
});
