// Canal de e-mail (Resend): garante que o estado exibido na UI e o estado
// usado pelo envio real venham do MESMO resolvedor, cobrindo credencial da
// marca, ausência de credencial, credencial inválida e isolamento por
// workspace.
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.BRAND_CREDENTIALS_SECRET ??= "test-secret-para-cifra-de-credenciais";

const BRAND_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";

type Row = { ciphertext: string; masked: string; metadata: Record<string, string> } | null;

/** Fake Supabase com RLS simulada: só a marca dona vê a própria linha. */
function makeSupabase(rows: Record<string, Row>) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_c1: string, brandId: string) => ({
          eq: (_c2: string, _provider: string) => ({
            maybeSingle: async () => ({ data: rows[brandId] ?? null }),
          }),
        }),
      }),
    }),
  } as never;
}

async function mod() {
  return import("@/lib/email/resend.server");
}

describe("resolveResendConfig", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.INVITE_FROM_EMAIL;
    vi.restoreAllMocks();
  });

  it("usa a credencial cifrada da marca e o remetente configurado", async () => {
    const { encryptCredential, maskCredential } = await import("@/lib/credentials-crypto.server");
    const { resolveResendConfig, resolveResendStatus } = await mod();
    const key = "re_test_abcdef123456";
    const supabase = makeSupabase({
      [BRAND_A]: {
        ciphertext: await encryptCredential(key),
        masked: maskCredential(key),
        metadata: { handle: "contato@dominio.com" },
      },
    });

    const cfg = await resolveResendConfig(supabase, BRAND_A);
    expect(cfg?.apiKey).toBe(key);
    expect(cfg?.source).toBe("brand");
    expect(cfg?.from).toBe("Unitos <contato@dominio.com>");

    const status = await resolveResendStatus(supabase, BRAND_A);
    expect(status.configured).toBe(true);
    // Remetente exibido == remetente usado no envio.
    expect(status.from).toBe(cfg?.from);
    expect(status.masked).not.toContain(key);
  });

  it("workspace A não pode usar credencial do workspace B", async () => {
    const { encryptCredential, maskCredential } = await import("@/lib/credentials-crypto.server");
    const { resolveResendConfig } = await mod();
    const key = "re_only_for_brand_a";
    const supabase = makeSupabase({
      [BRAND_A]: {
        ciphertext: await encryptCredential(key),
        masked: maskCredential(key),
        metadata: { handle: "a@dominio.com" },
      },
    });
    expect(await resolveResendConfig(supabase, BRAND_B)).toBeNull();
  });

  it("sem credencial da marca e sem credencial de instalação → não configurado", async () => {
    const { resolveResendStatus, sendBrandEmail } = await mod();
    const supabase = makeSupabase({});
    const status = await resolveResendStatus(supabase, BRAND_A);
    expect(status).toMatchObject({ configured: false, reason: "resend_nao_configurado" });
    const send = await sendBrandEmail(supabase, BRAND_A, {
      to: "x@y.com",
      subject: "s",
      html: "h",
    });
    expect(send).toMatchObject({ sent: false, error: "resend_nao_configurado" });
  });

  it("cai para a credencial da instalação quando a marca não tem a própria", async () => {
    process.env.RESEND_API_KEY = "re_installation_key";
    process.env.INVITE_FROM_EMAIL = "Unitos <sistema@dominio.com>";
    const { resolveResendConfig } = await mod();
    const cfg = await resolveResendConfig(makeSupabase({}), BRAND_A);
    expect(cfg?.source).toBe("installation");
    expect(cfg?.from).toBe("Unitos <sistema@dominio.com>");
  });
});

describe("invariante UI ↔ envio", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    vi.restoreAllMocks();
  });

  it("status configurado ⇒ envio nunca retorna resend_nao_configurado", async () => {
    const { encryptCredential, maskCredential } = await import("@/lib/credentials-crypto.server");
    const { resolveResendStatus, sendBrandEmail } = await mod();
    const key = "re_valid_key_000111";
    const supabase = makeSupabase({
      [BRAND_A]: {
        ciphertext: await encryptCredential(key),
        masked: maskCredential(key),
        metadata: { handle: "contato@dominio.com" },
      },
    });

    const captured: { from?: string; auth?: string } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { headers: Record<string, string>; body: string }) => {
        captured.from = JSON.parse(init.body).from;
        captured.auth = init.headers["Authorization"];
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      }),
    );

    const status = await resolveResendStatus(supabase, BRAND_A);
    const send = await sendBrandEmail(supabase, BRAND_A, {
      to: "x@y.com",
      subject: "Teste",
      html: "<p>ok</p>",
    });

    expect(status.configured).toBe(true);
    expect(send.sent).toBe(true);
    expect(send.error).toBeUndefined();
    expect(captured.from).toBe(status.from);
  });

  it("credencial inválida → erro sanitizado, sem expor a chave", async () => {
    const { encryptCredential, maskCredential } = await import("@/lib/credentials-crypto.server");
    const { sendBrandEmail } = await mod();
    const key = "re_invalid_key_999";
    const supabase = makeSupabase({
      [BRAND_A]: {
        ciphertext: await encryptCredential(key),
        masked: maskCredential(key),
        metadata: { handle: "contato@dominio.com" },
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: "validation_error", message: `API key ${key}` }), {
            status: 401,
          }),
      ),
    );
    const res = await sendBrandEmail(supabase, BRAND_A, {
      to: "x@y.com",
      subject: "s",
      html: "h",
    });
    expect(res.sent).toBe(false);
    expect(res.error).toBe("credencial_invalida");
    expect(JSON.stringify(res)).not.toContain(key);
  });
});

describe("sanitizeProviderError", () => {
  it("remove chaves e limita o tamanho", async () => {
    const { sanitizeProviderError } = await mod();
    const out = sanitizeProviderError(
      422,
      JSON.stringify({ message: "invalid from; key re_abc123456789 used" }),
    );
    expect(out).toContain("provider_422");
    expect(out).not.toContain("re_abc123456789");
    expect(out).toContain("[redacted]");
  });

  it("401/403 viram credencial_invalida", async () => {
    const { sanitizeProviderError } = await mod();
    expect(sanitizeProviderError(401, "unauthorized")).toBe("credencial_invalida");
    expect(sanitizeProviderError(403, "forbidden")).toBe("credencial_invalida");
  });
});

describe("sendResendEmail — roteamento de chave", () => {
  const msg = { to: "a@b.com", subject: "oi", html: "<p>oi</p>" };

  it("chave re_ vai direto ao Resend mesmo com LOVABLE_API_KEY presente", async () => {
    process.env.LOVABLE_API_KEY = "lov_test";
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { sendResendEmail } = await import("@/lib/email/resend.server");
    const out = await sendResendEmail(
      { apiKey: "re_abc123456", from: "Unitos <a@b.com>", source: "brand", masked: null },
      msg,
    );
    expect(out.sent).toBe(true);
    expect(calls).toEqual(["https://api.resend.com/emails"]);
    vi.unstubAllGlobals();
  });

  it("connection key usa gateway e cai para o Resend em 401", async () => {
    process.env.LOVABLE_API_KEY = "lov_test";
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes("connector-gateway")
        ? new Response("unauthorized", { status: 401 })
        : new Response(JSON.stringify({ id: "1" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { sendResendEmail } = await import("@/lib/email/resend.server");
    const out = await sendResendEmail(
      { apiKey: "conn_abc123", from: "Unitos <a@b.com>", source: "brand", masked: null },
      msg,
    );
    expect(out.sent).toBe(true);
    expect(calls[0]).toContain("connector-gateway");
    expect(calls[1]).toBe("https://api.resend.com/emails");
    vi.unstubAllGlobals();
  });
});
