import { describe, expect, it, vi } from "vitest";
import {
  CHAT_WORKSPACE_MISSING,
  ensureConversationBrandId,
  resolveUserBrandId,
} from "@/lib/chat/workspace.server";

function membersClient(rows: Array<{ brand_id: string | null; role: string | null }>) {
  const update = vi.fn(() => ({ eq: () => ({ is: () => Promise.resolve({ error: null }) }) }));
  const client = {
    from: (table: string) => {
      if (table === "brand_members") {
        return {
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
          }),
        };
      }
      return { update };
    },
    update,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, update };
}

describe("workspace da conversa de chat", () => {
  it("prioriza owner/admin ao resolver o workspace do usuário", async () => {
    const { client } = membersClient([
      { brand_id: "b-user", role: "user" },
      { brand_id: "b-owner", role: "owner" },
      { brand_id: "b-admin", role: "admin" },
    ]);
    await expect(resolveUserBrandId(client, "u1")).resolves.toBe("b-owner");
  });

  it("mantém o workspace já vinculado", async () => {
    const { client, update } = membersClient([{ brand_id: "b2", role: "owner" }]);
    await expect(
      ensureConversationBrandId(client, "u1", { id: "c1", brand_id: "b1" }),
    ).resolves.toBe("b1");
    expect(update).not.toHaveBeenCalled();
  });

  it("backfilla conversa legada sem workspace", async () => {
    const { client, update } = membersClient([{ brand_id: "b9", role: "manager" }]);
    await expect(
      ensureConversationBrandId(client, "u1", { id: "c1", brand_id: null }),
    ).resolves.toBe("b9");
    expect(update).toHaveBeenCalledWith({ brand_id: "b9" });
  });

  it("falha explicitamente quando o usuário não pertence a workspace", async () => {
    const { client } = membersClient([]);
    await expect(
      ensureConversationBrandId(client, "u1", { id: "c1", brand_id: null }),
    ).rejects.toThrow(CHAT_WORKSPACE_MISSING);
  });
});
