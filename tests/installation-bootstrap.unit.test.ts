import { describe, expect, it } from "vitest";
import {
  ALLOWED_SEED_TABLES,
  BASELINE_EXPECTED_COUNTS,
  BASELINE_ORDER,
  BUSINESS_TABLES_MUST_BE_EMPTY,
  CRON_HTTP_PATHS,
  REQUIRED_BUCKETS,
  assertCronTargetsOwnOrigin,
  buildCronUrls,
  containsMasterReference,
  isAllowedSeedTable,
  validateCronSecret,
  validatePublicAppUrl,
} from "@/lib/installation/bootstrap-contract";

describe("validatePublicAppUrl", () => {
  it("aceita a origem https da própria instalação", () => {
    const result = validatePublicAppUrl("https://minha-instalacao.com/");
    expect(result).toEqual({ ok: true, value: "https://minha-instalacao.com" });
  });

  it("recusa ausência, http, credenciais, path, query e hash", () => {
    expect(validatePublicAppUrl("").ok).toBe(false);
    expect(validatePublicAppUrl("http://inst.com").ok).toBe(false);
    expect(validatePublicAppUrl("https://a:b@inst.com").ok).toBe(false);
    expect(validatePublicAppUrl("https://inst.com/app").ok).toBe(false);
    expect(validatePublicAppUrl("https://inst.com/?x=1").ok).toBe(false);
    expect(validatePublicAppUrl("https://inst.com/#a").ok).toBe(false);
    expect(validatePublicAppUrl("nao-url").ok).toBe(false);
  });

  it("recusa qualquer URL do MASTER", () => {
    expect(validatePublicAppUrl("https://unitos-master.lovable.app").ok).toBe(false);
    expect(validatePublicAppUrl("https://tkjbhttylouamqxnbfgv.supabase.co").ok).toBe(false);
  });
});

describe("validateCronSecret", () => {
  it("exige 16+ caracteres", () => {
    expect(validateCronSecret("curto").ok).toBe(false);
    expect(validateCronSecret("a".repeat(16)).ok).toBe(true);
  });

  it("recusa segredo derivado do MASTER", () => {
    expect(validateCronSecret("tkjbhttylouamqxnbfgv-secret").ok).toBe(false);
  });
});

describe("containsMasterReference", () => {
  it("detecta ref e domínio do MASTER em qualquer caixa", () => {
    expect(containsMasterReference("https://UNITOS-MASTER.lovable.app/x")).toBe(true);
    expect(containsMasterReference("db.TKJBHTTYLOUAMQXNBFGV.supabase.co")).toBe(true);
    expect(containsMasterReference("https://outra.com")).toBe(false);
    expect(containsMasterReference(null)).toBe(false);
  });
});

describe("cron aponta somente para a própria URL", () => {
  const origin = "https://minha-instalacao.com";

  it("monta uma URL por endpoint de cron HTTP", () => {
    const urls = buildCronUrls(`${origin}/`);
    expect(urls).toHaveLength(CRON_HTTP_PATHS.length);
    expect(urls.every((u) => u.startsWith(`${origin}/api/public/`))).toBe(true);
  });

  it("aprova comandos que usam apenas a própria origem", () => {
    const commands = buildCronUrls(origin).map((url) => `select net.http_post(url := '${url}');`);
    expect(assertCronTargetsOwnOrigin(commands, origin)).toEqual({ ok: true, offenders: [] });
  });

  it("reprova comando apontando para outra instalação ou para o MASTER", () => {
    const result = assertCronTargetsOwnOrigin(
      [
        "select net.http_post(url := 'https://outra-instalacao.com/api/public/cron/sla-check');",
        "select net.http_post(url := 'https://unitos-master.lovable.app/api/public/cron/sla-check');",
      ],
      origin,
    );
    expect(result.ok).toBe(false);
    expect(result.offenders).toHaveLength(2);
  });

  it("ignora jobs SQL sem URL", () => {
    expect(assertCronTargetsOwnOrigin(["SELECT public.reap_stuck_ai_jobs();"], origin).ok).toBe(true);
  });
});

describe("contrato do baseline", () => {
  it("mantém a ordem definitiva de aplicação", () => {
    expect(BASELINE_ORDER).toEqual([
      "000_extensions.sql",
      "001_initial_schema.sql",
      "005_auth_trigger.sql",
      "003_storage_buckets.sql",
      "006_storage_policies.sql",
      "004_seeds.sql",
    ]);
  });

  it("declara as contagens e buckets esperados", () => {
    expect(BASELINE_EXPECTED_COUNTS.tables).toBe(89);
    expect(BASELINE_EXPECTED_COUNTS.cronJobs).toBe(14);
    expect(BASELINE_EXPECTED_COUNTS.cronHttpJobs).toBe(CRON_HTTP_PATHS.length);
    expect(REQUIRED_BUCKETS).toHaveLength(BASELINE_EXPECTED_COUNTS.buckets);
  });

  it("permite seeds somente de catálogo/configuração", () => {
    for (const table of ALLOWED_SEED_TABLES) expect(isAllowedSeedTable(table)).toBe(true);
    for (const table of BUSINESS_TABLES_MUST_BE_EMPTY) expect(isAllowedSeedTable(table)).toBe(false);
  });
});
