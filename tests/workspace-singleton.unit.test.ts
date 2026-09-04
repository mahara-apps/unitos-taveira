import { describe, expect, it } from "vitest";
import {
  SINGLE_WORKSPACE_ERROR,
  assertSingleWorkspace,
  canCreateWorkspace,
  resolveInstallationWorkspaceId,
  shouldShowWorkspaceSwitcher,
} from "@/lib/workspace-singleton";

describe("workspace singleton da instalação", () => {
  it("permite criar workspace somente quando a instalação está vazia", () => {
    expect(canCreateWorkspace(0)).toBe(true);
    expect(canCreateWorkspace(1)).toBe(false);
    expect(canCreateWorkspace(5)).toBe(false);
  });

  it("nunca exibe UI de seleção/troca de workspace", () => {
    expect(shouldShowWorkspaceSwitcher()).toBe(false);
  });

  it("resolve o workspace automaticamente pelo contexto da instalação", () => {
    expect(resolveInstallationWorkspaceId(["a"])).toBe("a");
    expect(resolveInstallationWorkspaceId([])).toBeNull();
    expect(resolveInstallationWorkspaceId(null)).toBeNull();
  });

  it("falha quando a instalação tem mais de um workspace", () => {
    expect(() => assertSingleWorkspace(["a"])).not.toThrow();
    expect(() => assertSingleWorkspace([])).not.toThrow();
    expect(() => assertSingleWorkspace(["a", "b"])).toThrowError(SINGLE_WORKSPACE_ERROR);
  });
});
