/**
 * FASE 1 RBAC — NÃO existe "admin global".
 *
 * `public.user_profiles.role = 'admin'` deixou de conceder autoridade em
 * workspaces onde o usuário não tem membership. Autoridade de plataforma é
 * exclusiva do SUPER ADMIN; ADMIN é sempre por workspace.
 *
 * Este teste blinda a não-escalação nas fontes canônicas: app_access_role,
 * my_access e can_access_client + RLS de brands/clients.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createUser, type TestUser } from "./helpers/fixtures";

let profileAdmin: TestUser;
let plainUser: TestUser;
let owner: TestUser;
let brandId: string;
let clientId: string;

beforeAll(async () => {
  profileAdmin = await createUser("gadmin");
  plainUser = await createUser("gplain");
  owner = await createUser("gowner");

  const stamp = Date.now();
  const brand = await admin
    .from("brands")
    .insert({ name: `QA GA ${stamp}`, slug: `qa-ga-${stamp}`, created_by: owner.id })
    .select("id")
    .single();
  if (brand.error) throw brand.error;
  brandId = brand.data.id;

  const client = await admin
    .from("clients")
    .insert({ brand_id: brandId, name: "QA GA Client" })
    .select("id")
    .single();
  if (client.error) throw client.error;
  clientId = client.data.id;

  await admin.from("brand_members").delete().eq("user_id", profileAdmin.id);
  await admin.from("brand_members").delete().eq("user_id", plainUser.id);
  const up = await admin.from("user_profiles").update({ role: "admin" }).eq("id", profileAdmin.id);
  if (up.error) throw up.error;
});

afterAll(async () => {
  await admin.from("clients").delete().eq("id", clientId);
  await admin.from("brand_members").delete().eq("brand_id", brandId);
  await admin.from("brands").delete().eq("id", brandId);
  for (const u of [profileAdmin, plainUser, owner]) {
    if (u) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  }
});

describe("user_profiles.role = 'admin' não é autoridade global", () => {
  it("app_access_role NÃO retorna 'admin' em marca sem membership", async () => {
    const { data, error } = await profileAdmin.client.rpc("app_access_role", {
      _user_id: profileAdmin.id,
      _brand_id: brandId,
    });
    expect(error).toBeNull();
    expect(data).not.toBe("admin");
  });

  it("my_access não escala papel nem super_admin", async () => {
    const { data } = await profileAdmin.client.rpc("my_access", { _brand_id: brandId });
    const row = (data ?? {}) as Record<string, unknown>;
    expect(row["role"]).not.toBe("admin");
    expect(row["is_super_admin"]).not.toBe(true);
    expect(row["client_ids"] ?? []).toEqual([]);
  });

  it("não enxerga a marca nem o cliente via RLS", async () => {
    const brands = await profileAdmin.client.from("brands").select("id").eq("id", brandId);
    expect(brands.data ?? []).toHaveLength(0);
    const clients = await profileAdmin.client.from("clients").select("id").eq("id", clientId);
    expect(clients.data ?? []).toHaveLength(0);
    const access = await profileAdmin.client.rpc("can_access_client", {
      _client_id: clientId,
      _user_id: profileAdmin.id,
    });
    expect(access.data).not.toBe(true);
  });

  it("não alcança áreas da agência (conexões, membros, SLA)", async () => {
    const conn = await admin
      .from("social_connections")
      .insert({
        brand_id: brandId,
        provider: "meta",
        channel: "instagram",
        external_id: `qa-ga-${Date.now()}`,
        access_token_ciphertext: "qa-cipher",
        status: "active",
      })
      .select("id")
      .single();
    if (conn.error) throw conn.error;

    const conns = await profileAdmin.client
      .from("social_connections")
      .select("id")
      .eq("id", conn.data.id);
    expect(conns.data ?? []).toHaveLength(0);

    const members = await profileAdmin.client
      .from("client_members")
      .select("id")
      .eq("brand_id", brandId);
    expect(members.data ?? []).toHaveLength(0);

    const sla = await profileAdmin.client
      .from("sla_rules")
      .insert({ brand_id: brandId, scope: "agent", target_hours: 24 })
      .select("id")
      .single();
    expect(sla.error).not.toBeNull();

    await admin.from("social_connections").delete().eq("id", conn.data.id);
  });

  it("ADMIN com membership real continua enxergando o próprio workspace", async () => {
    const link = await admin
      .from("brand_members")
      .insert({ brand_id: brandId, user_id: profileAdmin.id, role: "owner" })
      .select("id")
      .single();
    expect(link.error).toBeNull();

    const role = await profileAdmin.client.rpc("app_access_role", {
      _user_id: profileAdmin.id,
      _brand_id: brandId,
    });
    expect(role.data).toBe("admin");
    const clients = await profileAdmin.client.from("clients").select("id").eq("id", clientId);
    expect((clients.data ?? []).map((c) => c.id)).toEqual([clientId]);

    await admin.from("brand_members").delete().eq("id", link.data!.id);
  });

  it("usuário comum sem membership continua sem acesso", async () => {
    const role = await plainUser.client.rpc("app_access_role", {
      _user_id: plainUser.id,
      _brand_id: brandId,
    });
    expect(role.data).not.toBe("admin");
    const brands = await plainUser.client.from("brands").select("id").eq("id", brandId);
    expect(brands.data ?? []).toHaveLength(0);
  });
});
