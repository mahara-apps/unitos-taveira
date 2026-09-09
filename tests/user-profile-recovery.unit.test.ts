import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const helper = readFileSync("src/lib/user-profile.server.ts", "utf8");
const team = readFileSync("src/lib/team.functions.ts", "utf8");
const portal = readFileSync("src/lib/portal-accounts.functions.ts", "utf8");
const verify = readFileSync("supabase/install/verify-installation.sql", "utf8");

describe("recuperação de perfil de primeiro acesso", () => {
  it("cria o perfil sem elevar autoridade e confirma a persistência", () => {
    expect(helper).toContain('role: "user"');
    expect(helper).not.toContain("is_super_admin:");
    expect(helper).toContain('.select("id, full_name, email, requires_password_change")');
    expect(helper).toContain("profile_verify_failed");
  });

  it("todos os criadores de contas garantem o perfil", () => {
    expect(team.match(/ensureUserProfile\(/g)).toHaveLength(3);
    expect(portal).toContain("ensureUserProfile(supabaseAdmin");
  });

  it("a verificação da instalação detecta contas órfãs", () => {
    expect(verify).toContain("identidade: nenhuma conta sem perfil");
    expect(verify).toContain("LEFT JOIN public.user_profiles");
  });
});
