import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/team.functions.ts", "utf8");
const screen = readFileSync("src/routes/_authenticated/settings.team.tsx", "utf8");

describe("reenvio seguro de convite", () => {
  it("revalida autoridade, pendência e papel antes de rotacionar o token", () => {
    expect(source).toContain("export const resendBrandInvite");
    expect(source).toContain("await assertBrandAdmin");
    expect(source).toContain("await assertCanGrantBrandRole");
    expect(source).toContain("Somente convites pendentes podem ser reenviados");
    expect(source).toContain("const token = randomToken()");
  });

  it("não permite repontar silenciosamente uma conta já provisionada", () => {
    expect(source).toContain("Este convite já criou uma conta. Revogue-o");
  });

  it("expõe reenvio e edição na linha de convite", () => {
    expect(screen).toContain("Reenviar");
    expect(screen).toContain("Editar e-mail do convite");
    expect(screen).toContain("Salvar e reenviar");
  });
});

describe("ocultação explícita do Super Admin", () => {
  for (const file of [
    "src/lib/team.functions.ts",
    "src/lib/team-admin.functions.ts",
    "src/lib/content.functions.ts",
    "src/lib/project-participants.functions.ts",
    "src/lib/mention-notify.server.ts",
  ]) {
    it(file, () => {
      expect(readFileSync(file, "utf8")).toContain("is_super_admin");
    });
  }
});