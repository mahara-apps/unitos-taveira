import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetActiveWorkspace,
  getActiveWorkspace,
  markActiveWorkspaceUnresolved,
  publishActiveWorkspace,
  publishActiveWorkspaceError,
  waitForActiveWorkspace,
} from "@/lib/active-workspace";

/**
 * Regressão: o Dashboard ficava em skeleton infinito porque "resolvendo",
 * "sem workspace" e "falha ao resolver" compartilhavam o mesmo estado.
 */
describe("boot do Dashboard — estados do workspace", () => {
  beforeEach(() => __resetActiveWorkspace());

  it("estado inicial é 'resolving' (skeleton), não 'empty'", () => {
    expect(getActiveWorkspace().status).toBe("resolving");
    expect(getActiveWorkspace().resolved).toBe(false);
  });

  it("workspace encontrado no primeiro carregamento fica 'ready'", () => {
    publishActiveWorkspace("brand-a", true);
    expect(getActiveWorkspace()).toMatchObject({ brandId: "brand-a", status: "ready" });
  });

  it("usuário sem workspace fica 'empty' (estado vazio, não skeleton)", () => {
    publishActiveWorkspace(null, true);
    expect(getActiveWorkspace().status).toBe("empty");
  });

  it("falha ao listar workspaces é terminal 'error' — nunca skeleton eterno", () => {
    publishActiveWorkspaceError();
    const s = getActiveWorkspace();
    expect(s.status).toBe("error");
    expect(s.resolved).toBe(true);
  });

  it("o gate de features nunca espera indefinidamente após erro", async () => {
    publishActiveWorkspaceError();
    const s = await waitForActiveWorkspace(50);
    expect(s.status).toBe("error");
  });

  it("troca de identidade volta para 'resolving'", () => {
    publishActiveWorkspace("brand-a", true);
    markActiveWorkspaceUnresolved();
    expect(getActiveWorkspace().status).toBe("resolving");
    publishActiveWorkspace("brand-b", true);
    expect(getActiveWorkspace().brandId).toBe("brand-b");
  });
});
