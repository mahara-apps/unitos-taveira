/**
 * FASE 3 — Privilege escalation & server authorization.
 *
 * Exercita a camada server-side DIRETAMENTE (guards canônicos de
 * `src/lib/access-guard.ts` + RLS real), nunca a UI. Todo teste parte de um
 * ID válido porém FORA do escopo do usuário: se o servidor aceitar o ID
 * enviado, o teste falha.
 *
 * Matriz: USER / MANAGER / ADMIN / SUPER ADMIN × cliente atribuído,
 * cliente não atribuído, outro workspace, recursos descendentes e IDs
 * inexistentes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertBrandAdmin,
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
let subtaskB: string;
let taskB: string;
let projectB: string;
let convoB: string;
let jobB: string;

const NON_EXISTENT = "00000000-0000-4000-8000-000000000000";

/** Guard deve REJEITAR (lançar). */
const denied = async (fn: () => Promise<unknown>) => {
  await expect(fn()).rejects.toThrow();
};
/** Guard deve LIBERAR. */
const allowed = async (fn: () => Promise<unknown>) => {
  await expect(fn()).resolves.not.toThrow();
};

const sb = (u: TestUser) => u.client as never;

beforeAll(async () => {
  fx = await seed();
  if (PRIV) superAdmin = await createSuperAdminUser("super");

  const projects = await admin
    .from("projects")
    .insert([
      { brand_id: fx.brandId, client_id: fx.clientA, name: "PE Proj A", status: "active" },
      { brand_id: fx.brandId, client_id: fx.clientB, name: "PE Proj B", status: "active" },
    ])
    .select("id, client_id");
  if (projects.error) throw new Error(projects.error.message);
  projectA = projects.data.find((r) => r.client_id === fx.clientA)!.id as string;
  projectB = projects.data.find((r) => r.client_id === fx.clientB)!.id as string;

  const tasks = await admin
    .from("tasks")
    .insert([
      {
        brand_id: fx.brandId,
        client_id: fx.clientA,
        project_id: projectA,
        title: "PE Task A",
      },
      {
        brand_id: fx.brandId,
        client_id: fx.clientB,
        project_id: projectB,
        title: "PE Task B",
      },
    ])
    .select("id, client_id");
  if (tasks.error) throw new Error(tasks.error.message);
  taskA = tasks.data.find((r) => r.client_id === fx.clientA)!.id as string;
  taskB = tasks.data.find((r) => r.client_id === fx.clientB)!.id as string;

  const sub = await admin
    .from("task_subtasks")
    .insert({ brand_id: fx.brandId, task_id: taskB, title: "PE Sub B" })
    .select("id")
    .single();
  if (sub.error) throw new Error(sub.error.message);
  subtaskB = sub.data.id as string;

  const convo = await admin
    .from("chat_conversations")
    .insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      user_id: fx.userB.id,
      title: "PE Convo B",
    })
    .select("id")
    .single();
  if (convo.error) throw new Error(convo.error.message);
  convoB = convo.data.id as string;

  const job = await admin
    .from("ai_jobs")
    .insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      user_id: fx.userB.id,
      kind: "copilot_draft",
      status: "queued",
      title: "PE Job B",
    })
    .select("id")
    .single();
  if (job.error) throw new Error(job.error.message);
  jobB = job.data.id as string;
}, 120_000);

afterAll(async () => {
  await admin.from("chat_messages").delete().eq("conversation_id", convoB);
  await admin.from("chat_conversations").delete().eq("id", convoB);
  await admin.from("ai_jobs").delete().eq("id", jobB);
  await admin
    .from("user_profiles")
    .delete()
    .eq("id", superAdmin?.id ?? NON_EXISTENT);
  await admin.auth.admin.deleteUser(superAdmin?.id ?? NON_EXISTENT).catch(() => {});
  await cleanup(fx);
});

describe("1. USER — cliente não atribuído", () => {
  it("acessa o cliente atribuído", async () => {
    await allowed(() => assertClientScope(sb(fx.userA), fx.userA.id, fx.clientA));
  });

  it("é rejeitado no cliente de outro colega do mesmo workspace", async () => {
    await denied(() => assertClientScope(sb(fx.userA), fx.userA.id, fx.clientB));
  });

  it("é rejeitado em projeto/tarefa/subtarefa descendentes do cliente B", async () => {
    await denied(() => assertProjectScope(sb(fx.userA), fx.userA.id, projectB));
    await denied(() => assertTaskScope(sb(fx.userA), fx.userA.id, taskB));
    const sub = await fx.userA.client
      .from("task_subtasks")
      .select("id")
      .eq("id", subtaskB)
      .maybeSingle();
    expect(sub.data).toBeNull();
  });

  it("não lê conversa nem job de IA do cliente B mesmo com o ID em mãos", async () => {
    const convo = await fx.userA.client
      .from("chat_conversations")
      .select("id")
      .eq("id", convoB)
      .maybeSingle();
    expect(convo.data).toBeNull();
    const job = await fx.userA.client.from("ai_jobs").select("id").eq("id", jobB).maybeSingle();
    expect(job.data).toBeNull();
  });

  it("não cria conversa nem job em cliente fora do escopo (WITH CHECK)", async () => {
    const convo = await fx.userA.client.from("chat_conversations").insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      user_id: fx.userA.id,
      title: "forjada",
    });
    expect(convo.error).not.toBeNull();
    const job = await fx.userA.client.from("ai_jobs").insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      user_id: fx.userA.id,
      kind: "copilot_draft",
      status: "queued",
      title: "forjado",
    });
    expect(job.error).not.toBeNull();
  });

  it("não tem autoridade administrativa no workspace", async () => {
    await allowed(() => assertBrandMember(sb(fx.userA), fx.userA.id, fx.brandId));
    await denied(() => assertBrandAdmin(sb(fx.userA), fx.userA.id, fx.brandId));
  });
});

describe("2. MANAGER — somente clientes atribuídos", () => {
  beforeAll(async () => {
    const cm = await admin.from("client_members").insert([
      {
        brand_id: fx.brandId,
        client_id: fx.clientA,
        user_id: fx.userManager.id,
        role: "manager",
      },
      {
        brand_id: fx.brandId,
        client_id: fx.clientOrphan,
        user_id: fx.userManager.id,
        role: "manager",
      },
    ]);
    if (cm.error) throw new Error(cm.error.message);
  });

  it("acessa os clientes atribuídos (A e C)", async () => {
    await allowed(() => assertClientScope(sb(fx.userManager), fx.userManager.id, fx.clientA));
    await allowed(() => assertClientScope(sb(fx.userManager), fx.userManager.id, fx.clientOrphan));
  });

  it("é rejeitado no cliente B e em todos os descendentes de B", async () => {
    await denied(() => assertClientScope(sb(fx.userManager), fx.userManager.id, fx.clientB));
    await denied(() => assertProjectScope(sb(fx.userManager), fx.userManager.id, projectB));
    await denied(() => assertTaskScope(sb(fx.userManager), fx.userManager.id, taskB));
  });

  it("tem autoridade administrativa mas escopo de dados limitado", async () => {
    const role = await resolveAuthorityRole(sb(fx.userManager), fx.userManager.id, fx.brandId);
    expect(role).toBe("manager");
    const scope = await resolveAccessScope(sb(fx.userManager), fx.brandId);
    expect(scope.allowedClientIds).not.toBeNull();
    expect(scope.allowedClientIds).toContain(fx.clientA);
    expect(scope.allowedClientIds).not.toContain(fx.clientB);
  });

  it("resolveScopedClientIds rejeita cliente pedido fora do escopo", async () => {
    await denied(() => resolveScopedClientIds(sb(fx.userManager), fx.brandId, fx.clientB));
  });
});

describe("3. ADMIN — workspace selecionado, nunca os dois", () => {
  beforeAll(async () => {
    const r = await admin
      .from("brand_members")
      .upsert(
        { brand_id: fx.otherBrandId, user_id: fx.userOwner.id, role: "owner" },
        { onConflict: "brand_id,user_id" },
      );
    if (r.error) throw new Error(r.error.message);
  });

  it("cobre todos os clientes do workspace selecionado", async () => {
    const scope = await resolveAccessScope(sb(fx.userOwner), fx.brandId);
    expect(scope.role).toBe("admin");
    expect(scope.allowedClientIds).toBeNull();
    await allowed(() => assertClientScope(sb(fx.userOwner), fx.userOwner.id, fx.clientB));
  });

  it("escopo muda com o workspace selecionado (sem misturar dados)", async () => {
    const a = await resolveAccessScope(sb(fx.userOwner), fx.brandId);
    const b = await resolveAccessScope(sb(fx.userOwner), fx.otherBrandId);
    expect(a.brandId).toBe(fx.brandId);
    expect(b.brandId).toBe(fx.otherBrandId);
    // Par cross-workspace forjado: brandId de B + clientId de A.
    await denied(() =>
      assertClientInBrand(sb(fx.userOwner), fx.userOwner.id, fx.otherBrandId, fx.clientA),
    );
    await denied(() =>
      assertClientInBrand(sb(fx.userOwner), fx.userOwner.id, fx.brandId, fx.otherBrandClient),
    );
  });

  it("ADMIN não é SUPER ADMIN", async () => {
    const global = await resolveAuthorityRole(sb(fx.userOwner), fx.userOwner.id, null);
    expect(global).not.toBe("super_admin");
    const prof = await admin
      .from("user_profiles")
      .select("is_super_admin")
      .eq("id", fx.userOwner.id)
      .maybeSingle();
    expect(prof.data?.is_super_admin ?? false).toBe(false);
  });
});

describe("4. Cross-workspace — IDs de outro workspace nunca autorizam", () => {
  it("USER do workspace A não alcança recursos do workspace B", async () => {
    await denied(() => assertClientScope(sb(fx.userA), fx.userA.id, fx.otherBrandClient));
    await denied(() => assertProjectScope(sb(fx.userA), fx.userA.id, fx.otherBrandProject));
    await denied(() => assertBrandMember(sb(fx.userA), fx.userA.id, fx.otherBrandId));
  });

  it("MANAGER do workspace A não alcança o workspace B", async () => {
    await denied(() => assertBrandMember(sb(fx.userManager), fx.userManager.id, fx.otherBrandId));
    await denied(() =>
      assertClientScope(sb(fx.userManager), fx.userManager.id, fx.otherBrandClient),
    );
  });

  it("nenhum dado do workspace B aparece em consultas do workspace A", async () => {
    const rows = await fx.userManager.client
      .from("clients")
      .select("id, brand_id")
      .eq("brand_id", fx.otherBrandId);
    expect(rows.data ?? []).toHaveLength(0);
  });
});

describe("5. SUPER ADMIN — autoridade global e separada", () => {
  it.skipIf(!PRIV)("alcança qualquer workspace e qualquer cliente", async () => {
    const global = await resolveAuthorityRole(sb(superAdmin), superAdmin.id, null);
    expect(global).toBe("super_admin");
    await allowed(() => assertBrandMember(sb(superAdmin), superAdmin.id, fx.brandId));
    await allowed(() => assertBrandMember(sb(superAdmin), superAdmin.id, fx.otherBrandId));
    await allowed(() => assertClientScope(sb(superAdmin), superAdmin.id, fx.clientB));
    await allowed(() => assertClientScope(sb(superAdmin), superAdmin.id, fx.otherBrandClient));
  });

  it.skipIf(!PRIV)(
    "mesmo SUPER ADMIN é rejeitado em par cross-workspace inconsistente",
    async () => {
      await denied(() =>
        assertClientInBrand(sb(superAdmin), superAdmin.id, fx.otherBrandId, fx.clientA),
      );
    },
  );
});

describe("6. IDs inexistentes e ausentes", () => {
  it.skipIf(!PRIV)("ID inexistente é rejeitado para todos os papéis", async () => {
    for (const u of [fx.userA, fx.userManager, fx.userOwner, superAdmin].filter(Boolean)) {
      await denied(() => assertClientScope(sb(u), u.id, NON_EXISTENT));
      await denied(() => assertProjectScope(sb(u), u.id, NON_EXISTENT));
      await denied(() => assertTaskScope(sb(u), u.id, NON_EXISTENT));
    }
  });

  it("workspace vazio nunca concede autoridade", async () => {
    await denied(() => assertBrandMember(sb(fx.userA), fx.userA.id, ""));
    await denied(() => assertBrandAdmin(sb(fx.userA), fx.userA.id, ""));
  });
});

describe("7. Portal — somente o próprio cliente", () => {
  it("portal_client não recebe papel interno e não alcança outro cliente", async () => {
    const role = await resolveAuthorityRole(sb(fx.userPortal), fx.userPortal.id, fx.brandId);
    expect(role === "client" || role === null).toBe(true);
    await denied(() => assertClientScope(sb(fx.userPortal), fx.userPortal.id, fx.clientB));
    await denied(() => assertBrandAdmin(sb(fx.userPortal), fx.userPortal.id, fx.brandId));
  });
});

describe("8. Recursos descendentes exigem herança, não posse do ID", () => {
  it("tarefa/subtarefa do cliente A ficam disponíveis ao USER A", async () => {
    await allowed(() => assertProjectScope(sb(fx.userA), fx.userA.id, projectA));
    await allowed(() => assertTaskScope(sb(fx.userA), fx.userA.id, taskA));
  });

  it("USER B não escreve subtarefa em tarefa do cliente A", async () => {
    const ins = await fx.userB.client
      .from("task_subtasks")
      .insert({ brand_id: fx.brandId, task_id: taskA, title: "forjada" });
    expect(ins.error).not.toBeNull();
  });

  it("USER A não escreve mensagem em conversa do cliente B", async () => {
    const ins = await fx.userA.client.from("chat_messages").insert({
      conversation_id: convoB,
      user_id: fx.userA.id,
      role: "user",
      content: "forjada",
    });
    expect(ins.error).not.toBeNull();
  });
});
