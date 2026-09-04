import { describe, expect, it } from "vitest";
import { bulkApplyToDrafts } from "@/lib/drafts-bulk.server";

const BRAND = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OUT = "cccccccc-cccc-cccc-cccc-cccccccccccc";

type Row = Record<string, unknown>;

/**
 * Stub mínimo do client Supabase: só o que `bulkApplyToDrafts` consulta.
 * Registra os patches aplicados em `posts` para inspeção.
 */
function stub(posts: Row[]) {
  const patches: Array<{ table: string; patch: Row }> = [];
  const sb = {
    from(table: string) {
      if (table === "posts") {
        const api: Row = {
          select: () => api,
          in: () => api,
          eq: () => api,
          not: () => api,
          is: async () => ({ data: posts, error: null }),
          update(patch: Row) {
            patches.push({ table, patch });
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({ is: async () => ({ error: null }) }),
                  is: async () => ({ error: null }),
                  then: undefined,
                }),
                is: async () => ({ error: null }),
              }),
            } as never;
          },
        };
        // `is("deleted_at", null)` encerra o select; para updates o encadeamento
        // é resolvido acima.
        return api as never;
      }
      if (table === "post_placements") {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        } as never;
      }
      if (table === "client_social_accounts") {
        return {
          select: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }),
        } as never;
      }
      return {
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
        update: (patch: Row) => {
          patches.push({ table, patch });
          return { eq: async () => ({ error: null }) };
        },
      } as never;
    },
  };
  return { sb: sb as never as Parameters<typeof bulkApplyToDrafts>[0], patches };
}

const base = (id: string, extra: Row = {}) => ({
  id,
  brand_id: BRAND,
  client_id: CLIENT,
  stage: "idea",
  reference_media: [],
  proposed_at: null,
  scheduled_at: null,
  published_at: null,
  monthly_plan_topic_id: null,
  pipeline_id: null,
  ...extra,
});

describe("bulkApplyToDrafts — agenda em massa", () => {
  it("propõe data sem criar agendamento real e ignora peça fora do escopo", async () => {
    const { sb, patches } = stub([base(A), base(B)]);
    const res = await bulkApplyToDrafts(sb, {
      brandId: BRAND,
      clientId: CLIENT,
      userId: USER,
      postIds: [A, B, OUT],
      schedule: {
        mode: "fixed",
        weekday: 3,
        time: "19:00",
        monthAnchor: "2026-09-01T03:00:00.000Z",
      },
      now: new Date("2026-08-31T12:00:00.000Z"),
    });

    expect(res.applied).toBe(2);
    expect(res.skipped).toBe(1);
    expect(res.errors).toBe(0);
    expect(res.items.find((i) => i.postId === OUT)?.status).toBe("skipped");

    const schedulePatches = patches.filter((p) => "schedule_status" in p.patch);
    expect(schedulePatches).toHaveLength(2);
    for (const p of schedulePatches) {
      expect(p.patch.schedule_status).toBe("proposed");
      expect(p.patch).not.toHaveProperty("scheduled_at");
      expect(typeof p.patch.proposed_at).toBe("string");
    }
  });

  it("não sobrescreve proposta existente sem overwrite (idempotente)", async () => {
    const { sb, patches } = stub([base(A, { proposed_at: "2026-09-02T22:00:00.000Z" })]);
    const res = await bulkApplyToDrafts(sb, {
      brandId: BRAND,
      clientId: CLIENT,
      userId: USER,
      postIds: [A],
      schedule: { mode: "fixed", weekday: 3, time: "19:00" },
      now: new Date("2026-08-31T12:00:00.000Z"),
    });
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(1);
    expect(patches.filter((p) => "schedule_status" in p.patch)).toHaveLength(0);
  });

  it("nunca toca em peça já publicada", async () => {
    const { sb, patches } = stub([
      base(A, { stage: "published", published_at: "2026-08-01T12:00:00.000Z" }),
    ]);
    const res = await bulkApplyToDrafts(sb, {
      brandId: BRAND,
      clientId: CLIENT,
      userId: USER,
      postIds: [A],
      schedule: { mode: "fixed", weekday: 3, time: "19:00" },
      sendToProduction: true,
      now: new Date("2026-08-31T12:00:00.000Z"),
    });
    expect(res.skipped).toBe(1);
    expect(patches).toHaveLength(0);
  });
});
