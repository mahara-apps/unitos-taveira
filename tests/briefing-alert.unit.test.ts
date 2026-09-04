import { describe, expect, it } from "vitest";
import { buildBriefingAlert } from "@/lib/briefing-alert";

describe("alerta de briefing", () => {
  it("não alerta quando o briefing está concluído, mesmo antigo", () => {
    for (const status of ["submitted", "in_review", "approved"]) {
      expect(buildBriefingAlert({ status, completion: 40 })).toBeNull();
    }
  });

  it("não alerta quando a completude é 100% em rascunho", () => {
    expect(buildBriefingAlert({ status: "draft", completion: 100 })).toBeNull();
  });

  it("alerta como crítico quando não há briefing", () => {
    expect(buildBriefingAlert({ status: "draft", completion: 0 })?.title).toBe(
      "Briefing não preenchido",
    );
  });

  it("alerta como incompleto (nunca 'desatualizado') em briefing parcial", () => {
    const a = buildBriefingAlert({ status: "draft", completion: 60 });
    expect(a?.title).toBe("Briefing incompleto");
    expect(a?.severity).toBe("warning");
  });

  it("alerta quando há atualização explicitamente solicitada", () => {
    expect(buildBriefingAlert({ status: "requested", completion: 100 })?.title).toBe(
      "Atualização de briefing pendente",
    );
  });
});
