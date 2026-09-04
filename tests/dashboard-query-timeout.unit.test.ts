import { describe, expect, it } from "vitest";
import { QueryTimeoutError, withQueryTimeout } from "@/lib/query-timeout";

describe("withQueryTimeout", () => {
  it("resolve normalmente quando a query responde a tempo", async () => {
    await expect(withQueryTimeout(Promise.resolve("ok"), "X", 50)).resolves.toBe("ok");
  });

  it("falha com estado terminal quando a query nunca resolve", async () => {
    const never = new Promise<never>(() => {});
    await expect(withQueryTimeout(never, "O painel da conta", 20)).rejects.toBeInstanceOf(
      QueryTimeoutError,
    );
  });

  it("propaga o erro original da query", async () => {
    await expect(withQueryTimeout(Promise.reject(new Error("boom")), "X", 50)).rejects.toThrow(
      "boom",
    );
  });
});
