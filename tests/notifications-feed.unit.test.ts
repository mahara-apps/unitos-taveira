/**
 * Regras do drawer (caixa de entrada de pendentes) vs histórico.
 * Usa as funções REAIS de src/lib/notifications-feed.ts.
 */
import { describe, expect, it } from "vitest";
import {
  applyArchiveRead,
  applyMarkAllRead,
  applyMarkRead,
  isPending,
  notificationsQueryKey,
  pendingOnly,
  type NotificationRow,
  type NotificationsFeed,
} from "@/lib/notifications-feed";

function row(id: string, over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id,
    brand_id: "b1",
    user_id: "u1",
    kind: "system",
    title: `n${id}`,
    body: null,
    href: null,
    payload: null,
    read_at: null,
    archived_at: null,
    created_at: new Date().toISOString(),
    dedupe_key: null,
    ...over,
  } as NotificationRow;
}

function feed(items: NotificationRow[]): NotificationsFeed {
  return { items, unreadTotal: items.filter(isPending).length };
}

describe("pendente x lida x arquivada", () => {
  it("não lida é pendente e aparece no drawer", () => {
    expect(pendingOnly([row("1")]).map((n) => n.id)).toEqual(["1"]);
  });

  it("lida NÃO aparece no drawer", () => {
    expect(pendingOnly([row("1", { read_at: new Date().toISOString() })])).toEqual([]);
  });

  it("arquivada NÃO aparece no drawer", () => {
    expect(pendingOnly([row("1", { archived_at: new Date().toISOString() })])).toEqual([]);
  });
});

describe("marcar como lida", () => {
  it("no drawer remove o item na hora e baixa o contador", () => {
    const f = applyMarkRead(feed([row("1"), row("2")]), "1", { drop: true });
    expect(f.items.map((n) => n.id)).toEqual(["2"]);
    expect(f.unreadTotal).toBe(1);
  });

  it("no histórico mantém o item, apenas marcado como lido", () => {
    const f = applyMarkRead(feed([row("1"), row("2")]), "1", { drop: false });
    expect(f.items.map((n) => n.id)).toEqual(["1", "2"]);
    expect(f.items[0]!.read_at).toBeTruthy();
    expect(f.unreadTotal).toBe(1);
  });

  it("marcar todas remove todas do drawer e zera o contador", () => {
    const f = applyMarkAllRead(feed([row("1"), row("2"), row("3")]), { drop: true });
    expect(f.items).toEqual([]);
    expect(f.unreadTotal).toBe(0);
  });

  it("marcar todas no histórico preserva o histórico", () => {
    const f = applyMarkAllRead(feed([row("1"), row("2")]), { drop: false });
    expect(f.items).toHaveLength(2);
    expect(f.unreadTotal).toBe(0);
  });
});

describe("limpar (arquivar lidas)", () => {
  it("arquiva somente as lidas e não apaga nada", () => {
    const read = row("1", { read_at: new Date().toISOString() });
    const f = applyArchiveRead(feed([read, row("2")]));
    expect(f.items).toHaveLength(2);
    expect(f.items[0]!.archived_at).toBeTruthy();
    expect(f.items[1]!.archived_at).toBeNull();
  });

  it("não altera o contador de pendentes", () => {
    const before = feed([row("1", { read_at: "x" }), row("2")]);
    expect(applyArchiveRead(before).unreadTotal).toBe(before.unreadTotal);
  });
});

describe("isolamento de escopo", () => {
  it("chave inclui usuário e workspace", () => {
    expect(notificationsQueryKey("popup", "u1", "b1")).toEqual([
      "notifications",
      "me",
      "popup",
      "u1",
      "b1",
    ]);
  });

  it("workspaces diferentes nunca compartilham cache", () => {
    expect(notificationsQueryKey("popup", "u1", "b1")).not.toEqual(
      notificationsQueryKey("popup", "u1", "b2"),
    );
  });

  it("usuários diferentes nunca compartilham cache", () => {
    expect(notificationsQueryKey("inbox", "u1", "b1")).not.toEqual(
      notificationsQueryKey("inbox", "u2", "b1"),
    );
  });

  it("drawer e histórico são escopos distintos da mesma fonte", () => {
    expect(notificationsQueryKey("popup", "u1", "b1")).not.toEqual(
      notificationsQueryKey("inbox", "u1", "b1"),
    );
  });
});
