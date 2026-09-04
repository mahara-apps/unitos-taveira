// Resiliência do download multimodal: timeout 15s, classificação, retry
// apenas para rede/5xx/429 (máx 2 tentativas) e telemetria estruturada.
import { describe, expect, it, vi } from "vitest";
import {
  MULTIMODAL_MAX_ATTEMPTS,
  MULTIMODAL_DOWNLOAD_TIMEOUT_MS,
  classifyMultimodalOutcome,
  downloadAttachment,
  multimodalBackoffMs,
} from "@/lib/brain/chat-gateway/multimodal.server";

function run(fetchImpl: typeof fetch) {
  const logs: Record<string, unknown>[] = [];
  const sleeps: number[] = [];
  const lastFailure: { current?: unknown } = {};
  vi.stubGlobal("fetch", fetchImpl);
  return {
    logs,
    sleeps,
    lastFailure,
    result: downloadAttachment("https://x.test/file.pdf", "file.pdf", {
      sleep: async (ms) => void sleeps.push(ms),
      rand: () => 0,
      now: () => 1_000,
      logger: (l) => logs.push(l),
    }, lastFailure),
  };
}

const okRes = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });

describe("classificação de erro", () => {
  it("marca rede/timeout/429/5xx como recuperáveis", () => {
    expect(classifyMultimodalOutcome({ kind: "network" })).toBe("recoverable");
    expect(classifyMultimodalOutcome({ kind: "timeout" })).toBe("recoverable");
    expect(classifyMultimodalOutcome({ kind: "http", status: 429 })).toBe("recoverable");
    expect(classifyMultimodalOutcome({ kind: "http", status: 503 })).toBe("recoverable");
  });

  it("marca 400/401/403/404 como terminais", () => {
    for (const status of [400, 401, 403, 404]) {
      expect(classifyMultimodalOutcome({ kind: "http", status })).toBe("terminal");
    }
  });
});

describe("downloadAttachment", () => {
  it("sucesso retorna bytes sem retry nem log", async () => {
    const fetches = vi.fn(async () => okRes());
    const { result, logs, sleeps } = run(fetches as unknown as typeof fetch);
    const bytes = await result;
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetches).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(0);
    expect(sleeps).toHaveLength(0);
  });

  it("429 tenta novamente e registra telemetria por tentativa", async () => {
    const fetches = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(okRes());
    const { result, logs, sleeps } = run(fetches as unknown as typeof fetch);
    const bytes = await result;
    expect(bytes).not.toBeNull();
    expect(fetches).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([multimodalBackoffMs(1, () => 0)]);
    expect(logs[0]).toMatchObject({ reason: "http", status: 429, classification: "recoverable", attempts: 1 });
  });

  it("503 recupera na segunda tentativa", async () => {
    const fetches = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(okRes());
    const { result } = run(fetches as unknown as typeof fetch);
    expect(await result).not.toBeNull();
    expect(fetches).toHaveBeenCalledTimes(2);
  });

  it("timeout (abort) é recuperável e retentado", async () => {
    const fetches = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
      .mockResolvedValueOnce(okRes());
    const { result, logs } = run(fetches as unknown as typeof fetch);
    expect(await result).not.toBeNull();
    expect(logs[0]).toMatchObject({ reason: "timeout", classification: "recoverable" });
  });

  it("400 é terminal: sem retry e retorna null com telemetria", async () => {
    const fetches = vi.fn(async () => new Response("", { status: 400 }));
    const { result, logs, lastFailure, sleeps } = run(fetches as unknown as typeof fetch);
    expect(await result).toBeNull();
    expect(fetches).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
    expect(logs[0]).toMatchObject({ reason: "http", status: 400, classification: "terminal" });
    expect(lastFailure.current).toMatchObject({ reason: "http", status: 400 });
  });

  it("exaustão: 429 duas vezes retorna null após 2 tentativas", async () => {
    const fetches = vi.fn(async () => new Response("", { status: 429 }));
    const { result, logs, sleeps } = run(fetches as unknown as typeof fetch);
    expect(await result).toBeNull();
    expect(fetches).toHaveBeenCalledTimes(MULTIMODAL_MAX_ATTEMPTS);
    expect(sleeps).toHaveLength(MULTIMODAL_MAX_ATTEMPTS - 1);
    expect(logs).toHaveLength(2);
    expect(logs[1]).toMatchObject({ attempts: 2, classification: "recoverable" });
  });

  it("arquivo acima de 20MB é rejeitado com telemetria, sem retry", async () => {
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    const fetches = vi.fn(async () => new Response(big, { status: 200 }));
    const { result, logs, lastFailure } = run(fetches as unknown as typeof fetch);
    expect(await result).toBeNull();
    expect(fetches).toHaveBeenCalledTimes(1);
    expect(logs[0]).toMatchObject({ reason: "too_large" });
    expect(lastFailure.current).toMatchObject({ reason: "too_large" });
  });
});

describe("constantes", () => {
  it("timeout de 15s e máximo de 2 tentativas", () => {
    expect(MULTIMODAL_DOWNLOAD_TIMEOUT_MS).toBe(15_000);
    expect(MULTIMODAL_MAX_ATTEMPTS).toBe(2);
  });
});
