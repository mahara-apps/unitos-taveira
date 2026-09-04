// Resiliência do envio via Resend: timeout, classificação de erro,
// retry/backoff apenas para erros recuperáveis e telemetria por tentativa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESEND_MAX_ATTEMPTS,
  RESEND_TIMEOUT_MS,
  classifyResendOutcome,
  resendBackoffMs,
  sendResendEmail,
  type ResendTelemetrySummary,
} from "@/lib/email/resend.server";

const config = {
  apiKey: "re_test_abcdef123456",
  from: "Unitos <contato@dominio.com>",
  source: "brand" as const,
  masked: "re_***456",
};
const msg = { to: "dest@dominio.com", subject: "Assunto", html: "<p>oi</p>" };

function run(fetchImpl: typeof fetch) {
  const logs: ResendTelemetrySummary[] = [];
  const sleeps: number[] = [];
  vi.stubGlobal("fetch", fetchImpl);
  return {
    logs,
    sleeps,
    result: sendResendEmail(config, msg, {
      sleep: async (ms) => void sleeps.push(ms),
      rand: () => 0.5,
      now: () => 1_000,
      idFactory: () => "test-id",
      logger: (s) => logs.push(s),
    }),
  };
}

const jsonRes = (status: number, body = "{}") =>
  new Response(status === 200 ? "" : body, { status });

beforeEach(() => {
  delete process.env.LOVABLE_API_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("classificação de erro", () => {
  it("marca 429/5xx/timeout/rede como recuperáveis", () => {
    expect(classifyResendOutcome({ kind: "http", status: 429, body: "" })).toBe("recoverable");
    expect(classifyResendOutcome({ kind: "http", status: 503, body: "" })).toBe("recoverable");
    expect(classifyResendOutcome({ kind: "timeout" })).toBe("recoverable");
    expect(classifyResendOutcome({ kind: "network" })).toBe("recoverable");
  });

  it("marca 400/401/403 como terminais", () => {
    expect(classifyResendOutcome({ kind: "http", status: 400, body: "" })).toBe("terminal");
    expect(classifyResendOutcome({ kind: "http", status: 401, body: "" })).toBe("terminal");
    expect(classifyResendOutcome({ kind: "http", status: 403, body: "" })).toBe("terminal");
  });

  it("backoff cresce com jitter limitado", () => {
    expect(resendBackoffMs(1, () => 0)).toBe(400);
    expect(resendBackoffMs(2, () => 0)).toBe(800);
    expect(resendBackoffMs(2, () => 1)).toBe(1200);
  });
});

describe("sendResendEmail", () => {
  it("sucesso na primeira tentativa não faz retry", async () => {
    const calls: RequestInit[] = [];
    const { result, logs, sleeps } = run((async (_u: string, init: RequestInit) => {
      calls.push(init);
      return jsonRes(200);
    }) as unknown as typeof fetch);
    await expect(result).resolves.toEqual({ sent: true, from: config.from });
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(logs[0]?.reason).toBe("sent");
    expect(logs[0]?.attempts).toBe(1);
    expect(logs[0]?.perAttempt[0]?.outcome).toBe("success");
  });

  it("aplica timeout de 15s via AbortController", async () => {
    let seenSignal: AbortSignal | undefined;
    const { result, logs } = run((async (_u: string, init: RequestInit) => {
      seenSignal = init.signal as AbortSignal;
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }) as unknown as typeof fetch);
    const r = await result;
    expect(RESEND_TIMEOUT_MS).toBe(15_000);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(r.sent).toBe(false);
    expect(r.error).toBe("timeout");
    expect(logs[0]?.timeouts).toBe(RESEND_MAX_ATTEMPTS);
    expect(logs[0]?.reason).toBe("retry_exhausted");
  });

  it("429 é recuperável: tenta 3 vezes com backoff e esgota", async () => {
    let n = 0;
    const { result, logs, sleeps } = run((async () => {
      n += 1;
      return jsonRes(429, '{"message":"rate limited"}');
    }) as unknown as typeof fetch);
    const r = await result;
    expect(n).toBe(RESEND_MAX_ATTEMPTS);
    expect(sleeps).toHaveLength(RESEND_MAX_ATTEMPTS - 1);
    expect(r.sent).toBe(false);
    expect(logs[0]?.rateLimits).toBe(3);
    expect(logs[0]?.retries).toBe(2);
    expect(logs[0]?.reason).toBe("retry_exhausted");
  });

  it("503 recupera quando a tentativa seguinte tem sucesso", async () => {
    let n = 0;
    const { result, logs, sleeps } = run((async () => {
      n += 1;
      return n === 1 ? jsonRes(503, "upstream") : jsonRes(200);
    }) as unknown as typeof fetch);
    await expect(result).resolves.toEqual({ sent: true, from: config.from });
    expect(n).toBe(2);
    expect(sleeps).toHaveLength(1);
    expect(logs[0]?.retries).toBe(1);
    expect(logs[0]?.reason).toBe("sent");
  });

  it("400 é terminal: uma única tentativa, sem backoff", async () => {
    let n = 0;
    const { result, logs, sleeps } = run((async () => {
      n += 1;
      return jsonRes(400, '{"message":"invalid from"}');
    }) as unknown as typeof fetch);
    const r = await result;
    expect(n).toBe(1);
    expect(sleeps).toEqual([]);
    expect(r.error).toContain("provider_400");
    expect(logs[0]?.reason).toBe("terminal");
  });

  it("401 é terminal e nunca expõe a API key", async () => {
    let n = 0;
    const { result, logs } = run((async () => {
      n += 1;
      return jsonRes(401, `{"message":"invalid key ${config.apiKey}"}`);
    }) as unknown as typeof fetch);
    const r = await result;
    expect(n).toBe(1);
    expect(r.error).toBe("credencial_invalida");
    expect(JSON.stringify(logs[0])).not.toContain(config.apiKey);
    expect(logs[0]?.reason).toBe("terminal");
  });

  it("exaustão de retry em falha de rede devolve erro sanitizado", async () => {
    let n = 0;
    const { result, logs } = run((async () => {
      n += 1;
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    const r = await result;
    expect(n).toBe(RESEND_MAX_ATTEMPTS);
    expect(r).toEqual({ sent: false, error: "network", from: config.from });
    expect(logs[0]?.reason).toBe("retry_exhausted");
    expect(logs[0]?.perAttempt).toHaveLength(RESEND_MAX_ATTEMPTS);
  });

  it("preserva o fallback gateway → API oficial em 401 do gateway", async () => {
    process.env.LOVABLE_API_KEY = "lovable-key";
    const cfg = { ...config, apiKey: "conn_key_123456" };
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      (async (u: string) => {
        urls.push(u);
        return urls.length === 1 ? jsonRes(401, "no connection") : jsonRes(200);
      }) as unknown as typeof fetch,
    );
    const logs: ResendTelemetrySummary[] = [];
    const r = await sendResendEmail(cfg, msg, {
      sleep: async () => {},
      logger: (s) => logs.push(s),
    });
    expect(r.sent).toBe(true);
    expect(urls[0]).toContain("connector-gateway.lovable.dev");
    expect(urls[1]).toContain("api.resend.com");
    expect(logs[0]?.retries).toBe(0);
    expect(logs[0]?.route).toBe("api");
  });
});
