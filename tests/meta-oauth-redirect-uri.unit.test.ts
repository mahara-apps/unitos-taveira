import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * O `redirect_uri` do OAuth Meta é DETERMINÍSTICO: sai de `META_REDIRECT_URI`.
 * Nenhum host de requisição (preview, projeto antigo, domínio de terceiro)
 * pode sobrepô-lo — foi exatamente isso que fez a autorização de produção
 * apontar para o callback de outro projeto Lovable.
 */

const ENV = ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "META_EXTRA_REDIRECT_HOSTS"] as const;
const saved: Record<string, string | undefined> = {};

const CANONICAL = "https://unitos-master.lovable.app/api/public/meta/callback";

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.META_APP_ID = "app-id";
  process.env.META_APP_SECRET = "app-secret";
  process.env.META_REDIRECT_URI = CANONICAL;
  delete process.env.META_EXTRA_REDIRECT_HOSTS;
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

describe("redirect_uri do OAuth Meta", () => {
  it("ignora hosts de preview e de outros projetos Lovable", async () => {
    const { resolveMetaRedirectUri } = await import("@/lib/meta/provider.server");
    for (const origin of [
      "https://origin-blossom-kit.lovable.app",
      "https://id-preview--3f33732a-cb8b-43ae-84fb-01d9e367fb0c.lovable.app",
      "https://unitos-master.lovable.app.evil.com",
      "http://unitos-master.lovable.app",
      "http://localhost:8080",
      "lixo",
    ]) {
      expect(resolveMetaRedirectUri(origin)).toBe(CANONICAL);
    }
    expect(resolveMetaRedirectUri(null)).toBe(CANONICAL);
  });

  it("a URL de autorização enviada ao Meta usa exatamente o callback canônico", async () => {
    const { MetaProvider } = await import("@/lib/meta/provider.server");
    const provider = new MetaProvider({ origin: "https://origin-blossom-kit.lovable.app" });
    const authorize = new URL(await provider.buildAuthorizeUrl({ state: "s" }));
    expect(authorize.searchParams.get("redirect_uri")).toBe(CANONICAL);
    expect(authorize.toString()).not.toContain("origin-blossom-kit");
  });

  it("nenhum host de projeto antigo aparece no código-fonte", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync("rg -l origin-blossom-kit src || true", { encoding: "utf8" }).trim();
    expect(hits).toBe("");
  });
});
