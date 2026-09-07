import { describe, expect, it } from "vitest";
import { internalRecipients, portalPrefAllows } from "@/lib/client-comms.server";

describe("destinatários internos dos avisos do cliente", () => {
  const brandMembers = [
    { user_id: "owner", role: "owner" },
    { user_id: "admin", role: "admin" },
    { user_id: "manager", role: "manager" },
    { user_id: "user", role: "user" },
    { user_id: "super", role: "super_admin" },
    { user_id: "contato", role: "portal_client" },
  ];

  it("inclui todos os papéis internos, inclusive admin, super admin e usuário", () => {
    const set = internalRecipients({ brandMembers, clientMembers: [], ownerUserId: null });
    expect([...set].sort()).toEqual(["admin", "manager", "owner", "super", "user"]);
  });

  it("nunca inclui contato de portal", () => {
    const set = internalRecipients({
      brandMembers,
      clientMembers: [{ user_id: "contato", role: "portal_client" }],
      ownerUserId: null,
    });
    expect(set.has("contato")).toBe(false);
  });

  it("inclui o responsável pelo cliente quando ele é da equipe", () => {
    const set = internalRecipients({
      brandMembers: [{ user_id: "manager", role: "manager" }],
      clientMembers: [],
      ownerUserId: "manager",
    });
    expect(set.has("manager")).toBe(true);
  });

  it("ignora responsável que não pertence ao workspace", () => {
    const set = internalRecipients({
      brandMembers: [{ user_id: "owner", role: "owner" }],
      clientMembers: [],
      ownerUserId: "fora",
    });
    expect(set.has("fora")).toBe(false);
  });

  it("quem está ligado ao cliente entra só se também for interno", () => {
    const set = internalRecipients({
      brandMembers: [{ user_id: "user", role: "user" }],
      clientMembers: [
        { user_id: "user", role: "manager" },
        { user_id: "externo", role: "manager" },
      ],
      ownerUserId: null,
    });
    expect(set.has("user")).toBe(true);
    expect(set.has("externo")).toBe(false);
  });
});

describe("preferências de aviso do cliente", () => {
  it("sem preferência salva o cliente recebe tudo", () => {
    expect(portalPrefAllows(null, "requests")).toBe(true);
    expect(portalPrefAllows({}, "comments")).toBe(true);
  });

  it("respeita o tipo desligado", () => {
    expect(portalPrefAllows({ requests: false }, "requests")).toBe(false);
    expect(portalPrefAllows({ requests: false }, "comments")).toBe(true);
  });
});
