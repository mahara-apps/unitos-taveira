/**
 * FASE 6 — Validação E2E de autorização por papel e fechamento dos acessos.
 *
 * Matriz ADMIN / MANAGER / USER / PORTAL exercitada contra o banco real
 * (RLS + funções canônicas). Foco desta fase:
 *  - mutações negadas devem afetar ZERO linhas (nunca "sucesso silencioso");
 *  - busca global não pode devolver títulos de clientes fora do escopo;
 *  - dados administrativos (convites/tokens) invisíveis para papéis operacionais;
 *  - tampering de URL (IDs de outro workspace) sempre negado.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertClientInBrand, assertClientScope, resolveScopedClientIds } from "../src/lib/access-guard";
import { admin, cleanup, seed, testTag, type Fixture, type TestUser } from "./helpers/fixtures";

let fx: Fixture;
let projectA: string;
let projectB: string;
let taskB: string;

const sb = (u: TestUser) => u.client as never;

beforeAll(async () => {
  fx = await seed();

  const insProjects = await admin
    .from("projects")
    .insert([
      { brand_id: fx.brandId, client_id: fx.clientA, name: `E2E Proj A ${testTag}` },
      { brand_id: fx.brandId, client_id: fx.clientB, name: `E2E Proj B ${testTag}` },
    ])
    .select("id, client_id");
  if (insProjects.error) throw new Error(insProjects.error.message);
  projectA = insProjects.data!.find((r) => r.client_id === fx.clientA)!.id as string;
  projectB = insProjects.data!.find((r) => r.client_id === fx.clientB)!.id as string;

  const insTask = await admin
    .from("tasks")
    .insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      project_id: projectB,
      title: `E2E Task B ${testTag}`,
    })
    .select("id")
    .single();
  if (insTask.error) throw new Error(insTask.error.message);
  taskB = insTask.data!.id as string;

  const inv = await admin.from("brand_invites").insert({
    brand_id: fx.brandId,
    email: `qa+${testTag}-invite@unitos-tests.dev`,
    role: "owner",
    token: `e2e-${testTag}-token`,
    invited_by: fx.userOwner.id,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  if (inv.error) throw new Error(inv.error.message);
}, 120_000);

afterAll(async () => {
  await cleanup();
}, 120_000);

describe("Fase 6 — mutações fora de escopo não afetam linhas", () => {
  it("USER do cliente A não atualiza projeto do cliente B", async () => {
    const res = await fx.userA.client
      .from("projects")
      .update({ name: "hack" })
      .eq("id", projectB)
      .eq("brand_id", fx.brandId)
      .select("id");
    expect(res.error?.message ?? "").not.toContain("row-level security policy for table \"x\"");
    expect(res.data ?? []).toHaveLength(0);
  });

  it("USER do cliente A não arquiva projeto do cliente B", async () => {
    const res = await fx.userA.client
      .from("projects")
      .update({ status: "archived" })
      .eq("id", projectB)
      .select("id");
    expect(res.data ?? []).toHaveLength(0);
  });

  it("USER do cliente A não exclui projeto do cliente B", async () => {
    const res = await fx.userA.client.from("projects").delete().eq("id", projectB).select("id");
    expect(res.data ?? []).toHaveLength(0);
  });

  it("USER do cliente A não atualiza tarefa do cliente B", async () => {
    const res = await fx.userA.client
      .from("tasks")
      .update({ title: "hack" })
      .eq("id", taskB)
      .select("id");
    expect(res.data ?? []).toHaveLength(0);
  });

  it("USER do cliente A não exclui tarefa do cliente B", async () => {
    const res = await fx.userA.client.from("tasks").delete().eq("id", taskB).select("id");
    expect(res.data ?? []).toHaveLength(0);
  });

  it("USER do cliente A não arquiva tarefa do cliente B", async () => {
    const res = await fx.userA.client
      .from("tasks")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", taskB)
      .select("id");
    expect(res.data ?? []).toHaveLength(0);
  });

  it("MANAGER sem vínculo com cliente B não atualiza projeto de B", async () => {
    const res = await fx.userManager.client
      .from("projects")
      .update({ name: "hack-mgr" })
      .eq("id", projectB)
      .select("id");
    expect(res.data ?? []).toHaveLength(0);
  });

  it("ADMIN (owner) atualiza projeto de qualquer cliente do workspace", async () => {
    const res = await fx.userOwner.client
      .from("projects")
      .update({ name: `E2E Proj B ${testTag}` })
      .eq("id", projectB)
      .select("id");
    expect(res.error).toBeNull();
    expect(res.data ?? []).toHaveLength(1);
  });

  it("PORTAL não escreve em projects", async () => {
    const res = await fx.userPortal.client
      .from("projects")
      .update({ name: "portal-hack" })
      .eq("id", projectA)
      .select("id");
    expect(res.data ?? []).toHaveLength(0);
  });
});

describe("Fase 6 — busca global não vaza títulos fora do escopo", () => {
  it("USER A não encontra projeto do cliente B por busca textual", async () => {
    const res = await fx.userA.client
      .from("projects")
      .select("id, name")
      .eq("brand_id", fx.brandId)
      .ilike("name", `%E2E Proj%`);
    expect(res.error).toBeNull();
    const ids = (res.data ?? []).map((r) => r.id);
    expect(ids).toContain(projectA);
    expect(ids).not.toContain(projectB);
  });

  it("USER A não encontra tarefas do cliente B por busca textual", async () => {
    const res = await fx.userA.client
      .from("tasks")
      .select("id")
      .ilike("title", `%E2E Task%`);
    expect((res.data ?? []).map((r) => r.id)).not.toContain(taskB);
  });

  it("MANAGER só agrega clientes atribuídos", async () => {
    const ids = await resolveScopedClientIds(sb(fx.userManager), fx.brandId, null);
    expect(ids).not.toBeNull();
    expect(ids).not.toContain(fx.clientB);
  });

  it("ADMIN agrega todo o workspace (sem lista restritiva)", async () => {
    const ids = await resolveScopedClientIds(sb(fx.userOwner), fx.brandId, null);
    expect(ids).toBeNull();
  });
});

describe("Fase 6 — dados administrativos e URL tampering", () => {
  it("USER não lê convites (token de convite invisível)", async () => {
    const res = await fx.userA.client
      .from("brand_invites")
      .select("id, token")
      .eq("brand_id", fx.brandId);
    expect(res.data ?? []).toHaveLength(0);
  });

  it("PORTAL não lê convites", async () => {
    const res = await fx.userPortal.client.from("brand_invites").select("id").limit(5);
    expect(res.data ?? []).toHaveLength(0);
  });

  it("ADMIN lê convites do próprio workspace", async () => {
    const res = await fx.userOwner.client
      .from("brand_invites")
      .select("id")
      .eq("brand_id", fx.brandId);
    expect(res.error).toBeNull();
    expect((res.data ?? []).length).toBeGreaterThan(0);
  });

  it("cliente de outro workspace é negado (brand A + client B forjado)", async () => {
    await expect(
      assertClientInBrand(sb(fx.userOwner), fx.userOwner.id, fx.brandId, fx.otherBrandClient),
    ).rejects.toThrow();
  });

  it("USER A é negado no cliente B (tampering de URL)", async () => {
    await expect(assertClientScope(sb(fx.userA), fx.userA.id, fx.clientB)).rejects.toThrow();
  });

  it("USER A é liberado no próprio cliente", async () => {
    await expect(
      assertClientInBrand(sb(fx.userA), fx.userA.id, fx.brandId, fx.clientA),
    ).resolves.not.toThrow();
  });

  it("PORTAL não lê membros internos de outros workspaces", async () => {
    const res = await fx.userPortal.client
      .from("brand_members")
      .select("user_id")
      .eq("brand_id", fx.otherBrandId);
    expect(res.data ?? []).toHaveLength(0);
  });
});
