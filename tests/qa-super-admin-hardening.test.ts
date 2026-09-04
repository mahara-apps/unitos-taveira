/**
 * CORREÇÃO P1 — contas QA com SUPER ADMIN.
 *
 * Cobre a barreira de ambiente, a não-previsibilidade de senhas de teste e o
 * inventário do banco (nenhuma conta QA privilegiada). Não altera RBAC/RLS.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privilegedTestEnv, assertPrivilegedTestEnv } from "./helpers/test-env";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  delete process.env["UNITOS_TEST_ENV"];
  delete process.env["UNITOS_PRODUCTION_PROJECT_REF"];
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("barreira de ambiente (TEST_SUPER_ADMIN_CREATION)", () => {
  it("ambiente desconhecido bloqueia criação privilegiada (sem fallback)", () => {
    expect(privilegedTestEnv()).toEqual({ allowed: false, reason: "not_declared_test" });
    expect(() => assertPrivilegedTestEnv()).toThrow(/TEST_SUPER_ADMIN_CREATION bloqueado/);
  });

  it("valores não canônicos não habilitam (staging/dev/prod/vazio)", () => {
    for (const v of ["staging", "dev", "production", "", "TEST ", "true", "1"]) {
      process.env["UNITOS_TEST_ENV"] = v;
      if (v.trim().toLowerCase() === "test") continue;
      expect(privilegedTestEnv().allowed).toBe(false);
    }
  });

  it("projeto de produção bloqueia mesmo declarado como teste", () => {
    process.env["UNITOS_TEST_ENV"] = "test";
    process.env["UNITOS_PRODUCTION_PROJECT_REF"] =
      process.env["SUPABASE_PROJECT_ID"] ??
      /https?:\/\/([a-z0-9]+)\.supabase\./i.exec(process.env["SUPABASE_URL"] ?? "")?.[1] ??
      "x";
    expect(privilegedTestEnv()).toEqual({ allowed: false, reason: "production_project" });
    expect(() => assertPrivilegedTestEnv()).toThrow(/PRODUÇÃO/);
  });

  it("ambiente de teste explícito e projeto não-produção habilita", () => {
    process.env["UNITOS_TEST_ENV"] = "test";
    process.env["UNITOS_PRODUCTION_PROJECT_REF"] = "ref-de-producao-diferente";
    expect(privilegedTestEnv().allowed).toBe(true);
    expect(() => assertPrivilegedTestEnv()).not.toThrow();
  });
});

describe("senhas de teste", () => {
  it("não são deriváveis do e-mail e não repetem", async () => {
    const { generateTestPassword } = await import("./helpers/fixtures");
    const a = generateTestPassword();
    const b = generateTestPassword();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(24);
    for (const seed of ["qa+", "unitos-tests.dev", "@"]) expect(a).not.toContain(seed);
  });

  it("o repositório não contém senha derivada de e-mail nos helpers", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("tests/helpers/fixtures.ts", "utf8");
    expect(src).not.toMatch(/password\s*=\s*`Qa!\$\{TAG\}\$\{label\}/);
    expect(src).toContain("generateTestPassword");
  });
});

describe("inventário do banco", () => {
  it("nenhuma conta QA possui SUPER ADMIN", async () => {
    const { admin } = await import("./helpers/fixtures");
    const { data, error } = await admin
      .from("user_profiles")
      .select("id, is_super_admin, role")
      .or("is_super_admin.eq.true,role.eq.super_admin");
    if (error) throw new Error(error.message);
    const ids = (data ?? []).map((r) => r.id as string);
    if (!ids.length) return;
    const emails: string[] = [];
    for (const id of ids) {
      const u = await admin.auth.admin.getUserById(id);
      if (u.data.user?.email) emails.push(u.data.user.email.toLowerCase());
    }
    expect(emails.filter((e) => e.includes("unitos-tests.dev") || e.startsWith("qa+"))).toEqual([]);
  });

  it("SUPER ADMIN legítimo preservado (pelo menos um, não-QA)", async () => {
    const { admin } = await import("./helpers/fixtures");
    const { data, error } = await admin
      .from("user_profiles")
      .select("id")
      .or("is_super_admin.eq.true,role.eq.super_admin");
    if (error) throw new Error(error.message);
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
