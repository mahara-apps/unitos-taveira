import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BRIEFING_VERSION_GROUP_WINDOW_MS,
  suggestedVersionLabel,
} from "../src/lib/briefing-write.server";

describe("agrupamento e nome das versões de briefing", () => {
  it("agrupa salvamentos dentro de 10 minutos", () => {
    expect(BRIEFING_VERSION_GROUP_WINDOW_MS).toBe(600000);
  });

  it("sugere nome por origem e deixa a edição manual sem nome", () => {
    expect(suggestedVersionLabel("ai.import")).toBe("Importação por IA");
    expect(suggestedVersionLabel("portal")).toBe("Resposta do cliente");
    expect(suggestedVersionLabel("document")).toBe("Importação de documento");
    expect(suggestedVersionLabel("manual")).toBeNull();
  });

  it("nunca agrupa origens diferentes entre si", () => {
    const src = readFileSync("src/lib/briefing-write.server.ts", "utf8");
    const fn = src.slice(src.indexOf("upsertBriefingVersion"));
    expect(fn).toContain('.eq("origin", args.origin)');
    expect(fn).toContain('.gte("created_at", since)');
  });

  it("o assistente de pauta esconde a lista de versões por padrão", () => {
    const wizard = readFileSync("src/components/monthly-plan/generate-plan-wizard.tsx", "utf8");
    expect(wizard).toContain("useState(false)");
    expect(wizard).toContain("Usar uma versão anterior do briefing");
    expect(wizard).not.toContain("Briefing específico (opcional)");
  });
});
