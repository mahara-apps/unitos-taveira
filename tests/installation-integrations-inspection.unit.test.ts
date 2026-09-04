import { describe, expect, it } from "vitest";

import {
  classifyOperationalUrl,
  customDomainState,
  envIntegrationState,
  metaIntegrationState,
  metaRedirectUriFor,
  normalizeOriginCandidate,
} from "@/lib/installation/readiness-contract";

describe("domínio salvo sem esquema", () => {
  it("normaliza hostname puro para https", () => {
    expect(normalizeOriginCandidate("unitos.taveirapublicidade.com.br")).toBe(
      "https://unitos.taveirapublicidade.com.br",
    );
    expect(normalizeOriginCandidate(" ")).toBe("");
  });

  it("classifica hostname puro como domínio definitivo configurado", () => {
    const url = classifyOperationalUrl("unitos.taveirapublicidade.com.br");
    expect(url.ok).toBe(true);
    expect(customDomainState("unitos.taveirapublicidade.com.br")).toBe("configured");
  });

  it("mantém URL temporária de deploy como pendente", () => {
    expect(customDomainState("https://unitos-taveira.vercel.app")).toBe("pending");
  });
});

describe("estado da conexão Meta", () => {
  const appUrl = "unitos.taveirapublicidade.com.br";
  const expected = "https://unitos.taveirapublicidade.com.br/api/public/meta/callback";

  it("deriva o endereço de retorno por instalação", () => {
    expect(metaRedirectUriFor(appUrl)).toBe(expected);
    expect(metaRedirectUriFor(null)).toBeNull();
  });

  it("sem App Meta enviado fica não configurado", () => {
    const r = metaIntegrationState({ envKeys: ["SUPABASE_URL"], appUrl });
    expect(r.state).toBe("not_configured");
    expect(r.expectedRedirectUri).toBe(expected);
  });

  it("com App e Config ID coerentes fica configurado", () => {
    const r = metaIntegrationState({
      envKeys: ["META_APP_ID", "META_APP_SECRET", "META_BUSINESS_CONFIG_ID", "META_REDIRECT_URI"],
      redirectUri: expected,
      appUrl,
    });
    expect(r.state).toBe("configured");
  });

  it("retorno divergente do domínio fica pendente e informa o esperado", () => {
    const r = metaIntegrationState({
      envKeys: ["META_APP_ID", "META_APP_SECRET", "META_BUSINESS_CONFIG_ID", "META_REDIRECT_URI"],
      redirectUri: "https://outra-instalacao.com/api/public/meta/callback",
      appUrl,
    });
    expect(r.state).toBe("pending");
    expect(r.detail).toContain(expected);
  });

  it("sem Config ID fica pendente (consentimento legado)", () => {
    const r = metaIntegrationState({
      envKeys: ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"],
      redirectUri: expected,
      appUrl,
    });
    expect(r.state).toBe("pending");
  });
});

describe("integrações por variável", () => {
  it("classifica completo, incompleto e ausente", () => {
    const required = ["EVOLUTION_API_URL", "EVOLUTION_API_KEY"] as const;
    expect(
      envIntegrationState({ envKeys: [...required], required, label: "WhatsApp" }).state,
    ).toBe("configured");
    expect(
      envIntegrationState({ envKeys: ["EVOLUTION_API_URL"], required, label: "WhatsApp" }).state,
    ).toBe("pending");
    expect(envIntegrationState({ envKeys: [], required, label: "WhatsApp" }).state).toBe(
      "not_configured",
    );
  });
});
