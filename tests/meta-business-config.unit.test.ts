/**
 * Validação do `config_id` do Facebook Login for Business.
 *
 * Um `config_id` inexistente, de outro App ou sem permissões selecionadas faz a
 * Meta recusar o consentimento com "This app needs at least one supported
 * permission". Aqui garantimos que isso é detectado ANTES de montar a URL e que
 * o fluxo cai para escopos legados com o motivo preservado (nunca mascarado).
 */
import { describe, expect, it } from "vitest";
import { validateBusinessConfig } from "@/lib/meta/provider.server";

const APP = { appId: "111", appSecret: "shh" };

function fetchReturning(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("validateBusinessConfig", () => {
  it("sem config_id: inválido e sem motivo (modo legado normal)", async () => {
    const r = await validateBusinessConfig({ ...APP, configId: null });
    expect(r).toEqual({ configId: null, valid: false, reason: null });
  });

  it("config_id existente com permissões: válido", async () => {
    const r = await validateBusinessConfig({
      ...APP,
      configId: "cfg1",
      fetchImpl: fetchReturning(200, {
        id: "cfg1",
        name: "Agência",
        permissions: { data: [{ permission: "pages_show_list" }] },
      }),
    });
    expect(r.valid).toBe(true);
    expect(r.reason).toBeNull();
  });

  it("config_id de outro App / inexistente: inválido com motivo da Meta", async () => {
    const r = await validateBusinessConfig({
      ...APP,
      configId: "cfg-alheio",
      fetchImpl: fetchReturning(400, { error: { message: "Unsupported get request" } }),
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("Unsupported get request");
  });

  it("config sem nenhuma permissão selecionada: inválido", async () => {
    const r = await validateBusinessConfig({
      ...APP,
      configId: "cfg-vazio",
      fetchImpl: fetchReturning(200, { id: "cfg-vazio", permissions: { data: [] } }),
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("permissão");
  });

  it("falha de rede não derruba o fluxo: inválido com motivo", async () => {
    const r = await validateBusinessConfig({
      ...APP,
      configId: "cfg1",
      fetchImpl: (async () => {
        throw new Error("boom");
      }) as unknown as typeof fetch,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toContain("boom");
  });
});
