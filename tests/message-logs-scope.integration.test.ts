/**
 * FASE 10B — Isolamento client-scoped de `public.message_logs`.
 *
 * Modelo canônico validado aqui:
 * SUPER ADMIN → global · ADMIN → todos os clientes do workspace ·
 * MANAGER/USER → somente clientes atribuídos · PORTAL → sem acesso adicional ·
 * ANON → nenhum acesso direto.
 *
 * Registros com `client_id NULL` (escopo de workspace) NÃO podem vazar para
 * MANAGER/USER — a regra definitiva de NULL é assunto da Fase 10C.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anonClient, cleanup, seed, testTag, type Fixture, type TestUser } from "./helpers/fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";

let fx: Fixture;
const seededIds: string[] = [];

/** Cria um log com service role (fora de RLS) para servir de alvo de leitura. */
async function seedLog(brandId: string, clientId: string | null, channel = "resend") {
  const { data, error } = await admin
    .from("message_logs")
    .insert({
      brand_id: brandId,
      client_id: clientId,
      channel,
      status: "delivered",
      recipient: `qa+${testTag}@unitos-tests.dev`,
      metadata: { tag: testTag },
    })
    .select("id")
    .single();
  if (error) throw new Error(`seedLog: ${error.message}`);
  seededIds.push(data.id as string);
  return data.id as string;
}

/** Leitura de um log específico pela ótica do usuário (RLS aplicada). */
async function canRead(u: TestUser, id: string) {
  const { data, error } = await u.client.from("message_logs").select("id").eq("id", id);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** Espelha getMessagingKpis: escopo por workspace + escopo de cliente. */
async function readScoped(
  c: SupabaseClient,
  brandId: string,
  clientIds: string[] | null,
): Promise<string[]> {
  let q = c.from("message_logs").select("id").eq("brand_id", brandId);
  if (clientIds) q = q.in("client_id", clientIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

/** Escopo de clientes resolvido pelo servidor (my_access), nunca pelo frontend. */
async function scopedClientIds(u: TestUser, brandId: string): Promise<string[] | null> {
  const { data, error } = await u.client.rpc("my_access", { _brand_id: brandId });
  if (error) throw error;
  const row = (data ?? {}) as { role?: string; client_ids?: string[] };
  if (row.role === "admin" || row.role === "super_admin") return null;
  return Array.isArray(row.client_ids) ? row.client_ids : [];
}

let logA = "";
let logB = "";
let logOrphan = "";
let logOtherWorkspace = "";
let logNull = "";

beforeAll(async () => {
  fx = await seed();
  logA = await seedLog(fx.brandId, fx.clientA);
  logB = await seedLog(fx.brandId, fx.clientB, "whatsapp_cloud");
  logOrphan = await seedLog(fx.brandId, fx.clientOrphan);
  logOtherWorkspace = await seedLog(fx.otherBrandId, fx.otherBrandClient);
  logNull = await seedLog(fx.brandId, null);
}, 120_000);

afterAll(async () => {
  if (seededIds.length) await admin.from("message_logs").delete().in("id", seededIds);
  await cleanup(fx);
}, 120_000);

describe("FASE 10B — message_logs: escopo por cliente", () => {
  it("1. ADMIN lê logs do cliente A", async () => {
    expect(await canRead(fx.userOwner, logA)).toBe(true);
  });

  it("2. ADMIN lê logs do cliente B no mesmo workspace", async () => {
    expect(await canRead(fx.userOwner, logB)).toBe(true);
  });

  it("3. ADMIN não lê logs de outro workspace onde não é membro", async () => {
    // userManager é admin de nada; usamos userA como leitor externo do brand2.
    expect(await canRead(fx.userA, logOtherWorkspace)).toBe(false);
  });

  it("4. MANAGER lê logs do cliente atribuído", async () => {
    const cm = await admin
      .from("client_members")
      .insert({ brand_id: fx.brandId, client_id: fx.clientA, user_id: fx.userManager.id, role: "user" });
    expect(cm.error).toBeNull();
    expect(await canRead(fx.userManager, logA)).toBe(true);
  });

  it("5. MANAGER não lê logs de cliente não atribuído", async () => {
    expect(await canRead(fx.userManager, logB)).toBe(false);
  });

  it("6. USER lê logs do cliente atribuído", async () => {
    expect(await canRead(fx.userA, logA)).toBe(true);
  });

  it("7. USER não lê logs de cliente não atribuído", async () => {
    expect(await canRead(fx.userA, logB)).toBe(false);
  });

  it("8. USER não acessa logs de outro workspace", async () => {
    expect(await canRead(fx.userB, logOtherWorkspace)).toBe(false);
  });

  it("9. client_id forjado (inexistente) não retorna nada", async () => {
    const forged = "00000000-0000-4000-8000-000000000009";
    const rows = await readScoped(fx.userA.client, fx.brandId, [forged]);
    expect(rows).toEqual([]);
  });

  it("10. brand_id forjado não amplia acesso", async () => {
    const rows = await readScoped(fx.userA.client, fx.otherBrandId, null);
    expect(rows).toEqual([]);
  });

  it("11. cliente inexistente é rejeitado no guard do banco", async () => {
    const ins = await fx.userOwner.client.from("message_logs").insert({
      brand_id: fx.brandId,
      client_id: "00000000-0000-4000-8000-00000000000b",
      channel: "resend",
      status: "sent",
    });
    expect(ins.error).not.toBeNull();
  });

  it("12. cliente órfão segue a regra canônica (admin sim, user não)", async () => {
    expect(await canRead(fx.userOwner, logOrphan)).toBe(true);
    expect(await canRead(fx.userA, logOrphan)).toBe(false);
    expect(await canRead(fx.userNoLink, logOrphan)).toBe(false);
  });

  it("13. PORTAL não ganha acesso adicional a message_logs", async () => {
    expect(await canRead(fx.userPortal, logA)).toBe(false);
    expect(await canRead(fx.userPortal, logNull)).toBe(false);
  });

  it("14. ANON não acessa a tabela diretamente", async () => {
    const anon = anonClient();
    const { data, error } = await anon.from("message_logs").select("id").limit(1);
    expect(error ? true : (data ?? []).length === 0).toBe(true);
  });

  it("15. par cross-workspace forjado (brand A + client B) é rejeitado", async () => {
    const ins = await fx.userOwner.client.from("message_logs").insert({
      brand_id: fx.brandId,
      client_id: fx.otherBrandClient,
      channel: "resend",
      status: "sent",
    });
    expect(ins.error).not.toBeNull();
  });

  it("16. registros com client_id NULL não vazam para MANAGER/USER", async () => {
    expect(await canRead(fx.userOwner, logNull)).toBe(true);
    expect(await canRead(fx.userManager, logNull)).toBe(false);
    expect(await canRead(fx.userA, logNull)).toBe(false);
    expect(await canRead(fx.userNoLink, logNull)).toBe(false);
  });
});

describe("FASE 10B — regressão de server function (escopo revalidado)", () => {
  it("USER do cliente A pedindo logs do cliente B recebe conjunto vazio", async () => {
    const scope = await scopedClientIds(fx.userA, fx.brandId);
    expect(scope).toEqual([fx.clientA]);
    // Mesmo forjando clientId=B, o escopo do servidor não contém B.
    const rows = await readScoped(
      fx.userA.client,
      fx.brandId,
      (scope ?? []).filter((id) => id === fx.clientB),
    );
    expect(rows).toEqual([]);
  });

  it("MANAGER atribuído somente ao cliente A não recebe nenhum log do cliente B", async () => {
    const scope = await scopedClientIds(fx.userManager, fx.brandId);
    expect(scope).toEqual([fx.clientA]);
    const rows = await readScoped(fx.userManager.client, fx.brandId, scope);
    expect(rows).toContain(logA);
    expect(rows).not.toContain(logB);
    expect(rows).not.toContain(logNull);
  });

  it("ADMIN vê todos os clientes do workspace, nunca de outro workspace", async () => {
    const scope = await scopedClientIds(fx.userOwner, fx.brandId);
    expect(scope).toBeNull();
    const rows = await readScoped(fx.userOwner.client, fx.brandId, null);
    expect(rows).toContain(logA);
    expect(rows).toContain(logB);
    expect(rows).not.toContain(logOtherWorkspace);
  });
});
