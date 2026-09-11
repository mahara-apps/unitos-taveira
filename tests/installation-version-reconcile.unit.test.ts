import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("reconciliação de versão da instalação", () => {
  const automation = read("src/lib/installation/automation.server.ts");
  const manager = read("src/lib/installation/manager.functions.ts");
  const detail = read("src/routes/_authenticated/admin.instalacoes.$id.tsx");

  it("retomada com código já publicado não é barrada por 'MASTER não publicado'", () => {
    expect(automation).toContain(
      "const alreadyPublished = checkpoint.codeDone === true && Boolean(checkpoint.codeSha)",
    );
    expect(automation).toContain("!alreadyPublished &&");
    expect(automation).toContain("updateRelease?: string");
  });

  it("a autorização usa sempre o ponto atual do código do MASTER", () => {
    expect(manager).toContain("const head = await masterCode.masterHeadSha()");
    expect(manager).toContain("commitSha: targetSha");
  });

  it("existe sincronização com a versão publicada no repositório da instalação", () => {
    expect(manager).toContain("syncInstallationVersionFn");
    expect(manager).toContain("code.installedRelease()");
    expect(automation).toContain("async installedRelease()");
  });

  it("a tela oferece sincronizar versão", () => {
    expect(detail).toContain("Sincronizar versão");
    expect(detail).toContain("syncVersion.mutate(");
  });
});
