/**
 * RBAC por área — gating de UI (espelho das regras do servidor/RLS).
 *
 * Regra de produto:
 *  - SUPER_ADMIN: acesso total (integrações + Administração do Cliente).
 *  - ADMIN (inclui OWNER, que normaliza para `admin` em `my_access`): todas as
 *    integrações; ZERO acesso a Administração do Cliente.
 *  - MANAGER/USER/CLIENT: sem autoridade de integração.
 *
 * Sem hardcode de usuário: a decisão depende SÓ do papel.
 */
import { describe, expect, it } from "vitest";
import { canAccessClientAdmin, canManageIntegrations } from "@/lib/permissions";
import { AUTHORITY_ROLES } from "@/lib/access-guard";

describe("autoridade de integração", () => {
  it("super_admin e admin podem gerenciar integrações", () => {
    expect(canManageIntegrations("super_admin")).toBe(true);
    expect(canManageIntegrations("admin")).toBe(true);
  });

  it("manager, user, client e desconhecido não podem", () => {
    expect(canManageIntegrations("manager")).toBe(false);
    expect(canManageIntegrations("user")).toBe(false);
    expect(canManageIntegrations("client")).toBe(false);
    expect(canManageIntegrations(null)).toBe(false);
    expect(canManageIntegrations(undefined)).toBe(false);
  });
});

describe("Administração do Cliente (Recursos/Identidade/Ambiente)", () => {
  it("somente super_admin", () => {
    expect(canAccessClientAdmin("super_admin")).toBe(true);
    for (const r of AUTHORITY_ROLES.filter((r) => r !== "super_admin")) {
      expect(canAccessClientAdmin(r)).toBe(false);
    }
    expect(canAccessClientAdmin(null)).toBe(false);
  });

  it("ADMIN nunca acessa, mesmo tendo autoridade de integração", () => {
    expect(canManageIntegrations("admin")).toBe(true);
    expect(canAccessClientAdmin("admin")).toBe(false);
  });
});
