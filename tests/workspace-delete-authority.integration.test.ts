/**
 * Autoridade de exclusão de WORKSPACE em banco real (RLS + can_delete_brand).
 *
 * Regra canônica: somente OWNER da marca ou SUPER ADMIN excluem o workspace.
 * Admin/Manager/User não excluem — e a barreira é do banco, não do frontend.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, createUser, seed, type Fixture, type TestUser } from "./helpers/fixtures";

let fx: Fixture | null = null;
let userAdmin: TestUser | null = null;

beforeAll(async () => {
  fx = await seed();
  userAdmin = await createUser("wsadmin");
  const ins = await admin
    .from("brand_members")
    .insert({ brand_id: fx.brandId, user_id: userAdmin.id, role: "admin", is_active: true });
  if (ins.error) throw new Error(ins.error.message);
}, 180_000);

afterAll(async () => {
  await cleanup(fx);
}, 180_000);

async function canDelete(actor: TestUser, brandId: string): Promise<boolean> {
  const { data, error } = await actor.client.rpc("can_delete_brand", {
    _brand_id: brandId,
    _user_id: actor.id,
  });
  if (error) return false;
  return data === true;
}

async function brandExists(brandId: string): Promise<boolean> {
  const { data } = await admin.from("brands").select("id").eq("id", brandId).maybeSingle();
  return !!data;
}

describe("can_delete_brand", () => {
  it("Owner pode excluir o próprio workspace", async () => {
    expect(await canDelete(fx!.userOwner, fx!.brandId)).toBe(true);
  });

  it("Admin da marca NÃO pode excluir", async () => {
    expect(await canDelete(userAdmin!, fx!.brandId)).toBe(false);
  });

  it("Manager e User não podem excluir", async () => {
    expect(await canDelete(fx!.userManager, fx!.brandId)).toBe(false);
    expect(await canDelete(fx!.userA, fx!.brandId)).toBe(false);
  });

  it("nenhum papel pode excluir workspace de outra instalação em que não é owner", async () => {
    expect(await canDelete(fx!.userA, fx!.otherBrandId)).toBe(false);
    expect(await canDelete(userAdmin!, fx!.otherBrandId)).toBe(false);
  });
});

describe("RLS de DELETE em brands", () => {
  it("Admin/Manager não removem a linha (0 linhas afetadas, workspace intacto)", async () => {
    for (const actor of [userAdmin!, fx!.userManager, fx!.userA]) {
      const { error } = await actor.client.from("brands").delete().eq("id", fx!.brandId);
      expect(error).toBeNull();
      expect(await brandExists(fx!.brandId)).toBe(true);
    }
  });

  it("Owner remove somente o workspace alvo, sem afetar a outra instalação", async () => {
    const throwaway = await admin
      .from("brands")
      .insert({
        name: `QA Delete ${Date.now().toString(36)}`,
        slug: `qa-delete-${Date.now().toString(36)}`,
        created_by: fx!.userOwner.id,
      })
      .select("id")
      .single();
    if (throwaway.error) throw new Error(throwaway.error.message);
    const targetId = throwaway.data.id as string;

    const { error } = await fx!.userOwner.client.from("brands").delete().eq("id", targetId);
    expect(error).toBeNull();
    expect(await brandExists(targetId)).toBe(false);
    expect(await brandExists(fx!.brandId)).toBe(true);
    expect(await brandExists(fx!.otherBrandId)).toBe(true);
  });
});
