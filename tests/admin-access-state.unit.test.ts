import { describe, expect, it } from "vitest";

import { resolveAdminAccessState } from "@/lib/admin-access-state";

describe("gate da administração", () => {
  it("libera somente Super Admin confirmado", () => {
    expect(
      resolveAdminAccessState({ isPending: false, isError: false, isSuperAdmin: true }),
    ).toBe("allowed");
  });

  it("nega sem lançar redirect quando o usuário não é Super Admin", () => {
    expect(
      resolveAdminAccessState({ isPending: false, isError: false, isSuperAdmin: false }),
    ).toBe("denied");
  });

  it("mantém uma falha transitória recuperável", () => {
    expect(
      resolveAdminAccessState({ isPending: false, isError: true, isSuperAdmin: undefined }),
    ).toBe("error");
  });

  it("exibe carregamento enquanto a autoridade ainda não foi confirmada", () => {
    expect(
      resolveAdminAccessState({ isPending: true, isError: false, isSuperAdmin: undefined }),
    ).toBe("loading");
  });
});