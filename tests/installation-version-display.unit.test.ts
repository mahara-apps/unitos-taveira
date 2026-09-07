import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { MASTER_RELEASE_VERSION } from "@/lib/installation/manager-contract";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("versão exibida no ambiente", () => {
  const screen = read("src/routes/_authenticated/admin.ambiente.tsx");

  it("usa MASTER_RELEASE_VERSION, nunca um número fixo", () => {
    expect(screen).toContain("MASTER_RELEASE_VERSION");
    expect(screen).not.toMatch(/const APP_VERSION\s*=\s*["'][\d.]+["']/);
  });

  it("a versão do MASTER tem formato semver", () => {
    expect(MASTER_RELEASE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("consulta do commit do MASTER", () => {
  const automation = read("src/lib/installation/automation.server.ts");

  it("envia autorização do GitHub em latestCommit", () => {
    const start = automation.indexOf("async latestCommit()");
    expect(start).toBeGreaterThan(-1);
    const block = automation.slice(start, start + 1600);
    expect(block).toContain("authorization: `Bearer ${gh}`");
    expect(block).toContain("UNITOS_GITHUB_TOKEN");
  });
});
