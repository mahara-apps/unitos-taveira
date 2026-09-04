/**
 * V1 — MANAGER → OWNER. Validação em banco real com clients autenticados
 * (RLS/SECURITY DEFINER exercidos de verdade, sem service role no caminho de
 * escrita). Fonte canônica de autoridade: can_invite_brand_role(), consumida
 * pela RPC link_existing_user_to_brand() e pelas server functions
 * addPerson/provisionUser (que chamam assertCanGrantBrandRole antes de usar o
 * client admin).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, seed, type Fixture, type TestUser } from "./helpers/fixtures";

let fx: Fixture | null = null;

beforeAll(async () => {
  fx = await seed();
}, 120_000);

afterAll(async () => {
  await cleanup(fx);
}, 120_000);

/** Mesmo caminho usado pela UI de "vincular conta existente". */
async function link(actor: TestUser, brandId: string, target: TestUser, role: string) {
  const { data, error } = await actor.client.rpc("link_existing_user_to_brand", {
    _brand_id: brandId,
    _email: target.email,
    _role: role,
    _permissions: [],
  });
  return { data, error };
}

/** Espelha a validação de autoridade das server functions (addPerson/provisionUser). */
async function canGrant(actor: TestUser, brandId: string, target: TestUser, role: string) {
  const { data, error } = await actor.client.rpc("can_invite_brand_role", {
    _brand_id: brandId,
    _actor_id: actor.id,
    _role: role,
    _email: target.email,
  });
  if (error) return false;
  return data === true;
}

async function roleOf(brandId: string, userId: string) {
  const { data } = await admin
    .from("brand_members")
    .select("role")
    .eq("brand_id", brandId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as string | undefined) ?? null;
}

describe("V1 — link_existing_user_to_brand (RPC)", () => {
  it("manager → owner (terceiro) é bloqueado", async () => {
    const r = await link(fx!.userManager, fx!.brandId, fx!.userB, "owner");
    expect(r.error?.message).toContain("role_authority_invalid");
    expect(await roleOf(fx!.brandId, fx!.userB.id)).toBe("user");
  });

  it("manager → owner para o próprio e-mail é bloqueado", async () => {
    const r = await link(fx!.userManager, fx!.brandId, fx!.userManager, "owner");
    expect(r.error).toBeTruthy();
    expect(await roleOf(fx!.brandId, fx!.userManager.id)).toBe("manager");
  });

  it("manager → manager é bloqueado", async () => {
    const r = await link(fx!.userManager, fx!.brandId, fx!.userB, "manager");
    expect(r.error?.message).toContain("role_authority_invalid");
    expect(await roleOf(fx!.brandId, fx!.userB.id)).toBe("user");
  });

  it("manager → user é permitido", async () => {
    const r = await link(fx!.userManager, fx!.brandId, fx!.userB, "user");
    expect(r.error).toBeNull();
    expect(await roleOf(fx!.brandId, fx!.userB.id)).toBe("user");
  });

  it("ON CONFLICT DO UPDATE: manager não promove membro existente a owner", async () => {
    const r = await link(fx!.userManager, fx!.brandId, fx!.userA, "owner");
    expect(r.error?.message).toContain("role_authority_invalid");
    expect(await roleOf(fx!.brandId, fx!.userA.id)).toBe("user");
  });

  it("owner concede manager, user e admin — mas nunca outro owner", async () => {
    const asManager = await link(fx!.userOwner, fx!.brandId, fx!.userNoLink, "manager");
    expect(asManager.error).toBeNull();
    expect(await roleOf(fx!.brandId, fx!.userNoLink.id)).toBe("manager");

    const back = await link(fx!.userOwner, fx!.brandId, fx!.userNoLink, "user");
    expect(back.error).toBeNull();
    expect(await roleOf(fx!.brandId, fx!.userNoLink.id)).toBe("user");

    // Matriz canônica: Owner concede Admin.
    const asAdmin = await link(fx!.userOwner, fx!.brandId, fx!.userB, "admin");
    expect(asAdmin.error).toBeNull();
    expect(await roleOf(fx!.brandId, fx!.userB.id)).toBe("admin");

    // Owner NUNCA concede owner — só super admin.
    const asOwner = await link(fx!.userOwner, fx!.brandId, fx!.userNoLink, "owner");
    expect(asOwner.error?.message).toContain("role_authority_invalid");
    expect(await roleOf(fx!.brandId, fx!.userNoLink.id)).toBe("user");

    // Restaura o estado compartilhado da fixture para os próximos casos.
    const revert = await link(fx!.userOwner, fx!.brandId, fx!.userB, "user");
    expect(revert.error).toBeNull();
    expect(await roleOf(fx!.brandId, fx!.userB.id)).toBe("user");
  });

  it("user e portal_client não concedem papéis administrativos", async () => {
    for (const actor of [fx!.userA, fx!.userPortal]) {
      for (const role of ["owner", "manager"]) {
        const r = await link(actor, fx!.brandId, fx!.userB, role);
        expect(r.error).toBeTruthy();
      }
    }
    expect(await roleOf(fx!.brandId, fx!.userB.id)).toBe("user");
  });

  it("multi-tenant: manager da marca A não promove ninguém na marca B", async () => {
    for (const role of ["owner", "user"]) {
      const r = await link(fx!.userManager, fx!.otherBrandId, fx!.userB, role);
      expect(r.error).toBeTruthy();
    }
    expect(await roleOf(fx!.otherBrandId, fx!.userB.id)).toBeNull();
  });
});

describe("V1 — matriz usada por addPerson / provisionUser", () => {
  it("manager só concede user", async () => {
    expect(await canGrant(fx!.userManager, fx!.brandId, fx!.userB, "owner")).toBe(false);
    expect(await canGrant(fx!.userManager, fx!.brandId, fx!.userB, "manager")).toBe(false);
    expect(await canGrant(fx!.userManager, fx!.brandId, fx!.userB, "user")).toBe(true);
  });

  it("manager não concede owner para o próprio e-mail", async () => {
    expect(await canGrant(fx!.userManager, fx!.brandId, fx!.userManager, "owner")).toBe(false);
  });

  it("owner concede admin, manager e user — nunca owner", async () => {
    expect(await canGrant(fx!.userOwner, fx!.brandId, fx!.userB, "admin")).toBe(true);
    expect(await canGrant(fx!.userOwner, fx!.brandId, fx!.userB, "manager")).toBe(true);
    expect(await canGrant(fx!.userOwner, fx!.brandId, fx!.userB, "user")).toBe(true);
    expect(await canGrant(fx!.userOwner, fx!.brandId, fx!.userB, "owner")).toBe(false);
  });

  it("manager não concede admin", async () => {
    expect(await canGrant(fx!.userManager, fx!.brandId, fx!.userB, "admin")).toBe(false);
  });

  it("user e portal_client não concedem nada", async () => {
    for (const actor of [fx!.userA, fx!.userPortal]) {
      for (const role of ["owner", "admin", "manager", "user"]) {
        expect(await canGrant(actor, fx!.brandId, fx!.userB, role)).toBe(false);
      }
    }
  });

  it("multi-tenant: manager da marca A não concede papéis na marca B", async () => {
    for (const role of ["owner", "manager", "user"]) {
      expect(await canGrant(fx!.userManager, fx!.otherBrandId, fx!.userB, role)).toBe(false);
    }
  });
});
