/**
 * Fase 3 — Notificações Reais.
 *
 * Valida que `user_profiles.notification_prefs` é aplicada NO SERVIDOR pelos
 * emissores reais (triggers/funções SQL), que kinds críticos nunca são
 * bloqueados, que a preferência de um usuário não afeta outro e que o
 * isolamento cross-brand segue intacto.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, seed, type Fixture } from "./helpers/fixtures";
import {
  DEFAULT_NOTIFICATION_PREFS,
  allowsKind,
  filterRowsByPrefs,
  prefKeyForKind,
} from "@/lib/notification-prefs";

let fx: Fixture | null = null;

beforeAll(async () => {
  fx = await seed();
}, 120_000);

afterAll(async () => {
  await cleanup();
}, 120_000);

function f(): Fixture {
  if (!fx) throw new Error("fixture não carregada");
  return fx;
}

async function setPrefs(userId: string, prefs: Record<string, boolean>) {
  const { error } = await admin
    .from("user_profiles")
    .update({ notification_prefs: { ...DEFAULT_NOTIFICATION_PREFS, ...prefs } } as never)
    .eq("id", userId);
  if (error) throw error;
}

async function gate(userId: string, kind: string): Promise<boolean> {
  const { data, error } = await admin.rpc("notification_prefs_allows", {
    _user_id: userId,
    _kind: kind,
  });
  if (error) throw error;
  return data as boolean;
}

async function countKind(userId: string, kind: string): Promise<number> {
  const { count, error } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind);
  if (error) throw error;
  return count ?? 0;
}

async function createTask(assignee: string | null) {
  const { data, error } = await admin
    .from("tasks")
    .insert({
      brand_id: f().brandId,
      client_id: f().clientA,
      title: `QA prefs ${Date.now()}`,
      assignee_id: assignee,
      created_by: f().userOwner.id,
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

describe("gate de preferências no servidor", () => {
  it("kind sem preferência (crítico) sempre passa", async () => {
    await setPrefs(f().userA.id, {});
    expect(prefKeyForKind("sla_overdue")).toBeNull();
    expect(prefKeyForKind("briefing_submitted")).toBeNull();
    expect(await gate(f().userA.id, "sla_overdue")).toBe(true);
    expect(await gate(f().userA.id, "sla_overdue_manager")).toBe(true);
    expect(await gate(f().userA.id, "briefing_submitted")).toBe(true);
  });

  it("preferência desativada bloqueia; ativada libera", async () => {
    await setPrefs(f().userA.id, { assignments: false });
    expect(await gate(f().userA.id, "assignment")).toBe(false);
    await setPrefs(f().userA.id, { assignments: true });
    expect(await gate(f().userA.id, "assignment")).toBe(true);
  });

  it("mesmo com prefs desligadas, crítico continua liberado", async () => {
    await setPrefs(f().userA.id, {
      comments: false,
      assignments: false,
      approvals: false,
      deadlines: false,
      ai_jobs: false,
    });
    expect(await gate(f().userA.id, "sla_overdue")).toBe(true);
    expect(await gate(f().userA.id, "assignment")).toBe(false);
  });
});

describe("emissor real: atribuição de tarefa", () => {
  it("usuário com preferência desativada NÃO recebe a notificação", async () => {
    await setPrefs(f().userA.id, { assignments: false });
    const before = await countKind(f().userA.id, "assignment");
    const taskId = await createTask(null);
    await admin
      .from("tasks")
      .update({ assignee_id: f().userA.id } as never)
      .eq("id", taskId);
    expect(await countKind(f().userA.id, "assignment")).toBe(before);
  });

  it("usuário com preferência ativada recebe normalmente", async () => {
    await setPrefs(f().userA.id, { assignments: true });
    const before = await countKind(f().userA.id, "assignment");
    const taskId = await createTask(null);
    await admin
      .from("tasks")
      .update({ assignee_id: f().userA.id } as never)
      .eq("id", taskId);
    expect(await countKind(f().userA.id, "assignment")).toBe(before + 1);
  });

  it("preferência de um usuário não afeta outro", async () => {
    await setPrefs(f().userA.id, { assignments: false });
    await setPrefs(f().userB.id, { assignments: true });
    const beforeA = await countKind(f().userA.id, "assignment");
    const beforeB = await countKind(f().userB.id, "assignment");

    const t1 = await createTask(null);
    await admin
      .from("tasks")
      .update({ assignee_id: f().userA.id } as never)
      .eq("id", t1);
    const t2 = await createTask(null);
    await admin
      .from("tasks")
      .update({ assignee_id: f().userB.id } as never)
      .eq("id", t2);

    expect(await countKind(f().userA.id, "assignment")).toBe(beforeA);
    expect(await countKind(f().userB.id, "assignment")).toBe(beforeB + 1);
  });
});

describe("emissor real: aprovação de post", () => {
  async function createPost() {
    const { data, error } = await admin
      .from("posts")
      .insert({
        brand_id: f().brandId,
        client_id: f().clientA,
        title: `QA prefs post ${Date.now()}`,
        stage: "idea",
        created_by: f().userOwner.id,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  it("membro com aprovações desligadas não recebe approval_requested", async () => {
    await setPrefs(f().userA.id, { approvals: false });
    await setPrefs(f().userB.id, { approvals: true });
    const beforeA = await countKind(f().userA.id, "approval_requested");
    const beforeB = await countKind(f().userB.id, "approval_requested");

    const postId = await createPost();
    await admin
      .from("posts")
      .update({ stage: "review" } as never)
      .eq("id", postId);

    expect(await countKind(f().userA.id, "approval_requested")).toBe(beforeA);
    expect(await countKind(f().userB.id, "approval_requested")).toBe(beforeB + 1);
  });
});

describe("prazos e cross-brand", () => {
  it("deadline respeita preferência do responsável", async () => {
    await setPrefs(f().userA.id, { deadlines: false });
    const soon = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const t = await createTask(null);
    await admin
      .from("tasks")
      .update({ assignee_id: f().userA.id, due_at: soon, done: false } as never)
      .eq("id", t);
    const before = await countKind(f().userA.id, "deadline");
    await admin.rpc("enqueue_deadline_notifications");
    expect(await countKind(f().userA.id, "deadline")).toBe(before);

    await setPrefs(f().userA.id, { deadlines: true });
    await admin.rpc("enqueue_deadline_notifications");
    expect(await countKind(f().userA.id, "deadline")).toBeGreaterThan(before);
  });

  it("notificações continuam isoladas por usuário (RLS) e por marca", async () => {
    const { data: mine } = await f().userA.client.from("notifications").select("user_id, brand_id");
    for (const row of (mine ?? []) as Array<{ user_id: string; brand_id: string | null }>) {
      expect(row.user_id).toBe(f().userA.id);
      expect(row.brand_id === null || row.brand_id === f().brandId).toBe(true);
      expect(row.brand_id).not.toBe(f().otherBrandId);
    }
  });
});

describe("helper TS espelha a regra do SQL", () => {
  it("allowsKind bloqueia o que o SQL bloqueia e libera crítico", () => {
    expect(allowsKind({ ai_jobs: false }, "system")).toBe(false);
    expect(allowsKind({ ai_jobs: false }, "sla_overdue")).toBe(true);
    expect(allowsKind({}, "mention")).toBe(true);
  });

  it("filterRowsByPrefs remove destinatários que desligaram o evento", async () => {
    await setPrefs(f().userA.id, { ai_jobs: false });
    await setPrefs(f().userB.id, { ai_jobs: true });
    const rows = [
      { user_id: f().userA.id, kind: "system" },
      { user_id: f().userB.id, kind: "system" },
      { user_id: f().userA.id, kind: "sla_overdue" },
    ];
    const allowed = await filterRowsByPrefs(admin as never, rows);
    expect(allowed.map((r) => `${r.user_id}:${r.kind}`)).toEqual([
      `${f().userB.id}:system`,
      `${f().userA.id}:sla_overdue`,
    ]);
  });
});
