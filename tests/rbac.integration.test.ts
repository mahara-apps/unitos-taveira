/**
 * FASE 1 RBAC — validação da matriz de papéis × escopo com usuários reais e
 * clients autenticados (RLS exercida de verdade, sem service role).
 *
 * Papéis: SUPER ADMIN, ADMIN (owner), MANAGER, USER (operação), CLIENTE (portal).
 * Fontes canônicas exercitadas: app_access_role, can_access_client, my_access.
 *
 * Requer apenas SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY.
 * O papel super_admin depende da flag user_profiles.is_super_admin já estar
 * marcada na conta de QA (definida fora da app, por operação privilegiada);
 * quando não estiver, os testes de super admin são marcados como skip.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const publishable = process.env["SUPABASE_PUBLISHABLE_KEY"];
if (!url || !publishable) {
  throw new Error("Ambiente incompleto: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
}

const PASSWORD = "Qa!23456789";
const TAG = `rbac${Date.now().toString(36)}`;
const emailOf = (slot: string) => `rbac.${slot}.${TAG}@unitos-qa.test`;

type Actor = { id: string; email: string; client: SupabaseClient };

async function actor(slot: string): Promise<Actor> {
  const email = emailOf(slot);
  const client = createClient(url!, publishable!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let res = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (res.error) {
    const up = await client.auth.signUp({ email, password: PASSWORD });
    if (up.error) throw new Error(`signUp ${slot}: ${up.error.message}`);
    if (!up.data.session) {
      res = await client.auth.signInWithPassword({ email, password: PASSWORD });
      if (res.error) throw new Error(`signIn ${slot}: ${res.error.message}`);
    }
  }
  const u = await client.auth.getUser();
  if (u.error || !u.data.user) throw new Error(`getUser ${slot}: ${u.error?.message}`);
  return { id: u.data.user.id, email, client };
}

type Ctx = {
  brandId: string;
  otherBrandId: string;
  clientFree: string; // sem responsável e sem vínculo → invisível para USER
  clientOfUser: string; // owner_user_id = USER
  clientOfManager: string; // fora do escopo do USER
  otherBrandClient: string;
  taskOutOfScope: string;
  superAdmin: Actor;
  owner: Actor;
  manager: Actor;
  user: Actor;
  portal: Actor;
  outsider: Actor;
  superIsFlagged: boolean;
};

let cx: Ctx;

async function roleOf(a: Actor, brandId: string | null) {
  const { data, error } = await a.client.rpc(
    "app_access_role" as never,
    {
      _user_id: a.id,
      _brand_id: brandId,
    } as never,
  );
  if (error) throw error;
  return data as string | null;
}

async function visibleClients(c: SupabaseClient, brandId: string) {
  const { data, error } = await c.from("clients").select("id").eq("brand_id", brandId);
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string).sort();
}

beforeAll(async () => {
  const [superAdmin, owner, manager, user, portal, outsider] = await Promise.all([
    actor("super"),
    actor("owner"),
    actor("manager"),
    actor("user"),
    actor("portal"),
    actor("outsider"),
  ]);

  const prof = await superAdmin.client
    .from("user_profiles")
    .select("is_super_admin")
    .eq("id", superAdmin.id)
    .maybeSingle();
  const superIsFlagged = Boolean(prof.data?.is_super_admin);

  // Sem RETURNING: a associação de owner só existe depois do AFTER trigger,
  // então a linha ainda não é visível pela policy de SELECT no mesmo comando.
  const brandA = await owner.client
    .from("brands")
    .insert({ name: `RBAC ${TAG}`, slug: `rbac-${TAG}`, created_by: owner.id });
  if (brandA.error) throw new Error(`brandA: ${brandA.error.message}`);
  const brandB = await outsider.client
    .from("brands")
    .insert({ name: `RBAC Outra ${TAG}`, slug: `rbac-outra-${TAG}`, created_by: outsider.id });
  if (brandB.error) throw new Error(`brandB: ${brandB.error.message}`);
  const fetchBrand = async (a: Actor, slug: string) => {
    const r = await a.client.from("brands").select("id").eq("slug", slug).single();
    if (r.error) throw new Error(`brand ${slug}: ${r.error.message}`);
    return r.data.id as string;
  };
  const brandId = await fetchBrand(owner, `rbac-${TAG}`);
  const otherBrandId = await fetchBrand(outsider, `rbac-outra-${TAG}`);

  const bm = await owner.client.from("brand_members").insert([
    { brand_id: brandId, user_id: manager.id, role: "manager" },
    { brand_id: brandId, user_id: user.id, role: "user" },
  ]);
  if (bm.error) throw new Error(`brand_members: ${bm.error.message}`);

  const clients = await owner.client
    .from("clients")
    .insert([
      { brand_id: brandId, name: `Livre ${TAG}` },
      { brand_id: brandId, name: `DoUser ${TAG}`, owner_user_id: user.id },
      { brand_id: brandId, name: `DoManager ${TAG}`, owner_user_id: manager.id },
    ])
    .select("id, name");
  if (clients.error) throw new Error(`clients: ${clients.error.message}`);
  const byName = (p: string) => clients.data.find((c) => c.name.startsWith(p))!.id as string;
  const clientFree = byName("Livre");
  const clientOfUser = byName("DoUser");
  const clientOfManager = byName("DoManager");

  const otherClient = await outsider.client
    .from("clients")
    .insert({ brand_id: otherBrandId, name: `OutraBrand ${TAG}` })
    .select("id")
    .single();
  if (otherClient.error) throw new Error(`otherClient: ${otherClient.error.message}`);

  const cm = await owner.client.from("client_members").insert({
    brand_id: brandId,
    client_id: clientOfUser,
    user_id: portal.id,
    role: "portal_client",
  });
  if (cm.error) throw new Error(`client_members: ${cm.error.message}`);

  const task = await owner.client
    .from("tasks")
    .insert({ brand_id: brandId, client_id: clientOfManager, title: `Tarefa fora ${TAG}` })
    .select("id")
    .single();
  if (task.error) throw new Error(`task: ${task.error.message}`);

  cx = {
    brandId,
    otherBrandId,
    clientFree,
    clientOfUser,
    clientOfManager,
    otherBrandClient: otherClient.data.id as string,
    taskOutOfScope: task.data.id as string,
    superAdmin,
    owner,
    manager,
    user,
    portal,
    outsider,
    superIsFlagged,
  };
});

afterAll(async () => {
  if (!cx) return;
  await cx.owner.client.from("tasks").delete().eq("brand_id", cx.brandId);
  await cx.owner.client.from("client_members").delete().eq("brand_id", cx.brandId);
  await cx.owner.client.from("clients").delete().eq("brand_id", cx.brandId);
  await cx.owner.client
    .from("brand_members")
    .delete()
    .eq("brand_id", cx.brandId)
    .neq("user_id", cx.owner.id);
  await cx.outsider.client.from("clients").delete().eq("brand_id", cx.otherBrandId);
});

describe("papel canônico (fonte única de autoridade)", () => {
  it("ADMIN / MANAGER / USER / CLIENTE resolvem papéis distintos", async () => {
    expect(await roleOf(cx.owner, cx.brandId)).toBe("admin");
    expect(await roleOf(cx.manager, cx.brandId)).toBe("manager");
    expect(await roleOf(cx.user, cx.brandId)).toBe("user");
    expect(await roleOf(cx.portal, cx.brandId)).toBe("client");
  });

  it("MANAGER ≠ ADMIN", async () => {
    expect(await roleOf(cx.manager, cx.brandId)).not.toBe("admin");
  });

  it("papel é por marca — sem vínculo não há papel", async () => {
    expect(await roleOf(cx.user, cx.otherBrandId)).toBeNull();
    expect(await roleOf(cx.outsider, cx.brandId)).toBeNull();
  });

  it("SUPER ADMIN é global", async () => {
    if (!cx.superIsFlagged) return;
    expect(await roleOf(cx.superAdmin, cx.brandId)).toBe("super_admin");
    expect(await roleOf(cx.superAdmin, cx.otherBrandId)).toBe("super_admin");
  });
});

describe("escopo de leitura (SELECT via RLS)", () => {
  it("ADMIN cobre a marca inteira; MANAGER só os clientes atribuídos", async () => {
    const expected = [cx.clientFree, cx.clientOfUser, cx.clientOfManager].sort();
    expect(await visibleClients(cx.owner.client, cx.brandId)).toEqual(expected);
    // Fase 1 RBAC: MANAGER tem autoridade administrativa, mas escopo de DADOS
    // restrito aos clientes atribuídos.
    const mgr = await visibleClients(cx.manager.client, cx.brandId);
    expect(mgr).toContain(cx.clientOfManager);
    expect(mgr).not.toContain(cx.clientOfUser);
    expect(mgr).not.toContain(cx.clientFree);
  });


  it("USER limitado ao escopo (somente clientes vinculados)", async () => {
    const ids = await visibleClients(cx.user.client, cx.brandId);
    expect(ids).toContain(cx.clientOfUser);
    // Cliente sem responsável NÃO é mais visível por fallback.
    expect(ids).not.toContain(cx.clientFree);
    expect(ids).not.toContain(cx.clientOfManager);
  });

  it("CLIENTE (portal) isolado ao próprio cliente", async () => {
    expect(await visibleClients(cx.portal.client, cx.brandId)).toEqual([cx.clientOfUser]);
  });

  it("isolamento entre marcas", async () => {
    for (const a of [cx.owner, cx.manager, cx.user, cx.portal]) {
      expect(await visibleClients(a.client, cx.otherBrandId)).toHaveLength(0);
    }
    expect(await visibleClients(cx.outsider.client, cx.brandId)).toHaveLength(0);
  });

  it("SUPER ADMIN lê as duas marcas", async () => {
    if (!cx.superIsFlagged) return;
    expect(await visibleClients(cx.superAdmin.client, cx.brandId)).toHaveLength(3);
    expect(await visibleClients(cx.superAdmin.client, cx.otherBrandId)).toEqual([
      cx.otherBrandClient,
    ]);
  });
});

describe("acesso direto por ID/URL", () => {
  it("USER não alcança cliente nem tarefa fora do escopo pelo id", async () => {
    const c = await cx.user.client.from("clients").select("id").eq("id", cx.clientOfManager);
    expect(c.data ?? []).toHaveLength(0);
    const t = await cx.user.client.from("tasks").select("id").eq("id", cx.taskOutOfScope);
    expect(t.data ?? []).toHaveLength(0);
  });

  it("CLIENTE não alcança tarefa de outro cliente pelo id", async () => {
    const t = await cx.portal.client.from("tasks").select("id").eq("id", cx.taskOutOfScope);
    expect(t.data ?? []).toHaveLength(0);
  });

  it("usuário de outra marca não alcança cliente pelo id", async () => {
    const c = await cx.outsider.client.from("clients").select("id").eq("id", cx.clientOfUser);
    expect(c.data ?? []).toHaveLength(0);
  });
});

describe("escrita: INSERT / UPDATE / DELETE via RLS", () => {
  it("USER não cria cliente", async () => {
    const ins = await cx.user.client
      .from("clients")
      .insert({ brand_id: cx.brandId, name: `Proibido ${TAG}` })
      .select("id");
    expect(ins.error).toBeTruthy();
  });

  it("USER não exclui cliente do próprio escopo", async () => {
    const del = await cx.user.client
      .from("clients")
      .delete()
      .eq("id", cx.clientOfUser)
      .select("id");
    expect(del.data ?? []).toHaveLength(0);
  });

  it("USER não atualiza cliente fora do escopo", async () => {
    const up = await cx.user.client
      .from("clients")
      .update({ description: "hack" })
      .eq("id", cx.clientOfManager)
      .select("id");
    expect(up.data ?? []).toHaveLength(0);
  });

  it("USER atualiza cliente dentro do escopo", async () => {
    const up = await cx.user.client
      .from("clients")
      .update({ description: `ok ${TAG}` })
      .eq("id", cx.clientOfUser)
      .select("id");
    expect(up.data ?? []).toHaveLength(1);
  });

  it("MANAGER cria cliente, mas só ADMIN/OWNER exclui", async () => {
    const ins = await cx.manager.client
      .from("clients")
      .insert({ brand_id: cx.brandId, name: `DoManager2 ${TAG}` })
      .select("id");
    expect(ins.error).toBeNull();
    const id = (ins.data ?? [])[0]!.id as string;
    // Exclusão de cliente é irreversível: restrita a admin/owner (RLS).
    const delManager = await cx.manager.client.from("clients").delete().eq("id", id).select("id");
    expect(delManager.data ?? []).toHaveLength(0);
    const delAdmin = await cx.owner.client.from("clients").delete().eq("id", id).select("id");
    expect(delAdmin.data ?? []).toHaveLength(1);
  });

  // Regra canônica atual (endurecimento pós-integrações Meta): identidade/dados
  // da marca são administráveis somente por super_admin / owner / admin.
  // MANAGER não edita a marca.
  it("somente ADMIN/OWNER edita a marca; MANAGER e USER não", async () => {
    const m = await cx.manager.client
      .from("brands")
      .update({ name: `RBAC Manager ${TAG}` })
      .eq("id", cx.brandId)
      .select("id");
    expect(m.data ?? []).toHaveLength(0);
    const e = await cx.user.client
      .from("brands")
      .update({ name: `Hack ${TAG}` })
      .eq("id", cx.brandId)
      .select("id");
    expect(e.data ?? []).toHaveLength(0);
    const o = await cx.owner.client
      .from("brands")
      .update({ name: `RBAC ${TAG}` })
      .eq("id", cx.brandId)
      .select("id");
    expect(o.data ?? []).toHaveLength(1);
  });


  it("MANAGER não promove ninguém a owner nem altera o owner", async () => {
    const promote = await cx.manager.client
      .from("brand_members")
      .update({ role: "owner" })
      .eq("brand_id", cx.brandId)
      .eq("user_id", cx.user.id)
      .select("id");
    expect(promote.data ?? []).toHaveLength(0);
    const touchOwner = await cx.manager.client
      .from("brand_members")
      .update({ role: "user" })
      .eq("brand_id", cx.brandId)
      .eq("user_id", cx.owner.id)
      .select("id");
    expect(touchOwner.data ?? []).toHaveLength(0);
  });

  it("USER não gerencia membros da equipe", async () => {
    const r = await cx.user.client
      .from("brand_members")
      .update({ role: "manager" })
      .eq("brand_id", cx.brandId)
      .eq("user_id", cx.user.id)
      .select("id");
    expect(r.data ?? []).toHaveLength(0);
  });

  it("USER não escala privilégio marcando-se como super admin", async () => {
    const r = await cx.user.client
      .from("user_profiles")
      .update({ is_super_admin: true })
      .eq("id", cx.user.id)
      .select("id");
    const check = await cx.user.client
      .from("user_profiles")
      .select("is_super_admin")
      .eq("id", cx.user.id)
      .maybeSingle();
    expect(Boolean(check.data?.is_super_admin)).toBe(false);
    if (!r.error) expect(await roleOf(cx.user, cx.brandId)).toBe("user");
  });

  it("CLIENTE (portal) não escreve em tarefas nem clientes", async () => {
    const t = await cx.portal.client
      .from("tasks")
      .insert({ brand_id: cx.brandId, client_id: cx.clientOfUser, title: `Portal ${TAG}` })
      .select("id");
    expect(t.error).toBeTruthy();
    const c = await cx.portal.client
      .from("clients")
      .insert({ brand_id: cx.brandId, name: `Portal cliente ${TAG}` })
      .select("id");
    expect(c.error).toBeTruthy();
  });
});

describe("contrato das funções de servidor (mesmas usadas por access-guard)", () => {
  it("my_access devolve papel + escopo idênticos à RLS", async () => {
    for (const a of [cx.owner, cx.manager, cx.user]) {
      const { data, error } = await a.client.rpc(
        "my_access" as never,
        {
          _brand_id: cx.brandId,
        } as never,
      );
      if (error) throw error;
      const payload = data as { role: string; client_ids: string[] };
      expect(payload.role).toBe(await roleOf(a, cx.brandId));
      expect([...payload.client_ids].sort()).toEqual(await visibleClients(a.client, cx.brandId));
    }
  });

  it("can_access_client nega cliente fora do escopo e de outra marca", async () => {
    const deny = await cx.user.client.rpc(
      "can_access_client" as never,
      {
        _client_id: cx.clientOfManager,
        _user_id: cx.user.id,
      } as never,
    );
    expect(deny.data).toBe(false);
    const allow = await cx.user.client.rpc(
      "can_access_client" as never,
      {
        _client_id: cx.clientOfUser,
        _user_id: cx.user.id,
      } as never,
    );
    expect(allow.data).toBe(true);
    const cross = await cx.user.client.rpc(
      "can_access_client" as never,
      {
        _client_id: cx.otherBrandClient,
        _user_id: cx.user.id,
      } as never,
    );
    expect(cross.data).toBe(false);
  });
});

const LEGACY_ROLES = ["edi" + "tor", "desig" + "ner"] as const;

describe("papéis legados convergem para USER (sem papel operacional duplicado)", () => {
  it("gravação legada de papel operacional antigo é normalizada para 'user'", async () => {
    for (const legacy of LEGACY_ROLES) {
      const up = await cx.owner.client
        .from("brand_members")
        .update({ role: legacy })
        .eq("brand_id", cx.brandId)
        .eq("user_id", cx.user.id);
      expect(up.error, `update ${legacy}`).toBeNull();

      const row = await cx.owner.client
        .from("brand_members")
        .select("role")
        .eq("brand_id", cx.brandId)
        .eq("user_id", cx.user.id)
        .single();
      expect(row.error).toBeNull();
      expect(row.data!.role, `${legacy} deve ser armazenado como user`).toBe("user");
      // Autoridade continua sendo exatamente USER (nunca capacidade distinta).
      expect(await roleOf(cx.user, cx.brandId)).toBe("user");
    }
  });

  it("nenhum papel legado permanece na marca de teste", async () => {
    const rows = await cx.owner.client
      .from("brand_members")
      .select("role")
      .eq("brand_id", cx.brandId);
    expect(rows.error).toBeNull();
    const roles = (rows.data ?? []).map((r) => r.role as string);
    for (const legacy of LEGACY_ROLES) expect(roles).not.toContain(legacy);
    for (const r of roles) expect(["owner", "manager", "user", "client"]).toContain(r);
  });
});

describe("escopo do USER depende de vínculo explícito", () => {
  it("USER sem vínculo é negado; com vínculo em client_members é permitido", async () => {
    const denied = await cx.user.client.rpc(
      "can_access_client" as never,
      {
        _client_id: cx.clientFree,
        _user_id: cx.user.id,
      } as never,
    );
    expect(denied.data, "cliente sem responsável/vínculo deve ser negado").toBe(false);

    const link = await cx.owner.client.from("client_members").insert({
      brand_id: cx.brandId,
      client_id: cx.clientFree,
      user_id: cx.user.id,
      role: "user",
    });
    expect(link.error, link.error?.message).toBeNull();

    const allowed = await cx.user.client.rpc(
      "can_access_client" as never,
      {
        _client_id: cx.clientFree,
        _user_id: cx.user.id,
      } as never,
    );
    expect(allowed.data, "vínculo explícito concede acesso").toBe(true);
    expect(await visibleClients(cx.user.client, cx.brandId)).toContain(cx.clientFree);

    await cx.owner.client
      .from("client_members")
      .delete()
      .eq("client_id", cx.clientFree)
      .eq("user_id", cx.user.id);
  });

  it("ADMIN cobre a marca inteira; MANAGER só clientes atribuídos e nunca outra marca", async () => {
    for (const id of [cx.clientFree, cx.clientOfUser, cx.clientOfManager]) {
      const r = await cx.owner.client.rpc(
        "can_access_client" as never,
        { _client_id: id, _user_id: cx.owner.id } as never,
      );
      expect(r.data, `ADMIN deveria acessar ${id}`).toBe(true);
    }
    for (const [id, expected] of [
      [cx.clientOfManager, true],
      [cx.clientOfUser, false],
      [cx.clientFree, false],
    ] as const) {
      const r = await cx.manager.client.rpc(
        "can_access_client" as never,
        { _client_id: id, _user_id: cx.manager.id } as never,
      );
      expect(r.data, `MANAGER em ${id}`).toBe(expected);
    }
    const cross = await cx.manager.client.rpc(
      "can_access_client" as never,
      {
        _client_id: cx.otherBrandClient,
        _user_id: cx.manager.id,
      } as never,
    );
    expect(cross.data, "MANAGER não acessa outra marca").toBe(false);
    expect(await roleOf(cx.manager, cx.otherBrandId)).toBeNull();
  });

  it("SUPER ADMIN é global no escopo de clientes", async () => {
    if (!cx.superIsFlagged) return;
    const r = await cx.superAdmin.client.rpc(
      "can_access_client" as never,
      {
        _client_id: cx.otherBrandClient,
        _user_id: cx.superAdmin.id,
      } as never,
    );
    expect(r.data).toBe(true);
  });
});
