import { describe, expect, it } from "vitest";
import { sanitizeBaselineSqlForManagementApi } from "@/lib/installation/baseline-sql";
import baseline001 from "../supabase/baseline-snapshot/001_initial_schema.sql?raw";

describe("sanitizeBaselineSqlForManagementApi", () => {
  it("remove ALTER DEFAULT PRIVILEGES e COMMENT ON SCHEMA public", () => {
    const sql = [
      "CREATE TABLE public.a (id uuid PRIMARY KEY);",
      "COMMENT ON SCHEMA public IS 'standard public schema';",
      "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;",
      "GRANT SELECT ON public.a TO authenticated;",
    ].join("\n");
    const result = sanitizeBaselineSqlForManagementApi(sql);
    expect(result.sql).toContain("CREATE TABLE public.a");
    expect(result.sql).toContain("GRANT SELECT ON public.a TO authenticated;");
    expect(result.sql).not.toMatch(/ALTER DEFAULT PRIVILEGES/i);
    expect(result.sql).not.toMatch(/COMMENT ON SCHEMA public/i);
    expect(result.removed).toHaveLength(2);
  });

  it("preserva GRANTs, policies e funções", () => {
    const sql = [
      "ALTER TABLE public.a ENABLE ROW LEVEL SECURITY;",
      'CREATE POLICY "own" ON public.a FOR SELECT TO authenticated USING (auth.uid() = id);',
      "GRANT ALL ON public.a TO service_role;",
    ].join("\n");
    const result = sanitizeBaselineSqlForManagementApi(sql);
    expect(result.removed).toHaveLength(0);
    expect(result.sql).toBe(sql);
  });

  it("sanea o baseline real sem sobrar comando de superusuário", () => {
    const result = sanitizeBaselineSqlForManagementApi(baseline001);
    expect(result.removed.length).toBeGreaterThan(0);
    expect(result.sql).not.toMatch(/^\s*ALTER\s+DEFAULT\s+PRIVILEGES/im);
    expect(result.sql).not.toMatch(/^\s*COMMENT\s+ON\s+SCHEMA\s+public/im);
    // O schema em si permanece intacto.
    expect(result.sql).toContain("CREATE TABLE");
    expect(result.sql).toContain("ENABLE ROW LEVEL SECURITY");
  });
});

describe("saneamento de storage", () => {
  it("remove ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY", () => {
    const { sql, removed } = sanitizeBaselineSqlForManagementApi(
      [
        "ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;",
        "DROP POLICY IF EXISTS avatars_auth_read ON storage.objects;",
      ].join("\n"),
    );
    expect(sql).not.toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS avatars_auth_read/);
    expect(removed).toHaveLength(1);
  });

  it("preserva RLS de tabelas do schema public", () => {
    const { sql, removed } = sanitizeBaselineSqlForManagementApi(
      "ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;",
    );
    expect(sql).toMatch(/public\.brands ENABLE ROW LEVEL SECURITY/);
    expect(removed).toHaveLength(0);
  });
});
