import { describe, it, expect } from "vitest";
import { asText, asList, normalizeCohorts, describePayloadKeys } from "@/lib/ai-payload-coerce";

describe("asText / asList", () => {
  it("aceita string, número e lista", () => {
    expect(asText(" oi ")).toBe("oi");
    expect(asText(42)).toBe("42");
    expect(asText(["a", "b"])).toBe("a; b");
  });

  it("achata objeto aninhado em texto legível", () => {
    expect(asText({ canal_principal: "Instagram", frequencia: 3 })).toBe(
      "canal principal: Instagram | frequencia: 3",
    );
  });

  it("converte string única em lista", () => {
    expect(asList("Persona A")).toEqual(["Persona A"]);
    expect(asList(["A", 2])).toEqual(["A", "2"]);
    expect(asList(null)).toEqual([]);
  });
});

describe("normalizeCohorts", () => {
  it("aceita campos em lista", () => {
    const out = normalizeCohorts({
      cohorts: [
        {
          name: "Curiosos",
          target_personas: "Ana",
          behavioral_traits: ["pesquisa muito", "compara preços"],
          content_strategy: ["conteúdo educativo"],
          conversion_criteria: ["clicou no link"],
        },
      ],
    });
    expect(out.cohorts[0]).toMatchObject({
      name: "Curiosos",
      target_personas: ["Ana"],
      behavioral_traits: "pesquisa muito; compara preços",
      content_strategy: "conteúdo educativo",
      conversion_criteria: "clicou no link",
    });
  });

  it("aceita objeto aninhado e aliases PT-BR", () => {
    const out = normalizeCohorts({
      coortes: [
        {
          nome: "Decisores",
          personas_alvo: ["Bruno"],
          perfil_comportamental: { compra: "rápida", ticket: "alto" },
          estrategia: "prova social",
          criterios_de_conversao: "pediu orçamento",
        },
      ],
    });
    expect(out.cohorts).toHaveLength(1);
    expect(out.cohorts[0]!.name).toBe("Decisores");
    expect(out.cohorts[0]!.behavioral_traits).toContain("rápida");
    expect(out.cohorts[0]!.content_strategy).toBe("prova social");
    expect(out.cohorts[0]!.conversion_criteria).toBe("pediu orçamento");
  });

  it("aceita array na raiz", () => {
    const out = normalizeCohorts([{ nome: "X", comportamento: "impulsivo" }]);
    expect(out.cohorts[0]!.behavioral_traits).toBe("impulsivo");
  });

  it("continua vazio quando não há conteúdo real", () => {
    expect(normalizeCohorts({}).cohorts).toEqual([]);
    const empty = normalizeCohorts({ cohorts: [{ name: "Y" }] });
    expect(empty.cohorts[0]!.behavioral_traits).toBe("");
    expect(empty.cohorts[0]!.content_strategy).toBe("");
  });
});

describe("describePayloadKeys", () => {
  it("descreve apenas a forma, sem conteúdo", () => {
    expect(describePayloadKeys({ cohorts: [] })).toBe("{cohorts}");
    expect(describePayloadKeys([{ nome: "secreto" }])).toBe("array(1) item:{nome}");
  });
});
