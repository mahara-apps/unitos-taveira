import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canBypassOverage,
  resolveOveragePolicy,
  tryAutoAuthorizeOverage,
} from "@/lib/plan-overage.server";

type Row = Record<string, unknown> | null;

function fakeSb(opts: {
  role?: string;
  brandPolicy?: string | null;
  clientPolicy?: string | null;
  onInsert?: (rows: unknown) => void;
}) {
  return {
    rpc: async () => ({ data: opts.role ?? "user", error: null }),
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async (): Promise<{ data: Row }> => ({
              data:
                table === "brands"
                  ? { overage_policy: opts.brandPolicy ?? "block" }
                  : { overage_policy: opts.clientPolicy ?? null },
            }),
          }),
        }),
        insert: async (rows: unknown) => {
          opts.onInsert?.(rows);
          return { error: null };
        },
      };
    },
  } as never;
}

const items = [{ channel: "instagram" as const, quota: 0, requested: 22, overage: 22 }];
const base = { brandId: "b", clientId: "c", userId: "u", items };

describe("excedente de volumetria — hierarquia e política", () => {
  it("Super Admin e Admin (inclui Owner) geram acima da volumetria", async () => {
    for (const role of ["super_admin", "admin"]) {
      expect(await canBypassOverage(fakeSb({ role }), "u", "b")).toBe(true);
    }
  });

  it("Manager e User não bypassam", async () => {
    for (const role of ["manager", "user", "client"]) {
      expect(await canBypassOverage(fakeSb({ role }), "u", "b")).toBe(false);
    }
  });

  it("override do cliente vence o padrão do workspace", async () => {
    expect(
      await resolveOveragePolicy(fakeSb({ brandPolicy: "block", clientPolicy: "warn" }), {
        brandId: "b",
        clientId: "c",
      }),
    ).toBe("warn");
    expect(
      await resolveOveragePolicy(fakeSb({ brandPolicy: "warn", clientPolicy: null }), {
        brandId: "b",
        clientId: "c",
      }),
    ).toBe("warn");
    expect(
      await resolveOveragePolicy(fakeSb({ brandPolicy: null, clientPolicy: null }), {
        brandId: "b",
        clientId: "c",
      }),
    ).toBe("block");
  });

  it("bypass registra o excedente como autorizado", async () => {
    let inserted: unknown = null;
    const res = await tryAutoAuthorizeOverage(
      fakeSb({ role: "admin", onInsert: (r) => (inserted = r) }),
      base,
    );
    expect(res).toEqual({ allowed: true, reason: "role_bypass" });
    expect((inserted as Array<{ status: string }>)[0]?.status).toBe("approved");
  });

  it("política warn libera Manager/User e também registra", async () => {
    let inserted: unknown = null;
    const res = await tryAutoAuthorizeOverage(
      fakeSb({ role: "manager", clientPolicy: "warn", onInsert: (r) => (inserted = r) }),
      base,
    );
    expect(res.allowed).toBe(true);
    expect(res.reason).toBe("policy_warn");
    expect(Array.isArray(inserted)).toBe(true);
  });

  it("política block mantém bloqueio para Manager/User", async () => {
    const res = await tryAutoAuthorizeOverage(fakeSb({ role: "manager" }), base);
    expect(res.allowed).toBe(false);
  });

  it("solicitação e decisão notificam in-app; decisão exige autoridade", () => {
    const fns = readFileSync("src/lib/plan-overage.functions.ts", "utf8");
    expect(fns).toContain("notifyOverageRequested");
    expect(fns).toContain("notifyOverageDecided");
    expect(fns).toContain("assertBrandAdmin");
    const notify = readFileSync("src/lib/plan-overage-notify.server.ts", "utf8");
    expect(notify).toContain("approval_requested");
    expect(notify).toContain("insertNotificationsDeduped");
  });
});
