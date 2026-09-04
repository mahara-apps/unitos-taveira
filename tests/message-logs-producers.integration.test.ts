/**
 * FASE 10C.2 — produtores de `public.message_logs`.
 *
 * Valida o ponto único de escrita (`logMessage`): escopo declarado
 * explicitamente, `client_id` sempre determinado/validado no servidor,
 * rejeição de pares inconsistentes e integridade em fluxo service_role.
 *
 * Nenhum registro histórico é tocado — só linhas criadas e removidas aqui.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, cleanup, seed, testTag, type Fixture } from "./helpers/fixtures";
import { logMessage } from "../src/lib/messaging-log.server";

let fx: Fixture;
const created: string[] = [];
const FORGED = "00000000-0000-4000-8000-0000000010c2";

const base = { channel: "resend", status: "sent", metadata: { tag: testTag } };

async function row(id: string) {
  const { data, error } = await admin
    .from("message_logs")
    .select("id, brand_id, client_id")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; brand_id: string; client_id: string | null };
}

beforeAll(async () => {
  fx = await seed();
}, 120_000);

afterAll(async () => {
  if (created.length) await admin.from("message_logs").delete().in("id", created);
  await cleanup(fx);
}, 120_000);

describe("FASE 10C.2 — logMessage: escopo client-level", () => {
  it("1. grava o client_id correto quando o fluxo é client-level", async () => {
    const id = await logMessage(
      fx.userOwner.client,
      { kind: "user", userId: fx.userOwner.id },
      { scope: "client", brandId: fx.brandId, clientId: fx.clientA },
      base,
    );
    created.push(id);
    const r = await row(id);
    expect(r.client_id).toBe(fx.clientA);
    expect(r.brand_id).toBe(fx.brandId);
  });

  it("2. client-level nunca grava NULL silenciosamente (sem clientId → erro)", async () => {
    await expect(
      logMessage(
        fx.userOwner.client,
        { kind: "user", userId: fx.userOwner.id },
        { scope: "client", brandId: fx.brandId, clientId: "" },
        base,
      ),
    ).rejects.toThrow();
  });

  it("3. client_id inexistente é rejeitado", async () => {
    await expect(
      logMessage(
        fx.userOwner.client,
        { kind: "user", userId: fx.userOwner.id },
        { scope: "client", brandId: fx.brandId, clientId: FORGED },
        base,
      ),
    ).rejects.toThrow();
  });

  it("4. client_id de outro workspace é rejeitado", async () => {
    await expect(
      logMessage(
        fx.userOwner.client,
        { kind: "user", userId: fx.userOwner.id },
        { scope: "client", brandId: fx.brandId, clientId: fx.otherBrandClient },
        base,
      ),
    ).rejects.toThrow();
  });

  it("5. par brand_id/client_id inconsistente é rejeitado", async () => {
    await expect(
      logMessage(
        fx.userOwner.client,
        { kind: "user", userId: fx.userOwner.id },
        { scope: "client", brandId: fx.otherBrandId, clientId: fx.clientA },
        base,
      ),
    ).rejects.toThrow();
  });

  it("6. USER não pode forjar cliente da mesma marca fora do seu escopo", async () => {
    await expect(
      logMessage(
        fx.userA.client,
        { kind: "user", userId: fx.userA.id },
        { scope: "client", brandId: fx.brandId, clientId: fx.clientB },
        base,
      ),
    ).rejects.toThrow();
  });

  it("7. USER grava normalmente no cliente atribuído", async () => {
    const id = await logMessage(
      fx.userA.client,
      { kind: "user", userId: fx.userA.id },
      { scope: "client", brandId: fx.brandId, clientId: fx.clientA },
      base,
    );
    created.push(id);
    expect((await row(id)).client_id).toBe(fx.clientA);
  });

  it("8. usuário fora do workspace é rejeitado (brandId do frontend não autoriza)", async () => {
    await expect(
      logMessage(
        fx.userA.client,
        { kind: "user", userId: fx.userA.id },
        { scope: "client", brandId: fx.otherBrandId, clientId: fx.otherBrandClient },
        base,
      ),
    ).rejects.toThrow();
  });
});

describe("FASE 10C.2 — logMessage: escopo workspace-level", () => {
  it("9. workspace-level continua gravando client_id NULL", async () => {
    const id = await logMessage(
      fx.userOwner.client,
      { kind: "user", userId: fx.userOwner.id },
      { scope: "workspace", brandId: fx.brandId },
      base,
    );
    created.push(id);
    const r = await row(id);
    expect(r.client_id).toBeNull();
    expect(r.brand_id).toBe(fx.brandId);
  });

  it("10. workspace-level em marca alheia é rejeitado", async () => {
    await expect(
      logMessage(
        fx.userA.client,
        { kind: "user", userId: fx.userA.id },
        { scope: "workspace", brandId: fx.otherBrandId },
        base,
      ),
    ).rejects.toThrow();
  });
});

describe("FASE 10C.2 — logMessage: worker/service_role", () => {
  it("11. service_role grava client-level válido preservando a relação brand→client", async () => {
    const id = await logMessage(
      admin,
      { kind: "service_role" },
      { scope: "client", brandId: fx.brandId, clientId: fx.clientB },
      base,
    );
    created.push(id);
    const r = await row(id);
    expect(r.client_id).toBe(fx.clientB);
    expect(r.brand_id).toBe(fx.brandId);
  });

  it("12. service_role rejeita par cross-workspace antes de gravar", async () => {
    await expect(
      logMessage(
        admin,
        { kind: "service_role" },
        { scope: "client", brandId: fx.brandId, clientId: fx.otherBrandClient },
        base,
      ),
    ).rejects.toThrow(/inconsistente/);
  });

  it("13. service_role rejeita cliente inexistente", async () => {
    await expect(
      logMessage(
        admin,
        { kind: "service_role" },
        { scope: "client", brandId: fx.brandId, clientId: FORGED },
        base,
      ),
    ).rejects.toThrow(/inexistente/);
  });

  it("14. service_role workspace-level grava NULL sem inferir cliente", async () => {
    const id = await logMessage(
      admin,
      { kind: "service_role" },
      { scope: "workspace", brandId: fx.brandId },
      base,
    );
    created.push(id);
    expect((await row(id)).client_id).toBeNull();
  });
});

describe("FASE 10C.2 — registros históricos intactos", () => {
  it("15. nenhuma linha legada com client_id NULL foi alterada por esta fase", async () => {
    const { count, error } = await admin
      .from("message_logs")
      .select("id", { count: "exact", head: true })
      .is("client_id", null)
      .not("brand_id", "in", `(${fx.brandId},${fx.otherBrandId})`);
    expect(error).toBeNull();
    expect(count ?? 0).toBeGreaterThanOrEqual(20);
  });
});
