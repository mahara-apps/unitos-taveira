/**
 * FASE 4 — Workspace context, seleção de cliente e escopo de dashboard.
 *
 * Exercita a camada canônica server-side (`src/lib/access-guard.ts` + RLS real)
 * que alimenta o contexto ativo do frontend:
 *  - workspace é o contexto superior (`my_access` por brand);
 *  - nenhum cliente é resolvido automaticamente (o escopo nunca "escolhe" um);
 *  - troca de workspace não carrega cliente do workspace anterior;
 *  - MANAGER/USER só recebem clientes atribuídos;
 *  - agregações de dashboard respeitam o escopo do papel.
 *
 * Nada aqui altera o modelo de papéis (SUPER ADMIN / ADMIN / MANAGER / USER /
 * CLIENT) — apenas verifica o comportamento já definido nas Fases 1–3.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertBrandMember,
  assertClientInBrand,
  assertClientScope,
  assertProjectScope,
  assertTaskScope,
  resolveAccessScope,
  resolveAuthorityRole,
  resolveScopedClientIds,
} from "../src/lib/access-guard";
import { admin, cleanup, createUser, seed, type Fixture, type TestUser } from "./helpers/fixtures";
import { createSuperAdminUser, privilegedTestEnvAllowed } from "./helpers/fixtures";

/** Identidade SUPER ADMIN real só é criada em ambiente declarado de teste. */
const PRIV = privilegedTestEnvAllowed();

let fx: Fixture;
let superAdmin: TestUser;
let taskA: string;
let projectA: string;
let taskOther: string;

const sb = (u: TestUser) => u.client as never;
const denied = async (fn: () => Promise<unknown>) => {
  await expect(fn()).rejects.toThrow();
};
const allowed = async (fn: () => Promise<unknown>) => {
  await expect(fn()).resolves.not.toThrow();
};

/** Agregação de clientes como um dashboard de workspace faria (via RLS). */
async function visibleClients(u: TestUser, brandId: string): Promise<string[]> {
  const { data, error } = await u.client
    .from("clients")
    .select("id")
    .eq("brand_id", brandId)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

/** Agregação de tarefas do workspace (equivalente ao counts do dashboard). */
async function visibleTaskClientIds(u: TestUser, brandId: string): Promise<string[]> {
  const { data, error } = await u.client.from("tasks").select("client_id").eq("brand_id", brandId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.client_id as string).filter(Boolean);
}

beforeAll(async () => {
  fx = await seed();

  if (PRIV) superAdmin = await createSuperAdminUser("wsctx-super");

  const proj = await admin
    .from("projects")
    .insert({ brand_id: fx.brandId, client_id: fx.clientA, name: "WS Ctx Proj", status: "active" })
    .select("id")
    .single();
  if (proj.error) throw new Error(`project: ${proj.error.message}`);
  projectA = proj.data.id as string;

  const tasks = await admin
    .from("tasks")
    .insert([
      { brand_id: fx.brandId, client_id: fx.clientA, project_id: projectA, title: "WS Ctx Task A" },
      { brand_id: fx.brandId, client_id: fx.clientB, title: "WS Ctx Task B" },
      { brand_id: fx.otherBrandId, client_id: fx.otherBrandClient, title: "WS Ctx Task Other" },
    ])
    .select("id, client_id");
  if (tasks.error) throw new Error(`tasks: ${tasks.error.message}`);
  taskA = tasks.data.find((t) => t.client_id === fx.clientA)!.id as string;
  taskOther = tasks.data.find((t) => t.client_id === fx.otherBrandClient)!.id as string;
}, 120_000);

afterAll(async () => {
  if (superAdmin) await admin.auth.admin.deleteUser(superAdmin.id).catch(() => {});
  await cleanup(fx);
}, 60_000);

describe("ADMIN — workspace é o contexto superior", () => {
  it("cada owner pertence ao próprio workspace de QA", async () => {
    await allowed(() => assertBrandMember(sb(fx.userOwner), fx.userOwner.id, fx.brandId));
    await allowed(() =>
      assertBrandMember(sb(fx.userOtherOwner), fx.userOtherOwner.id, fx.otherBrandId),
    );
  });

  it("papel é resolvido POR workspace (nunca global)", async () => {
    await expect(resolveAuthorityRole(sb(fx.userOwner), fx.userOwner.id, fx.brandId)).resolves.toBe(
      "admin",
    );
  });

  it("escopo do workspace não pré-seleciona nenhum cliente", async () => {
    const scope = await resolveAccessScope(sb(fx.userOwner), fx.brandId);
    expect(scope.role).toBe("admin");
    // `null` = autoridade total no workspace; NÃO é "um cliente escolhido".
    expect(scope.allowedClientIds).toBeNull();
    const ids = await resolveScopedClientIds(sb(fx.userOwner), fx.brandId, null);
    expect(ids).toBeNull();
  });

  it("vê todos os clientes do workspace selecionado", async () => {
    const ids = await visibleClients(fx.userOwner, fx.brandId);
    expect(ids).toEqual(expect.arrayContaining([fx.clientA, fx.clientB, fx.clientOrphan]));
    expect(ids).not.toContain(fx.otherBrandClient);
  });

  it("troca de workspace muda o conjunto de clientes", async () => {
    const idsB = await visibleClients(fx.userOtherOwner, fx.otherBrandId);
    expect(idsB).toEqual([fx.otherBrandClient]);
  });

  it("cliente do workspace anterior é rejeitado no novo workspace", async () => {
    await denied(() =>
      assertClientInBrand(sb(fx.userOwner), fx.userOwner.id, fx.otherBrandId, fx.clientA),
    );
    await denied(() =>
      assertClientInBrand(sb(fx.userOwner), fx.userOwner.id, fx.brandId, fx.otherBrandClient),
    );
  });
});

describe("MANAGER — workspace + clientes atribuídos", () => {
  it("papel canônico é manager (não admin)", async () => {
    await expect(
      resolveAuthorityRole(sb(fx.userManager), fx.userManager.id, fx.brandId),
    ).resolves.toBe("manager");
  });

  it("escopo é lista explícita, nunca `null`", async () => {
    const scope = await resolveAccessScope(sb(fx.userManager), fx.brandId);
    expect(scope.role).toBe("manager");
    expect(Array.isArray(scope.allowedClientIds)).toBe(true);
  });

  it("não pertence a outro workspace", async () => {
    await denied(() => assertBrandMember(sb(fx.userManager), fx.userManager.id, fx.otherBrandId));
  });

  it("dashboard agrega somente clientes do próprio escopo", async () => {
    const scope = await resolveAccessScope(sb(fx.userManager), fx.brandId);
    const ids = await visibleClients(fx.userManager, fx.brandId);
    for (const id of ids) expect(scope.allowedClientIds).toContain(id);
    expect(ids).not.toContain(fx.otherBrandClient);
  });

  it("cliente de outro workspace é rejeitado", async () => {
    await denied(() =>
      assertClientScope(sb(fx.userManager), fx.userManager.id, fx.otherBrandClient),
    );
  });
});

describe("USER — somente clientes atribuídos", () => {
  it("escopo = exatamente o cliente atribuído", async () => {
    const scope = await resolveAccessScope(sb(fx.userA), fx.brandId);
    expect(scope.role).toBe("user");
    expect(scope.allowedClientIds).toEqual([fx.clientA]);
  });

  it("cliente não atribuído é rejeitado", async () => {
    await denied(() => assertClientScope(sb(fx.userA), fx.userA.id, fx.clientB));
    await denied(() => assertClientInBrand(sb(fx.userA), fx.userA.id, fx.brandId, fx.clientB));
  });

  it("agregação de tarefas do workspace fica restrita ao escopo", async () => {
    const clientIds = await visibleTaskClientIds(fx.userA, fx.brandId);
    expect(new Set(clientIds)).toEqual(new Set([fx.clientA]));
  });

  it("zero clientes atribuídos → escopo vazio, não 'todos'", async () => {
    const scope = await resolveAccessScope(sb(fx.userNoLink), fx.brandId);
    expect(scope.role).toBe("user");
    expect(scope.allowedClientIds).toEqual([]);
    const ids = await resolveScopedClientIds(sb(fx.userNoLink), fx.brandId, null);
    expect(ids).toEqual([]);
    expect(await visibleClients(fx.userNoLink, fx.brandId)).toEqual([]);
  });

  it("contexto residual (clientId de sessão anterior) é rejeitado", async () => {
    await denied(() => resolveScopedClientIds(sb(fx.userA), fx.brandId, fx.clientB));
    await denied(() => resolveScopedClientIds(sb(fx.userNoLink), fx.brandId, fx.clientA));
  });
});

describe("SUPER ADMIN — autoridade global", () => {
  it.skipIf(!PRIV)("acessa múltiplos workspaces", async () => {
    await allowed(() => assertBrandMember(sb(superAdmin), superAdmin.id, fx.brandId));
    await allowed(() => assertBrandMember(sb(superAdmin), superAdmin.id, fx.otherBrandId));
  });

  it.skipIf(!PRIV)("escopo muda ao trocar de workspace", async () => {
    const a = await resolveAccessScope(sb(superAdmin), fx.brandId);
    const b = await resolveAccessScope(sb(superAdmin), fx.otherBrandId);
    expect(a.role).toBe("super_admin");
    expect(b.role).toBe("super_admin");
    expect(await visibleClients(superAdmin, fx.otherBrandId)).toEqual([fx.otherBrandClient]);
  });

  it.skipIf(!PRIV)("par cross-workspace continua inválido, mesmo global", async () => {
    await denied(() =>
      assertClientInBrand(sb(superAdmin), superAdmin.id, fx.otherBrandId, fx.clientA),
    );
  });
});

describe("Cross-workspace — recursos client-scoped", () => {
  it("clientId de A não vale em B", async () => {
    await denied(() => assertClientInBrand(sb(fx.userA), fx.userA.id, fx.otherBrandId, fx.clientA));
  });

  it("projectId de outro workspace é rejeitado", async () => {
    await denied(() => assertProjectScope(sb(fx.userA), fx.userA.id, fx.otherBrandProject));
    await denied(() =>
      assertProjectScope(sb(fx.userManager), fx.userManager.id, fx.otherBrandProject),
    );
  });

  it("taskId de outro workspace é rejeitado", async () => {
    await denied(() => assertTaskScope(sb(fx.userA), fx.userA.id, taskOther));
    await denied(() => assertTaskScope(sb(fx.userManager), fx.userManager.id, taskOther));
  });

  it("recurso do próprio escopo continua acessível", async () => {
    await allowed(() => assertProjectScope(sb(fx.userA), fx.userA.id, projectA));
    await allowed(() => assertTaskScope(sb(fx.userA), fx.userA.id, taskA));
  });
});

describe("Persistência de contexto não concede autorização", () => {
  it("brandId persistido de workspace sem acesso não vira acesso", async () => {
    await denied(() => assertBrandMember(sb(fx.userA), fx.userA.id, fx.otherBrandId));
    // Sem papel no workspace, o escopo é nulo/vazio — nunca "tudo".
    const scope = await resolveAccessScope(sb(fx.userA), fx.otherBrandId);
    expect(scope.role).toBeNull();
    expect(scope.allowedClientIds).toEqual([]);
  });

  it("troca de usuário: mesmo clientId persistido, escopos diferentes", async () => {
    await allowed(() => assertClientScope(sb(fx.userA), fx.userA.id, fx.clientA));
    await denied(() => assertClientScope(sb(fx.userB), fx.userB.id, fx.clientA));
  });

  it("cliente órfão do workspace: admin sim, user atribuído não", async () => {
    await allowed(() => assertClientScope(sb(fx.userOwner), fx.userOwner.id, fx.clientOrphan));
    await denied(() => assertClientScope(sb(fx.userA), fx.userA.id, fx.clientOrphan));
  });
});
