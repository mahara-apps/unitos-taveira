import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1 — integridade/rastreabilidade dos dados de IA.
 * Garante que todo consumo gravado em `brand_ai_usage` declara QUEM consumiu
 * (`actor_kind='user'` + `actor_id`) ou que foi rotina automática
 * (`actor_kind='system'`), respeitando o CHECK criado no banco.
 */

const inserts: Array<Record<string, unknown>> = [];

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

const { recordAiUsage } = await import("@/lib/ai-usage.server");

const BRAND = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

/** Réplica do CHECK `brand_ai_usage_actor_kind_chk`. */
function satisfiesDbCheck(row: Record<string, unknown>): boolean {
  const kind = row["actor_kind"];
  if (kind !== "user" && kind !== "system") return false;
  return kind !== "user" || row["actor_id"] != null;
}

describe("brand_ai_usage — rastreabilidade do consumidor", () => {
  beforeEach(() => {
    inserts.length = 0;
  });

  it("consumo originado por pessoa grava actor_id e actor_kind=user", async () => {
    await recordAiUsage({
      brandId: BRAND,
      model: "gemini-2.5-flash",
      inputTokens: 100,
      outputTokens: 50,
      success: true,
      agent: "post.agent",
      userId: USER,
    });
    const row = inserts[0]!;
    expect(row["actor_id"]).toBe(USER);
    expect(row["actor_kind"]).toBe("user");
    expect(satisfiesDbCheck(row)).toBe(true);
  });

  it("rotina automática grava actor_kind=system (nunca 'user' sem autor)", async () => {
    await recordAiUsage({
      brandId: BRAND,
      model: "gemini-2.5-flash",
      inputTokens: 10,
      outputTokens: 5,
      success: true,
      agent: "brain.consolidate",
    });
    const row = inserts[0]!;
    expect(row["actor_id"]).toBeNull();
    expect(row["actor_kind"]).toBe("system");
    expect(satisfiesDbCheck(row)).toBe(true);
  });

  it("nunca produz combinação rejeitada pelo banco", async () => {
    for (const userId of [USER, null, undefined]) {
      await recordAiUsage({
        brandId: BRAND,
        model: "gpt-5-mini",
        inputTokens: 1,
        outputTokens: 1,
        success: false,
        errorMessage: "x",
        ...(userId !== undefined ? { userId } : {}),
      });
    }
    expect(inserts).toHaveLength(3);
    for (const row of inserts) expect(satisfiesDbCheck(row)).toBe(true);
  });
});
