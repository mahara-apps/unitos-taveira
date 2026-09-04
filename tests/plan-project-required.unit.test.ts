import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  requiredOrganization,
  toOrganizationInput,
} from "@/components/monthly-plan/pauta-organization-field";

const read = (p: string) => readFileSync(p, "utf8");

describe("projeto obrigatório na criação de pauta", () => {
  it("rejeita 'nenhum projeto' quando allowNone=false", () => {
    expect(toOrganizationInput({ mode: "none" }, false)).toBeNull();
    expect(toOrganizationInput({ mode: "none" })).toEqual({ mode: "none" });
  });

  it("exige projeto escolhido ou nome do novo projeto", () => {
    expect(toOrganizationInput(requiredOrganization, false)).toBeNull();
    expect(
      toOrganizationInput({ mode: "existing", projectId: "11111111-1111-1111-1111-111111111111" }, false),
    ).toEqual({ mode: "existing", projectId: "11111111-1111-1111-1111-111111111111" });
    expect(toOrganizationInput({ mode: "new", name: "  ", description: "", due_at: "" }, false)).toBeNull();
    expect(
      toOrganizationInput({ mode: "new", name: "POSTS SETEMBRO", description: "", due_at: "" }, false),
    ).toEqual({ mode: "new", name: "POSTS SETEMBRO", description: null, due_at: null });
  });

  it("nenhum fluxo cria projeto automaticamente", () => {
    const project = read("src/lib/monthly-plan-project.server.ts");
    expect(project).not.toMatch(/from\("projects"\)\s*\.insert/);
    expect(project).toContain("reconcilePlanProjectLink");

    const kanban = read("src/lib/monthly-plan-kanban.server.ts");
    expect(kanban).not.toContain("ensurePlanProject");
    expect(kanban).toContain('throw new Error("project_required")');
  });

  it("criação manual e aprovação interna exigem projeto", () => {
    const fns = read("src/lib/monthly-plans.functions.ts");
    expect(fns).toContain('if (data.organization.mode === "none") throw new Error("project_required")');
    expect(fns).toContain('if (!plan.project_id) throw new Error("project_required")');
    expect(fns).toContain("linkPlanToProject");
  });

  it("wizard de IA envia a organização escolhida", () => {
    const wizard = read("src/components/monthly-plan/generate-plan-wizard.tsx");
    expect(wizard).toContain("allowNone={false}");
    expect(wizard).toContain("organization: PlanOrganizationInput");
  });
});
