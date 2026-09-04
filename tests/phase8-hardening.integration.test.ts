/**
 * FASE 8 — Fechamento de segurança, privilégios e integridade do RBAC.
 *
 * Cobre exatamente as brechas remediadas nesta fase:
 *  1. `clients` DELETE exigia apenas papel no workspace (manager apagava
 *     cliente NÃO atribuído). Agora exige escopo do cliente.
 *  2. `my_access(NULL)` devolvia o "maior papel" entre workspaces em
 *     `brand_role` (elevação silenciosa na UI).
 *  3. Helpers de escopo (`client_in_scope`, `is_client_assigned`) eram
 *     executáveis por visitante anônimo.
 *  4. Matriz de papéis: ADMIN cobre o workspace; MANAGER/USER só clientes
 *     atribuídos; nenhum papel atravessa workspace.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, cleanup, seed, type Fixture } from "./helpers/fixtures";

let fx: Fixture;

beforeAll(async () => {
  fx = await seed();
}, 120_000);

afterAll(async () => {
  await cleanup();
});

describe("Fase 8 — exclusão de cliente respeita escopo", () => {
  it("MANAGER não apaga cliente fora do seu escopo (clientOrphan)", async () => {
    const { data, error } = await fx.userManager.client
      .from("clients")
      .delete()
      .eq("id", fx.clientOrphan)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("USER não apaga cliente atribuído a outro usuário", async () => {
    const { data } = await fx.userA.client
      .from("clients")
      .delete()
      .eq("id", fx.clientB)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("papéis sem membership no outro workspace não apagam clientes de lá", async () => {
    // `userOwner` é membro das DUAS marcas de QA, por isso não entra aqui.
    for (const u of [fx.userManager, fx.userA, fx.userB]) {

      const { data } = await u.client
        .from("clients")
        .delete()
        .eq("id", fx.otherBrandClient)
        .select("id");
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("ADMIN (owner) apaga cliente do próprio workspace", async () => {
    const { data: created, error: cErr } = await fx.userOwner.client
      .from("clients")
      .insert({ brand_id: fx.brandId, name: "F8 descartável" })
      .select("id")
      .single();
    expect(cErr).toBeNull();
    const { data } = await fx.userOwner.client
      .from("clients")
      .delete()
      .eq("id", created!.id)
      .select("id");
    expect(data ?? []).toHaveLength(1);
  });
});

describe("Fase 8 — my_access sem elevação silenciosa", () => {
  it("brand_role é nulo quando nenhum workspace é informado", async () => {
    const { data, error } = await fx.userManager.client.rpc("my_access", { _brand_id: null });
    expect(error).toBeNull();
    expect((data as Record<string, unknown>)["brand_role"]).toBeNull();
  });

  it("brand_role e role refletem o workspace informado", async () => {
    const { data } = await fx.userManager.client.rpc("my_access", { _brand_id: fx.brandId });
    const row = data as Record<string, unknown>;
    expect(row["role"]).toBe("manager");
    expect(row["brand_role"]).toBe("manager");
  });

  it("papel é nulo em workspace onde o usuário não é membro", async () => {
    const { data } = await fx.userA.client.rpc("my_access", { _brand_id: fx.otherBrandId });
    const row = data as Record<string, unknown>;
    expect(row["role"]).toBeNull();
    expect(row["client_ids"]).toEqual([]);
  });

  it("MANAGER/USER só enxergam clientes atribuídos; ADMIN cobre o workspace", async () => {
    const asIds = async (u: Fixture["userA"]) => {
      const { data } = await u.client.rpc("my_access", { _brand_id: fx.brandId });
      return ((data as Record<string, unknown>)["client_ids"] as string[]) ?? [];
    };
    expect(await asIds(fx.userA)).toContain(fx.clientA);
    expect(await asIds(fx.userA)).not.toContain(fx.clientOrphan);
    expect(await asIds(fx.userB)).not.toContain(fx.clientA);
    expect(await asIds(fx.userOwner)).toContain(fx.clientOrphan);
  });
});

describe("Fase 8 — helpers de escopo não são públicos", () => {
  it("anon não executa client_in_scope nem is_client_assigned", async () => {
    const anon = anonClient();
    const a = await anon.rpc("client_in_scope", {
      _client_id: fx.clientA,
      _brand_id: fx.brandId,
    });
    const b = await anon.rpc("is_client_assigned", {
      _client_id: fx.clientA,
      _user_id: fx.userA.id,
    });
    expect(a.error).not.toBeNull();
    expect(b.error).not.toBeNull();
  });
});
