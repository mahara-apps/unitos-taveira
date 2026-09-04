import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Separação Instalação × Workspace.
 *
 * Instalação (singleton `public.installation`): domínio canônico, branding
 * institucional e remetente de e-mail. Workspace (`brands`): todo o resto,
 * isolado por `brand_id`.
 *
 * Estes testes garantem que a resolução de URL nunca cai em env compartilhado
 * quando a instalação tem domínio próprio, e que a logo de login só é assinada
 * para paths estruturalmente válidos.
 */

const headers = new Map<string, string>();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: (name: string) => headers.get(name.toLowerCase()),
}));

let installationAppUrl: string | null = null;
const updates: Array<Record<string, string | null>> = [];

vi.mock("@/lib/installation-settings.server", () => ({
  getInstallationSettings: async () => ({
    appUrl: installationAppUrl,
    logoUrl: null,
    logoDarkUrl: null,
    iconUrl: null,
    loginLogoUrl: null,
    emailFrom: null,
    emailFromName: null,
  }),
  updateInstallationSettings: async (patch: Record<string, string | null>) => {
    updates.push(patch);
    if (typeof patch["app_url"] !== "undefined") installationAppUrl = patch["app_url"];
  },
}));

const ENV_KEYS = ["PUBLIC_APP_URL", "APP_PUBLIC_URL", "APP_URL"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  headers.clear();
  updates.length = 0;
  installationAppUrl = null;
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

describe("URL canônica: instalação antes do env compartilhado", () => {
  it("sem requisição, usa o domínio da própria instalação e ignora env de outra", async () => {
    process.env.PUBLIC_APP_URL = "https://instalacao-b.lovable.app";
    installationAppUrl = "https://instalacao-a.lovable.app";
    const { absoluteUrl } = await import("@/lib/app-url.server");
    expect(await absoluteUrl("/invite/tok")).toBe("https://instalacao-a.lovable.app/invite/tok");
  });

  it("host da requisição vence e é aprendido pela instalação", async () => {
    installationAppUrl = "https://antigo.lovable.app";
    headers.set("x-forwarded-host", "instalacao-a.lovable.app");
    headers.set("x-forwarded-proto", "https");
    const { getPublicAppUrl } = await import("@/lib/app-url.server");
    expect(await getPublicAppUrl()).toBe("https://instalacao-a.lovable.app");
    await new Promise((r) => setTimeout(r, 0));
    expect(updates.at(-1)).toEqual({ app_url: "https://instalacao-a.lovable.app" });
  });

  it("sem host, sem instalação e sem env, falha em vez de inventar domínio", async () => {
    const { getPublicAppUrl } = await import("@/lib/app-url.server");
    await expect(getPublicAppUrl()).rejects.toThrow("app_url_nao_configurada");
  });
});

describe("logo de login: path estruturalmente válido", () => {
  it("aceita apenas <uuid>/arquivo ou installation/arquivo", async () => {
    const { isSafeLoginLogoPath } = await import("@/lib/login-branding.functions");
    expect(isSafeLoginLogoPath("60fce5a7-1859-4bbd-a887-9018ed7f17b5/logo.png")).toBe(true);
    expect(isSafeLoginLogoPath("installation/logo.png")).toBe(true);
    expect(isSafeLoginLogoPath("outra-marca/logo.png")).toBe(false);
    expect(isSafeLoginLogoPath("installation/../secret.png")).toBe(false);
    expect(isSafeLoginLogoPath("")).toBe(false);
  });
});
