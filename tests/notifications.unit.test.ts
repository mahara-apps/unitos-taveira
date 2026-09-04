/**
 * Regras puras da Central de Notificações: janela do popup e idempotência.
 * Usa as funções REAIS usadas pelo app (sem reimplementar regra).
 */
import { describe, expect, it } from "vitest";
import { NOTIFICATION_WINDOW, notificationWindow } from "@/lib/notifications-window";
import {
  insertNotificationsDeduped,
  notificationDedupeKey,
  type NotificationInsert,
} from "@/lib/notifications-dedupe";

const now = new Date("2026-08-17T12:00:00.000Z");

describe("janela do popup", () => {
  it("popup cobre 30 dias e limita a carga inicial", () => {
    const w = notificationWindow("popup", now);
    expect(NOTIFICATION_WINDOW.popup.days).toBe(30);
    expect(w.limit).toBe(20);
    expect(w.sinceIso).toBe(new Date(now.getTime() - 30 * 86_400_000).toISOString());
  });

  it("inbox usa janela maior que o popup (histórico não polui o popup)", () => {
    expect(NOTIFICATION_WINDOW.inbox.days).toBeGreaterThan(NOTIFICATION_WINDOW.popup.days);
    expect(NOTIFICATION_WINDOW.inbox.limit).toBeGreaterThan(NOTIFICATION_WINDOW.popup.limit);
    expect(new Date(notificationWindow("inbox", now).sinceIso).getTime()).toBeLessThan(
      new Date(notificationWindow("popup", now).sinceIso).getTime(),
    );
  });
});

function row(key: string): NotificationInsert {
  return {
    user_id: "u1",
    brand_id: "b1",
    kind: "sla_overdue",
    title: "SLA vencido",
    dedupe_key: key,
  };
}

/** Fake que reproduz o índice único parcial (user_id, kind, dedupe_key) WHERE read_at IS NULL. */
function fakeClient() {
  const pending = new Set<string>();
  const calls: number[] = [];
  return {
    pending,
    calls,
    from() {
      return {
        insert: async (rows: NotificationInsert[]) => {
          calls.push(rows.length);
          const keys = rows.map((r) => `${r.user_id}:${r.kind}:${r.dedupe_key}`);
          const dup = keys.some((k) => pending.has(k)) || new Set(keys).size !== keys.length;
          if (dup) return { error: { code: "23505", message: "duplicate key" } };
          for (const k of keys) pending.add(k);
          return { error: null };
        },
      };
    },
  };
}

describe("idempotência de notificações", () => {
  it("mesmo evento pendente não duplica em reprocessamentos", async () => {
    const c = fakeClient();
    const r = row(notificationDedupeKey("sla_overdue", "post-1"));
    expect(await insertNotificationsDeduped(c as never, [r])).toBe(1);
    expect(await insertNotificationsDeduped(c as never, [r])).toBe(0);
    expect(await insertNotificationsDeduped(c as never, [r, r])).toBe(0);
    expect(c.pending.size).toBe(1);
  });

  it("insere os novos e ignora só os duplicados dentro do mesmo lote", async () => {
    const c = fakeClient();
    const a = row(notificationDedupeKey("sla_overdue", "post-a"));
    const b = row(notificationDedupeKey("sla_overdue", "post-b"));
    expect(await insertNotificationsDeduped(c as never, [a])).toBe(1);
    expect(await insertNotificationsDeduped(c as never, [a, b])).toBe(1);
    expect(c.pending.size).toBe(2);
  });

  it("propaga erros que não são violação de unicidade", async () => {
    const client = {
      from: () => ({ insert: async () => ({ error: { code: "42501", message: "denied" } }) }),
    };
    await expect(insertNotificationsDeduped(client as never, [row("k")])).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("chave de dedupe é estável e tolera partes nulas", () => {
    expect(notificationDedupeKey("deadline", "task", "abc")).toBe("deadline:task:abc");
    expect(notificationDedupeKey("sla_overdue_manager", null)).toBe("sla_overdue_manager:-");
  });
});
