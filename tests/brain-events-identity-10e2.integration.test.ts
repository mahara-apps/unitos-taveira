/**
 * FASE 10E.2 — hardening de identidade/timestamp/payload em `brain_events`.
 *
 * Prova no BANCO (RLS + trigger reais, sem bypass) que:
 * - USER/MANAGER/ADMIN não conseguem forjar `actor_id`;
 * - escopo (cliente não atribuído, cross-workspace, par brand/client inconsistente)
 *   permanece bloqueado como nas fases anteriores;
 * - `created_at` enviado pelo chamador autenticado é ignorado;
 * - campos de autoridade no payload são removidos;
 * - service_role continua podendo registrar evento de sistema.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, seed, type Fixture, type TestUser } from "./helpers/fixtures";

let fx: Fixture;

const FAKE_TS = "2020-01-01T00:00:00.000Z";

async function insertAs(
  user: TestUser,
  row: Record<string, unknown>,
): Promise<{ error: string | null; id?: string }> {
  const r = await user.client
    .from("brain_events")
    .insert({
      source_module: "qa.10e2",
      event_type: "qa.identity",
      payload: {},
      ...row,
    })
    .select("id")
    .single();
  if (r.error) return { error: r.error.message };
  return { error: null, id: r.data.id as string };
}

async function readRow(id: string) {
  const r = await admin
    .from("brain_events")
    .select("actor_id, created_at, payload, brand_id, client_id")
    .eq("id", id)
    .single();
  if (r.error) throw new Error(r.error.message);
  return r.data as {
    actor_id: string | null;
    created_at: string;
    payload: Record<string, unknown>;
    brand_id: string | null;
    client_id: string | null;
  };
}

beforeAll(async () => {
  fx = await seed();
}, 120_000);

afterAll(async () => {
  await cleanup();
}, 120_000);

describe("brain_events — actor_id não pode ser forjado", () => {
  it("USER: actor_id de outro usuário é substituído pela própria identidade", async () => {
    const res = await insertAs(fx.userA, {
      brand_id: fx.brandId,
      client_id: fx.clientA,
      actor_id: fx.userB.id,
    });
    expect(res.error).toBeNull();
    const row = await readRow(res.id!);
    expect(row.actor_id).toBe(fx.userA.id);
  });

  it("MANAGER: actor_id forjado é substituído pela própria identidade", async () => {
    // MANAGER só alcança clientes atribuídos (10D). Vincula explicitamente ao clientA.
    const link = await admin
      .from("client_members")
      .insert({
        brand_id: fx.brandId,
        client_id: fx.clientA,
        user_id: fx.userManager.id,
        role: "manager",
      });
    expect(link.error).toBeNull();
    const res = await insertAs(fx.userManager, {
      brand_id: fx.brandId,
      client_id: fx.clientA,
      actor_id: fx.userA.id,
    });
    expect(res.error).toBeNull();
    const row = await readRow(res.id!);
    expect(row.actor_id).toBe(fx.userManager.id);
  });

  it("ADMIN (owner): evento registra a própria identidade", async () => {
    const res = await insertAs(fx.userOwner, {
      brand_id: fx.brandId,
      client_id: fx.clientB,
      actor_id: fx.userB.id,
    });
    expect(res.error).toBeNull();
    const row = await readRow(res.id!);
    expect(row.actor_id).toBe(fx.userOwner.id);
  });

  it("actor_id nulo enviado por usuário autenticado também vira a identidade real", async () => {
    const res = await insertAs(fx.userA, {
      brand_id: fx.brandId,
      client_id: fx.clientA,
      actor_id: null,
    });
    expect(res.error).toBeNull();
    const row = await readRow(res.id!);
    expect(row.actor_id).toBe(fx.userA.id);
  });
});

describe("brain_events — escopo permanece isolado", () => {
  it("USER não escreve em cliente não atribuído", async () => {
    const res = await insertAs(fx.userA, { brand_id: fx.brandId, client_id: fx.clientB });
    expect(res.error).toBeTruthy();
  });

  it("MANAGER não escreve em cliente não atribuído", async () => {
    const res = await insertAs(fx.userManager, { brand_id: fx.brandId, client_id: fx.clientOrphan });
    expect(res.error).toBeTruthy();
  });

  it("cross-workspace bloqueado", async () => {
    const res = await insertAs(fx.userA, {
      brand_id: fx.otherBrandId,
      client_id: fx.otherBrandClient,
    });
    expect(res.error).toBeTruthy();
  });

  it("par brand/client inconsistente bloqueado", async () => {
    const res = await insertAs(fx.userOwner, {
      brand_id: fx.otherBrandId,
      client_id: fx.clientA,
    });
    expect(res.error).toBeTruthy();
  });

  it("portal não escreve em brain_events", async () => {
    const res = await insertAs(fx.userPortal, { brand_id: fx.brandId, client_id: fx.clientA });
    expect(res.error).toBeTruthy();
  });
});

describe("brain_events — created_at e payload", () => {
  it("created_at falsificado pelo chamador é rejeitado", async () => {
    const res = await insertAs(fx.userA, {
      brand_id: fx.brandId,
      client_id: fx.clientA,
      created_at: FAKE_TS,
    });
    expect(res.error).toBeTruthy();
  });

  it("created_at futuro é rejeitado", async () => {
    const res = await insertAs(fx.userA, {
      brand_id: fx.brandId,
      client_id: fx.clientA,
      created_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(res.error).toBeTruthy();
  });

  it("evento sem created_at recebe timestamp atual do banco", async () => {
    const res = await insertAs(fx.userA, { brand_id: fx.brandId, client_id: fx.clientA });
    expect(res.error).toBeNull();
    const row = await readRow(res.id!);
    expect(Math.abs(Date.now() - new Date(row.created_at).getTime())).toBeLessThan(120_000);
  });

  it("campos de autoridade no payload são removidos, dados legítimos preservados", async () => {
    const res = await insertAs(fx.userA, {
      brand_id: fx.brandId,
      client_id: fx.clientA,
      payload: {
        role: "admin",
        is_super_admin: true,
        access_token: "x",
        actor_id: fx.userB.id,
        permissions: ["*"],
        note: "conteudo legitimo",
        count: 3,
      },
    });
    expect(res.error).toBeNull();
    const row = await readRow(res.id!);
    expect(row.payload["role"]).toBeUndefined();
    expect(row.payload["is_super_admin"]).toBeUndefined();
    expect(row.payload["access_token"]).toBeUndefined();
    expect(row.payload["actor_id"]).toBeUndefined();
    expect(row.payload["permissions"]).toBeUndefined();
    expect(row.payload["note"]).toBe("conteudo legitimo");
    expect(row.payload["count"]).toBe(3);
  });
});

describe("brain_events — evento de sistema (service_role)", () => {
  it("service_role registra evento de sistema com ator nulo e payload intacto", async () => {
    const r = await admin
      .from("brain_events")
      .insert({
        brand_id: fx.brandId,
        client_id: fx.clientA,
        source_module: "qa.10e2.system",
        event_type: "qa.system",
        actor_id: null,
        payload: { role: "system", worker: "qa" },
      })
      .select("id")
      .single();
    expect(r.error).toBeNull();
    const row = await readRow(r.data!.id as string);
    expect(row.actor_id).toBeNull();
    expect(row.payload["worker"]).toBe("qa");
  });
});
