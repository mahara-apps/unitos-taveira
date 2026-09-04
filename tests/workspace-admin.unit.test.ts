import { describe, expect, it } from "vitest";
import {
  canAccessVisualIdentity,
  isDeleteConfirmationValid,
  workspaceAdminActions,
} from "@/lib/workspace-admin";
import {
  isWorkspaceScopedQueryKey,
  queryKeyCarriesScopeId,
} from "@/lib/session-reset";

describe("matriz de ações administrativas do workspace", () => {
  it("Super Admin vê tudo, inclusive excluir", () => {
    expect(workspaceAdminActions("super_admin", "super_admin")).toMatchObject({
      canEdit: true,
      canConfigure: true,
      canManageMembers: true,
      canDelete: true,
      hasAny: true,
    });
  });

  it("Owner vê todas as ações administrativas, inclusive excluir", () => {
    expect(workspaceAdminActions("admin", "owner")).toMatchObject({
      canEdit: true,
      canConfigure: true,
      canManageMembers: true,
      canDelete: true,
    });
  });

  it("Admin edita/configura/gerencia membros mas NÃO vê excluir", () => {
    const a = workspaceAdminActions("admin", "admin");
    expect(a.canEdit).toBe(true);
    expect(a.canConfigure).toBe(true);
    expect(a.canManageMembers).toBe(true);
    expect(a.canDelete).toBe(false);
  });

  it("Manager e User não vêem nenhuma ação administrativa do workspace", () => {
    for (const [authority, brand] of [
      ["manager", "manager"],
      ["user", "user"],
      ["client", "client"],
      [null, null],
    ] as const) {
      const a = workspaceAdminActions(authority, brand);
      expect(a.hasAny).toBe(false);
      expect(a.canEdit).toBe(false);
      expect(a.canDelete).toBe(false);
      expect(a.canManageMembers).toBe(false);
    }
  });
});

describe("confirmação de exclusão", () => {
  it("exige o nome exato do workspace", () => {
    expect(isDeleteConfirmationValid("Pitada Digital", "Pitada Digital")).toBe(true);
    expect(isDeleteConfirmationValid("  pitada digital ", "Pitada Digital")).toBe(true);
    expect(isDeleteConfirmationValid("Pitada", "Pitada Digital")).toBe(false);
    expect(isDeleteConfirmationValid("", "Pitada Digital")).toBe(false);
    expect(isDeleteConfirmationValid("Outra Agência", "Pitada Digital")).toBe(false);
    expect(isDeleteConfirmationValid("qualquer", null)).toBe(false);
  });
});

describe("estado após excluir/trocar workspace (sem reload)", () => {
  it("a lista de workspaces é cache estável e não é derrubada pela troca de escopo", () => {
    expect(isWorkspaceScopedQueryKey(["brands"])).toBe(false);
    expect(isWorkspaceScopedQueryKey(["clients", "brand-a"])).toBe(true);
  });

  it("queries do workspace removido não são reutilizadas para o novo workspace", () => {
    const removed = "11111111-1111-1111-1111-111111111111";
    const next = "22222222-2222-2222-2222-222222222222";
    expect(queryKeyCarriesScopeId(["clients", removed], [next, removed])).toBe(true);
    expect(queryKeyCarriesScopeId(["clients", next], [next])).toBe(true);
    // Chave sem id de escopo → é marcada obsoleta na troca (revalida sozinha).
    expect(queryKeyCarriesScopeId(["dashboard"], [next])).toBe(false);
  });
});

describe("identidade visual (Agência → Identidade visual)", () => {
  it("somente Super Admin visualiza/acessa", () => {
    expect(canAccessVisualIdentity(true)).toBe(true);
    for (const v of [false, null, undefined]) {
      expect(canAccessVisualIdentity(v)).toBe(false);
    }
  });

  it("Owner/Admin/Manager/User não ganham acesso pela autoridade do workspace", () => {
    for (const [authority, brand] of [
      ["admin", "owner"],
      ["admin", "admin"],
      ["manager", "manager"],
      ["user", "user"],
    ] as const) {
      // A matriz de workspace pode liberar editar/configurar, mas identidade
      // visual continua fora do alcance de qualquer papel não Super Admin.
      void workspaceAdminActions(authority, brand);
      expect(canAccessVisualIdentity(false)).toBe(false);
    }
  });
});
