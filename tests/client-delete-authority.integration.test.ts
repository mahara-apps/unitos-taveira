/**
 * Autoridade de exclusão de CLIENTE em banco real (RLS + matriz de papéis).
 *
 * Regra canônica: somente nível ADMINISTRADOR (super_admin / admin do
 * workspace; owner resolve como admin) exclui clientes. Manager/User não
 * excluem — nem mesmo clientes atribuídos — e a barreira é do banco (RLS
 * "clients delete admins only"), não do frontend.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createUser, seed, type Fixture, type TestUser } from "./helpers/fixtures";

let fx: Fixture | null = null;
let userAdmin: TestUser | null = null;
let throwawayClientId: string | null = null;

async function makeClient(name: string): Promise<string> {
  const ins = await admin
    .from("clients")
    .insert({ brand_id: fx!.brandId, name, owner_user_id: fx!.userOwner.id })
    .select("id")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  return ins.data.id as string;
}

async function clientExists(clientId: string): Promise<boolean> {
  const { data } = await admin.from("clients").select("id").eq("id", clientId).maybeSingle();
  return !!data;
}

beforeAll(async () => {
  fx = await seed();
  userAdmin = await createUser("cladmin");
  const ins = await admin
    .from("brand_members")
    .insert({ brand_id: fx.brandId, user_id: userAdmin.id, role: "admin", is_active: true });
  if (ins.error) throw new Error(ins.error.message);
}, 180_000);

afterAll(async () => {
  await cleanup(fx);
}, 180_000);

describe("RLS de DELETE em clients — somente administradores", () => {
  it("Manager NÃO exclui cliente atribuído (0 linhas afetadas, cliente intacto)", async () => {
    const id = await makeClient(`QA MgrDel ${Date.now().toString(36)}`);
    // atribui o cliente ao manager
    const link = await admin
      .from("client_members")
      .insert({ brand_id: fx!.brandId, client_id: id, user_id: fx!.userManager.id, role: "manager" });
    if (link.error) throw new Error(link.error.message);

    const { error } = await fx!.userManager.client.from("clients").delete().eq("id", id);
    expect(error).toBeNull(); // RLS não gera erro: apenas não deleta
    expect(await clientExists(id)).toBe(true);
  });

  it("User NÃO exclui cliente atribuído", async () => {
    const { error } = await fx!.userA.client.from("clients").delete().eq("id", fx!.clientA);
    expect(error).toBeNull();
    expect(await clientExists(fx!.clientA)).toBe(true);
  });

  it("Owner NÃO exclui cliente de outro workspace", async () => {
    const { error } = await fx!.userOwner.client
      .from("clients")
      .delete()
      .eq("id", fx!.otherBrandClient);
    expect(error).toBeNull();
    expect(await clientExists(fx!.otherBrandClient)).toBe(true);
  });

  it("Admin do workspace exclui somente o cliente alvo", async () => {
    throwawayClientId = await makeClient(`QA AdmDel ${Date.now().toString(36)}`);
    const { error } = await userAdmin!.client
      .from("clients")
      .delete()
      .eq("id", throwawayClientId);
    expect(error).toBeNull();
    expect(await clientExists(throwawayClientId)).toBe(false);
    expect(await clientExists(fx!.clientA)).toBe(true);
  });

  it("Owner exclui cliente do próprio workspace", async () => {
    const id = await makeClient(`QA OwnDel ${Date.now().toString(36)}`);
    const { error } = await fx!.userOwner.client.from("clients").delete().eq("id", id);
    expect(error).toBeNull();
    expect(await clientExists(id)).toBe(false);
  });
});
