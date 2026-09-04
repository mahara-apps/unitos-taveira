import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PT_BR_DIRECTIVE, withPtBr } from "@/lib/ai-language";

/**
 * Impede reincidência: todo fluxo de geração de conteúdo por IA deve aplicar a
 * diretriz de idioma pt-BR (direta ou via withPtBr). Sem isso, o modelo devolve
 * valores em inglês quando as chaves do schema estão em inglês.
 */
/**
 * Só entram nesta lista módulos que realmente montam o prompt enviado ao modelo.
 * As rotas src/routes/api/jobs/analyze-briefing-text.ts e analyze-document.ts
 * apenas enfileiram o job: a execução (e o prompt) vive em
 * briefing-import-executor.server.ts.
 */
const GENERATION_FILES = [
  "src/routes/api/jobs/customer-pipeline.ts",
  "src/lib/briefing-import-executor.server.ts",
  "src/lib/post-agents.server.ts",
  "src/lib/monthly-plan-generate.server.ts",
  "src/lib/monthly-plans.functions.ts",
  "src/lib/media-plans-ai.functions.ts",
];


describe("diretriz de idioma pt-BR", () => {
  it("a diretriz exige conteúdo em português do Brasil", () => {
    expect(PT_BR_DIRECTIVE).toMatch(/portugu[êe]s do Brasil/i);
    expect(PT_BR_DIRECTIVE).toMatch(/IDIOMA:/);
  });

  it("withPtBr anexa a diretriz uma única vez", () => {
    const once = withPtBr("Você é um estrategista.");
    expect(once).toContain(PT_BR_DIRECTIVE);
    expect(withPtBr(once)).toBe(once);
  });

  it.each(GENERATION_FILES)("%s declara o idioma do conteúdo", (file) => {
    const src = readFileSync(file, "utf8");
    const hasDirective = src.includes("withPtBr") || /portugu[êe]s\s*\(?\s*(BR|Brasil)/i.test(src);
    expect(hasDirective, `${file} não aplica a diretriz de idioma pt-BR`).toBe(true);
  });
});
