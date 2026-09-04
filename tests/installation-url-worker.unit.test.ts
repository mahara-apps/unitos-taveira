import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Isolamento de URL em disparos ASSÍNCRONOS (cron/jobs/workers).
 *
 * O mesmo processo atende as instalações A e B. Sem requisição HTTP, a URL só
 * pode vir de `brands.app_url` do workspace que originou o evento — nunca de
 * `PUBLIC_APP_URL` (aqui apontando de propósito para uma terceira instalação).
 */

// Worker: nenhuma requisição em curso.
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
}));

// Sem requisição não há persistência; o mock evita tocar no client de serviço.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  },
}));

const BRAND_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";
const BRAND_SEM_URL = "33333333-3333-4333-8333-333333333333";

const BRANDS: Record<string, { name: string; app_url: string | null }> = {
  [BRAND_A]: { name: "Agência A", app_url: "https://instalacao-a.lovable.app" },
  [BRAND_B]: { name: "Agência B", app_url: "https://instalacao-b.lovable.app" },
  [BRAND_SEM_URL]: { name: "Agência C", app_url: null },
};

/** Supabase mínimo: só o que o resolvedor de contexto realmente consulta. */
function fakeSupabase() {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let brandId: string | null = null;
      const api = {
        select: () => api,
        eq: (col: string, value: string) => {
          if (table === "brands" && col === "id") brandId = value;
          return api;
        },
        is: () => api,
        order: () => api,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          if (table === "brands" && brandId) {
            const row = BRANDS[brandId];
            return { data: row ? { id: brandId, ...row, nome_fantasia: null } : null, error: null };
          }
          return { data: null, error: null };
        },
      };
      Object.assign(builder, api);
      return api;
    },
  };
}

let savedEnv: string | undefined;

beforeEach(async () => {
  savedEnv = process.env.PUBLIC_APP_URL;
  // Instalação "terceira": jamais pode aparecer em nenhum link.
  process.env.PUBLIC_APP_URL = "https://instalacao-global.lovable.app";
  vi.resetModules();
  const mod = await import("@/lib/installation-url.server");
  mod.__resetInstallationUrlMemo();
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL = savedEnv;
});

async function inviteUrlFor(brandId: string): Promise<string | undefined> {
  const { resolveEventContext } = await import("@/lib/message-templates/context.server");
  const ctx = await resolveEventContext(fakeSupabase() as never, {
    brandId,
    invite: { token: `tok-${brandId.slice(0, 4)}`, role: "user" },
  });
  return ctx["invite.url"];
}

describe("URL por instalação em worker/cron", () => {
  it("mesmo worker: instalação A recebe URL A e B recebe URL B", async () => {
    const a = await inviteUrlFor(BRAND_A);
    const b = await inviteUrlFor(BRAND_B);

    expect(a).toBe("https://instalacao-a.lovable.app/invite/tok-1111");
    expect(b).toBe("https://instalacao-b.lovable.app/invite/tok-2222");
    // Nenhuma cruza para a outra instalação nem para o env global.
    expect(a).not.toContain("instalacao-b");
    expect(b).not.toContain("instalacao-a");
    expect(`${a} ${b}`).not.toContain("instalacao-global");
  });

  it("ordem invertida no mesmo processo não vaza a URL aprendida antes", async () => {
    const b = await inviteUrlFor(BRAND_B);
    const a = await inviteUrlFor(BRAND_A);
    expect(b).toContain("instalacao-b.lovable.app");
    expect(a).toContain("instalacao-a.lovable.app");
  });

  it("workspace sem URL de instalação não gera link (nem usa PUBLIC_APP_URL)", async () => {
    expect(await inviteUrlFor(BRAND_SEM_URL)).toBeUndefined();
  });

  it("resolveInstallationUrl falha explicitamente quando a instalação é desconhecida", async () => {
    const { resolveInstallationUrl, InstallationUrlUnknownError } = await import(
      "@/lib/installation-url.server"
    );
    await expect(resolveInstallationUrl(fakeSupabase() as never, BRAND_SEM_URL)).rejects.toBeInstanceOf(
      InstallationUrlUnknownError,
    );
  });

  it("portal.url também respeita a instalação do workspace", async () => {
    const { resolveEventContext } = await import("@/lib/message-templates/context.server");
    const ctx = await resolveEventContext(fakeSupabase() as never, {
      brandId: BRAND_B,
      portal: { token: "ptok" },
    });
    expect(ctx["portal.url"]).toBe("https://instalacao-b.lovable.app/portal/ptok");
  });
});
