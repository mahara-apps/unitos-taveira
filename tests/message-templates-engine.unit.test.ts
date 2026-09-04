import { describe, expect, it } from "vitest";
import {
  renderStrict,
  missingVariables,
  extractVariables,
  TemplateRenderError,
} from "@/lib/message-templates/render";
import { resolveEventContext } from "@/lib/message-templates/context.server";

/** Stub mínimo do client Supabase: apenas o que o resolver consulta. */
function makeSupabase(rows: Record<string, unknown>) {
  const builder = (table: string) => {
    const result = { data: rows[table] ?? null, error: null };
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    Object.assign(chain, {
      select: self,
      eq: self,
      is: self,
      order: self,
      limit: () => ({ data: rows[table] ?? [], error: null }),
      maybeSingle: async () => result,
      then: (fn: (v: unknown) => unknown) => Promise.resolve(fn({ data: rows[table] ?? [] })),
    });
    return chain;
  };
  return { from: builder } as never;
}

describe("renderStrict", () => {
  it("substitui variáveis resolvidas", () => {
    expect(renderStrict("Olá {{user.full_name}}", { "user.full_name": "Maria" })).toBe("Olá Maria");
  });

  it("falha em vez de entregar {{...}} cru ou travessão", () => {
    expect(() => renderStrict("Link: {{invite.url}}", {})).toThrow(TemplateRenderError);
    try {
      renderStrict("{{a.b}} {{c.d}}", { "a.b": "x" });
    } catch (error) {
      expect((error as TemplateRenderError).missing).toEqual(["c.d"]);
    }
  });

  it("trata string vazia como variável não resolvida", () => {
    expect(missingVariables("{{brand.name}}", { "brand.name": "  " })).toEqual(["brand.name"]);
  });

  it("extrai variáveis únicas", () => {
    expect(extractVariables("{{a}}{{a}}{{ b }}")).toEqual(["a", "b"]);
  });
});

describe("resolveEventContext", () => {
  it("resolve marca e cliente reais, sem dados de exemplo", async () => {
    const supabase = makeSupabase({
      brands: { name: "Agência X", nome_fantasia: null, logo_url: null },
      clients: {
        id: "c1",
        brand_id: "b1",
        name: "Café Origem",
        contact_name: "João",
        contact_email: "joao@cafe.com",
      },
    });
    const ctx = await resolveEventContext(supabase, { brandId: "b1", clientId: "c1" });
    expect(ctx["brand.name"]).toBe("Agência X");
    expect(ctx["client.name"]).toBe("Café Origem");
    expect(ctx["client.email"]).toBe("joao@cafe.com");
    // Nenhuma chave de exemplo do preview vaza para o contexto real.
    expect(ctx["invite.password"]).toBeUndefined();
  });

  it("bloqueia cliente de outra marca", async () => {
    const supabase = makeSupabase({
      brands: { name: "Agência X" },
      clients: { id: "c1", brand_id: "OUTRA", name: "Vazamento" },
    });
    await expect(resolveEventContext(supabase, { brandId: "b1", clientId: "c1" })).rejects.toThrow(
      /não pertence/,
    );
  });

  it("monta invite.url a partir da URL da instalação do workspace, ignorando PUBLIC_APP_URL", async () => {
    // PUBLIC_APP_URL é de outra instalação: não pode aparecer no link.
    process.env.PUBLIC_APP_URL = "https://instalacao-global.exemplo.com/";
    const supabase = makeSupabase({
      brands: { name: "Agência X", app_url: "https://app.exemplo.com" },
    });
    const ctx = await resolveEventContext(supabase, {
      brandId: "b1",
      invite: { token: "tok123", role: "manager" },
    });
    expect(ctx["invite.url"]).toBe("https://app.exemplo.com/invite/tok123");
    expect(ctx["invite.role"]).toBe("Manager");
    delete process.env.PUBLIC_APP_URL;
  });
});
