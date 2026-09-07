import { describe, expect, it } from "vitest";

import {
  clientApprovalRequired,
  defaultApprovalPolicy,
  defaultScopePolicy,
  normalizeApprovalPolicy,
  normalizeScopePolicy,
  scopeBlocks,
} from "@/lib/client-policy";

describe("política de aprovação por cliente", () => {
  it("sem configuração, mantém o comportamento histórico (cliente aprova tudo)", () => {
    expect(normalizeApprovalPolicy(null, null)).toEqual(defaultApprovalPolicy());
    expect(normalizeApprovalPolicy({}, {})).toEqual(defaultApprovalPolicy());
  });

  it("cliente sobrescreve workspace por etapa", () => {
    const p = normalizeApprovalPolicy(
      { plan: "internal" },
      { plan: "client", content: "internal" },
    );
    expect(p).toEqual({ plan: "internal", content: "internal", schedule: "client" });
    expect(clientApprovalRequired(p, "plan")).toBe(false);
    expect(clientApprovalRequired(p, "schedule")).toBe(true);
  });

  it("ignora valores inválidos", () => {
    expect(normalizeApprovalPolicy({ plan: "sim", content: 3 })).toEqual(defaultApprovalPolicy());
  });
});

describe("limite de produção", () => {
  it("padrão histórico: bloqueia apenas a geração por IA", () => {
    const p = normalizeScopePolicy({});
    expect(p).toEqual(defaultScopePolicy());
    expect(scopeBlocks(p, "ai")).toBe(true);
    expect(scopeBlocks(p, "manual")).toBe(false);
  });

  it("respeita o campo legado overage_policy", () => {
    const p = normalizeScopePolicy({ clientLegacy: "warn" });
    expect(p.mode).toBe("warn");
    expect(scopeBlocks(p, "ai")).toBe(false);
  });

  it("cliente pode incluir a criação manual no bloqueio", () => {
    const p = normalizeScopePolicy({
      clientScope: { mode: "block", applies: ["ai", "manual"] },
      brandScope: { mode: "warn" },
    });
    expect(scopeBlocks(p, "manual")).toBe(true);
  });

  it("modo avisar nunca bloqueia, mesmo com frentes marcadas", () => {
    const p = normalizeScopePolicy({ clientScope: { mode: "warn", applies: ["ai", "manual"] } });
    expect(scopeBlocks(p, "ai")).toBe(false);
    expect(scopeBlocks(p, "manual")).toBe(false);
  });
});
