import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseInstallationPeers,
  isForwardedWebhook,
  forwardMetaWebhook,
  META_FORWARD_HEADER,
  META_WEBHOOK_PATH,
} from "@/lib/meta/installation.server";

const ENV_KEYS = [
  "META_APP_ID",
  "META_APP_SECRET",
  "META_STATE_SECRET",
  "META_REDIRECT_URI",
  "META_EXTRA_REDIRECT_HOSTS",
  "PUBLIC_APP_URL",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

/** Fresh module instance so env changes are picked up by module-level reads. */
async function loadProvider() {
  return await import("@/lib/meta/provider.server");
}

describe("OAuth redirect URI is derived per installation", () => {
  it("installation A returns callback A, installation B returns callback B", async () => {
    const { resolveMetaRedirectUri, META_CALLBACK_PATH } = await loadProvider();

    process.env.META_REDIRECT_URI = `https://a.agencia-a.com${META_CALLBACK_PATH}`;
    expect(resolveMetaRedirectUri("https://a.agencia-a.com")).toBe(
      `https://a.agencia-a.com${META_CALLBACK_PATH}`,
    );

    process.env.META_REDIRECT_URI = `https://b.agencia-b.com${META_CALLBACK_PATH}`;
    expect(resolveMetaRedirectUri("https://b.agencia-b.com")).toBe(
      `https://b.agencia-b.com${META_CALLBACK_PATH}`,
    );
  });

  it("never returns another installation's domain for an untrusted origin", async () => {
    const { resolveMetaRedirectUri, META_CALLBACK_PATH } = await loadProvider();
    process.env.META_REDIRECT_URI = `https://a.agencia-a.com${META_CALLBACK_PATH}`;
    delete process.env.META_EXTRA_REDIRECT_HOSTS;

    // An attacker-supplied origin cannot steer the redirect URI.
    expect(resolveMetaRedirectUri("https://evil.example.com")).toBe(
      `https://a.agencia-a.com${META_CALLBACK_PATH}`,
    );
    // Non-https is rejected too.
    expect(resolveMetaRedirectUri("http://a.agencia-a.com")).toBe(
      `https://a.agencia-a.com${META_CALLBACK_PATH}`,
    );
  });

  it("honours explicitly configured extra hosts (preview domains)", async () => {
    const { resolveMetaRedirectUri, META_CALLBACK_PATH } = await loadProvider();
    process.env.META_REDIRECT_URI = `https://a.agencia-a.com${META_CALLBACK_PATH}`;
    process.env.META_EXTRA_REDIRECT_HOSTS = "preview.agencia-a.com";
    expect(resolveMetaRedirectUri("https://preview.agencia-a.com")).toBe(
      `https://preview.agencia-a.com${META_CALLBACK_PATH}`,
    );
  });

  it("never derives the URI from an unregistered preview/hosting subdomain", async () => {
    const { resolveMetaRedirectUri, META_CALLBACK_PATH } = await loadProvider();
    process.env.META_REDIRECT_URI = `https://unitos-master.lovable.app${META_CALLBACK_PATH}`;
    delete process.env.META_EXTRA_REDIRECT_HOSTS;
    // The Meta App allow-list only contains the configured URI, so the preview
    // host must NOT be used (that produced "URL bloqueada").
    expect(resolveMetaRedirectUri("https://id-preview--abc123.lovable.app")).toBe(
      `https://unitos-master.lovable.app${META_CALLBACK_PATH}`,
    );
    // Subdomains of the configured host are not implicitly trusted either.
    expect(resolveMetaRedirectUri("https://sub.unitos-master.lovable.app")).toBe(
      `https://unitos-master.lovable.app${META_CALLBACK_PATH}`,
    );
  });
});


describe("OAuth state is isolated per installation even with a shared Meta App", () => {
  it("a state signed by installation A is rejected by installation B", async () => {
    const { signOAuthState, verifyOAuthState } = await loadProvider();

    // Both installations share the same Meta App credentials.
    process.env.META_APP_ID = "shared-app-id";
    process.env.META_APP_SECRET = "shared-app-secret";

    process.env.META_STATE_SECRET = "secret-instalacao-A";
    const stateA = await signOAuthState({
      brandId: "brand-a",
      userId: "user-a",
      redirectTo: "/connections",
      channel: "facebook",
    });
    expect((await verifyOAuthState(stateA)).brandId).toBe("brand-a");

    process.env.META_STATE_SECRET = "secret-instalacao-B";
    await expect(verifyOAuthState(stateA)).rejects.toThrow();
  });
});

describe("compliance URLs never point at another installation", () => {
  it("requires PUBLIC_APP_URL instead of falling back to a hardcoded domain", async () => {
    const { confirmationUrl } = await import("@/lib/meta/signed-request.server");
    delete process.env.PUBLIC_APP_URL;
    expect(() => confirmationUrl("del_1")).toThrow(/PUBLIC_APP_URL/);

    process.env.PUBLIC_APP_URL = "https://b.agencia-b.com/";
    expect(confirmationUrl("del_1")).toBe(
      "https://b.agencia-b.com/api/public/meta/deletion-status?code=del_1",
    );
  });
});

describe("webhook forward targets are infrastructure configuration only", () => {
  it("accepts only absolute https origins and drops self", () => {
    const peers = parseInstallationPeers(
      "https://b.agencia-b.com, https://c.agencia-c.com , https://a.agencia-a.com",
      "https://a.agencia-a.com",
    );
    expect(peers).toEqual(["https://b.agencia-b.com", "https://c.agencia-c.com"]);
  });

  it("rejects manipulable / unsafe destinations", () => {
    expect(
      parseInstallationPeers(
        "http://insecure.example.com, ftp://x.example.com, /relative, javascript:alert(1), https://user:pw@evil.example.com, not-a-url",
      ),
    ).toEqual([]);
  });

  it("returns no peers when unconfigured (forward is opt-in)", () => {
    expect(parseInstallationPeers(undefined)).toEqual([]);
    expect(parseInstallationPeers("")).toEqual([]);
  });

  it("deduplicates peers", () => {
    expect(
      parseInstallationPeers("https://b.agencia-b.com,https://b.agencia-b.com/webhook"),
    ).toEqual(["https://b.agencia-b.com"]);
  });
});

describe("webhook forward mechanics", () => {
  it("preserves raw body + signature, marks the copy and hits the canonical path", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const rawBody = JSON.stringify({ object: "page", entry: [{ id: "123" }] });
    const outcomes = await forwardMetaWebhook({
      rawBody,
      signature: "sha256=deadbeef",
      peers: ["https://b.agencia-b.com"],
      contentType: "application/json",
      fetchImpl: fakeFetch,
    });

    expect(outcomes).toEqual([{ target: "https://b.agencia-b.com", ok: true, status: 200 }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://b.agencia-b.com${META_WEBHOOK_PATH}`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(rawBody);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Hub-Signature-256"]).toBe("sha256=deadbeef");
    expect(headers[META_FORWARD_HEADER]).toBe("1");
    // No credentials of any kind are forwarded.
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("cookie");
  });

  it("contains peer failures so Meta still gets a 200", async () => {
    const fakeFetch = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    const outcomes = await forwardMetaWebhook({
      rawBody: "{}",
      signature: "sha256=x",
      peers: ["https://b.agencia-b.com"],
      fetchImpl: fakeFetch,
    });
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[0].error).toBe("timeout");
  });

  it("detects an already-forwarded request (no loops)", () => {
    expect(isForwardedWebhook(new Headers({ [META_FORWARD_HEADER]: "1" }))).toBe(true);
    expect(isForwardedWebhook(new Headers())).toBe(false);
    expect(isForwardedWebhook(new Headers({ [META_FORWARD_HEADER]: "0" }))).toBe(false);
  });
});
