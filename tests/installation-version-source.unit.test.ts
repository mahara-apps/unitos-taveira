import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("versão exibida da instalação", () => {
  const detail = read("src/routes/_authenticated/admin.instalacoes.$id.tsx");
  const card = read("src/components/installations/installation-card.tsx");

  it("detalhe usa a release fixada (código realmente publicado)", () => {
    expect(detail).toContain("installed={inst.pinnedRelease ?? inst.currentVersion}");
  });

  it("listagem usa a mesma fonte de versão", () => {
    expect(card).toContain("installed={i.pinnedRelease ?? i.currentVersion}");
  });

  it("bloqueia autorizar atualização sem saber a versão do pacote do MASTER", () => {
    expect(detail).toContain("!masterVersion.data?.repoRelease");
  });
});
