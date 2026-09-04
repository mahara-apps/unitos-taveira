import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Tipo de App Meta por instalação:
 * - nova instalação começa em `unitos` (App oficial em env);
 * - Super Admin pode passar para `client` (App próprio, segredo cifrado);
 * - voltar para `unitos` restaura o App oficial;
 * - a configuração é do singleton local: instalação A nunca muda a B;
 * - Admin comum não altera nada (assertSuperAdmin fail-closed).
 */

const ENV = ["META_APP_ID", "META_APP_SECRET", "META_BUSINESS_CONFIG_ID", "BRAND_CREDENTIALS_SECRET"] as const;
const saved: Record<string, string | undefined> = {};

type Row = Record<string, unknown> | null;
let row: Row = null;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: row }) }) }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          row = { ...(row ?? {}), ...patch };
          return { error: null };
        },
      }),
    }),
  },
}));

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.META_APP_ID = "official-app";
  process.env.META_APP_SECRET = "official-secret";
  process.env.META_BUSINESS_CONFIG_ID = "official-config";
  process.env.BRAND_CREDENTIALS_SECRET = "test-secret-for-credentials-crypto";
  row = null;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

async function load() {
  const mod = await import("@/lib/meta/app-config.server");
  mod.__resetMetaAppConfigCache();
  return mod;
}

describe("tipo de App Meta por instalação", () => {
  it("instalação nova usa Unitos — App Meta oficial por padrão", async () => {
    const m = await load();
    row = { app_type: "unitos" };
    expect(await m.getMetaAppType()).toBe("unitos");
    const creds = await m.resolveMetaAppCredentials();
    expect(creds).toMatchObject({
      appType: "unitos",
      appId: "official-app",
      appSecret: "official-secret",
      businessConfigId: "official-config",
    });
  });

  it("sem linha no banco também cai no padrão oficial (fail-safe)", async () => {
    const m = await load();
    row = null;
    expect(await m.getMetaAppType()).toBe("unitos");
    expect((await m.resolveMetaAppCredentials()).appId).toBe("official-app");
  });

  it("Super Admin muda para Cliente → usa o App do cliente", async () => {
    const m = await load();
    row = { app_type: "unitos" };
    await m.saveMetaAppSettings({
      appType: "client",
      appId: "client-app",
      appSecret: "client-secret",
      businessConfigId: "client-config",
      actorId: "00000000-0000-0000-0000-000000000001",
    });
    m.__resetMetaAppConfigCache();
    const creds = await m.resolveMetaAppCredentials();
    expect(creds).toMatchObject({
      appType: "client",
      appId: "client-app",
      appSecret: "client-secret",
      businessConfigId: "client-config",
    });
    expect(await m.resolveMetaBusinessConfigId()).toBe("client-config");
    // segredo nunca volta em claro para a UI
    const view = await m.getMetaAppSettings();
    expect(view.client.hasSecret).toBe(true);
    expect(JSON.stringify(view)).not.toContain("client-secret");
  });

  it("modo Cliente sem credenciais falha em vez de cair no App oficial", async () => {
    const m = await load();
    row = { app_type: "client" };
    await expect(m.resolveMetaAppCredentials()).rejects.toThrow(/App Meta próprio/i);
  });

  it("voltar para Unitos restaura o App oficial", async () => {
    const m = await load();
    row = { app_type: "client", app_id: "client-app", app_secret_ciphertext: "x" };
    await m.saveMetaAppSettings({
      appType: "unitos",
      actorId: "00000000-0000-0000-0000-000000000001",
    });
    m.__resetMetaAppConfigCache();
    const creds = await m.resolveMetaAppCredentials();
    expect(creds.appType).toBe("unitos");
    expect(creds.appId).toBe("official-app");
    expect(creds.businessConfigId).toBe("official-config");
  });

  it("a configuração é local: a instalação B continua oficial quando A vira Cliente", async () => {
    const m = await load();
    // Instalação A (este banco) vira Cliente.
    await m.saveMetaAppSettings({
      appType: "client",
      appId: "a-app",
      appSecret: "a-secret",
      actorId: "00000000-0000-0000-0000-000000000001",
    });
    m.__resetMetaAppConfigCache();
    expect((await m.resolveMetaAppCredentials()).appId).toBe("a-app");
    // Instalação B = outro banco (outra linha), mesmas env compartilhadas.
    row = { app_type: "unitos" };
    m.__resetMetaAppConfigCache();
    expect((await m.resolveMetaAppCredentials()).appId).toBe("official-app");
  });
});

describe("autoridade", () => {
  it("Admin comum não pode alterar o tipo (assertSuperAdmin fail-closed)", async () => {
    const { assertSuperAdmin } = await import("@/lib/super-admin");
    const client = { rpc: async () => ({ data: false, error: null }) } as never;
    await expect(assertSuperAdmin(client, "user-1")).rejects.toThrow(/super admin/i);
  });
});
