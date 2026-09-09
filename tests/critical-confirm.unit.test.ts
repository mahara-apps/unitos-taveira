/**
 * Dupla confirmação obrigatória nas ações de risco (nível master).
 *
 * Regra de produto: nenhuma ação crítica executa com um clique. O texto exato
 * do alvo precisa ser digitado e o servidor revalida — a UI nunca é a única
 * barreira. Aqui garantimos o contrato compartilhado (registro de ações +
 * validação canônica) e a cobertura das ações protegidas no servidor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CRITICAL_ACTIONS,
  CRITICAL_ACTION_KEYS,
  assertConfirmLabel,
  matchesConfirmLabel,
} from "@/lib/critical-actions";

const read = (p: string) => readFileSync(p, "utf8");

describe("validação do texto de confirmação", () => {
  it("aceita o nome exato ignorando espaços nas pontas e caixa", () => {
    expect(matchesConfirmLabel("  Taveira ", "taveira")).toBe(true);
    expect(matchesConfirmLabel("Cliente A", "Cliente A")).toBe(true);
  });

  it("recusa texto diferente, vazio ou alvo ausente", () => {
    expect(matchesConfirmLabel("Taveir", "Taveira")).toBe(false);
    expect(matchesConfirmLabel("", "Taveira")).toBe(false);
    expect(matchesConfirmLabel("Taveira", "")).toBe(false);
    expect(matchesConfirmLabel("Taveira", null)).toBe(false);
    expect(matchesConfirmLabel(null, "Taveira")).toBe(false);
  });

  it("assertConfirmLabel lança quando não confere e passa quando confere", () => {
    expect(() => assertConfirmLabel("errado", "Taveira")).toThrow(/Confirmação inválida/);
    expect(() => assertConfirmLabel("Taveira", "Taveira")).not.toThrow();
  });
});

describe("registro de ações críticas", () => {
  it("toda chave tem definição com título e impacto", () => {
    for (const key of CRITICAL_ACTION_KEYS) {
      const def = CRITICAL_ACTIONS[key];
      expect(def, key).toBeTruthy();
      expect(def.title.length, key).toBeGreaterThan(2);
      expect(def.impact.length, key).toBeGreaterThan(10);
    }
  });
});

describe("cobertura no servidor (confirmação revalidada)", () => {
  const files: Array<[string, string[]]> = [
    ["src/lib/workspace.functions.ts", ["client.delete", "workspace.delete"]],
    ["src/lib/content.functions.ts", ["content.bulk_delete", "content.pipeline_delete"]],
    ["src/lib/team.functions.ts", ["member.remove", "invite.revoke"]],
    ["src/lib/feature-flags.functions.ts", ["feature.toggle"]],
    ["src/lib/admin-environment.functions.ts", ["environment.rename"]],
    ["src/lib/meta/app-config.functions.ts", ["meta_app.update"]],
    ["src/lib/ai-limits.functions.ts", ["ai_limits.update"]],
  ];

  for (const [file, actions] of files) {
    it(`${file} exige confirmLabel e registra auditoria`, () => {
      const src = read(file);
      expect(src).toContain("confirmLabel");
      expect(src).toContain("assertConfirmLabel");
      expect(src).toContain("logCriticalAction");
      for (const action of actions) expect(src).toContain(action);
    });
  }

  it("instalações exigem confirmação em todas as ações de risco", () => {
    const src = read("src/lib/installation/manager.functions.ts");
    expect(src).toContain("confirmLabel");
    expect(src).toContain("assertCriticalInstallationConfirm");
  });

  it("a validação da instalação cobre a tabela de auditoria", () => {
    expect(read("supabase/install/verify-installation.sql")).toContain("critical_action_events");
  });
});
