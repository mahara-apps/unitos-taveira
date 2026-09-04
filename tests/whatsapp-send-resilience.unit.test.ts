/**
 * Resiliência do canal WhatsApp/Evolution:
 * budget por operação, teto de destinatários, retry apenas para falhas
 * recuperáveis, tratamento de 429/5xx/timeout, cooldown persistente e
 * telemetria por tentativa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  backoffDelayMs,
  classifyWhatsappFailure,
  cooldownKey,
  cooldownRemainingMs,
  createDispatchBudget,
  isInCooldown,
  isRecoverableWhatsappFailure,
  logWhatsappAttempt,
  MAX_RECIPIENTS_PER_BATCH,
  MAX_REQUESTS_PER_DISPATCH,
  resetCooldowns,
  splitBatch,
  startCooldown,
} from "@/lib/whatsapp/budget";
import { EvolutionApiError, evolutionRequest } from "@/lib/evolution/client.server";

const config = { baseUrl: "https://evo.example.com", apiKey: "secret-key" } as never;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function send(options: Parameters<typeof evolutionRequest>[1] = { path: "/x" }) {
  return evolutionRequest(config, { method: "POST", attempts: 3, ...options });
}

describe("budget e teto de lote", () => {
  it("lote pequeno passa inteiro, sem overflow", () => {
    const list = Array.from({ length: 5 }, (_, i) => i);
    const { accepted, overflow } = splitBatch(list);
    expect(accepted).toHaveLength(5);
    expect(overflow).toHaveLength(0);
  });

  it("lote acima do limite corta no teto e devolve o excedente", () => {
    const list = Array.from({ length: MAX_RECIPIENTS_PER_BATCH + 7 }, (_, i) => i);
    const { accepted, overflow } = splitBatch(list);
    expect(accepted).toHaveLength(MAX_RECIPIENTS_PER_BATCH);
    expect(overflow).toHaveLength(7);
  });

  it("budget da operação para exatamente no teto", () => {
    const budget = createDispatchBudget(3);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, true]);
    expect(budget.take()).toBe(false);
    expect(budget.used()).toBe(3);
    expect(budget.remaining()).toBe(0);
  });

  it("budget padrão é o limite documentado", () => {
    expect(createDispatchBudget().limit).toBe(MAX_REQUESTS_PER_DISPATCH);
  });
});

describe("classificação de falhas", () => {
  it("reconhece recuperáveis e terminais", () => {
    expect(classifyWhatsappFailure({ code: "rate_limited", status: 429 })).toBe("rate_limited");
    expect(classifyWhatsappFailure({ code: "timeout" })).toBe("timeout");
    expect(classifyWhatsappFailure({ code: "network_error" })).toBe("network");
    expect(classifyWhatsappFailure({ status: 503 })).toBe("provider_error");
    expect(classifyWhatsappFailure({ code: "unauthorized", status: 401 })).toBe("terminal");
    expect(classifyWhatsappFailure({ code: "not_found", status: 404 })).toBe("terminal");
    expect(isRecoverableWhatsappFailure({ status: 500 })).toBe(true);
    expect(isRecoverableWhatsappFailure({ status: 403 })).toBe(false);
  });

  it("backoff cresce com jitter e tem teto", () => {
    expect(backoffDelayMs(1, () => 0)).toBe(250);
    expect(backoffDelayMs(2, () => 0)).toBe(500);
    expect(backoffDelayMs(20, () => 0)).toBe(4_000);
    expect(backoffDelayMs(1, () => 1)).toBe(500);
  });
});

describe("cooldown persistente", () => {
  beforeEach(() => resetCooldowns());

  it("abre janela e expira", () => {
    const key = cooldownKey("brand-1", "inst-1");
    startCooldown(key, 1_000, 0);
    expect(isInCooldown(key, 500)).toBe(true);
    expect(cooldownRemainingMs(key, 500)).toBe(500);
    expect(isInCooldown(key, 1_500)).toBe(false);
  });

  it("mantém o prazo mais longo e isola instâncias", () => {
    const a = cooldownKey("brand-1", "inst-1");
    const b = cooldownKey("brand-1", "inst-2");
    startCooldown(a, 5_000, 0);
    startCooldown(a, 1_000, 0);
    expect(cooldownRemainingMs(a, 0)).toBe(5_000);
    expect(isInCooldown(b, 0)).toBe(false);
  });
});

describe("evolutionRequest: 429 / 5xx / timeout", () => {
  beforeEach(() => {
    resetCooldowns();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("sucesso não gera retry e loga a tentativa", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { key: { id: "msg-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const info = vi.spyOn(console, "info");
    const res = await send({ path: "/message/sendText/inst", operation: "sendText" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain("outcome=ok");
  });

  it("429 tenta novamente e abre cooldown na chave informada", async () => {
    const key = cooldownKey("brand-1", "inst-1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: "slow down" }))
      .mockResolvedValueOnce(jsonResponse(200, { key: { id: "msg-2" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await send({ path: "/message/sendText/inst", cooldownKey: key });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(isInCooldown(key)).toBe(true);
  });

  it("durante o cooldown nenhuma request é feita", async () => {
    const key = cooldownKey("brand-1", "inst-9");
    startCooldown(key, 30_000);
    const fetchMock = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await expect(send({ path: "/message/sendText/inst", cooldownKey: key })).rejects.toBeInstanceOf(
      EvolutionApiError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("5xx é recuperável e recupera na tentativa seguinte", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { message: "unavailable" }))
      .mockResolvedValueOnce(jsonResponse(200, { key: { id: "msg-3" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await send({ path: "/message/sendText/inst" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("timeout (abort) é classificado e tentado novamente", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abort)
      .mockResolvedValueOnce(jsonResponse(200, { key: { id: "msg-4" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await send({ path: "/message/sendText/inst" });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("erro terminal (401) não gera retry", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { message: "nope" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(send({ path: "/message/sendText/inst" })).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("budget esgotado impede a chamada (sucesso parcial do lote)", async () => {
    const budget = createDispatchBudget(1);
    const fetchMock = vi.fn(async () => jsonResponse(200, { key: { id: "ok" } }));
    vi.stubGlobal("fetch", fetchMock);
    await send({ path: "/message/sendText/inst", budget });
    expect(budget.remaining()).toBe(0);
    await expect(send({ path: "/message/sendText/inst", budget })).rejects.toBeInstanceOf(
      EvolutionApiError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("telemetria nunca inclui chave de API nem URL do servidor", () => {
    const info = vi.spyOn(console, "info");
    logWhatsappAttempt({ operation: "sendText", attempt: 1, attempts: 3, outcome: "ok" });
    const line = String(info.mock.calls.at(-1)?.[0]);
    expect(line).toContain("[whatsapp]");
    expect(line).not.toContain("secret-key");
    expect(line).not.toContain("evo.example.com");
  });
});
