import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORTAL_PERMISSIONS,
  normalizePortalPermissions,
  portalCanInteract,
  portalCanView,
  PORTAL_MODULES,
} from "@/lib/portal-permissions";
import { portalErrorMessage } from "@/components/portal/portal-shared";
import { visiblePortalTabs } from "@/components/portal/portal-nav";

describe("permissões do portal", () => {
  it("normaliza níveis inválidos para o padrão seguro", () => {
    const p = normalizePortalPermissions({ approvals: "admin", pauta: null, calendar: "interact" });
    expect(p.approvals).toBe(DEFAULT_PORTAL_PERMISSIONS.approvals);
    expect(p.pauta).toBe(DEFAULT_PORTAL_PERMISSIONS.pauta);
    expect(p.calendar).toBe("interact");
  });

  it("rebaixa interação em módulos somente leitura", () => {
    const p = normalizePortalPermissions({ files: "interact", brand: "interact" });
    expect(portalCanInteract(p, "files")).toBe(false);
    expect(portalCanInteract(p, "brand")).toBe(false);
    expect(portalCanView(p, "files")).toBe(true);
  });

  it("nível 'none' esconde o módulo", () => {
    const p = normalizePortalPermissions({ approvals: "none" });
    expect(portalCanView(p, "approvals")).toBe(false);
    expect(portalCanInteract(p, "approvals")).toBe(false);
  });

  it("todo módulo do catálogo tem padrão definido", () => {
    for (const m of PORTAL_MODULES) {
      expect(DEFAULT_PORTAL_PERMISSIONS[m.id]).toBeDefined();
    }
  });

  it("traduz bloqueios do servidor para linguagem do cliente", () => {
    expect(portalErrorMessage("portal_permission_denied:approvals")).toContain("não está liberado");
    expect(portalErrorMessage("portal_token_read_only")).toContain("somente de acompanhamento");
    expect(portalErrorMessage("network error")).toBeNull();
    expect(portalErrorMessage(undefined)).toBeNull();
  });
});

describe("navegação do portal segue as permissões", () => {
  const ids = (perms: unknown, isSession: boolean) =>
    visiblePortalTabs(normalizePortalPermissions(perms), isSession).map((t) => t.id);

  it("esconde módulo sem acesso e mantém Início", () => {
    const out = ids({ approvals: "none", files: "none" }, true);
    expect(out).toContain("home");
    expect(out).not.toContain("approvals");
    expect(out).not.toContain("files");
  });

  it("link sem senha não mostra Pedidos, Avisos nem Minha conta", () => {
    const out = ids(DEFAULT_PORTAL_PERMISSIONS, false);
    expect(out).not.toContain("requests");
    expect(out).not.toContain("notifications");
    expect(out).not.toContain("account");
  });

  it("login mostra Avisos e Minha conta", () => {
    const out = ids(DEFAULT_PORTAL_PERMISSIONS, true);
    expect(out).toContain("notifications");
    expect(out).toContain("account");
  });
});
