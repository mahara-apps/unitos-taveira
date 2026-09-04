/**
 * FASE 1 RBAC — matriz completa de papéis × workspace × cliente, exercida com
 * usuários reais e RLS de verdade (sem service role no caminho de leitura).
 *
 * Hierarquia validada:
 *   SUPER ADMIN → todos os workspaces
 *   ADMIN       → workspaces em que é membro (todos os clientes deles)
 *   MANAGER     → workspace + clientes atribuídos
 *   USER        → workspace + clientes atribuídos
 *   CLIENT      → somente o próprio cliente (Portal)
 *
 * Herança: workspace → client → project → task → subtask.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createUser, seed, type Fixture, type TestUser } from "./helpers/fixtures";
import { createSuperAdminUser, privilegedTestEnvAllowed } from "./helpers/fixtures";

/** Identidade SUPER ADMIN real só é criada em ambiente declarado de teste. */
const PRIV = privilegedTestEnvAllowed();

let fx: Fixture;
let superAdmin: TestUser;
let multiAdmin: TestUser; // ADMIN de brandId + otherBrandId
let projectB: string;
let taskB: string;
let subtaskB: string;

const canAccessClient = async (u: TestUser, clientId: string) => {
  const { data, error } = await u.client.rpc("can_access_client", {
    _client_id: clientId,
    _user_id: u.id,
  });
  expect(error).toBeNull();
  return data === true;
};

const canAccessProject = async (u: TestUser, projectId: string) => {
  const { data, error } = await u.client.rpc("can_access_project", {
    _project_id: projectId,
    _user_id: u.id,
  });
  expect(error).toBeNull();
  return data === true;
};

const canAccessTask = async (u: TestUser, taskId: string) => {
  const { data, error } = await u.client.rpc("can_access_task", {
    _task_id: taskId,
    _user_id: u.id,
  });
  expect(error).toBeNull();
  return data === true;
};

const myAccess = async (u: TestUser, brandId: string | null) => {
  const { data, error } = await u.client.rpc("my_access", { _brand_id: brandId });
  expect(error).toBeNull();
  return data as {
    role: string | null;
    is_super_admin: boolean;
    client_ids: string[];
    brand_ids: string[];
  };
};

beforeAll(async () => {
  fx = await seed();

  if (PRIV) superAdmin = await createSuperAdminUser("su");

  multiAdmin = await createUser("multi");
  const mm = await admin.from("brand_members").insert([
    { brand_id: fx.brandId, user_id: multiAdmin.id, role: "owner" },
    { brand_id: fx.otherBrandId, user_id: multiAdmin.id, role: "owner" },
  ]);
  if (mm.error) throw mm.error;

  // Descendentes do Cliente B (mesmo workspace do Cliente A).
  const p = await admin
    .from("projects")
    .insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      name: `Projeto B ${Date.now()}`,
      status: "active",
    })
    .select("id")
    .single();
  if (p.error) throw p.error;
  projectB = p.data.id as string;

  const t = await admin
    .from("tasks")
    .insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      project_id: projectB,
      title: "Task B",
    })
    .select("id")
    .single();
  if (t.error) throw t.error;
  taskB = t.data.id as string;

  const st = await admin
    .from("task_subtasks")
    .insert({ brand_id: fx.brandId, task_id: taskB, title: "Subtask B" })
    .select("id")
    .single();
  if (st.error) throw st.error;
  subtaskB = st.data.id as string;
}, 120_000);

afterAll(async () => {
  await admin
    .from("brand_members")
    .delete()
    .eq("user_id", multiAdmin?.id ?? "");
  await cleanup(fx);
  for (const u of [superAdmin, multiAdmin].filter(Boolean)) {
    if (u) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }
});

describe("SUPER ADMIN — autoridade de plataforma", () => {
  it.skipIf(!PRIV)("1) acessa clientes do workspace A", async () => {
    expect(await canAccessClient(superAdmin, fx.clientA)).toBe(true);
  });

  it.skipIf(!PRIV)("2) acessa clientes do workspace B", async () => {
    expect(await canAccessClient(superAdmin, fx.otherBrandClient)).toBe(true);
  });

  it.skipIf(!PRIV)("19) é distinto de admin: my_access marca is_super_admin", async () => {
    const a = await myAccess(superAdmin, fx.brandId);
    expect(a.is_super_admin).toBe(true);
    expect(a.role).toBe("super_admin");
  });
});

describe("ADMIN — escopo por workspace", () => {
  it("3) acessa todos os clientes do próprio workspace (sem vínculo por cliente)", async () => {
    expect(await canAccessClient(fx.userOwner, fx.clientA)).toBe(true);
    expect(await canAccessClient(fx.userOwner, fx.clientB)).toBe(true);
    expect(await canAccessClient(fx.userOwner, fx.clientOrphan)).toBe(true);
  });

  it("4) NÃO acessa cliente de workspace onde não é membro", async () => {
    const solo = await createUser("adminsolo");
    await admin.from("brand_members").insert({
      brand_id: fx.brandId,
      user_id: solo.id,
      role: "owner",
    });
    expect(await canAccessClient(solo, fx.otherBrandClient)).toBe(false);
    await admin.from("brand_members").delete().eq("user_id", solo.id);
    await admin.auth.admin.deleteUser(solo.id).catch(() => {});
  });

  it("5+20) admin de A+B alterna entre os dois workspaces", async () => {
    const a = await myAccess(multiAdmin, fx.brandId);
    const b = await myAccess(multiAdmin, fx.otherBrandId);
    expect(a.role).toBe("admin");
    expect(b.role).toBe("admin");
    expect(a.brand_ids).toEqual(expect.arrayContaining([fx.brandId, fx.otherBrandId]));
    expect(await canAccessClient(multiAdmin, fx.clientA)).toBe(true);
    expect(await canAccessClient(multiAdmin, fx.otherBrandClient)).toBe(true);
  });

  it("18) admin NÃO vira super_admin", async () => {
    const a = await myAccess(fx.userOwner, fx.brandId);
    expect(a.role).toBe("admin");
    expect(a.is_super_admin).toBe(false);
  });

  it("user_profiles.role='admin' não concede acesso fora das memberships", async () => {
    const ghost = await createUser("ghostadmin");
    const up = await admin.from("user_profiles").update({ role: "admin" }).eq("id", ghost.id);
    expect(up.error).toBeNull();
    expect(await canAccessClient(ghost, fx.clientA)).toBe(false);
    const acc = await myAccess(ghost, fx.brandId);
    expect(acc.is_super_admin).toBe(false);
    expect(acc.client_ids).toEqual([]);
    await admin.auth.admin.deleteUser(ghost.id).catch(() => {});
  });
});

describe("MANAGER / USER — escopo por cliente atribuído", () => {
  it("6+7) manager sem atribuição não acessa clientes do workspace", async () => {
    expect(await canAccessClient(fx.userManager, fx.clientA)).toBe(false);
    expect(await canAccessClient(fx.userManager, fx.clientB)).toBe(false);

    const link = await admin.from("client_members").insert({
      brand_id: fx.brandId,
      client_id: fx.clientA,
      user_id: fx.userManager.id,
      role: "manager",
    });
    expect(link.error).toBeNull();
    expect(await canAccessClient(fx.userManager, fx.clientA)).toBe(true);
    expect(await canAccessClient(fx.userManager, fx.clientB)).toBe(false);
  });

  it("8+9) user atribuído ao Cliente A não acessa o Cliente B", async () => {
    expect(await canAccessClient(fx.userA, fx.clientA)).toBe(true);
    expect(await canAccessClient(fx.userA, fx.clientB)).toBe(false);
    expect(await canAccessClient(fx.userB, fx.clientB)).toBe(true);
    expect(await canAccessClient(fx.userB, fx.clientA)).toBe(false);
  });

  it("16+17) membership no workspace não concede acesso global", async () => {
    expect(await canAccessClient(fx.userNoLink, fx.clientA)).toBe(false);
    expect(await canAccessClient(fx.userNoLink, fx.clientOrphan)).toBe(false);
    const acc = await myAccess(fx.userNoLink, fx.brandId);
    expect(acc.role).toBe("user");
    expect(acc.client_ids).toEqual([]);
  });

  it("11) cross-workspace bloqueado para manager e user", async () => {
    expect(await canAccessClient(fx.userManager, fx.otherBrandClient)).toBe(false);
    expect(await canAccessClient(fx.userA, fx.otherBrandClient)).toBe(false);
    const rows = await fx.userA.client.from("clients").select("id").eq("brand_id", fx.otherBrandId);
    expect(rows.data ?? []).toEqual([]);
  });
});

describe("CLIENT (Portal) — somente o próprio cliente", () => {
  it("10) portal lê o próprio cliente e nenhum outro", async () => {
    const rows = await fx.userPortal.client.from("clients").select("id");
    expect(rows.error).toBeNull();
    expect((rows.data ?? []).map((r) => r.id)).toEqual([fx.clientA]);
  });
});

describe("Herança workspace → client → project → task → subtask", () => {
  it("12) projeto herda o isolamento do cliente", async () => {
    expect(await canAccessProject(fx.userB, projectB)).toBe(true);
    expect(await canAccessProject(fx.userA, projectB)).toBe(false);
    const rows = await fx.userA.client.from("projects").select("id").eq("id", projectB);
    expect(rows.data ?? []).toEqual([]);
  });

  it("13) tarefa herda o isolamento do projeto/cliente", async () => {
    expect(await canAccessTask(fx.userB, taskB)).toBe(true);
    expect(await canAccessTask(fx.userA, taskB)).toBe(false);
    const rows = await fx.userA.client.from("tasks").select("id").eq("id", taskB);
    expect(rows.data ?? []).toEqual([]);
  });

  it("14) subtarefa herda o isolamento da tarefa", async () => {
    const denied = await fx.userA.client.from("task_subtasks").select("id").eq("id", subtaskB);
    expect(denied.data ?? []).toEqual([]);
    const allowed = await fx.userB.client.from("task_subtasks").select("id").eq("id", subtaskB);
    expect((allowed.data ?? []).map((r) => r.id)).toEqual([subtaskB]);
  });

  it("descendentes derivados também respeitam o cliente (comentários e tempo)", async () => {
    const c = await admin
      .from("task_comments")
      .insert({ brand_id: fx.brandId, task_id: taskB, author_id: fx.userB.id, body: "nota B" })
      .select("id")
      .single();
    expect(c.error).toBeNull();
    const deniedComment = await fx.userA.client
      .from("task_comments")
      .select("id")
      .eq("id", c.data!.id);
    expect(deniedComment.data ?? []).toEqual([]);
    const allowedComment = await fx.userB.client
      .from("task_comments")
      .select("id")
      .eq("id", c.data!.id);
    expect((allowedComment.data ?? []).map((r) => r.id)).toEqual([c.data!.id]);

    const te = await admin
      .from("task_time_entries")
      .insert({
        brand_id: fx.brandId,
        task_id: taskB,
        user_id: fx.userB.id,
        started_at: new Date().toISOString(),
        seconds: 60,
      })
      .select("id")
      .single();
    expect(te.error).toBeNull();
    const deniedTe = await fx.userA.client
      .from("task_time_entries")
      .select("id")
      .eq("id", te.data!.id);
    expect(deniedTe.data ?? []).toEqual([]);
  });
});

describe("clientId forjado no frontend", () => {
  it("15) escrever tarefa em cliente fora do escopo é bloqueado pela RLS", async () => {
    const res = await fx.userA.client
      .from("tasks")
      .insert({
        brand_id: fx.brandId,
        client_id: fx.clientB,
        title: "forjada",
      })
      .select("id");
    expect(res.error).not.toBeNull();
  });

  it("15b) escrever em cliente de outro workspace é bloqueado", async () => {
    const res = await fx.userA.client
      .from("tasks")
      .insert({
        brand_id: fx.otherBrandId,
        client_id: fx.otherBrandClient,
        title: "cross",
      })
      .select("id");
    expect(res.error).not.toBeNull();
  });
});
