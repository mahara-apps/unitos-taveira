/**
 * Mínimo Operacional Primeiro — regras de prontidão de uma instalação nova.
 *
 * READY depende só do núcleo. Domínio definitivo, Meta, Resend, Evolution e IA
 * são configuração posterior e NUNCA bloqueiam a instalação.
 */
import { describe, expect, it } from "vitest";

import {
  CORE_REQUIREMENTS,
  FIRST_ACCESS_REQUIREMENTS,
  classifyOperationalUrl,
  computeReadiness,
  customDomainState,
  isTemporaryDeployUrl,
  validateAppUrlSwitch,
} from "@/lib/installation/readiness-contract";
import { classifySecretSource } from "@/lib/installation/preflight-contract";

const CORE_OK = Object.fromEntries(
  CORE_REQUIREMENTS.map((r) => [r.id, { state: "ok" as const }]),
);

describe("núcleo da instalação", () => {
  it("instalação mínima chega a READY/OPERACIONAL sem integração externa alguma", () => {
    const report = computeReadiness({ core: CORE_OK });
    expect(report.ready).toBe(true);
    expect(report.state).toBe("operational");
    expect(report.pendingOptional).toContain("meta");
  });

  it("cada integração opcional ausente mantém READY", () => {
    for (const id of ["meta", "resend", "evolution", "ai", "branding", "custom_domain"] as const) {
      const report = computeReadiness({
        core: CORE_OK,
        optional: { [id]: "not_configured" },
      });
      expect(report.ready, id).toBe(true);
      expect(["operational", "attention"]).toContain(report.state);
    }
  });

  it("item obrigatório ausente fica BLOQUEADA e nunca READY", () => {
    const report = computeReadiness({ core: { ...CORE_OK, cron: { state: "pending" } } });
    expect(report.ready).toBe(false);
    expect(report.state).toBe("blocked");
    expect(report.missingCore).toEqual(["cron"]);
  });

  it("primeiro Super Admin e workspace aparecem no núcleo, mas não bloqueiam READY", () => {
    const ids = CORE_REQUIREMENTS.map((r) => r.id);
    expect(ids).toContain("super_admin");
    expect(ids).toContain("workspace");
    // Criados pelo cliente em /setup: pendente é informação, não bloqueio.
    const semAdmin = computeReadiness({ core: { ...CORE_OK, super_admin: { state: "pending" } } });
    expect(semAdmin.ready).toBe(true);
    // Falha real (ex.: mais de um workspace) continua bloqueando.
    expect(computeReadiness({ core: { ...CORE_OK, workspace: { state: "error" } } }).ready).toBe(
      false,
    );
  });


  it("ressalva no núcleo vira ATENÇÃO, mas continua READY", () => {
    const report = computeReadiness({ core: { ...CORE_OK, storage: { state: "attention" } } });
    expect(report.ready).toBe(true);
    expect(report.state).toBe("attention");
  });

  it("falha do núcleo vira FALHA e provisionamento em curso vira PROVISIONANDO", () => {
    expect(computeReadiness({ core: { ...CORE_OK, database: { state: "error" } } }).state).toBe(
      "failure",
    );
    expect(computeReadiness({ core: CORE_OK, operationRunning: true }).state).toBe("provisioning");
  });

  it("check desconhecido nunca é assumido como ok", () => {
    const report = computeReadiness({ core: {} });
    expect(report.ready).toBe(false);
    // Só os itens bloqueantes entram em missingCore (primeiro acesso fica fora).
    expect(report.missingCore.length).toBe(
      CORE_REQUIREMENTS.length - FIRST_ACCESS_REQUIREMENTS.length,
    );
    for (const id of FIRST_ACCESS_REQUIREMENTS) {
      expect(report.core[id].state).toBe("pending");
    }
  });

});

describe("URL operacional", () => {
  it("URL temporária do deploy é aceita", () => {
    const url = classifyOperationalUrl("https://unitos-pitada-abc.vercel.app");
    expect(url).toEqual({
      ok: true,
      origin: "https://unitos-pitada-abc.vercel.app",
      kind: "temporary",
    });
    expect(isTemporaryDeployUrl("https://x.lovable.app")).toBe(true);
  });

  it("domínio definitivo é opcional e apenas 'pendente' enquanto a URL é temporária", () => {
    expect(customDomainState("https://unitos-pitada-abc.vercel.app")).toBe("pending");
    expect(customDomainState("https://app.pitada.com.br")).toBe("configured");
  });

  it("URL do MASTER é sempre recusada", () => {
    expect(classifyOperationalUrl("https://unitos-master.lovable.app").ok).toBe(false);
  });

  it("domínio definitivo pode ser configurado depois quando tudo aponta para a mesma origem", () => {
    const ok = validateAppUrlSwitch({
      newUrl: "https://app.pitada.com.br",
      installationAppUrl: "https://app.pitada.com.br",
      cronUrls: ["https://app.pitada.com.br/api/public/cron/sla-check"],
      metaRedirectUri: "https://app.pitada.com.br/api/public/meta/callback",
    });
    expect(ok.ok).toBe(true);
  });

  it("divergência entre app_url, cron e redirect Meta é recusada", () => {
    const res = validateAppUrlSwitch({
      newUrl: "https://app.pitada.com.br",
      installationAppUrl: "https://unitos-pitada-abc.vercel.app",
      cronUrls: ["https://unitos-pitada-abc.vercel.app/api/public/cron/sla-check"],
      metaRedirectUri: "https://outra.com/api/public/meta/callback",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("secrets exclusivos da instalação", () => {
  it("secret herdado do ambiente MASTER é bloqueado", () => {
    expect(
      classifySecretSource({
        name: "CRON_SECRET",
        value: "segredo-do-master-1234",
        declared: "all",
        masterEnvironment: true,
      }).status,
    ).toBe("blocked");
    expect(
      classifySecretSource({
        name: "META_STATE_SECRET",
        value: "tkjbhttylouamqxnbfgv-derivado",
        declared: "all",
      }).status,
    ).toBe("blocked");
  });

  it("secret ausente é gerado na própria instalação", () => {
    for (const name of [
      "CRON_SECRET",
      "BRAND_CREDENTIALS_SECRET",
      "META_STATE_SECRET",
      "META_WEBHOOK_VERIFY_TOKEN",
    ] as const) {
      expect(classifySecretSource({ name, value: null, declared: null }).status).toBe("generate");
    }
  });
});
