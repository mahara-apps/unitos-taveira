import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.resolve(file), "utf8");

describe("guardião de apresentação PT-BR", () => {
  it("fixa o calendário compartilhado em pt-BR", () => {
    const source = read("src/components/ui/calendar.tsx");
    expect(source).toContain("locale={ptBR}");
    expect(source).toContain('toLocaleString("pt-BR"');
    expect(source).not.toContain('toLocaleString("default"');
  });

  it("mantém o briefing público integralmente em português", () => {
    const source = read("src/routes/p.briefing.$token.tsx");
    for (const english of [
      "Something went wrong",
      "Please try",
      "Welcome,",
      "Business overview",
      "Target audience",
      "Tone of voice",
      "Add custom tone",
      "Submit briefing",
    ]) {
      expect(source).not.toContain(english);
    }
  });

  it("mantém segundos nos formatadores humanos centrais", () => {
    const source = read("src/lib/timezone.ts");
    expect(source.match(/second: "2-digit"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});