/**
 * Invariante da instalação: nunca mais de um workspace.
 *
 * O teste é read-only: consulta a contagem real de workspaces e a função
 * `can_create_brand`, que é a barreira consultada pela policy de criação.
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const url = process.env["SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const enabled = Boolean(url && key);

describe.skipIf(!enabled)("instalação com workspace único", () => {
  const admin = createClient(url!, key!, { auth: { persistSession: false } });

  it("existe no máximo um workspace na instalação", async () => {
    const { count, error } = await admin.from("brands").select("id", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count ?? 0).toBeLessThanOrEqual(1);
  });

  it("can_create_brand nega criação enquanto existir um workspace", async () => {
    const { data: brands } = await admin.from("brands").select("id").limit(1);
    if (!brands || brands.length === 0) return; // instalação vazia: criação é permitida
    const { data: member } = await admin
      .from("brand_members")
      .select("user_id")
      .eq("brand_id", brands[0]!.id)
      .limit(1);
    const userId = member?.[0]?.user_id;
    if (!userId) return;
    const { data, error } = await admin.rpc("can_create_brand", { _user_id: userId });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});
