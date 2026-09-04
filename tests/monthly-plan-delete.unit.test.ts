import { describe, expect, it } from "vitest";
import { deletePlanHard } from "@/lib/monthly-plan-delete.server";

/**
 * Exclusão definitiva de pauta: autoridade, bloqueio por peças materializadas
 * e preservação do projeto (só o vínculo é desfeito).
 */

type Row = Record<string, unknown>;

function makeClient(opts: {
  role: string | null;
  plan: Row | null;
  topicIds: string[];
  postCount: number;
}) {
  const calls: string[] = [];
  const client = {
    rpc: (_fn: string, _args: Record<string, unknown>) =>
      Promise.resolve({ data: opts.role, error: null }),
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: (_c?: string, o?: { count?: string; head?: boolean }) => {
          if (table === "posts" && o?.head) {
            return {
              in: () => Promise.resolve({ count: opts.postCount, error: null }),
            };
          }
          return chain;
        },
        update: (_v: unknown) => {
          calls.push(`update:${table}`);
          return { eq: () => Promise.resolve({ error: null }) };
        },
        delete: () => {
          calls.push(`delete:${table}`);
          return {
            eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
          };
        },
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: opts.plan, error: null }),
        then: undefined,
      };
      if (table === "monthly_plan_topics") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({ data: opts.topicIds.map((id) => ({ id })), error: null }),
          }),
        } as never;
      }
      return chain as never;
    },
  };
  return { client: client as never, calls };
}

const args = {
  planId: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  clientId: "33333333-3333-4333-8333-333333333333",
  userId: "44444444-4444-4444-8444-444444444444",
};

const plan = { id: args.planId, project_id: "55555555-5555-4555-8555-555555555555" };

describe("deletePlanHard", () => {
  it("exclui e desvincula o projeto quando é admin e não há peças", async () => {
    const { client, calls } = makeClient({ role: "admin", plan, topicIds: ["t1"], postCount: 0 });
    await expect(deletePlanHard(client, args)).resolves.toEqual({ ok: true });
    expect(calls).toContain("update:projects");
    expect(calls).toContain("delete:monthly_plans");
  });

  it("bloqueia quando a pauta já gerou peças de conteúdo", async () => {
    const { client, calls } = makeClient({ role: "admin", plan, topicIds: ["t1"], postCount: 2 });
    await expect(deletePlanHard(client, args)).rejects.toThrow("plan_has_content");
    expect(calls).not.toContain("delete:monthly_plans");
  });

  it("recusa manager/user", async () => {
    const { client } = makeClient({ role: "manager", plan, topicIds: [], postCount: 0 });
    await expect(deletePlanHard(client, args)).rejects.toThrow("forbidden");
  });

  it("recusa pauta fora do escopo", async () => {
    const { client } = makeClient({ role: "admin", plan: null, topicIds: [], postCount: 0 });
    await expect(deletePlanHard(client, args)).rejects.toThrow("plan_not_found");
  });
});
