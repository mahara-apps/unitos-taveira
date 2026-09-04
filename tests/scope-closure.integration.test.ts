/**
 * FASE 5 — Fechamento global de escopo (RPCs SECURITY DEFINER).
 *
 * Alvo: funções de banco que rodam com privilégio elevado e, por isso, NÃO
 * passam pelo RLS. Cada caso envia um ID válido mas fora do escopo do usuário:
 * se a função aceitar, o teste falha.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createUser, seed, type Fixture, type TestUser } from "./helpers/fixtures";
import { createSuperAdminUser, privilegedTestEnvAllowed } from "./helpers/fixtures";

/** Identidade SUPER ADMIN real só é criada em ambiente declarado de teste. */
const PRIV = privilegedTestEnvAllowed();

let fx: Fixture;
let superAdmin: TestUser;
let templateId: string;
let taskB: string;

beforeAll(async () => {
  fx = await seed();
  if (PRIV) superAdmin = await createSuperAdminUser("s5super");

  const tpl = await admin
    .from("project_templates")
    .insert({ brand_id: fx.brandId, name: "S5 Template", is_system: false })
    .select("id")
    .single();
  if (tpl.error) throw new Error(tpl.error.message);
  templateId = tpl.data.id as string;

  const proj = await admin
    .from("projects")
    .insert({ brand_id: fx.brandId, client_id: fx.clientB, name: "S5 Proj B", status: "active" })
    .select("id")
    .single();
  if (proj.error) throw new Error(proj.error.message);
  const task = await admin
    .from("tasks")
    .insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      project_id: proj.data.id,
      title: "S5 Task B",
      status: "todo",
    })
    .select("id")
    .single();
  if (task.error) throw new Error(task.error.message);
  taskB = task.data.id as string;

  const snap = await admin.from("brain_metrics_snapshots").insert({
    brand_id: fx.brandId,
    channel: "instagram",
    metric_name: "s5_metric",
    metric_value: 42,
    period_start: new Date().toISOString(),
    period_end: new Date().toISOString(),
  });
  if (snap.error) throw new Error(snap.error.message);
}, 120_000);

afterAll(async () => {
  await admin.from("brain_metrics_snapshots").delete().eq("metric_name", "s5_metric");
  await admin.from("project_templates").delete().eq("id", templateId);
  await cleanup();
}, 120_000);

describe("instantiate_project_template herda escopo de cliente", () => {
  it("USER vinculado ao clientA não cria projeto para o clientB", async () => {
    const r = await fx.userA.client.rpc("instantiate_project_template", {
      _template_id: templateId,
      _brand_id: fx.brandId,
      _client_id: fx.clientB,
      _project_name: "S5 forjado",
    });
    expect(r.error).toBeTruthy();
    expect(r.data).toBeNull();
  });

  it("cliente de outro workspace é rejeitado mesmo para o ADMIN da marca", async () => {
    const r = await fx.userOwner.client.rpc("instantiate_project_template", {
      _template_id: templateId,
      _brand_id: fx.brandId,
      _client_id: fx.otherBrandClient,
      _project_name: "S5 cross-workspace",
    });
    expect(r.error).toBeTruthy();
  });

  it("USER cria projeto no próprio cliente atribuído", async () => {
    const r = await fx.userA.client.rpc("instantiate_project_template", {
      _template_id: templateId,
      _brand_id: fx.brandId,
      _client_id: fx.clientA,
      _project_name: "S5 legítimo",
    });
    expect(r.error).toBeNull();
    expect(typeof r.data).toBe("string");
    if (r.data)
      await admin
        .from("projects")
        .delete()
        .eq("id", r.data as string);
  });
});

describe("start_timer herda escopo da tarefa", () => {
  it("USER do clientA não inicia timer em tarefa do clientB", async () => {
    const r = await fx.userA.client.rpc("start_timer", {
      _task_id: taskB,
      _brand_id: fx.brandId,
    });
    expect(r.error).toBeTruthy();
  });

  it("tarefa inexistente é rejeitada", async () => {
    const r = await fx.userOwner.client.rpc("start_timer", {
      _task_id: "00000000-0000-4000-8000-000000000000",
      _brand_id: fx.brandId,
    });
    expect(r.error).toBeTruthy();
  });
});

describe("brain_metrics_snapshots é agregação de workspace", () => {
  it("ADMIN da marca lê os snapshots", async () => {
    const r = await fx.userOwner.client
      .from("brain_metrics_snapshots")
      .select("id")
      .eq("metric_name", "s5_metric");
    expect(r.error).toBeNull();
    expect((r.data ?? []).length).toBeGreaterThan(0);
  });

  it("MANAGER e USER não leem agregação do workspace", async () => {
    for (const u of [fx.userManager, fx.userA]) {
      const r = await u.client
        .from("brain_metrics_snapshots")
        .select("id")
        .eq("metric_name", "s5_metric");
      expect(r.data ?? []).toHaveLength(0);
    }
  });

  it.skipIf(!PRIV)("SUPER ADMIN lê os snapshots", async () => {
    const r = await superAdmin.client
      .from("brain_metrics_snapshots")
      .select("id")
      .eq("metric_name", "s5_metric");
    expect(r.error).toBeNull();
    expect((r.data ?? []).length).toBeGreaterThan(0);
  });
});

describe("check_ai_usage_budget exige membership no workspace", () => {
  it("membro de outra marca não consulta orçamento", async () => {
    const r = await fx.userA.client.rpc("check_ai_usage_budget", {
      _brand_id: fx.otherBrandId,
      _client_id: null,
      _user_id: null,
    });
    expect(r.error).toBeTruthy();
  });

  it("membro do workspace consulta normalmente", async () => {
    const r = await fx.userA.client.rpc("check_ai_usage_budget", {
      _brand_id: fx.brandId,
      _client_id: fx.clientA,
      _user_id: fx.userA.id,
    });
    expect(r.error).toBeNull();
  });
});

describe("list_ai_usage_overview limita o MANAGER aos clientes atribuídos", () => {
  it("ADMIN recebe a visão completa do workspace", async () => {
    const r = await fx.userOwner.client.rpc("list_ai_usage_overview", { _brand_id: fx.brandId });
    expect(r.error).toBeNull();
    const payload = r.data as { scoped: boolean; clients: { client_id: string }[] };
    expect(payload.scoped).toBe(false);
    const ids = payload.clients.map((c) => c.client_id);
    expect(ids).toContain(fx.clientA);
    expect(ids).toContain(fx.clientB);
  });

  it("MANAGER sem clientes atribuídos não recebe clientes do workspace", async () => {
    const r = await fx.userManager.client.rpc("list_ai_usage_overview", { _brand_id: fx.brandId });
    expect(r.error).toBeNull();
    const payload = r.data as {
      scoped: boolean;
      clients: { client_id: string }[];
      brand: { limit: number | null };
    };
    if (payload.scoped) {
      const ids = payload.clients.map((c) => c.client_id);
      expect(ids).not.toContain(fx.clientB);
      expect(payload.brand.limit).toBeNull();
    }
  });

  it("membro de outro workspace é bloqueado", async () => {
    const r = await fx.userA.client.rpc("list_ai_usage_overview", { _brand_id: fx.otherBrandId });
    expect(r.error).toBeTruthy();
  });
});

describe("brain_memory_evolve exige escopo de workspace/cliente", () => {
  it("usuário sem membership no workspace alvo é bloqueado", async () => {
    const r = await fx.userA.client.rpc("brain_memory_guard_scope", {
      _brand_id: fx.otherBrandId,
      _client_id: null,
    });
    expect(r.error).toBeTruthy();
  });

  it("cliente fora do escopo é bloqueado dentro do próprio workspace", async () => {
    const r = await fx.userA.client.rpc("brain_memory_guard_scope", {
      _brand_id: fx.brandId,
      _client_id: fx.clientB,
    });
    expect(r.error).toBeTruthy();
  });

  it("cliente atribuído é liberado", async () => {
    const r = await fx.userA.client.rpc("brain_memory_guard_scope", {
      _brand_id: fx.brandId,
      _client_id: fx.clientA,
    });
    expect(r.error).toBeNull();
  });
});
