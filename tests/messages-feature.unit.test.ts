import { describe, expect, it } from "vitest";
import { MODULE_KEYS, MODULES } from "@/lib/module-permissions";
import { SIDEBAR_ALLOWED_URLS } from "@/lib/permissions";

describe("Central de mensagens como módulo/recurso próprio", () => {
  it("existe um módulo Mensagens independente do Chat com IA", () => {
    expect(MODULE_KEYS).toContain("messages");
    const messages = MODULES.find((m) => m.key === "messages");
    expect(messages?.urls).toEqual(["/messages"]);
    const chat = MODULES.find((m) => m.key === "chat");
    expect(chat?.urls).toEqual(["/chat"]);
  });

  it("a tela de mensagens está liberada para os papéis do workspace", () => {
    expect(SIDEBAR_ALLOWED_URLS.admin.has("/messages")).toBe(true);
    expect(SIDEBAR_ALLOWED_URLS.user.has("/messages")).toBe(true);
  });
});
