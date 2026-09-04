import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Isolamento por instalação: o link SEMPRE vem do host da requisição atual.
 * O env (`PUBLIC_APP_URL`/`APP_URL`) só vale quando não há requisição, e nunca
 * pode sobrepor o host real — foi essa precedência invertida que fazia convites
 * da instalação A apontarem para a instalação B.
 */

const headers = new Map<string, string>();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => headers.get(name.toLowerCase()),
}));

// A instalação (singleton) é mockada: este teste cobre requisição × env, e
// nunca deve escrever/ler o banco real.
vi.mock("@/lib/installation-settings.server", () => ({
  getInstallationSettings: async () => ({
    appUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    iconUrl: null,
    loginLogoUrl: null,
    emailFrom: null,
    emailFromName: null,
  }),
  updateInstallationSettings: async () => {},
}));

const ENV_KEYS = ["PUBLIC_APP_URL", "APP_PUBLIC_URL", "APP_URL"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  headers.clear();
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function load() {
  return await import("@/lib/app-url.server");
}

describe("app-url por instalação", () => {
  it("host da requisição vence env de outra instalação", async () => {
    process.env.PUBLIC_APP_URL = "https://instalacao-b.lovable.app";
    headers.set("x-forwarded-host", "instalacao-a.lovable.app");
    headers.set("x-forwarded-proto", "https");

    const { absoluteUrl } = await load();
    expect(await absoluteUrl("/invite/tok")).toBe("https://instalacao-a.lovable.app/invite/tok");
  });

  it("sem requisição, usa o env configurado da instalação", async () => {
    process.env.APP_URL = "instalacao-c.lovable.app";
    const { absoluteUrl } = await load();
    expect(await absoluteUrl("/invite/tok")).toBe("https://instalacao-c.lovable.app/invite/tok");
  });

  it("sem host e sem env, falha em vez de inventar domínio", async () => {
    const { getPublicAppUrl, tryAbsoluteUrl } = await load();
    await expect(getPublicAppUrl()).rejects.toThrow("app_url_nao_configurada");
    expect(await tryAbsoluteUrl("/invite/tok")).toBeNull();
  });
});
