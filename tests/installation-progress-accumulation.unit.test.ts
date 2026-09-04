import { describe, expect, it } from "vitest";
import { applyProgressReport } from "@/lib/installation/runner.server";
import {
  applyStepReport,
  initialSteps,
  stepsProgress,
} from "@/lib/installation/manager-contract";

/** Cliente Supabase falso com uma única linha de installation_operations. */
function fakeClient(initialSteps: unknown) {
  const row: { id: string; steps: unknown } = { id: "op-1", steps: initialSteps };
  const client = {
    from() {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq() {
              if ("steps" in patch) row.steps = patch.steps;
              return Promise.resolve({ error: null });
            },
          };
        },
        select() {
          return {
            eq() {
              return { maybeSingle: () => Promise.resolve({ data: { steps: row.steps }, error: null }) };
            },
          };
        },
      };
    },
  };
  return { client, row };
}

describe("applyProgressReport acumula etapas", () => {
  it("preserva etapas já concluídas ao reportar a próxima", async () => {
    const initial = initialSteps("provision");
    const { client, row } = fakeClient(initial);
    const op = { id: "op-1", kind: "provision", steps: initial } as never;

    await applyProgressReport(client as never, op, { step: "supabase", state: "done" });
    await applyProgressReport(client as never, op, { step: "database", state: "done" });
    const steps = await applyProgressReport(client as never, op, {
      step: "storage",
      state: "error",
      detail: "006_storage_policies falhou",
    });

    const byId = Object.fromEntries(steps.map((s) => [s.id, s.state]));
    expect(byId["supabase"]).toBe("done");
    expect(byId["database"]).toBe("done");
    expect(byId["storage"]).toBe("error");
    expect(steps.filter((s) => s.state === "done")).toHaveLength(2);
    expect(row.steps).toEqual(steps);
  });
});

describe("percentual por etapa", () => {
  it("guarda o percentual reportado e completa em 100% ao concluir", () => {
    let steps = initialSteps("provision");
    steps = applyStepReport(steps, { step: "code", state: "running", percent: 37.4 });
    expect(steps.find((s) => s.id === "code")?.percent).toBe(37);

    // Report sem percentual não apaga a última medição.
    steps = applyStepReport(steps, { step: "code", state: "running", detail: "publicando" });
    expect(steps.find((s) => s.id === "code")?.percent).toBe(37);

    steps = applyStepReport(steps, { step: "code", state: "done" });
    expect(steps.find((s) => s.id === "code")?.percent).toBe(100);
  });

  it("progresso geral conta a fração da etapa em execução", () => {
    let steps = initialSteps("provision");
    const total = steps.length;
    steps = applyStepReport(steps, { step: "supabase", state: "done" });
    const antes = stepsProgress(steps).percent;
    steps = applyStepReport(steps, { step: "code", state: "running", percent: 50 });
    const depois = stepsProgress(steps).percent;
    expect(depois).toBeGreaterThan(antes);
    expect(depois).toBe(Math.round(((1 + 0.5) / total) * 100));
  });
});
