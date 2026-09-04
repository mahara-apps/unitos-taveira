import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  classifySecretSource,
  evaluatePreflight,
  formatBootstrapResult,
  isMasterEnvironment,
} from "@/lib/installation/preflight-contract";
import { parseReportEvent, redactReportText } from "@/lib/installation/report-contract";

const BOOTSTRAP = "supabase/install/bootstrap.sh";

function runBootstrap(env: Record<string, string>) {
  try {
    const stdout = execFileSync("bash", [BOOTSTRAP], {
      env: { PATH: process.env["PATH"] ?? "", ...env },
      encoding: "utf8",
      timeout: 60_000,
    });
    return { code: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, stdout: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("secrets nunca herdados do MASTER", () => {
  it("bloqueia secret presente no ambiente sem declaração explícita", () => {
    const source = classifySecretSource({
      name: "BRAND_CREDENTIALS_SECRET",
      value: "valor-do-master-shell",
      declared: null,
    });
    expect(source.status).toBe("blocked");
  });

  it("bloqueia secret com identificador do MASTER mesmo declarado", () => {
    expect(
      classifySecretSource({
        name: "META_STATE_SECRET",
        value: "tkjbhttylouamqxnbfgv-abc",
        declared: "all",
      }).status,
    ).toBe("blocked");
  });

  it("bloqueia secret declarado quando o ambiente é o MASTER", () => {
    expect(
      classifySecretSource({
        name: "CRON_SECRET",
        value: "a".repeat(24),
        declared: "CRON_SECRET",
        masterEnvironment: true,
      }).status,
    ).toBe("blocked");
  });

  it("aceita secret declarado pelo destino e gera quando ausente", () => {
    expect(
      classifySecretSource({ name: "CRON_SECRET", value: "b".repeat(20), declared: "all" }).status,
    ).toBe("declared");
    expect(classifySecretSource({ name: "CRON_SECRET", value: "", declared: null }).status).toBe(
      "generate",
    );
  });

  it("detecta ambiente MASTER por role e por URL", () => {
    expect(isMasterEnvironment({ role: "MASTER" })).toBe(true);
    expect(isMasterEnvironment({ supabaseUrl: "https://tkjbhttylouamqxnbfgv.supabase.co" })).toBe(
      true,
    );
    expect(isMasterEnvironment({ appUrl: "https://cliente.com" })).toBe(false);
  });

  it("bootstrap falha quando o secret vem do ambiente sem declaração", () => {
    const result = runBootstrap({
      PUBLIC_APP_URL: "https://instalacao-teste.example.com",
      SUPABASE_DB_URL: "postgresql://postgres:x@127.0.0.1:1/postgres",
      BRAND_CREDENTIALS_SECRET: "segredo-herdado-do-master-shell",
    });
    expect(result.stdout).toContain("herança não permitida");
    expect(result.stdout).not.toContain("RESULTADO: PASS");
    expect(result.code).not.toBe(0);
  });
});

describe("relatório final do bootstrap", () => {
  it("abort de pré-condição resulta em BLOCKED e exit != 0", () => {
    const result = runBootstrap({ PUBLIC_APP_URL: "https://instalacao-teste.example.com" });
    expect(result.stdout).toContain("BOOTSTRAP ABORTADO");
    expect(result.stdout).toContain("RESULTADO: BLOCKED");
    expect(result.stdout).not.toContain("RESULTADO: PASS");
    expect(result.code).toBe(2);
  });

  it("banco inacessível não imprime PASS", () => {
    const result = runBootstrap({
      PUBLIC_APP_URL: "https://instalacao-teste.example.com",
      SUPABASE_DB_URL: "postgresql://postgres:x@127.0.0.1:1/postgres",
    });
    expect(result.stdout).not.toContain("RESULTADO: PASS");
    expect(result.code).not.toBe(0);
  });

  it("guard anti-MASTER continua ativo", () => {
    const result = runBootstrap({
      PUBLIC_APP_URL: "https://unitos-master.lovable.app",
      SUPABASE_DB_URL: "postgresql://postgres:x@127.0.0.1:1/postgres",
    });
    expect(result.stdout).toContain("aponta para o MASTER");
    expect(result.code).toBe(2);
  });

  it("formatBootstrapResult nunca devolve PASS após abort ou falha", () => {
    expect(formatBootstrapResult({ aborted: true, failures: 0 })).toEqual({
      result: "BLOCKED",
      exitCode: 2,
    });
    expect(formatBootstrapResult({ failures: 3 })).toEqual({ result: "FAIL", exitCode: 1 });
    expect(formatBootstrapResult({ failures: 0 })).toEqual({ result: "PASS", exitCode: 0 });
  });
});

describe("preflight determinístico", () => {
  const complete = {
    publicAppUrl: "https://instalacao.com",
    supabaseUrl: "https://abcdefghijklmnop.supabase.co",
    supabaseDbUrl: "postgresql://postgres:x@db.abcdefghijklmnop.supabase.co:5432/postgres",
    managementCredential: "token",
    availableExtensions: ["vector", "pg_net", "pg_cron", "supabase_vault", "pgcrypto"],
    endpointProbeStatus: 401,
    secrets: {},
    declaredSecrets: null,
  };

  it("PASS quando todas as pré-condições existem", () => {
    const report = evaluatePreflight(complete);
    expect(report.result).toBe("PASS");
    expect(report.blocked).toEqual([]);
    expect(report.failed).toEqual([]);
  });

  it("BLOCKED (nunca PASS) quando falta credencial de gestão ou endpoint", () => {
    const report = evaluatePreflight({
      ...complete,
      managementCredential: null,
      endpointProbeStatus: null,
    });
    expect(report.result).toBe("BLOCKED");
    expect(report.blocked).toContain("management");
    expect(report.blocked).toContain("endpoint");
  });

  it("BLOCKED quando o ambiente não tem banco nem extensões", () => {
    const report = evaluatePreflight({
      ...complete,
      supabaseDbUrl: null,
      availableExtensions: null,
    });
    expect(report.result).toBe("BLOCKED");
    expect(report.blocked).toEqual(expect.arrayContaining(["database", "extensions"]));
  });

  it("FAIL quando alvo aponta para o MASTER ou extensão falta", () => {
    expect(
      evaluatePreflight({ ...complete, supabaseUrl: "https://tkjbhttylouamqxnbfgv.supabase.co" })
        .result,
    ).toBe("FAIL");
    expect(evaluatePreflight({ ...complete, availableExtensions: ["pgcrypto"] }).result).toBe(
      "FAIL",
    );
  });

  it("FAIL quando secret herdado sem declaração", () => {
    const report = evaluatePreflight({ ...complete, secrets: { CRON_SECRET: "x".repeat(20) } });
    expect(report.result).toBe("FAIL");
    expect(report.failed).toContain("secrets");
  });
});

describe("canal de progresso", () => {
  it("aceita evento de etapa válido e normaliza detalhe", () => {
    const parsed = parseReportEvent({
      token: "t".repeat(40),
      step: "database",
      state: "running",
      detail: "aplicando baseline",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.kind === "progress") {
      expect(parsed.event.step).toBe("database");
      expect(parsed.event.detail).toBe("aplicando baseline");
    }
  });

  it("recusa etapa desconhecida, token curto e evento incompleto", () => {
    expect(parseReportEvent({ token: "t".repeat(40), step: "hack", state: "done" }).ok).toBe(false);
    expect(parseReportEvent({ token: "curto", step: "cron", state: "done" }).ok).toBe(false);
    expect(parseReportEvent({ token: "t".repeat(40), state: "done" }).ok).toBe(false);
    expect(parseReportEvent({ token: "t".repeat(40), done: true }).ok).toBe(false);
  });

  it("aceita evento final com ok booleano", () => {
    const parsed = parseReportEvent({
      token: "t".repeat(40),
      done: true,
      ok: true,
      version: "1.0.0",
      checks: { database: "ok" },
    });
    expect(parsed.ok && parsed.kind).toBe("final");
  });

  it("nunca propaga credenciais no texto livre", () => {
    const redacted = redactReportText(
      "falhou em postgresql://postgres:senha@db.x.supabase.co:5432/postgres com CRON_SECRET=abc123 e Bearer eyJabcdefghij.klmno.pqrst",
    );
    expect(redacted).not.toContain("senha");
    expect(redacted).not.toContain("abc123");
    expect(redacted).toContain("[redacted]");
  });
});
