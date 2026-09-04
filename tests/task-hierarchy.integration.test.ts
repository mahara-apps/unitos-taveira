/**
 * Suíte de integração REAL (sem mocks) do fluxo Projeto → Tarefa → Subtarefa.
 * Executa contra o banco real, com clientes Supabase autenticados (RLS ativa),
 * espelhando exatamente as queries usadas pelas server functions em
 * src/lib/tasks.functions.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  admin,
  cleanup,
  listProjects,
  listTasks,
  seed,
  testTag,
  type Fixture,
} from "./helpers/fixtures";

let fx: Fixture;
let A: SupabaseClient;
let B: SupabaseClient;

// IDs compartilhados entre os testes sequenciais
const ids: Record<string, string> = {};

beforeAll(async () => {
  fx = await seed();
  A = fx.userA.client;
  B = fx.userB.client;
});

afterAll(async () => {
  await cleanup(fx);
});

async function createProject(
  c: SupabaseClient,
  brandId: string,
  clientId: string | null,
  name: string,
  status = "active",
) {
  const { data, error } = await c
    .from("projects")
    .insert({ brand_id: brandId, client_id: clientId, name, status })
    .select("id, client_id, status")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function createTask(c: SupabaseClient, payload: Record<string, unknown>) {
  return c
    .from("tasks")
    .insert({ brand_id: fx.brandId, status: "todo", priority: "medium", ...payload })
    .select("id, client_id, project_id")
    .single();
}

describe("1. Criação de tarefa", () => {
  it("cria tarefa sem projeto", async () => {
    const r = await createTask(A, { title: `T sem projeto ${testTag}`, client_id: fx.clientA });
    expect(r.error, r.error?.message).toBeNull();
    ids.taskNoProject = r.data!.id;
  });

  it("cria projeto do cliente A e tarefa vinculada (cliente + projeto)", async () => {
    const p = await createProject(A, fx.brandId, fx.clientA, `Projeto A ${testTag}`);
    ids.projectA = p.id;
    const r = await createTask(A, {
      title: `T com projeto ${testTag}`,
      client_id: fx.clientA,
      project_id: p.id,
    });
    expect(r.error, r.error?.message).toBeNull();
    expect(r.data!.project_id).toBe(p.id);
    ids.taskWithProject = r.data!.id;
  });

  it("novo projeto criado durante a tarefa pertence ao cliente correto", async () => {
    const { data } = await admin
      .from("projects")
      .select("client_id, brand_id")
      .eq("id", ids.projectA)
      .single();
    expect(data!.client_id).toBe(fx.clientA);
    expect(data!.brand_id).toBe(fx.brandId);
  });

  it("BLOQUEIA tarefa apontando para projeto de OUTRO cliente (trigger)", async () => {
    const pB = await createProject(B, fx.brandId, fx.clientB, `Projeto B ${testTag}`);
    ids.projectB = pB.id;
    const r = await createTask(A, {
      title: `T cross client ${testTag}`,
      client_id: fx.clientA,
      project_id: pB.id,
    });
    expect(r.error, "deveria falhar: projeto de outro cliente").not.toBeNull();
    expect(r.error!.message.toLowerCase()).toContain("cliente");
  });

  it("BLOQUEIA tarefa apontando para projeto de outra workspace/brand", async () => {
    const r = await createTask(A, {
      title: `T cross brand ${testTag}`,
      client_id: fx.clientA,
      project_id: fx.otherBrandProject,
    });
    expect(r.error, "deveria falhar: projeto de outra workspace").not.toBeNull();
  });

  it("BLOQUEIA criar tarefa em outra workspace (RLS)", async () => {
    const r = await A.from("tasks")
      .insert({
        brand_id: fx.otherBrandId,
        client_id: fx.otherBrandClient,
        title: `T outra brand ${testTag}`,
        status: "todo",
        priority: "medium",
      })
      .select("id")
      .single();
    expect(r.error, "deveria falhar: outra workspace").not.toBeNull();
  });

  it("trocar o cliente de uma tarefa com projeto incompatível é bloqueado no banco", async () => {
    const r = await A.from("tasks").update({ client_id: fx.clientB }).eq("id", ids.taskWithProject);
    expect(r.error, "deveria falhar sem desvincular o projeto").not.toBeNull();
  });

  it("10D.2: USER não pode tornar a tarefa workspace-level (client_id NULL)", async () => {
    const r = await A.from("tasks")
      .update({ client_id: null, project_id: null })
      .eq("id", ids.taskWithProject);
    expect(r.error, "USER não tem autoridade de workspace").not.toBeNull();
  });

  it("10D.2: ADMIN (owner) pode desvincular cliente/projeto da tarefa", async () => {
    const O = fx.userOwner.client;
    const r = await O.from("tasks")
      .update({ client_id: null, project_id: null })
      .eq("id", ids.taskWithProject);
    expect(r.error, r.error?.message).toBeNull();
    const back = await O.from("tasks")
      .update({ client_id: fx.clientA, project_id: ids.projectA })
      .eq("id", ids.taskWithProject);
    expect(back.error, back.error?.message).toBeNull();
  });


  it("persistência: tarefas relidas do banco mantêm os vínculos", async () => {
    const rows = await listTasks(A, fx.brandId, { clientId: fx.clientA });
    const t = rows.find((r) => r.id === ids.taskWithProject);
    expect(t).toBeTruthy();
    expect(t!.project_id).toBe(ids.projectA);
  });
});

describe("2. Projeto (seletor e arquivamento)", () => {
  it("projeto ativo aparece no seletor", async () => {
    const list = await listProjects(A, fx.brandId);
    expect(list.map((p) => p.id)).toContain(ids.projectA);
  });

  it("projeto arquivado não aparece no seletor padrão e não é excluído", async () => {
    const upd = await A.from("projects").update({ status: "archived" }).eq("id", ids.projectA);
    expect(upd.error, upd.error?.message).toBeNull();
    const list = await listProjects(A, fx.brandId);
    expect(list.map((p) => p.id)).not.toContain(ids.projectA);
    const still = await admin.from("projects").select("id, status").eq("id", ids.projectA).single();
    expect(still.data!.status).toBe("archived");
  });

  it("includeInactive (visão Todas) mostra arquivados", async () => {
    const list = await listProjects(A, fx.brandId, true);
    expect(list.map((p) => p.id)).toContain(ids.projectA);
  });

  it("restaurar projeto recupera disponibilidade", async () => {
    const upd = await A.from("projects").update({ status: "active" }).eq("id", ids.projectA);
    expect(upd.error, upd.error?.message).toBeNull();
    const list = await listProjects(A, fx.brandId);
    expect(list.map((p) => p.id)).toContain(ids.projectA);
  });

  it("projeto de outro cliente NUNCA aparece para seleção do usuário A", async () => {
    const list = await listProjects(A, fx.brandId);
    expect(list.map((p) => p.id)).not.toContain(ids.projectB);
  });

  it("projeto de outra brand nunca aparece", async () => {
    const list = await listProjects(A, fx.otherBrandId);
    expect(list.map((p) => p.id)).not.toContain(fx.otherBrandProject);
  });
});

describe("3 & 4. Subtarefas e progresso", () => {
  const pct = (done: number, total: number) => (total === 0 ? 0 : Math.round((done / total) * 100));

  it("0/0 antes de criar subtarefas", async () => {
    const rows = await listTasks(A, fx.brandId, { clientId: fx.clientA });
    const t = rows.find((r) => r.id === ids.taskWithProject)!;
    expect([t.subtasks_done, t.subtasks_total]).toEqual([0, 0]);
    expect(pct(t.subtasks_done, t.subtasks_total)).toBe(0);
  });

  it("cria 3 subtarefas com posições sequenciais → 0/3", async () => {
    for (let i = 0; i < 3; i++) {
      const last = await A.from("task_subtasks")
        .select("position")
        .eq("task_id", ids.taskWithProject)
        .order("position", { ascending: false })
        .limit(1);
      const nextPos = ((last.data?.[0]?.position as number | undefined) ?? -1) + 1;
      const r = await A.from("task_subtasks")
        .insert({
          task_id: ids.taskWithProject,
          brand_id: fx.brandId,
          title: `Sub ${i + 1}`,
          position: nextPos,
          created_by: fx.userA.id,
        })
        .select("id, position")
        .single();
      expect(r.error, r.error?.message).toBeNull();
      ids[`sub${i + 1}`] = r.data!.id;
      expect(r.data!.position).toBe(i);
    }
    const rows = await listTasks(A, fx.brandId, { clientId: fx.clientA });
    const t = rows.find((r) => r.id === ids.taskWithProject)!;
    expect([t.subtasks_done, t.subtasks_total]).toEqual([0, 3]);
  });

  it("edita título inline", async () => {
    const r = await A.from("task_subtasks")
      .update({ title: "Sub 1 editada" })
      .eq("id", ids.sub1)
      .select("title")
      .single();
    expect(r.error, r.error?.message).toBeNull();
    expect(r.data!.title).toBe("Sub 1 editada");
  });

  it("conclui 1 → 1/3 (33%)", async () => {
    await A.from("task_subtasks").update({ done: true }).eq("id", ids.sub1);
    const t = (await listTasks(A, fx.brandId, { clientId: fx.clientA })).find(
      (r) => r.id === ids.taskWithProject,
    )!;
    expect([t.subtasks_done, t.subtasks_total]).toEqual([1, 3]);
    expect(pct(t.subtasks_done, t.subtasks_total)).toBe(33);
  });

  it("conclui outra → 2/3 (67%)", async () => {
    await A.from("task_subtasks").update({ done: true }).eq("id", ids.sub2);
    const t = (await listTasks(A, fx.brandId, { clientId: fx.clientA })).find(
      (r) => r.id === ids.taskWithProject,
    )!;
    expect([t.subtasks_done, t.subtasks_total]).toEqual([2, 3]);
    expect(pct(t.subtasks_done, t.subtasks_total)).toBe(67);
  });

  it("reabre uma → 1/3 (33%)", async () => {
    await A.from("task_subtasks").update({ done: false }).eq("id", ids.sub2);
    const t = (await listTasks(A, fx.brandId, { clientId: fx.clientA })).find(
      (r) => r.id === ids.taskWithProject,
    )!;
    expect([t.subtasks_done, t.subtasks_total]).toEqual([1, 3]);
  });

  it("3/3 (100%)", async () => {
    await A.from("task_subtasks").update({ done: true }).in("id", [ids.sub1, ids.sub2, ids.sub3]);
    const t = (await listTasks(A, fx.brandId, { clientId: fx.clientA })).find(
      (r) => r.id === ids.taskWithProject,
    )!;
    expect([t.subtasks_done, t.subtasks_total]).toEqual([3, 3]);
    expect(pct(t.subtasks_done, t.subtasks_total)).toBe(100);
  });

  it("exclui subtarefa → 2/2 e sem órfãos", async () => {
    const del = await A.from("task_subtasks").delete().eq("id", ids.sub3);
    expect(del.error, del.error?.message).toBeNull();
    const t = (await listTasks(A, fx.brandId, { clientId: fx.clientA })).find(
      (r) => r.id === ids.taskWithProject,
    )!;
    expect([t.subtasks_done, t.subtasks_total]).toEqual([2, 2]);
    const gone = await admin.from("task_subtasks").select("id").eq("id", ids.sub3);
    expect(gone.data).toHaveLength(0);
  });

  it("somente subtarefas da tarefa correta são retornadas", async () => {
    await A.from("task_subtasks").insert({
      task_id: ids.taskNoProject,
      brand_id: fx.brandId,
      title: "Sub outra tarefa",
      position: 0,
      created_by: fx.userA.id,
    });
    const list = await A.from("task_subtasks")
      .select("id, task_id")
      .eq("task_id", ids.taskWithProject);
    expect(list.data!.every((s) => s.task_id === ids.taskWithProject)).toBe(true);
    expect(list.data).toHaveLength(2);
  });

  it("contadores do banco batem com a leitura da lista (sem divergência)", async () => {
    const direct = await admin
      .from("task_subtasks")
      .select("done")
      .eq("task_id", ids.taskWithProject);
    const t = (await listTasks(A, fx.brandId, { clientId: fx.clientA })).find(
      (r) => r.id === ids.taskWithProject,
    )!;
    expect(t.subtasks_total).toBe(direct.data!.length);
    expect(t.subtasks_done).toBe(direct.data!.filter((s) => s.done).length);
  });
});

describe("6. Isolamento / segurança (RLS)", () => {
  it("A não vê projeto do cliente B", async () => {
    const r = await A.from("projects").select("id").eq("id", ids.projectB);
    expect(r.data ?? []).toHaveLength(0);
  });

  it("A não cria tarefa no projeto do cliente B", async () => {
    const r = await createTask(A, {
      title: "T no projeto de B",
      client_id: fx.clientB,
      project_id: ids.projectB,
    });
    expect(r.error).not.toBeNull();
  });

  it("A não vê nem edita tarefa do cliente B", async () => {
    const tB = await createTask(B, {
      title: `T de B ${testTag}`,
      client_id: fx.clientB,
      project_id: ids.projectB,
    });
    expect(tB.error, tB.error?.message).toBeNull();
    ids.taskB = tB.data!.id;

    const read = await A.from("tasks").select("id").eq("id", ids.taskB);
    expect(read.data ?? [], "A não deveria ler tarefa de B").toHaveLength(0);

    await A.from("tasks").update({ title: "hackeado" }).eq("id", ids.taskB);
    const after = await admin.from("tasks").select("title").eq("id", ids.taskB).single();
    expect(after.data!.title).not.toBe("hackeado");
  });

  it("A não cria subtarefa em tarefa do cliente B", async () => {
    const r = await A.from("task_subtasks")
      .insert({
        task_id: ids.taskB,
        brand_id: fx.brandId,
        title: "Sub invasora",
        position: 0,
        created_by: fx.userA.id,
      })
      .select("id")
      .single();
    if (!r.error && r.data) ids.leakedSubtask = r.data.id;
    expect(r.error, "RLS deveria impedir subtarefa em tarefa de outro cliente").not.toBeNull();
  });

  it("A não altera subtarefa do cliente B", async () => {
    const subB = await B.from("task_subtasks")
      .insert({
        task_id: ids.taskB,
        brand_id: fx.brandId,
        title: "Sub de B",
        position: 0,
        created_by: fx.userB.id,
      })
      .select("id")
      .single();
    expect(subB.error, subB.error?.message).toBeNull();
    await A.from("task_subtasks").update({ title: "alterada por A" }).eq("id", subB.data!.id);
    const after = await admin
      .from("task_subtasks")
      .select("title")
      .eq("id", subB.data!.id)
      .single();
    expect(after.data!.title).toBe("Sub de B");
  });

  it("dados de outra brand nunca aparecem nas listas", async () => {
    const tasks = await listTasks(A, fx.otherBrandId, { archive: "all" });
    expect(tasks).toHaveLength(0);
    const clientsRes = await A.from("clients").select("id").eq("id", fx.otherBrandClient);
    expect(clientsRes.data ?? []).toHaveLength(0);
  });
});

describe("6b. Matriz de papéis (isolamento por cliente)", () => {
  it("ADMIN (owner da marca) acessa todos os clientes da própria marca", async () => {
    const c = fx.userOwner.client;
    const clients = await c.from("clients").select("id").in("id", [fx.clientA, fx.clientB]);
    expect((clients.data ?? []).map((r) => r.id).sort()).toEqual([fx.clientA, fx.clientB].sort());
    const projA = await c.from("projects").select("id").eq("id", ids.projectA);
    const projB = await c.from("projects").select("id").eq("id", ids.projectB);
    expect(projA.data ?? []).toHaveLength(1);
    expect(projB.data ?? []).toHaveLength(1);
    const taskB = await c.from("tasks").select("id").eq("id", ids.taskB);
    expect(taskB.data ?? []).toHaveLength(1);
  });

  it("MANAGER acessa somente clientes atribuídos (Fase 1 RBAC)", async () => {
    const c = fx.userManager.client;
    // Sem vínculo em client_members o MANAGER não enxerga clientes da marca.
    const none = await c.from("clients").select("id").in("id", [fx.clientA, fx.clientB]);
    expect(none.data ?? []).toHaveLength(0);
    const projB = await c.from("projects").select("id").eq("id", ids.projectB);
    expect(projB.data ?? []).toHaveLength(0);

    const link = await admin.from("client_members").insert({
      brand_id: fx.brandId,
      client_id: fx.clientB,
      user_id: fx.userManager.id,
      role: "manager",
    });
    expect(link.error, link.error?.message).toBeNull();

    const scoped = await c.from("clients").select("id").in("id", [fx.clientA, fx.clientB]);
    expect((scoped.data ?? []).map((r) => r.id)).toEqual([fx.clientB]);
    const projBNow = await c.from("projects").select("id").eq("id", ids.projectB);
    expect(projBNow.data ?? []).toHaveLength(1);
    const subs = await c.from("task_subtasks").select("id").eq("task_id", ids.taskB);
    expect(subs.error, subs.error?.message).toBeNull();

    await admin
      .from("client_members")
      .delete()
      .eq("client_id", fx.clientB)
      .eq("user_id", fx.userManager.id);
  });

  it("ADMIN/MANAGER não atravessam a fronteira de marca", async () => {
    // Regra de 1 workspace por conta: cada brand de QA tem owner dedicado
    // (userOwner → brand A, userOtherOwner → brand B). Ninguém da brand A
    // enxerga dados da brand B.
    for (const u of [fx.userOwner, fx.userManager]) {
      const other = await u.client.from("clients").select("id").eq("id", fx.otherBrandClient);
      const otherProj = await u.client.from("projects").select("id").eq("id", fx.otherBrandProject);
      expect(other.data ?? [], "sem acesso à outra marca").toHaveLength(0);
      expect(otherProj.data ?? []).toHaveLength(0);
    }
  });

  it("USER sem vínculo não acessa cliente com responsáveis definidos", async () => {
    const c = fx.userNoLink.client;
    const clients = await c.from("clients").select("id").in("id", [fx.clientA, fx.clientB]);
    expect(clients.data ?? [], "user sem vínculo não vê clientes vinculados").toHaveLength(0);
    const proj = await c.from("projects").select("id").eq("id", ids.projectA);
    expect(proj.data ?? []).toHaveLength(0);
    const task = await c.from("tasks").select("id").eq("id", ids.taskB);
    expect(task.data ?? []).toHaveLength(0);
    const subs = await c.from("task_subtasks").select("id").eq("task_id", ids.taskB);
    expect(subs.data ?? []).toHaveLength(0);
  });

  it("USER sem vínculo não escreve em projeto/tarefa de cliente vinculado", async () => {
    const c = fx.userNoLink.client;
    const p = await c
      .from("projects")
      .insert({ brand_id: fx.brandId, client_id: fx.clientA, name: `Invasor ${testTag}` })
      .select("id")
      .single();
    expect(p.error, "user sem vínculo não deveria criar projeto do cliente A").not.toBeNull();

    const t = await c
      .from("tasks")
      .insert({
        brand_id: fx.brandId,
        client_id: fx.clientA,
        title: `Invasora ${testTag}`,
        status: "todo",
        priority: "medium",
      })
      .select("id")
      .single();
    expect(t.error, "user sem vínculo não deveria criar tarefa do cliente A").not.toBeNull();
  });

  it("USER com vínculo acessa somente o próprio cliente", async () => {
    const own = await A.from("clients").select("id").eq("id", fx.clientA);
    expect(own.data ?? []).toHaveLength(1);
    const foreign = await A.from("clients").select("id").eq("id", fx.clientB);
    expect(foreign.data ?? []).toHaveLength(0);

    const projects = await A.from("projects").select("client_id").eq("brand_id", fx.brandId);
    expect(
      (projects.data ?? []).every((p) => p.client_id === fx.clientA || p.client_id === null),
      "listagem de projetos vaza cliente alheio",
    ).toBe(true);

    const tasks = await A.from("tasks").select("client_id").eq("brand_id", fx.brandId);
    expect(
      (tasks.data ?? []).every((t) => t.client_id === fx.clientA || t.client_id === null),
      "listagem de tarefas vaza cliente alheio",
    ).toBe(true);
  });

  it("CLIENTE (portal_client) acessa somente o próprio cliente", async () => {
    const c = fx.userPortal.client;
    const own = await c.from("clients").select("id").eq("id", fx.clientA);
    expect(own.data ?? []).toHaveLength(1);
    const foreign = await c
      .from("clients")
      .select("id")
      .in("id", [fx.clientB, fx.otherBrandClient]);
    expect(foreign.data ?? []).toHaveLength(0);

    const projB = await c.from("projects").select("id").eq("id", ids.projectB);
    expect(projB.data ?? []).toHaveLength(0);

    // Portal não é operador de agência: não escreve em projetos/tarefas.
    const p = await c
      .from("projects")
      .insert({ brand_id: fx.brandId, client_id: fx.clientA, name: `Portal ${testTag}` })
      .select("id")
      .single();
    expect(p.error, "portal_client não deveria criar projeto").not.toBeNull();
  });

  it("cross-brand permanece bloqueado para USER e CLIENTE", async () => {
    for (const u of [fx.userA, fx.userB, fx.userNoLink, fx.userPortal]) {
      const cl = await u.client.from("clients").select("id").eq("id", fx.otherBrandClient);
      expect(cl.data ?? [], `${u.email} não deveria ver cliente de outra marca`).toHaveLength(0);
      const pr = await u.client.from("projects").select("id").eq("id", fx.otherBrandProject);
      expect(pr.data ?? [], `${u.email} não deveria ver projeto de outra marca`).toHaveLength(0);
    }
  });

  it("cliente sem responsável e sem vínculos é visível só para ADMIN", async () => {
    // can_access_client_row(): USER só acessa cliente de que é responsável
    // (owner_user_id) ou ao qual está vinculado em client_members.
    for (const u of [fx.userA, fx.userB, fx.userNoLink]) {
      const r = await u.client.from("clients").select("id").eq("id", fx.clientOrphan);
      expect(r.data ?? [], `${u.email} não deveria ver o cliente órfão`).toHaveLength(0);
    }
    // ADMIN cobre a marca inteira; MANAGER não (escopo por cliente atribuído).
    const asAdmin = await fx.userOwner.client
      .from("clients")
      .select("id")
      .eq("id", fx.clientOrphan);
    expect(asAdmin.data ?? [], "ADMIN deveria ver o cliente órfão").toHaveLength(1);
    const asManager = await fx.userManager.client
      .from("clients")
      .select("id")
      .eq("id", fx.clientOrphan);
    expect(asManager.data ?? [], "MANAGER sem vínculo não vê o cliente órfão").toHaveLength(0);
    // Portal continua isolado ao próprio cliente.
    const portal = await fx.userPortal.client
      .from("clients")
      .select("id")
      .eq("id", fx.clientOrphan);
    expect(portal.data ?? []).toHaveLength(0);

    // Ao ganhar vínculo explícito, o USER passa a acessar.
    await admin.from("client_members").insert({
      brand_id: fx.brandId,
      client_id: fx.clientOrphan,
      user_id: fx.userA.id,
      role: "user",
    });
    const noLinkAfter = await fx.userNoLink.client
      .from("clients")
      .select("id")
      .eq("id", fx.clientOrphan);
    expect(noLinkAfter.data ?? [], "sem vínculo continua sem acesso").toHaveLength(0);
    const linkedAfter = await A.from("clients").select("id").eq("id", fx.clientOrphan);
    expect(linkedAfter.data ?? []).toHaveLength(1);
  });
});

describe("7 & 8. Integridade e E2E", () => {
  it("E2E: projeto → tarefa → 3 subtarefas → 33% → 66% → 33% → arquivar/restaurar", async () => {
    const p = await createProject(A, fx.brandId, fx.clientA, `Projeto Teste ${testTag}`);
    const t = await createTask(A, {
      title: `Tarefa E2E ${testTag}`,
      client_id: fx.clientA,
      project_id: p.id,
    });
    expect(t.error, t.error?.message).toBeNull();
    const taskId = t.data!.id;

    const subIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await A.from("task_subtasks")
        .insert({
          task_id: taskId,
          brand_id: fx.brandId,
          title: `E2E sub ${i + 1}`,
          position: i,
          created_by: fx.userA.id,
        })
        .select("id")
        .single();
      expect(s.error, s.error?.message).toBeNull();
      subIds.push(s.data!.id);
    }

    const read = async () =>
      (await listTasks(A, fx.brandId, { clientId: fx.clientA })).find((r) => r.id === taskId)!;

    await A.from("task_subtasks").update({ done: true }).eq("id", subIds[0]);
    expect(Math.round(((await read()).subtasks_done / 3) * 100)).toBe(33);

    await A.from("task_subtasks").update({ title: "E2E sub 1 editada" }).eq("id", subIds[0]);
    await A.from("task_subtasks").update({ done: true }).eq("id", subIds[1]);
    expect(Math.round(((await read()).subtasks_done / 3) * 100)).toBe(67);

    await A.from("task_subtasks").update({ done: false }).eq("id", subIds[1]);
    expect(Math.round(((await read()).subtasks_done / 3) * 100)).toBe(33);

    // Arquivar tarefa (reversível, sem exclusão)
    await A.from("tasks").update({ archived_at: new Date().toISOString() }).eq("id", taskId);
    const active = await listTasks(A, fx.brandId, { clientId: fx.clientA });
    expect(active.map((r) => r.id)).not.toContain(taskId);
    const archived = await listTasks(A, fx.brandId, { clientId: fx.clientA, archive: "archived" });
    expect(archived.map((r) => r.id)).toContain(taskId);
    const all = await listTasks(A, fx.brandId, { clientId: fx.clientA, archive: "all" });
    expect(all.map((r) => r.id)).toContain(taskId);

    // Subtarefas sobrevivem ao arquivamento
    const subsAfterArchive = await admin.from("task_subtasks").select("id").eq("task_id", taskId);
    expect(subsAfterArchive.data).toHaveLength(3);

    // Restaurar
    await A.from("tasks").update({ archived_at: null }).eq("id", taskId);
    const back = await listTasks(A, fx.brandId, { clientId: fx.clientA });
    expect(back.map((r) => r.id)).toContain(taskId);

    // Arquivar/restaurar projeto
    await A.from("projects").update({ status: "archived" }).eq("id", p.id);
    expect((await listProjects(A, fx.brandId)).map((x) => x.id)).not.toContain(p.id);
    await A.from("projects").update({ status: "active" }).eq("id", p.id);
    expect((await listProjects(A, fx.brandId)).map((x) => x.id)).toContain(p.id);

    // "Reload": releitura completa e sem duplicações
    const finalRows = await listTasks(A, fx.brandId, { clientId: fx.clientA, archive: "all" });
    const dup = finalRows.filter((r) => r.id === taskId);
    expect(dup).toHaveLength(1);
    expect(dup[0]!.subtasks_total).toBe(3);
    expect(dup[0]!.subtasks_done).toBe(1);
    ids.e2eTask = taskId;
  });

  it("integridade: nenhuma tarefa aponta para projeto de cliente/brand incompatível", async () => {
    const { data } = await admin
      .from("tasks")
      .select("id, brand_id, client_id, project_id, projects(brand_id, client_id)")
      .in("brand_id", [fx.brandId, fx.otherBrandId])
      .not("project_id", "is", null);
    for (const t of (data ?? []) as Array<Record<string, any>>) {
      expect(t.projects.brand_id).toBe(t.brand_id);
      if (t.projects.client_id) expect(t.client_id).toBe(t.projects.client_id);
    }
  });

  it("integridade: task_subtasks.brand_id sempre igual ao brand_id da tarefa pai", async () => {
    const { data, error } = await admin
      .from("task_subtasks")
      .select("id, brand_id, task_id, tasks(brand_id)")
      .in("brand_id", [fx.brandId, fx.otherBrandId]);
    expect(error, error?.message).toBeNull();
    const divergentes = ((data ?? []) as Array<Record<string, any>>).filter(
      (s) => s.tasks && s.tasks.brand_id !== s.brand_id,
    );
    expect(divergentes.map((s) => s.id)).toEqual([]);
  });

  it("integridade: nenhuma subtarefa órfã após exclusão da tarefa (cascade)", async () => {
    const t = await createTask(A, { title: `T descartável ${testTag}`, client_id: fx.clientA });
    const s = await A.from("task_subtasks")
      .insert({
        task_id: t.data!.id,
        brand_id: fx.brandId,
        title: "Sub descartável",
        position: 0,
        created_by: fx.userA.id,
      })
      .select("id")
      .single();
    await A.from("tasks").delete().eq("id", t.data!.id);
    const orphan = await admin.from("task_subtasks").select("id").eq("id", s.data!.id);
    expect(orphan.data ?? [], "subtarefa órfã encontrada").toHaveLength(0);
  });
});
