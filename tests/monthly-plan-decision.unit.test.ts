import { describe, expect, it } from "vitest";
import { decidePlanAsClient } from "@/lib/monthly-plan-decision.server";

/**
 * Fake mínimo do client Supabase: cobre os caminhos usados pela decisão do
 * cliente (plano, temas, updates, clientes, membros e notificações).
 */
type Row = Record<string, unknown>;

function makeSb(opts: {
  plan?: Row | null;
  topics?: Row[];
  topicUpdateError?: { code: string; message: string } | null;
  planUpdateError?: { code: string; message: string } | null;
}) {
  const calls = {
    topicUpdates: [] as Row[],
    planUpdates: [] as Row[],
    notifications: [] as Row[],
  };

  const table = (name: string) => {
    const state: { payload?: Row } = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      insert: (rows: Row[]) => {
        if (name === "notifications") calls.notifications.push(...rows);
        return Promise.resolve({ error: null });
      },
      update: (payload: Row) => {
        state.payload = payload;
        return builder;
      },
      maybeSingle: () => {
        if (name === "monthly_plans") return Promise.resolve({ data: opts.plan ?? null });
        if (name === "clients") return Promise.resolve({ data: { name: "Cliente X" } });
        return Promise.resolve({ data: null });
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (state.payload) {
          if (name === "monthly_plan_topics") {
            calls.topicUpdates.push(state.payload);
            return Promise.resolve({ error: opts.topicUpdateError ?? null }).then(resolve);
          }
          calls.planUpdates.push(state.payload);
          return Promise.resolve({ error: opts.planUpdateError ?? null }).then(resolve);
        }
        if (name === "monthly_plan_topics")
          return Promise.resolve({ data: opts.topics ?? [] }).then(resolve);
        return Promise.resolve({ data: [] }).then(resolve);
      },
    };
    return builder;
  };

  return { sb: { from: (name: string) => table(name) } as never, calls };
}

const PLAN = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Pauta de Setembro",
  status: "pending_client",
  created_by: "22222222-2222-2222-2222-222222222222",
  client_id: "33333333-3333-3333-3333-333333333333",
  brand_id: "44444444-4444-4444-4444-444444444444",
};

const TOPICS = [
  { id: "aaaaaaa1-1111-1111-1111-111111111111", topic_title: "Tema 1", position: 0 },
  { id: "aaaaaaa2-2222-2222-2222-222222222222", topic_title: "Tema 2", position: 1024 },
];

const base = {
  planId: PLAN.id,
  clientId: PLAN.client_id,
  brandId: PLAN.brand_id,
};

describe("decidePlanAsClient", () => {
  it("registra rejeição total como client_rejected", async () => {
    const { sb, calls } = makeSb({ plan: PLAN, topics: TOPICS });
    const res = await decidePlanAsClient(sb, {
      ...base,
      decision: "reject",
      feedback: "Não faz sentido para o mês.",
    });
    expect(res.status).toBe("client_rejected");
    expect(res.rejected).toBe(2);
    expect(calls.planUpdates[0]?.status).toBe("client_rejected");
    expect(calls.topicUpdates).toHaveLength(2);
  });

  it("exige feedback em ajustes", async () => {
    const { sb } = makeSb({ plan: PLAN, topics: TOPICS });
    await expect(
      decidePlanAsClient(sb, { ...base, decision: "changes", feedback: "  " }),
    ).rejects.toThrow("feedback_required");
  });

  it("bloqueia pauta já respondida", async () => {
    const { sb } = makeSb({ plan: { ...PLAN, status: "client_approved" }, topics: TOPICS });
    await expect(decidePlanAsClient(sb, { ...base, decision: "approve" })).rejects.toThrow(
      "plan_not_pending",
    );
  });

  it("aborta quando a gravação dos temas falha", async () => {
    const { sb } = makeSb({
      plan: PLAN,
      topics: TOPICS,
      topicUpdateError: { code: "42501", message: "denied" },
    });
    await expect(decidePlanAsClient(sb, { ...base, decision: "approve" })).rejects.toThrow(
      "decision_items_failed",
    );
  });

  it("decisão mista vira changes_requested e notifica a equipe", async () => {
    const { sb, calls } = makeSb({ plan: PLAN, topics: TOPICS });
    const res = await decidePlanAsClient(sb, {
      ...base,
      decision: "per_item",
      feedback: "Ajustar o segundo tema.",
      items: [
        { topicId: TOPICS[0]!.id, decision: "approved", comment: "" },
        { topicId: TOPICS[1]!.id, decision: "changes", comment: "Trocar o gancho." },
      ],
    });
    expect(res.status).toBe("changes_requested");
    expect(res.approved).toBe(1);
    expect(res.changes).toBe(1);
    expect(calls.notifications.length).toBeGreaterThan(0);
    expect(calls.notifications[0]?.kind).toBe("approval_decision");
    expect(String(calls.notifications[0]?.href)).toContain(PLAN.client_id);
  });
});
