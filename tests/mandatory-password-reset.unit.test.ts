import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync("src/lib/password.functions.ts", "utf8");
const dialog = readFileSync("src/components/auth/mandatory-password-reset.tsx", "utf8");

describe("primeiro acesso", () => {
  it("só confirma o nome quando o servidor retorna a linha atualizada", () => {
    expect(server).toContain("ensureUserProfile");
    expect(server).toContain("userId: context.userId");
    expect(server).toContain("fullName: updated.full_name");
  });

  it("fecha a etapa de nome imediatamente no cache verificado", () => {
    expect(dialog).toContain('qc.setQueryData(["me", "password-flag"]');
    expect(dialog).toContain("requiresName: false");
    expect(dialog).toContain("await qc.invalidateQueries");
  });

  it("mantém erro acionável e trata sessão expirada", () => {
    expect(dialog).toContain('rawMessage.startsWith("Unauthorized")');
    expect(dialog).toContain("Sua sessão expirou. Entre novamente para continuar.");
    expect(dialog).toContain('role="alert"');
  });
});
