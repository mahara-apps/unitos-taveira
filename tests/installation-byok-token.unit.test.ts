import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  AUTOMATION_CREDENTIAL_VARS,
  BYOK_SUPABASE_MARKER,
  resolveAutomationCapability,
} from "@/lib/installation/automation-contract";

const manager = readFileSync("src/lib/installation/manager.functions.ts", "utf8");
const credentials = readFileSync("src/lib/installation/credentials.server.ts", "utf8");
const form = readFileSync("src/routes/_authenticated/admin.instalacoes.index.tsx", "utf8");
const verify = readFileSync("supabase/install/verify-installation.sql", "utf8");

describe("BYOK: cada instalação usa o Supabase Access Token do próprio cliente", () => {
  it("cadastro exige o token e marca a instalação como BYOK", () => {
    expect(manager).toContain("supabaseManagementToken: z");
    expect(manager).toContain("requires_own_supabase_token: true");
  });

  it("falha ao guardar o token desfaz o cadastro", () => {
    const block = manager.slice(manager.indexOf("const CreateInput"));
    expect(block).toContain('.from("installations").delete().eq("id", row.id)');
  });

  it("instalação BYOK não herda o token global do MASTER", () => {
    expect(credentials).toContain("requiresOwnSupabaseToken");
    expect(credentials).toContain(`env[BYOK_SUPABASE_MARKER] = "1"`);
  });

  it("sem token próprio a automação fica indisponível com mensagem acionável", () => {
    const capability = resolveAutomationCapability({ [BYOK_SUPABASE_MARKER]: "1" });
    expect(capability.supabase.available).toBe(false);
    expect(capability.supabase.reason).toContain("Acessos da instalação");
  });

  it("com o token próprio resolvido a automação segue disponível", () => {
    const name = AUTOMATION_CREDENTIAL_VARS.supabaseManagement[0]!;
    const capability = resolveAutomationCapability({
      [BYOK_SUPABASE_MARKER]: "1",
      [name]: "sbp_teste",
    });
    expect(capability.supabase.available).toBe(true);
  });

  it("formulário pede o token de forma segura e o pacote MASTER valida a coluna", () => {
    expect(form).toContain("PasswordInput");
    expect(form).toContain("supabaseManagementToken");
    expect(verify).toContain("requires_own_supabase_token");
  });
});
