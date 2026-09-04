/**
 * FASE 10D.2 — fechamento do escopo NULL em projects / tasks / activity_events.
 *
 * Verifica no BANCO (RLS real, sem bypass) que registros workspace-level
 * (`client_id IS NULL`) deixaram de ser visíveis a MANAGER/USER por simples
 * membership, mantendo ADMIN/SUPER ADMIN com autoridade de workspace e o
 * Portal isolado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createUser, seed, type Fixture, type TestUser } from "./helpers/fixtures";
import { createSuperAdminUser, privilegedTestEnvAllowed } from "./helpers/fixtures";

/** Identidade SUPER ADMIN real só é criada em ambiente declarado de teste. */
const PRIV = privilegedTestEnvAllowed();

let fx: Fixture;
let superAdmin: TestUser;

let projectA: string;
let projectB: string;
let projectNull: string;
let taskA: string;
let taskB: string;
let taskNull: string;
let eventA: string;
let eventB: string;
let eventNull: string;

const ids = (rows: Array<{ id: string }> | null) => (rows ?? []).map((r) => r.id);

async function insertProject(clientId: string | null, name: string) {
  const r = await admin
    .from("projects")
    .insert({ brand_id: fx.brandId, client_id: clientId, name, status: "active" })
    .select("id")
    .single();
  if (r.error) throw new Error(`project ${name}: ${r.error.message}`);
  return r.data.id as string;
}

async function insertTask(clientId: string | null, projectId: string | null, title: string) {
  const r = await admin
    .from("tasks")
    .insert({
      brand_id: fx.brandId,
      client_id: clientId,
      project_id: projectId,
      title,
      status: "todo",
    })
    .select("id")
    .single();
  if (r.error) throw new Error(`task ${title}: ${r.error.message}`);
  return r.data.id as string;
}

async function insertEvent(clientId: string | null, verb: string) {
  const r = await admin
    .from("activity_events")
    .insert({
      brand_id: fx.brandId,
      client_id: clientId,
      entity_type: "task",
      entity_id: taskA,
      verb,
      payload: { tag: "10d2" },
    })
    .select("id")
    .single();
  if (r.error) throw new Error(`event ${verb}: ${r.error.message}`);
  return r.data.id as string;
}

beforeAll(async () => {
  fx = await seed();
  if (PRIV) superAdmin = await createSuperAdminUser("d2super");

  projectA = await insertProject(fx.clientA, "10D2 Proj A");
  projectB = await insertProject(fx.clientB, "10D2 Proj B");
  projectNull = await insertProject(null, "10D2 Proj Workspace");

  taskA = await insertTask(fx.clientA, projectA, "10D2 Task A");
  taskB = await insertTask(fx.clientB, projectB, "10D2 Task B");
  taskNull = await insertTask(null, null, "10D2 Task Workspace");

  eventA = await insertEvent(fx.clientA, "10d2_a");
  eventB = await insertEvent(fx.clientB, "10d2_b");
  eventNull = await insertEvent(null, "10d2_orphan");
}, 180_000);

afterAll(async () => {
  await admin.from("activity_events").delete().in("id", [eventA, eventB, eventNull]);
  if (superAdmin) await admin.auth.admin.deleteUser(superAdmin.id).catch(() => {});
  await cleanup(fx);
}, 180_000);

const readProjects = (u: TestUser) =>
  u.client.from("projects").select("id").eq("brand_id", fx.brandId);
const readTasks = (u: TestUser) => u.client.from("tasks").select("id").eq("brand_id", fx.brandId);
const readEvents = (u: TestUser) =>
  u.client.from("activity_events").select("id").in("id", [eventA, eventB, eventNull]);

describe("A/B/T — ADMIN (owner) cobre todo o workspace", () => {
  it("vê projects de A e de B", async () => {
    const r = await readProjects(fx.userOwner);
    expect(r.error).toBeNull();
    expect(ids(r.data)).toEqual(expect.arrayContaining([projectA, projectB]));
  });
  it("vê o project workspace-level (client_id NULL)", async () => {
    const r = await readProjects(fx.userOwner);
    expect(ids(r.data)).toContain(projectNull);
  });
  it("vê tasks de A, B e workspace-level", async () => {
    const r = await readTasks(fx.userOwner);
    expect(ids(r.data)).toEqual(expect.arrayContaining([taskA, taskB, taskNull]));
  });
});

describe("U — SUPER ADMIN mantém autoridade global", () => {
  it.skipIf(!PRIV)("vê todos os projects e tasks", async () => {
    const p = await readProjects(superAdmin);
    const t = await readTasks(superAdmin);
    expect(ids(p.data)).toEqual(expect.arrayContaining([projectA, projectB, projectNull]));
    expect(ids(t.data)).toEqual(expect.arrayContaining([taskA, taskB, taskNull]));
  });
  it.skipIf(!PRIV)("vê os eventos, inclusive o órfão NULL", async () => {
    const r = await readEvents(superAdmin);
    expect(ids(r.data)).toEqual(expect.arrayContaining([eventA, eventB, eventNull]));
  });
});

describe("C/D/I/K — MANAGER só acessa clientes atribuídos", () => {
  it("MANAGER sem atribuição não recebe projects/tasks de A nem de B", async () => {
    const p = await readProjects(fx.userManager);
    const t = await readTasks(fx.userManager);
    expect(ids(p.data)).not.toContain(projectA);
    expect(ids(p.data)).not.toContain(projectB);
    expect(ids(t.data)).not.toContain(taskA);
    expect(ids(t.data)).not.toContain(taskB);
  });
  it("MANAGER não acessa project NULL por membership", async () => {
    const p = await readProjects(fx.userManager);
    expect(ids(p.data)).not.toContain(projectNull);
  });
  it("MANAGER não acessa task NULL por membership", async () => {
    const t = await readTasks(fx.userManager);
    expect(ids(t.data)).not.toContain(taskNull);
  });
  it("MANAGER atribuído ao cliente A vê A e não vê B", async () => {
    const link = await admin
      .from("client_members")
      .insert({
        brand_id: fx.brandId,
        client_id: fx.clientA,
        user_id: fx.userManager.id,
        role: "manager",
      })
      .select("id")
      .single();
    if (link.error) throw new Error(link.error.message);
    try {
      const p = await readProjects(fx.userManager);
      const t = await readTasks(fx.userManager);
      expect(ids(p.data)).toContain(projectA);
      expect(ids(p.data)).not.toContain(projectB);
      expect(ids(p.data)).not.toContain(projectNull);
      expect(ids(t.data)).toContain(taskA);
      expect(ids(t.data)).not.toContain(taskB);
      expect(ids(t.data)).not.toContain(taskNull);
    } finally {
      await admin.from("client_members").delete().eq("id", link.data.id);
    }
  });
});

describe("E/F/H/J/L — USER só acessa clientes atribuídos", () => {
  it("USER de A vê A e não vê B", async () => {
    const p = await readProjects(fx.userA);
    const t = await readTasks(fx.userA);
    expect(ids(p.data)).toContain(projectA);
    expect(ids(p.data)).not.toContain(projectB);
    expect(ids(t.data)).toContain(taskA);
    expect(ids(t.data)).not.toContain(taskB);
  });
  it("USER de A não acessa project/task NULL por membership", async () => {
    const p = await readProjects(fx.userA);
    const t = await readTasks(fx.userA);
    expect(ids(p.data)).not.toContain(projectNull);
    expect(ids(t.data)).not.toContain(taskNull);
  });
  it("USER sem cliente atribuído não recebe nada por membership", async () => {
    const p = await readProjects(fx.userNoLink);
    const t = await readTasks(fx.userNoLink);
    expect(p.data ?? []).toHaveLength(0);
    expect(t.data ?? []).toHaveLength(0);
  });
});

describe("herança — subtarefas/comentários/tempo/jobs de registro NULL", () => {
  it("can_access_task/can_access_project rejeitam registro NULL para USER", async () => {
    const t = await fx.userA.client.rpc("can_access_task", {
      _task_id: taskNull,
      _user_id: fx.userA.id,
    });
    const p = await fx.userA.client.rpc("can_access_project", {
      _project_id: projectNull,
      _user_id: fx.userA.id,
    });
    expect(t.data).toBe(false);
    expect(p.data).toBe(false);
  });
  it("subtarefa de task NULL não é visível nem inserível por USER", async () => {
    const st = await admin
      .from("task_subtasks")
      .insert({ brand_id: fx.brandId, task_id: taskNull, title: "10D2 sub null" })
      .select("id")
      .single();
    if (st.error) throw new Error(st.error.message);
    try {
      const read = await fx.userA.client.from("task_subtasks").select("id").eq("id", st.data.id);
      expect(read.data ?? []).toHaveLength(0);
      const write = await fx.userA.client
        .from("task_subtasks")
        .insert({ brand_id: fx.brandId, task_id: taskNull, title: "forjada" })
        .select("id");
      expect(write.error).toBeTruthy();
    } finally {
      await admin.from("task_subtasks").delete().eq("id", st.data.id);
    }
  });
  it("comentário em task NULL é rejeitado para USER", async () => {
    const r = await fx.userA.client
      .from("task_comments")
      .insert({ task_id: taskNull, author_id: fx.userA.id, body: "forjado" })
      .select("id");
    expect(r.error).toBeTruthy();
  });
  it("apontamento de tempo em task NULL é rejeitado para USER", async () => {
    const r = await fx.userA.client
      .from("task_time_entries")
      .insert({ task_id: taskNull, user_id: fx.userA.id, minutes: 10 })
      .select("id");
    expect(r.error).toBeTruthy();
  });
});

describe("M/N/O — activity_events", () => {
  it("evento do cliente A é visível para o USER de A", async () => {
    const r = await readEvents(fx.userA);
    expect(ids(r.data)).toContain(eventA);
  });
  it("evento do cliente B não é visível para o USER de A", async () => {
    const r = await readEvents(fx.userA);
    expect(ids(r.data)).not.toContain(eventB);
  });
  it("evento órfão NULL não vaza para MANAGER/USER", async () => {
    const u = await readEvents(fx.userA);
    const m = await readEvents(fx.userManager);
    const n = await readEvents(fx.userNoLink);
    expect(ids(u.data)).not.toContain(eventNull);
    expect(ids(m.data)).not.toContain(eventNull);
    expect(ids(n.data)).not.toContain(eventNull);
  });
  it("ADMIN do workspace continua vendo o histórico NULL", async () => {
    const r = await readEvents(fx.userOwner);
    expect(ids(r.data)).toContain(eventNull);
  });
});

describe("P/Q/R/S — escrita com IDs forjados", () => {
  it("USER de A não cria project para o cliente B", async () => {
    const r = await fx.userA.client
      .from("projects")
      .insert({ brand_id: fx.brandId, client_id: fx.clientB, name: "forjado", status: "active" })
      .select("id");
    expect(r.error).toBeTruthy();
  });
  it("USER de A não cria project workspace-level (client_id NULL)", async () => {
    const r = await fx.userA.client
      .from("projects")
      .insert({ brand_id: fx.brandId, client_id: null, name: "forjado null", status: "active" })
      .select("id");
    expect(r.error).toBeTruthy();
  });
  it("USER de A não cria task para o cliente B nem workspace-level", async () => {
    const b = await fx.userA.client
      .from("tasks")
      .insert({ brand_id: fx.brandId, client_id: fx.clientB, title: "forjada B", status: "todo" })
      .select("id");
    const nul = await fx.userA.client
      .from("tasks")
      .insert({ brand_id: fx.brandId, client_id: null, title: "forjada null", status: "todo" })
      .select("id");
    expect(b.error).toBeTruthy();
    expect(nul.error).toBeTruthy();
  });
  it("project/task de outra workspace são rejeitados", async () => {
    const p = await fx.userA.client.from("projects").select("id").eq("id", fx.otherBrandProject);
    expect(p.data ?? []).toHaveLength(0);
    const w = await fx.userA.client
      .from("tasks")
      .insert({
        brand_id: fx.otherBrandId,
        client_id: fx.otherBrandClient,
        title: "cross workspace",
        status: "todo",
      })
      .select("id");
    expect(w.error).toBeTruthy();
  });
});

describe("V — Portal permanece isolado", () => {
  it("portal_client não lê projects/tasks/activity_events internos", async () => {
    const p = await readProjects(fx.userPortal);
    const t = await readTasks(fx.userPortal);
    const e = await readEvents(fx.userPortal);
    expect(p.data ?? []).toHaveLength(0);
    expect(t.data ?? []).toHaveLength(0);
    expect(e.data ?? []).toHaveLength(0);
  });
});
