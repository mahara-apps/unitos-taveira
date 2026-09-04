import { describe, expect, it, vi } from "vitest";
import {
  ensureClientScheduleLink,
  reserveScheduleDirect,
} from "@/lib/schedule-approval.server";

const BRAND = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";
const POST = "44444444-4444-4444-4444-444444444444";

type Row = Record<string, unknown>;

function clientStub(opts: {
  clientBrand?: string | null;
  tokens?: Row[];
  role?: string;
  updated?: Row[];
  inserts?: Row[];
}) {
  const inserts = opts.inserts ?? [];
  const updateFilters: Row = {};
  const sb = {
    rpc: vi.fn(async () => ({ data: opts.role ?? "user", error: null })),
    from(table: string) {
      if (table === "clients") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  opts.clientBrand === null
                    ? null
                    : { id: CLIENT, brand_id: opts.clientBrand ?? BRAND },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "portal_tokens") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: async () => ({ data: opts.tokens ?? [], error: null }),
              }),
            }),
          }),
          insert: async (row: Row) => {
            inserts.push(row);
            return { error: null };
          },
        };
      }
      // posts
      const chain: Row = {};
      const api = {
        update(patch: Row) {
          updateFilters["patch"] = patch;
          return api;
        },
        in(col: string, val: unknown) {
          updateFilters[`in:${col}`] = val;
          return api;
        },
        eq(col: string, val: unknown) {
          updateFilters[`eq:${col}`] = val;
          return api;
        },
        not() {
          return api;
        },
        async select() {
          return { data: opts.updated ?? [], error: null };
        },
      };
      chain["api"] = api;
      return api as never;
    },
    __updateFilters: updateFilters,
    __inserts: inserts,
  };
  return sb as never as Parameters<typeof reserveScheduleDirect>[0] & {
    __updateFilters: Row;
    __inserts: Row[];
  };
}

describe("ensureClientScheduleLink", () => {
  it("reutiliza o link ativo do cliente", async () => {
    const sb = clientStub({ tokens: [{ token: "abc123", expires_at: null }] });
    const link = await ensureClientScheduleLink(sb, {
      brandId: BRAND,
      clientId: CLIENT,
      userId: USER,
    });
    expect(link).toEqual({
      token: "abc123",
      path: "/portal/abc123/calendario",
      expiresAt: null,
      created: false,
    });
    expect(sb.__inserts).toHaveLength(0);
  });

  it("cria link quando não há ativo e ignora expirado", async () => {
    const sb = clientStub({ tokens: [{ token: "old", expires_at: "2000-01-01T00:00:00.000Z" }] });
    const link = await ensureClientScheduleLink(sb, {
      brandId: BRAND,
      clientId: CLIENT,
      userId: USER,
    });
    expect(link?.created).toBe(true);
    expect(link?.path.startsWith("/portal/")).toBe(true);
    expect(sb.__inserts).toHaveLength(1);
  });

  it("recusa cliente de outro workspace", async () => {
    const sb = clientStub({ clientBrand: "99999999-9999-9999-9999-999999999999" });
    await expect(
      ensureClientScheduleLink(sb, { brandId: BRAND, clientId: CLIENT, userId: USER }),
    ).rejects.toThrow(/forbidden/);
  });
});

describe("reserveScheduleDirect", () => {
  it("nega para papel sem autoridade", async () => {
    const sb = clientStub({ role: "manager" });
    await expect(
      reserveScheduleDirect(sb, {
        brandId: BRAND,
        clientId: CLIENT,
        postIds: [POST],
        userId: USER,
      }),
    ).rejects.toThrow(/forbidden/);
  });

  it("reserva para admin sem preencher scheduled_at", async () => {
    const sb = clientStub({ role: "admin", updated: [{ id: POST }] });
    const res = await reserveScheduleDirect(sb, {
      brandId: BRAND,
      clientId: CLIENT,
      postIds: [POST],
      userId: USER,
    });
    expect(res).toEqual({ updated: 1, skipped: 0 });
    const patch = sb.__updateFilters["patch"] as Row;
    expect(patch["schedule_status"]).toBe("reserved");
    expect(patch).not.toHaveProperty("scheduled_at");
  });
});
